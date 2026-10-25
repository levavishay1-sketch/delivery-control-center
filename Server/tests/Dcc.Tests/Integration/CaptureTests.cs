using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dcc.Tests.Support;

namespace Dcc.Tests.Integration;

/// <summary>
/// POST /events — what the hooks and the "add note" form record: where an event lands (an id, a key inside its own
/// client, a branch, else the inbox), who it is by (always a person), the ledger row a session leaves, a note's
/// correction, and the wall between clients that the old shared-secret route did not have.
/// </summary>
[Collection(DbCollection.Name)]
public sealed class CaptureTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    private static async Task<JsonElement> Refused(HttpResponseMessage res, HttpStatusCode status)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(res.StatusCode == status, $"expected {(int)status}, got {(int)res.StatusCode}: {body}");
        return body;
    }

    private async Task<HttpClient> Admin() => _f.Client(await _f.AdminTokenAsync());

    private static string NewKey() => "CAP-" + Random.Shared.Next(100000, 999999);

    private async Task<(Guid ClientId, Guid ReqId, string Key)> NewRequirement(HttpClient admin)
    {
        var clientId = await _f.NewClientAsync();
        var key = NewKey();
        var row = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "Tiered discounts", type = "feature", key }));
        return (clientId, row.GetProperty("id").GetGuid(), key);
    }

    /// <summary>A person with <paramref name="roleKey"/> on the client, signed in with an API token an admin minted for them (the hooks' way in).</summary>
    private async Task<(Guid Id, HttpClient Hook)> PersonWithToken(HttpClient admin, string roleKey, Guid clientId)
    {
        var (id, _, _) = await _f.NewUserAsync();
        await _f.AssignAsync("user", id, roleKey, "client", clientId);
        var created = await Ok(await admin.PostAsJsonAsync("/tokens", new { name = "hooks", forAgentId = id }));
        return (id, _f.Client(created.GetProperty("secret").GetString()!));
    }

    private static object SessionBody(string summary = "Built the DiscountTier model.") =>
        new { sessionId = "sess-" + Guid.NewGuid().ToString("N")[..8], transcriptPath = "C:/t/transcript.jsonl", summary };

    [Fact]
    public async Task A_hook_session_lands_on_the_requirement_its_branch_names_with_one_ledger_row_and_no_second_timeline_entry()
    {
        var admin = await Admin();
        var (clientId, reqId, key) = await NewRequirement(admin);
        var (devId, hook) = await PersonWithToken(admin, "reader", clientId); // reading the work is enough to log your own session

        var summary = "Implemented flat-tier calc; pro-rata stubbed. " + new string('x', 300);
        var res = await Ok(await hook.PostAsJsonAsync("/events", new { clientId, branch = $"feature/{key}-tiered-discount", kind = "session", session = SessionBody(summary) }));
        Assert.Equal(reqId, res.GetProperty("workitemId").GetGuid());
        Assert.True(res.GetProperty("assigned").GetBoolean());
        var eventId = res.GetProperty("eventId").GetGuid();

        var events = (await Ok(await admin.GetAsync($"/workitems/{reqId}/timeline"))).GetProperty("events").EnumerateArray().ToList();
        var ev = Assert.Single(events);
        Assert.Equal("claude.session", ev.GetProperty("type").GetString());
        Assert.Equal("claude_session", ev.GetProperty("source").GetString());
        Assert.Equal("user", ev.GetProperty("actor").GetProperty("kind").GetString());
        Assert.Equal(devId, ev.GetProperty("actor").GetProperty("userId").GetGuid());
        Assert.Equal("interactive", ev.GetProperty("actor").GetProperty("identityType").GetString());
        Assert.Equal("session", ev.GetProperty("links")[0].GetProperty("rel").GetString());
        Assert.Equal("C:/t/transcript.jsonl", ev.GetProperty("payload").GetProperty("transcriptPath").GetString());
        Assert.False(ev.GetProperty("payload").TryGetProperty("model", out _)); // nothing sent, nothing stored

        Assert.Equal(1L, await _f.ScalarAsync<long>("select count(*) from claude_call where workitem_id = @w", ("w", reqId)));
        Assert.Equal($"event:{eventId}", await _f.ScalarAsync<string>("select source_ref from claude_call where workitem_id = @w", ("w", reqId)));
        Assert.Equal("interactive_session|hook|workitem|0.000000", await _f.ScalarAsync<string>(
            "select capability || '|' || trigger || '|' || entity_kind || '|' || cost_usd from claude_call where workitem_id = @w", ("w", reqId)));
        Assert.Equal(devId, await _f.ScalarAsync<Guid>("select user_id from claude_call where workitem_id = @w", ("w", reqId)));
        Assert.Equal(summary[..200], await _f.ScalarAsync<string>("select label from claude_call where workitem_id = @w", ("w", reqId)));

        var brief = await admin.GetStringAsync($"/workitems/{reqId}/brief");
        Assert.Contains("**claude_session** claude.session — Implemented flat-tier calc; pro-rata stubbed.", brief);
    }

    [Fact]
    public async Task Git_activity_on_an_unknown_branch_and_a_session_with_no_branch_land_in_the_clients_inbox()
    {
        var admin = await Admin();
        var (clientId, _, _) = await NewRequirement(admin);
        var (_, hook) = await PersonWithToken(admin, "reader", clientId);

        var at = DateTimeOffset.UtcNow.AddHours(-2);
        var git = await Ok(await hook.PostAsJsonAsync("/events", new
        {
            clientId, branch = "main", occurredAt = at, kind = "git",
            git = new { repo = "CRM", branch = "main", kind = "pull_request", prNumber = 42, shas = new[] { "a1b2c3d", "e4f5g6h" } },
        }));
        Assert.False(git.GetProperty("assigned").GetBoolean());
        Assert.Equal(JsonValueKind.Null, git.GetProperty("workitemId").ValueKind);

        // session-end sends branch: null on a detached HEAD — the old schema refused it and the session was lost
        var session = await Ok(await hook.PostAsJsonAsync("/events", new { clientId, branch = (string?)null, kind = "session", session = SessionBody() }));
        Assert.False(session.GetProperty("assigned").GetBoolean());
        Assert.Equal("none|", await _f.ScalarAsync<string>("select entity_kind || '|' || coalesce(workitem_id::text, '') from claude_call where source_ref = @r",
            ("r", $"event:{session.GetProperty("eventId").GetGuid()}")));

        var inbox = (await Ok(await admin.GetAsync($"/clients/{clientId}/inbox"))).GetProperty("events").EnumerateArray().ToList();
        var g = inbox.Single(e => e.GetProperty("id").GetGuid() == git.GetProperty("eventId").GetGuid());
        Assert.Equal("git", g.GetProperty("source").GetString());
        Assert.Equal(new[] { "pull_request:42", "commit:a1b2c3d", "commit:e4f5g6h" },
            g.GetProperty("links").EnumerateArray().Select(l => $"{l.GetProperty("rel").GetString()}:{l.GetProperty("ref").GetString()}").ToArray());
        Assert.Equal(at.ToUnixTimeMilliseconds(), DateTimeOffset.Parse(g.GetProperty("occurredAt").GetString()!).ToUnixTimeMilliseconds());
        Assert.Contains(inbox, e => e.GetProperty("id").GetGuid() == session.GetProperty("eventId").GetGuid());
    }

    [Fact]
    public async Task Capture_keeps_the_old_refusals()
    {
        var admin = await Admin();
        var (clientId, reqId, _) = await NewRequirement(admin);

        var none = await Refused(await admin.PostAsJsonAsync("/events", new { kind = "note", note = new { body = "x" } }), (HttpStatusCode)422);
        Assert.Equal("cannot determine client; pass clientId or a resolvable workitem", none.GetProperty("error").GetString());
        foreach (var kind in new[] { "session", "git", "note" })
        {
            var missing = await Refused(await admin.PostAsJsonAsync("/events", new { workitemId = reqId, kind }), HttpStatusCode.BadRequest);
            Assert.Equal($"{kind} body required", missing.GetProperty("error").GetString());
        }
        await Refused(await admin.PostAsJsonAsync("/events", new { workitemId = reqId, kind = "call" }), HttpStatusCode.BadRequest);
        await Refused(await admin.PostAsJsonAsync("/events", new { workitemId = Guid.NewGuid(), kind = "note", note = new { body = "x" } }), HttpStatusCode.NotFound);
        await Refused(await admin.PostAsJsonAsync("/events", new { workitemId = reqId, kind = "git", git = new { repo = "r", branch = "b", kind = "merge" } }), HttpStatusCode.BadRequest);
        await Refused(await admin.PostAsJsonAsync("/events", new { workitemId = reqId, occurredAt = DateTimeOffset.UtcNow.AddHours(1), kind = "note", note = new { body = "x" } }),
            HttpStatusCode.BadRequest);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.Client().PostAsJsonAsync("/events", new { clientId, kind = "note", note = new { body = "x" } })).StatusCode);
    }

    [Fact]
    public async Task A_key_is_looked_up_only_inside_the_client_the_body_names()
    {
        var admin = await Admin();
        var (clientA, reqA, keyA) = await NewRequirement(admin);
        var (clientB, _, _) = await NewRequirement(admin);

        var found = await Ok(await admin.PostAsJsonAsync("/events", new { clientId = clientA, workitemKey = keyA, kind = "note", note = new { body = "by key" } }));
        Assert.Equal(reqA, found.GetProperty("workitemId").GetGuid());

        // the old route looked a key up across every client; now A's key is simply not in B
        await Refused(await admin.PostAsJsonAsync("/events", new { clientId = clientB, workitemKey = keyA, kind = "note", note = new { body = "x" } }), HttpStatusCode.NotFound);
        await Refused(await admin.PostAsJsonAsync("/events", new { workitemKey = keyA, kind = "note", note = new { body = "x" } }), HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Outside_the_wall_a_key_gets_the_same_refusal_whether_or_not_it_is_there()
    {
        var admin = await Admin();
        var (clientA, _, _) = await NewRequirement(admin);
        var (clientB, _, keyB) = await NewRequirement(admin);
        var (_, reader) = await PersonWithToken(admin, "reader", clientA);

        async Task<string> RefusedAsync(object body, HttpStatusCode status) => (await Refused(await reader.PostAsJsonAsync("/events", body), status)).ToString();

        // keys are guessable: "WI-1284 is not in B" must not read differently from "WI-1284 is in B, and you may not"
        Assert.Equal(
            await RefusedAsync(new { clientId = clientB, workitemKey = keyB, kind = "session", session = SessionBody() }, HttpStatusCode.Forbidden),
            await RefusedAsync(new { clientId = clientB, workitemKey = "NOPE-1", kind = "session", session = SessionBody() }, HttpStatusCode.Forbidden));
        Assert.Equal(
            await RefusedAsync(new { clientId = clientB, workitemKey = keyB, kind = "note", note = new { body = "x" } }, HttpStatusCode.Forbidden),
            await RefusedAsync(new { clientId = clientB, workitemKey = "NOPE-1", kind = "note", note = new { body = "x" } }, HttpStatusCode.Forbidden));
        // nor does a missing body give a found key away: the wall answers before the shape of the body does
        Assert.Contains("forbidden", await RefusedAsync(new { clientId = clientB, workitemKey = keyB, kind = "session" }, HttpStatusCode.Forbidden));

        // inside a client they may read, a key that is not there is still the old 404; an unknown client is 404 too
        Assert.Contains("workitem not found", await RefusedAsync(new { clientId = clientA, workitemKey = "NOPE-1", kind = "session", session = SessionBody() }, HttpStatusCode.NotFound));
        Assert.Contains("client not found", await RefusedAsync(new { clientId = Guid.NewGuid(), workitemKey = keyB, kind = "session", session = SessionBody() }, HttpStatusCode.NotFound));
        Assert.Equal(0L, await _f.ScalarAsync<long>("select count(*) from event_log where client_id = @c", ("c", clientB)));
    }

    [Fact]
    public async Task A_session_whose_ledger_row_cannot_be_written_is_still_captured()
    {
        var admin = await Admin();
        var (_, reqId, _) = await NewRequirement(admin);

        // a cost past claude_call.cost_usd's numeric(12,6) passes the event's schema, then fails the ledger insert
        var res = await Ok(await admin.PostAsJsonAsync("/events", new
        {
            workitemId = reqId, kind = "session",
            session = new { sessionId = "sess-overflow", summary = "Ledger refused this one.", costUsd = 1_000_000 },
        }));
        var eventId = res.GetProperty("eventId").GetGuid();

        Assert.Equal(1L, await _f.ScalarAsync<long>("select count(*) from event_log where id = @e and type = 'claude.session'", ("e", eventId)));
        Assert.Equal(0L, await _f.ScalarAsync<long>("select count(*) from claude_call where source_ref = @r", ("r", $"event:{eventId}")));
        Assert.Contains("claude.session — Ledger refused this one.", await admin.GetStringAsync($"/workitems/{reqId}/brief"));
    }

    [Fact]
    public async Task Two_people_correcting_the_same_note_at_once_leave_one_correction()
    {
        var admin = await Admin();
        var (_, reqId, _) = await NewRequirement(admin);
        var first = (await Ok(await admin.PostAsJsonAsync("/events", new { workitemId = reqId, kind = "note", note = new { body = "Ronit called." } })))
            .GetProperty("eventId").GetGuid();

        var tries = await Task.WhenAll(Enumerable.Range(0, 4).Select(i =>
            admin.PostAsJsonAsync("/events", new { workitemId = reqId, kind = "note", note = new { body = $"correction {i}", corrects = first } })));

        Assert.Equal(1, tries.Count(r => r.StatusCode == HttpStatusCode.Created));
        Assert.Equal(3, tries.Count(r => r.StatusCode == HttpStatusCode.Conflict));
        Assert.Equal(1L, await _f.ScalarAsync<long>("select count(*) from event_log where supersedes = @e", ("e", first)));
    }

    [Fact]
    public async Task The_wall_holds_a_reader_logs_work_but_writes_no_note_and_reaches_no_other_client()
    {
        var admin = await Admin();
        var (clientA, reqA, keyA) = await NewRequirement(admin);
        var (clientB, reqB, keyB) = await NewRequirement(admin);
        var (_, reader) = await PersonWithToken(admin, "reader", clientA);

        await Ok(await reader.PostAsJsonAsync("/events", new { workitemId = reqA, kind = "git", git = new { repo = "CRM", branch = $"x/{keyA}", kind = "push" } }));

        var note = await Refused(await reader.PostAsJsonAsync("/events", new { workitemId = reqA, kind = "note", note = new { body = "x" } }), HttpStatusCode.Forbidden);
        Assert.Equal("requirements.edit", note.GetProperty("permission").GetString());
        await Refused(await reader.PostAsJsonAsync("/events", new { clientId = clientB, branch = "main", kind = "session", session = SessionBody() }), HttpStatusCode.Forbidden);
        await Refused(await reader.PostAsJsonAsync("/events", new { workitemId = reqB, kind = "session", session = SessionBody() }), HttpStatusCode.Forbidden);
        await Refused(await reader.PostAsJsonAsync("/events", new { clientId = clientB, branch = $"feature/{keyB}", kind = "session", session = SessionBody() }), HttpStatusCode.Forbidden);
        await Refused(await reader.PostAsJsonAsync("/events", new { clientId = Guid.NewGuid(), kind = "session", session = SessionBody() }), HttpStatusCode.NotFound);

        Assert.Equal(0L, await _f.ScalarAsync<long>("select count(*) from event_log where client_id = @c", ("c", clientB)));
        Assert.Equal(0L, await _f.ScalarAsync<long>("select count(*) from claude_call where client_id = @c", ("c", clientB)));

        var (_, contributor) = await PersonWithToken(admin, "contributor", clientA);
        await Ok(await contributor.PostAsJsonAsync("/events", new { workitemId = reqA, kind = "note", note = new { body = "from a contributor" } }));
    }

    [Fact]
    public async Task A_note_from_the_web_is_corrected_once_and_only_on_its_own_requirement()
    {
        var admin = await Admin();
        var (clientId, reqId, _) = await NewRequirement(admin);
        var (_, otherReq, _) = await NewRequirement(admin);

        var first = await Ok(await admin.PostAsJsonAsync("/events", new { workitemId = reqId, kind = "note", note = new { body = "Ronit called.", source = "phone" } }));
        var firstId = first.GetProperty("eventId").GetGuid();
        var fixedNote = await Ok(await admin.PostAsJsonAsync("/events", new { workitemId = reqId, kind = "note", note = new { body = "Ronit called — end of month.", source = "manual", corrects = firstId } }));

        var events = (await Ok(await admin.GetAsync($"/workitems/{reqId}/timeline"))).GetProperty("events").EnumerateArray().ToList();
        var original = events.Single(e => e.GetProperty("id").GetGuid() == firstId);
        Assert.Equal("phone", original.GetProperty("source").GetString());
        Assert.Equal(JsonValueKind.Null, original.GetProperty("supersedes").ValueKind);
        var correction = events.Single(e => e.GetProperty("id").GetGuid() == fixedNote.GetProperty("eventId").GetGuid());
        Assert.Equal(firstId, correction.GetProperty("supersedes").GetGuid());
        Assert.Equal(firstId, correction.GetProperty("payload").GetProperty("corrects").GetGuid());
        Assert.Equal("manual", correction.GetProperty("source").GetString());

        async Task<string> CorrectAsync(Guid workitemId, Guid target) =>
            (await Refused(await admin.PostAsJsonAsync("/events", new { workitemId, kind = "note", note = new { body = "again", corrects = target } }), HttpStatusCode.Conflict))
            .GetProperty("message").GetString()!;

        Assert.Equal("ההערה הזו כבר תוקנה. כדי לשנות אותה שוב צריך לתקן את התיקון האחרון.", await CorrectAsync(reqId, firstId));
        Assert.Equal("אפשר לתקן רק הערה שנמצאת בדרישה הזו.", await CorrectAsync(otherReq, fixedNote.GetProperty("eventId").GetGuid()));
        Assert.Equal("אפשר לתקן רק הערה שנמצאת בדרישה הזו.", await CorrectAsync(reqId, Guid.NewGuid()));
        var session = await Ok(await admin.PostAsJsonAsync("/events", new { workitemId = reqId, kind = "session", session = SessionBody() }));
        Assert.Equal("אפשר לתקן רק הערה שנמצאת בדרישה הזו.", await CorrectAsync(reqId, session.GetProperty("eventId").GetGuid()));

        // the correction itself is the current note, so it can be corrected in turn
        await Ok(await admin.PostAsJsonAsync("/events", new { workitemId = reqId, kind = "note", note = new { body = "final", corrects = fixedNote.GetProperty("eventId").GetGuid() } }));
        Assert.Equal(clientId, await _f.ScalarAsync<Guid>("select client_id from event_log where id = @e", ("e", firstId)));
    }

    [Fact]
    public async Task An_agents_token_is_recorded_as_the_person_who_owns_it_with_the_agent_named()
    {
        var admin = await Admin();
        var (clientId, reqId, _) = await NewRequirement(admin);
        var (ownerId, _, _) = await _f.NewUserAsync();
        await _f.AssignAsync("user", ownerId, "contributor", "client", clientId);
        var agent = (await Ok(await admin.PostAsJsonAsync("/agents", new { displayName = "ci-bot", ownerUserId = ownerId }))).GetProperty("id").GetGuid();
        await _f.AssignAsync("user", agent, "reader", "client", clientId);
        var secret = (await Ok(await admin.PostAsJsonAsync("/tokens", new { name = "ci", forAgentId = agent }))).GetProperty("secret").GetString()!;

        var res = await Ok(await _f.Client(secret).PostAsJsonAsync("/events", new { workitemId = reqId, kind = "session", session = SessionBody() }));

        var ev = (await Ok(await admin.GetAsync($"/workitems/{reqId}/timeline"))).GetProperty("events").EnumerateArray()
            .Single(e => e.GetProperty("id").GetGuid() == res.GetProperty("eventId").GetGuid());
        var actor = ev.GetProperty("actor");
        Assert.Equal("delegated", actor.GetProperty("kind").GetString());
        Assert.Equal(ownerId, actor.GetProperty("userId").GetGuid());
        Assert.Equal("agent:ci-bot", actor.GetProperty("triggeredBy").GetString());
        Assert.Equal(agent, actor.GetProperty("agentId").GetGuid());
        Assert.Equal(ownerId, await _f.ScalarAsync<Guid>("select user_id from claude_call where workitem_id = @w", ("w", reqId)));
        Assert.Equal(agent.ToString(), await _f.ScalarAsync<string>("select meta->>'agentId' from claude_call where workitem_id = @w", ("w", reqId)));
    }

    [Fact]
    public async Task An_independent_agents_token_is_recorded_as_the_agent_with_the_person_accountable_for_it()
    {
        var admin = await Admin();
        var (clientId, reqId, _) = await NewRequirement(admin);
        var (ownerId, _, _) = await _f.NewUserAsync();
        var (sponsorId, _, _) = await _f.NewUserAsync();
        var agent = (await Ok(await admin.PostAsJsonAsync("/agents", new { displayName = "night-runner", ownerUserId = ownerId }))).GetProperty("id").GetGuid();
        // the switch itself is gated behind the decision-02 amendment; the database state is what capture reads
        await _f.ExecAsync("update agent_profile set mode = 'independent', owner_user_id = null, sponsor_user_id = @s where user_id = @a", ("s", sponsorId), ("a", agent));
        await _f.AssignAsync("user", agent, "reader", "client", clientId);
        var secret = (await Ok(await admin.PostAsJsonAsync("/tokens", new { name = "night", forAgentId = agent }))).GetProperty("secret").GetString()!;

        var res = await Ok(await _f.Client(secret).PostAsJsonAsync("/events", new { workitemId = reqId, kind = "git", git = new { repo = "CRM", branch = "main", kind = "push" } }));
        var session = await Ok(await _f.Client(secret).PostAsJsonAsync("/events", new { workitemId = reqId, kind = "session", session = SessionBody() }));

        var events = (await Ok(await admin.GetAsync($"/workitems/{reqId}/timeline"))).GetProperty("events").EnumerateArray().ToList();
        foreach (var id in new[] { res.GetProperty("eventId").GetGuid(), session.GetProperty("eventId").GetGuid() })
        {
            var actor = events.Single(e => e.GetProperty("id").GetGuid() == id).GetProperty("actor");
            Assert.Equal("agent", actor.GetProperty("kind").GetString());
            Assert.Equal(agent, actor.GetProperty("agentId").GetGuid());
            Assert.Equal(sponsorId, actor.GetProperty("sponsorUserId").GetGuid());
        }
        Assert.Equal(sponsorId, await _f.ScalarAsync<Guid>("select user_id from claude_call where workitem_id = @w", ("w", reqId)));
        Assert.Equal(agent.ToString(), await _f.ScalarAsync<string>("select meta->>'agentId' from claude_call where workitem_id = @w", ("w", reqId)));
    }
}
