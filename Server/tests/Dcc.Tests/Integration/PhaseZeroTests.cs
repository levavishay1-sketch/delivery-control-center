using System.Net.Http.Json;
using System.Text.Json;
using Dcc.Tests.Support;

namespace Dcc.Tests.Integration;

/// <summary>
/// The Phase 0 exit gate, end to end, through the API: a raw requirement, a gap a person verifies, a Claude session
/// and commits on the convention branch — and a fresh session starts from the Context Brief, not from zero.
/// It was a script that wrote a new client into the developer's database on every run; here it leaves nothing behind.
/// </summary>
[Collection(DbCollection.Name)]
public sealed class PhaseZeroTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    [Fact]
    public async Task A_requirement_goes_from_raw_notes_through_a_gap_a_session_and_commits_to_a_brief_the_next_session_starts_from()
    {
        var admin = _f.Client(await _f.AdminTokenAsync());

        // A client with its top-level requirement, and the feature under it.
        var setup = await Ok(await admin.PostAsJsonAsync("/admin/setup-client", new
        {
            clientName = "Medipharm " + Guid.NewGuid().ToString("N")[..8],
            firstRequirement = new { title = "Customer Portal", type = "epic" },
        }));
        var clientId = setup.GetProperty("clientId").GetGuid();
        var epic = setup.GetProperty("workitemId").GetGuid();
        var wi = (await Ok(await admin.PostAsJsonAsync("/workitems", new
        {
            parentId = epic, key = "WI-1284", title = "Tiered discounts for business customers", type = "feature", linkedAdoId = 4471,
        }))).GetProperty("id").GetGuid();

        // 1. The raw requirement by email, then a phone call mid-build.
        await Ok(await admin.PostAsJsonAsync("/events", new { workitemId = wi, kind = "note", note = new { source = "email", body = "Need tiered discounts by turnover, like we discussed." } }));
        await Ok(await admin.PostAsJsonAsync("/events", new
        {
            workitemId = wi, kind = "note",
            note = new { source = "phone", body = "Ronit called — mid-month tier change: pro-rata or end-of-month? She'll send a formal req tomorrow." },
        }));

        // 2. A blocking gap, proposed and verified by a person.
        var gap = await Ok(await admin.PostAsJsonAsync($"/workitems/{wi}/gaps", new
        {
            description = "Mid-month tier crossing — pro-rata vs end-of-month is undefined.", blocking = true, confidence = 0.88, mode = "interactive",
        }));
        await Ok(await admin.PostAsJsonAsync($"/gaps/{gap.GetProperty("id").GetString()}/verify", new { clientId, outcome = "verified" }));

        // 3. A Claude session and commits on the convention branch — posted the way the hooks post them.
        const string branch = "feature/WI-1284-tiered-discount";
        var resolved = await Ok(await admin.GetAsync($"/resolve?clientId={clientId}&branch={Uri.EscapeDataString(branch)}"));
        Assert.Equal(wi, resolved.GetProperty("workitemId").GetGuid());
        Assert.Equal("WI-1284", resolved.GetProperty("key").GetString());
        Assert.Equal("Tiered discounts for business customers", resolved.GetProperty("title").GetString());

        const string summary = "Built the DiscountTier model and the schema migration. Implemented flat-tier calc; pro-rata path stubbed pending the gap answer.";
        var session = await Ok(await admin.PostAsJsonAsync("/events", new
        {
            clientId, branch, kind = "session",
            session = new { sessionId = Guid.NewGuid().ToString(), model = "claude-sonnet-5", tokensIn = 48000, tokensOut = 9000, costUsd = 0.31, summary },
        }));
        Assert.Equal(wi, session.GetProperty("workitemId").GetGuid());
        var git = await Ok(await admin.PostAsJsonAsync("/events", new
        {
            clientId, branch, kind = "git",
            git = new { repo = "CRM", branch, kind = "commit", count = 4, shas = new[] { "a1b2c3d", "e4f5g6h", "i7j8k9l", "m0n1o2p" } },
        }));
        Assert.True(git.GetProperty("assigned").GetBoolean());

        // 4. The timeline is complete, newest first.
        var events = (await Ok(await admin.GetAsync($"/workitems/{wi}/timeline"))).GetProperty("events").EnumerateArray().ToList();
        Assert.Equal(
            new[] { "git git.activity", "claude_session claude.session", "manual gap.verified", "manual gap.proposed", "phone note.added", "email note.added" },
            events.Select(e => $"{e.GetProperty("source").GetString()} {e.GetProperty("type").GetString()}").ToArray());
        Assert.Equal(4, events[0].GetProperty("links").EnumerateArray().Count(l => l.GetProperty("rel").GetString() == "commit"));

        // The session is counted once, as the developer's own session: in the cost, not as a second timeline entry.
        var cost = await Ok(await admin.GetAsync($"/workitems/{wi}/cost"));
        var interactive = cost.GetProperty("byKind").GetProperty("interactive_session");
        Assert.Equal(1, interactive.GetProperty("count").GetInt32());
        Assert.Equal(0.31, interactive.GetProperty("usd").GetDouble(), 6);
        Assert.Equal(0.31, cost.GetProperty("totalUsd").GetDouble(), 6);
        Assert.Equal(48000, cost.GetProperty("totalInputTokens").GetInt64());
        Assert.Equal(9000, cost.GetProperty("totalOutputTokens").GetInt64());

        // 5. A FRESH session starts from the brief.
        var brief = await admin.GetStringAsync($"/workitems/{wi}/brief");
        Assert.StartsWith("# WI-1284 — Tiered discounts for business customers", brief);
        Assert.Contains("**ADO:** #4471", brief);
        Assert.Contains("- **BLOCKING** — Mid-month tier crossing — pro-rata vs end-of-month is undefined.  _(confidence 0.88, verified)_", brief);
        Assert.Contains("**email** note.added — Need tiered discounts by turnover, like we discussed.", brief);
        Assert.Contains("**phone** note.added — Ronit called — mid-month tier change", brief);
        Assert.Contains($"**claude_session** claude.session — {summary}", brief);
        Assert.Contains($"**git** git.activity — commit on {branch}", brief);
        Assert.True(brief.IndexOf("note.added", StringComparison.Ordinal) < brief.IndexOf("git.activity", StringComparison.Ordinal), "the recent timeline reads oldest first");
    }
}
