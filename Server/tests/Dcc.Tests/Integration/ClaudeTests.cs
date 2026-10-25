using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Dcc.Tests.Support;

namespace Dcc.Tests.Integration;

/// <summary>
/// Phase 4.5: the requirement's AI steps (readiness, breakdown, spec reading) as background runs against the stand-in
/// claude; the chat — answered by the screen with no model, or by the model with proposals the person approves — the
/// gaps conversation, the control centre, conclusions and retention.
/// </summary>
[Collection(DbCollection.Name)]
public sealed class ClaudeTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    private async Task<HttpClient> Admin() => _f.Client(await _f.AdminTokenAsync());

    private async Task<JsonElement> WaitForRequirementRunAsync(HttpClient admin, Guid reqId)
    {
        for (var i = 0; i < 240; i++)
        {
            var run = await Ok(await admin.GetAsync($"/workitems/{reqId}/flow-run"));
            if (run.GetProperty("state").GetString() is not ("running" or "idle")) return run;
            await Task.Delay(250);
        }
        throw new TimeoutException("the run did not finish");
    }

    private async Task<(Guid ClientId, Guid ReqId, HttpClient Admin)> Requirement(string type = "research", string title = "Which payment provider")
    {
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        var req = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title, requirementType = type }));
        return (clientId, req.GetProperty("id").GetGuid(), admin);
    }

    [Fact]
    public async Task The_readiness_check_writes_a_summary_and_proposes_each_gap()
    {
        var (_, reqId, admin) = await Requirement();
        // the requirement's own detail is part of what Claude reads (its "i" says so)
        await Ok(await admin.PatchAsJsonAsync($"/workitems/{reqId}", new { description = "Compare fees for ILS and USD." }));
        _f.FakeReply = JsonSerializer.Serialize(new
        {
            title = "Payment provider", summary = "Pick one provider.", whatChanges = new[] { "one provider" }, baked = true, rationale = "- clear enough",
            gaps = new[] { new { question = "Which currencies?", why = "fees differ", kind = "business", whoAnswers = "client", options = new[] { "ILS", "USD" }, impactIfWrong = "rework", blocking = true, confidence = 0.8 } },
        });
        try
        {
            var preview = await Ok(await admin.GetAsync($"/workitems/{reqId}/assess-preview?promptKey=assess.readiness.standard"));
            Assert.Contains("Which payment provider", preview.GetProperty("prompt").GetString());
            Assert.Contains("Detail: Compare fees for ILS and USD.", preview.GetProperty("prompt").GetString());
            var started = await Ok(await admin.PostAsJsonAsync($"/workitems/{reqId}/assess", new { }));
            Assert.False(started.GetProperty("alreadyRunning").GetBoolean());
            var run = await WaitForRequirementRunAsync(admin, reqId);
            Assert.True(run.GetProperty("state").GetString() == "done", run.ToString());
            // Ground truth over the model: "baked" with an open question is not baked.
            Assert.False(run.GetProperty("result").GetProperty("baked").GetBoolean());
        }
        finally { _f.FakeReply = null; }

        var page = await Ok(await admin.GetAsync($"/workitems/{reqId}"));
        Assert.Equal("shaping", page.GetProperty("workitem").GetProperty("phase").GetString());
        var gap = Assert.Single(page.GetProperty("gaps").EnumerateArray());
        Assert.Equal("Which currencies?", gap.GetProperty("description").GetString());
        Assert.Contains(page.GetProperty("events").EnumerateArray(), e => e.GetProperty("type").GetString() == "note.added"
            && e.GetProperty("payload").GetProperty("body").GetString()!.StartsWith("סיכום Claude: Payment provider"));
        var cost = await Ok(await admin.GetAsync($"/workitems/{reqId}/cost"));
        Assert.Equal(1, cost.GetProperty("runCount").GetInt32());
        Assert.Equal(1, cost.GetProperty("byKind").GetProperty("gap_detection").GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task A_development_requirement_without_a_repository_is_refused_in_words()
    {
        var (_, reqId, admin) = await Requirement("development");
        await Ok(await admin.PostAsJsonAsync($"/workitems/{reqId}/assess", new { }));
        var run = await WaitForRequirementRunAsync(admin, reqId);
        Assert.Equal("error", run.GetProperty("state").GetString());
        Assert.Contains("repository", run.GetProperty("error").GetString());
    }

    [Fact]
    public async Task The_breakdown_builds_the_tree_with_types_by_role_dependencies_and_the_required_checks()
    {
        var (clientId, reqId, admin) = await Requirement("development", "Loyalty points");
        await _f.LinkRepoAsync(clientId, reqId, await _f.NewOriginAsync());
        _f.FakeReply = JsonSerializer.Serialize(new object[]
        {
            new { seq = 1, intent = "Points story", appetite = "standard" },
            new { seq = 2, parentSeq = 1, intent = "Store points", appetite = "small", affectedPaths = new[] { "src/points.cs" } },
            new { seq = 3, parentSeq = 1, intent = "Show points", appetite = "small", dependsOnSeq = new[] { 2 } },
        });
        try
        {
            await Ok(await admin.PostAsJsonAsync($"/workitems/{reqId}/breakdown", new { }));
            var run = await WaitForRequirementRunAsync(admin, reqId);
            Assert.True(run.GetProperty("state").GetString() == "done", run.ToString());
            Assert.Equal(2, run.GetProperty("result").GetProperty("depth").GetInt32());
        }
        finally { _f.FakeReply = null; }

        var flow = await Ok(await admin.GetAsync($"/workitems/{reqId}/task-flow"));
        var nodes = flow.GetProperty("nodes").EnumerateArray().ToDictionary(n => n.GetProperty("seq").GetInt32());
        Assert.Equal("User Story", nodes[1].GetProperty("adoType").GetString());
        Assert.True(nodes[1].GetProperty("isGroup").GetBoolean());
        Assert.Equal("Task", nodes[2].GetProperty("adoType").GetString());
        Assert.Equal(1, nodes[3].GetProperty("stage").GetInt32());
        // the leaves get the build/tests/regression checks; the group does not
        Assert.Equal(3, nodes[2].GetProperty("checks").GetArrayLength());
        Assert.Equal(0, nodes[1].GetProperty("checks").GetArrayLength());
    }

    [Fact]
    public async Task The_spec_is_read_and_each_link_must_quote_the_task()
    {
        var (clientId, reqId, admin) = await Requirement("research", "Refunds");
        Assert.Equal(HttpStatusCode.Conflict, (await admin.GetAsync($"/workitems/{reqId}/spec/preview")).StatusCode);
        await Ok(await admin.PostAsJsonAsync($"/workitems/{reqId}/attachments",
            new { name = "spec.txt", contentBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes("A customer can ask for a refund within 30 days.")) }));
        var created = await Ok(await admin.PostAsJsonAsync($"/workitems/{reqId}/tasks", new { tasks = new object[] { new { intent = "Let a customer ask for a refund" } } }));
        var taskId = created.GetProperty("taskIds")[0].GetGuid();

        var spec = await Ok(await admin.GetAsync($"/workitems/{reqId}/spec"));
        var lineId = spec.GetProperty("doc").GetProperty("blocks")[0].GetProperty("id").GetString()!; // a one-line paragraph is named by its own id
        var preview = await Ok(await admin.GetAsync($"/workitems/{reqId}/spec/preview"));
        Assert.Contains(lineId, preview.GetProperty("prompt").GetString());

        _f.FakeReply = JsonSerializer.Serialize(new
        {
            requirements = new[] { new { id = lineId, title = "Refund within 30 days" } },
            links = new object[] { new { seq = 1, id = lineId, evidence = "ask for a refund" }, new { seq = 1, id = lineId, evidence = "words the task never says" } },
            corrections = Array.Empty<object>(),
        });
        try
        {
            var mapped = await Ok(await admin.PostAsync($"/workitems/{reqId}/spec/map", null));
            Assert.Equal(1, mapped.GetProperty("requirements").GetInt32());
            Assert.Equal(1, mapped.GetProperty("links").GetInt32());
            Assert.Equal(1, mapped.GetProperty("unsupported").GetInt32());
            Assert.Equal(0, mapped.GetProperty("uncovered").GetInt32());
        }
        finally { _f.FakeReply = null; }

        var forTask = await Ok(await admin.GetAsync($"/tasks/{taskId}/spec"));
        Assert.Equal("Refund within 30 days", forTask[0].GetProperty("title").GetString());
        Assert.Equal(0, (await Ok(await admin.PutAsJsonAsync($"/tasks/{taskId}/spec", new { anchors = new[] { "nope" } }))).GetProperty("linked").GetInt32());
        Assert.Equal(1, (await Ok(await admin.PutAsJsonAsync($"/tasks/{taskId}/spec", new { anchors = new[] { lineId } }))).GetProperty("linked").GetInt32());
    }

    // ── the chat ─────────────────────────────────────────────────────

    [Fact]
    public async Task The_screen_answers_what_it_can_with_no_model_call()
    {
        var (_, reqId, admin) = await Requirement();
        var open = await Ok(await admin.PostAsJsonAsync("/claude/chat/open", new { topic = new { kind = "wi", id = reqId }, context = new { screen = "requirement" } }));
        Assert.Equal(JsonValueKind.Null, open.GetProperty("conversation").ValueKind);
        Assert.Equal("מה המסך הזה מציג?", open.GetProperty("suggestions")[0].GetString());

        var before = _f.FakeCalls().Count;
        var about = await Ok(await admin.PostAsJsonAsync("/claude/chat/ask", new { topic = new { kind = "wi", id = reqId }, context = new { screen = "requirement" }, question = "מה המסך הזה מציג?" }));
        var answer = about.GetProperty("messages")[1];
        Assert.Equal("system", answer.GetProperty("source").GetString());
        Assert.Equal("glossary", answer.GetProperty("payload").GetProperty("from").GetString());
        var facts = await Ok(await admin.PostAsJsonAsync("/claude/chat/ask", new
        {
            topic = new { kind = "wi", id = reqId }, context = new { screen = "requirement", facts = new { nextStep = "לאשר את המשימות" } }, question = "מה השלב הבא?",
        }));
        Assert.Equal("לאשר את המשימות", facts.GetProperty("messages")[1].GetProperty("text").GetString());
        Assert.Equal(before, _f.FakeCalls().Count);
    }

    [Fact]
    public async Task A_model_answer_can_propose_an_action_that_runs_only_on_the_persons_click()
    {
        var (_, reqId, admin) = await Requirement();
        _f.FakeReply = "אפשר לבחון את הדרישה.\n<action key=\"assess\">{}</action>\n<action key=\"implement\">{}</action>";
        JsonElement asked;
        try
        {
            asked = await Ok(await admin.PostAsJsonAsync("/claude/chat/ask", new
            {
                topic = new { kind = "wi", id = reqId }, context = new { screen = "requirement" }, question = "תבדוק בבקשה אם הדרישה מוכנה לפירוק לעומק",
            }));
        }
        finally { _f.FakeReply = null; }
        var messages = asked.GetProperty("messages").EnumerateArray().ToList();
        Assert.Equal("model", messages[1].GetProperty("source").GetString());
        Assert.Equal("אפשר לבחון את הדרישה.", messages[1].GetProperty("text").GetString());
        Assert.Equal(0.0123, messages[1].GetProperty("cost").GetProperty("costUsd").GetDouble(), 4);
        var proposal = messages.Single(m => m.GetProperty("kind").GetString() == "proposal");
        Assert.Equal("assess", proposal.GetProperty("payload").GetProperty("key").GetString());
        // "implement" is not an action of a requirement's screen — it becomes a sentence, never a button
        Assert.Contains(messages, m => m.GetProperty("kind").GetString() == "refusal" && m.GetProperty("text").GetString()!.Contains("implement"));
        // the model call was lean: the chat's own prompt file and a session of its own
        var call = _f.FakeCalls()[^1].GetProperty("args").EnumerateArray().Select(a => a.GetString()).ToList();
        Assert.Contains("--system-prompt-file", call);
        Assert.Contains("--session-id", call);

        var ran = await Ok(await admin.PostAsync($"/claude/proposals/{proposal.GetProperty("id").GetGuid()}/run", null));
        Assert.Equal("done", ran.GetProperty("message").GetProperty("payload").GetProperty("status").GetString());
        await WaitForRequirementRunAsync(admin, reqId);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/claude/proposals/{proposal.GetProperty("id").GetGuid()}/run", null)).StatusCode);

        // the conversation is listed with its cost, and a second question resumes the same session
        var conv = asked.GetProperty("conversation");
        Assert.Equal(1, conv.GetProperty("calls").GetInt32());
        _f.FakeReply = "עוד תשובה";
        try { await Ok(await admin.PostAsJsonAsync("/claude/chat/ask", new { topic = new { kind = "wi", id = reqId }, context = new { screen = "requirement" }, question = "ומה עוד כדאי לבדוק כאן לפני שמתחילים" })); }
        finally { _f.FakeReply = null; }
        Assert.Contains("--resume", _f.FakeCalls()[^1].GetProperty("args").EnumerateArray().Select(a => a.GetString()));
    }

    [Fact]
    public async Task The_gaps_conversation_closes_a_gap_only_through_a_card_the_person_approves()
    {
        var (clientId, reqId, admin) = await Requirement();
        var gap = await Ok(await admin.PostAsJsonAsync($"/workitems/{reqId}/gaps", new { description = "Which currencies?", blocking = true, confidence = 0.9 }));
        var gapRef = gap.GetProperty("id").GetString()![..8];
        _f.FakeReply = $"סוכם שמטבע אחד.\n<action key=\"resolve_gap\">{{\"gap\":\"{gapRef}\",\"answer\":\"ILS only\"}}</action>";
        JsonElement asked;
        try { asked = await Ok(await admin.PostAsJsonAsync("/claude/chat/ask", new { topic = new { kind = "gaps", id = reqId }, question = "רק שקלים" })); }
        finally { _f.FakeReply = null; }
        Assert.Contains(gapRef, _f.FakeCalls()[^1].GetProperty("prompt").GetString());
        var card = asked.GetProperty("messages").EnumerateArray().Single(m => m.GetProperty("kind").GetString() == "proposal");
        Assert.Equal("אשר וסגור את הפער", card.GetProperty("payload").GetProperty("approveLabel").GetString());
        Assert.Equal("proposed", (await Ok(await admin.GetAsync($"/workitems/{reqId}"))).GetProperty("gaps")[0].GetProperty("state").GetString());

        await Ok(await admin.PostAsync($"/claude/proposals/{card.GetProperty("id").GetGuid()}/run", null));
        var after = (await Ok(await admin.GetAsync($"/workitems/{reqId}"))).GetProperty("gaps")[0];
        Assert.Equal("resolved", after.GetProperty("state").GetString());
        Assert.Equal("ILS only", after.GetProperty("answer").GetString());
    }

    [Fact]
    public async Task The_control_centre_counts_every_call_and_a_repeated_question_becomes_a_cluster()
    {
        var (_, reqId, admin) = await Requirement();
        for (var i = 0; i < 2; i++)
            await Ok(await admin.PostAsJsonAsync("/claude/chat/ask", new { topic = new { kind = "wi", id = reqId }, context = new { screen = "requirement" }, question = "מה המסך הזה מציג?" }));
        var overview = await Ok(await admin.GetAsync("/claude/overview"));
        Assert.True(overview.GetProperty("tiles").GetProperty("questions").GetInt32() >= 2);
        Assert.True(overview.GetProperty("tiles").GetProperty("answeredWithoutModel").GetInt32() >= 2);
        var calls = await Ok(await admin.GetAsync("/claude/calls?limit=5"));
        Assert.True(calls.GetProperty("total").GetInt32() >= 0);

        var insights = await Ok(await admin.GetAsync("/claude/insights"));
        Assert.Contains(insights.GetProperty("clusters").EnumerateArray(), c => c.GetProperty("sampleQuestion").GetString() == "מה המסך הזה מציג?" && c.GetProperty("count").GetInt32() >= 2);

        // a person without claude.manage sees none of it
        var (_, token, _) = await _f.NewUserAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await _f.Client(token).GetAsync("/claude/overview")).StatusCode);
    }

    [Fact]
    public async Task Retention_blanks_a_conversation_past_its_period_and_keeps_that_it_existed()
    {
        var (_, reqId, admin) = await Requirement();
        var asked = await Ok(await admin.PostAsJsonAsync("/claude/chat/ask", new { topic = new { kind = "wi", id = reqId }, context = new { screen = "requirement" }, question = "מה המסך הזה מציג?" }));
        var convId = asked.GetProperty("conversation").GetProperty("id").GetGuid();
        await _f.ExecAsync("update conversation set retain_until = now() - interval '1 day' where id = @id", ("id", convId));
        var r = await Ok(await admin.PostAsync("/claude/retention/run", null));
        Assert.True(r.GetProperty("archived").GetInt32() >= 1);
        var c = await Ok(await admin.GetAsync($"/claude/conversations/{convId}"));
        Assert.Equal("archived", c.GetProperty("conversation").GetProperty("status").GetString());
        Assert.All(c.GetProperty("messages").EnumerateArray(), m => Assert.Equal("התוכן נמחק לפי תקופת השמירה", m.GetProperty("text").GetString()));
    }
}
