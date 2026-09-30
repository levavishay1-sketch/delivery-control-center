using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dcc.Infrastructure.Repos;
using Dcc.Tests.Support;

namespace Dcc.Tests.Integration;

/// <summary>
/// Phase 4.3: tasks — the tree and its schedule, approval with the checks every task gets, the done gate, a whole
/// development run (a real git repository, the stand-in claude), rollback, push, manual work, surgical delete.
/// </summary>
[Collection(DbCollection.Name)]
public sealed class TasksTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    private async Task<HttpClient> Admin() => _f.Client(await _f.AdminTokenAsync());

    /// <summary>A requirement with tasks A and B (B depends on A).</summary>
    private async Task<(Guid ClientId, Guid ReqId, Guid A, Guid B, HttpClient Admin)> TwoTasks()
    {
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        var req = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "Tiered discounts", key = "WI-" + Random.Shared.Next(10000, 99999) }));
        var reqId = req.GetProperty("id").GetGuid();
        var created = await admin.PostAsJsonAsync($"/workitems/{reqId}/tasks", new
        {
            tasks = new object[]
            {
                new { intent = "Add the discount table", appetite = "small" },
                new { intent = "Apply the discount at checkout", dependsOn = new[] { 0 }, dependencyReason = "needs the table" },
            },
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var ids = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("taskIds").EnumerateArray().Select(x => x.GetGuid()).ToList();
        return (clientId, reqId, ids[0], ids[1], admin);
    }

    [Fact]
    public async Task The_tree_schedules_what_waits_and_every_card_says_its_status()
    {
        var (_, reqId, a, b, admin) = await TwoTasks();
        var flow = await Ok(await admin.GetAsync($"/workitems/{reqId}/task-flow"));
        var nodes = flow.GetProperty("nodes").EnumerateArray().ToDictionary(n => n.GetProperty("id").GetGuid());
        Assert.Equal(0, nodes[a].GetProperty("stage").GetInt32());
        Assert.Equal(1, nodes[b].GetProperty("stage").GetInt32());
        Assert.Equal(a, nodes[b].GetProperty("dependsOn")[0].GetGuid());
        Assert.Equal("Task", nodes[a].GetProperty("adoType").GetString());
        Assert.Equal("awaiting_approval", nodes[a].GetProperty("status").GetProperty("key").GetString());
        Assert.Contains(flow.GetProperty("edges").EnumerateArray(), e => e.GetProperty("kind").GetString() == "depends" && e.GetProperty("from").GetGuid() == a);

        var page = await Ok(await admin.GetAsync($"/tasks/{b}"));
        Assert.Equal(a, page.GetProperty("blockedBy")[0].GetProperty("id").GetGuid());
        Assert.False(page.GetProperty("developed").GetBoolean());
        Assert.Equal(["develop:current", "checks:todo", "review:todo"],
            page.GetProperty("flow").EnumerateArray().Select(s => $"{s.GetProperty("kind").GetString()}:{s.GetProperty("state").GetString()}"));
        Assert.Equal("🔗 קיימת תלות · #1", page.GetProperty("status").GetProperty("dependency").GetProperty("label").GetString());
    }

    [Fact]
    public async Task Approving_adds_the_required_checks_and_says_why_it_is_not_in_TFS_yet()
    {
        var (_, _, a, _, admin) = await TwoTasks();
        var r = await Ok(await admin.PostAsJsonAsync($"/tasks/{a}/approve", new { }));
        Assert.True(r.GetProperty("approved").GetBoolean());
        Assert.Contains("אין חיבור Azure DevOps", r.GetProperty("materializeError").GetString());

        var page = await Ok(await admin.GetAsync($"/tasks/{a}"));
        var kinds = page.GetProperty("children").EnumerateArray().Select(c => c.GetProperty("checkKind").GetString()).ToList();
        Assert.Equal(["build", "tests", "regression"], kinds);
        Assert.All(page.GetProperty("children").EnumerateArray(), c => Assert.Equal(JsonValueKind.String, c.GetProperty("approvedAt").ValueKind));
        Assert.Equal("awaiting_tfs", page.GetProperty("status").GetProperty("key").GetString());

        // approving twice is refused in words
        var again = await admin.PostAsJsonAsync($"/tasks/{a}/approve", new { });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task Done_is_refused_while_checks_have_not_passed_and_the_refusal_names_them()
    {
        var (clientId, _, a, _, admin) = await TwoTasks();
        await Ok(await admin.PostAsJsonAsync($"/tasks/{a}/approve", new { }));
        var res = await admin.PostAsJsonAsync($"/tasks/{a}/progress", new { to = "done", clientId });
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.StartsWith("אי אפשר לסמן כהושלם", body.GetProperty("error").GetString());
        Assert.Equal(3, body.GetProperty("unresolved").GetArrayLength());

        // an override with a reason passes, and the reason is a decision on the timeline
        await Ok(await admin.PostAsJsonAsync($"/tasks/{a}/progress", new { to = "done", clientId, overrideChecks = true, overrideReason = "verified by hand" }));
        var page = await Ok(await admin.GetAsync($"/tasks/{a}"));
        Assert.Equal("done", page.GetProperty("status").GetProperty("key").GetString());
    }

    [Fact]
    public async Task A_person_without_task_permissions_cannot_read_a_task_and_a_reader_cannot_approve()
    {
        var (clientId, _, a, _, _) = await TwoTasks();
        var (_, stranger, _) = await _f.NewUserAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await _f.Client(stranger).GetAsync($"/tasks/{a}")).StatusCode);
        var (readerId, _, password) = await _f.NewUserAsync();
        await _f.AssignAsync("user", readerId, "reader", "client", clientId);
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", readerId));
        var reader = _f.Client((await _f.LoginAsync(email, password)).AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await reader.GetAsync($"/tasks/{a}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.PostAsJsonAsync($"/tasks/{a}/approve", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await reader.GetAsync($"/tasks/{Guid.NewGuid()}")).StatusCode);
    }

    // ── a whole development run on a real repository ────────────────

    /// <summary>A bare repository with one commit on main — the "remote" DCC clones from and pushes to.</summary>
    private async Task<string> OriginAsync()
    {
        var root = Path.Combine(_f.TempDir, "origins", Guid.NewGuid().ToString("N")[..8]);
        var bare = Path.Combine(root, "origin.git");
        var work = Path.Combine(root, "work");
        Directory.CreateDirectory(bare);
        Directory.CreateDirectory(work);
        await Git.RunAsync(bare, "init", "--bare", "-b", "main");
        await Git.RunAsync(work, "init", "-b", "main");
        await File.WriteAllTextAsync(Path.Combine(work, "README.md"), "# shop\n");
        await Git.RunAsync(work, "add", "-A");
        await Git.RunAsync(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "first");
        await Git.RunAsync(work, "push", bare, "main");
        return "file:///" + bare.Replace('\\', '/');
    }

    private async Task<Guid> LinkRepoAsync(Guid clientId, Guid reqId, string url)
    {
        var repoId = await _f.ScalarAsync<Guid>("insert into repo(name, ado_repo_ref) values (@n, @u) returning id", ("n", "shop-" + Guid.NewGuid().ToString("N")[..6]), ("u", url));
        await _f.ExecAsync("insert into workitem_repo(client_id, workitem_id, repo_id, link_kind) values (@c, @w, @r, 'declared')", ("c", clientId), ("w", reqId), ("r", repoId));
        return repoId;
    }

    private async Task<JsonElement> WaitForRunAsync(HttpClient admin, Guid taskId)
    {
        for (var i = 0; i < 240; i++)
        {
            var run = await Ok(await admin.GetAsync($"/tasks/{taskId}/flow-run"));
            var state = run.GetProperty("state").GetString();
            if (state is not ("running" or "idle")) return run;
            await Task.Delay(250);
        }
        throw new TimeoutException("the run did not finish");
    }

    [Fact]
    public async Task A_task_is_developed_built_checked_pushed_and_rolled_back_on_DCCs_own_copy()
    {
        var (clientId, reqId, a, _, admin) = await TwoTasks();
        var origin = await OriginAsync();
        await LinkRepoAsync(clientId, reqId, origin);

        // refused before approval, and before it exists in TFS
        var early = await admin.PostAsync($"/tasks/{a}/implement", null);
        Assert.Equal(HttpStatusCode.Conflict, early.StatusCode);
        await Ok(await admin.PostAsJsonAsync($"/tasks/{a}/approve", new { }));
        Assert.Contains("TFS", (await (await admin.PostAsync($"/tasks/{a}/implement", null)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
        await _f.ExecAsync("update task set linked_ado_id = 4242 where id = @t", ("t", a));

        var preview = await Ok(await admin.GetAsync($"/tasks/{a}/implement-preview"));
        Assert.True(preview.GetProperty("approved").GetBoolean());
        Assert.Contains("Add the discount table", preview.GetProperty("prompt").GetString());

        var started = await Ok(await admin.PostAsync($"/tasks/{a}/implement", null));
        Assert.False(started.GetProperty("alreadyRunning").GetBoolean());
        var run = await WaitForRunAsync(admin, a);
        Assert.True(run.GetProperty("state").GetString() == "done", run.ToString());
        var lines = run.GetProperty("lines").EnumerateArray().Select(l => l.GetString()!).ToList();
        Assert.Contains(lines, l => l.StartsWith("🔧 Write feature.txt"));
        Assert.Contains(lines, l => l.Contains("אין מה לבנות"));

        var page = await Ok(await admin.GetAsync($"/tasks/{a}"));
        Assert.True(page.GetProperty("developed").GetBoolean());
        Assert.Equal("review", page.GetProperty("status").GetProperty("key").GetString());
        Assert.Equal(["develop:done", "checks:done", "review:current"],
            page.GetProperty("flow").EnumerateArray().Select(s => $"{s.GetProperty("kind").GetString()}:{s.GetProperty("state").GetString()}"));
        var dev = page.GetProperty("development");
        Assert.Equal(["feature.txt"], dev.GetProperty("filesChanged").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal(JsonValueKind.String, dev.GetProperty("commit").ValueKind);
        Assert.Equal(3, dev.GetProperty("checks").GetArrayLength());
        Assert.Single(page.GetProperty("history").EnumerateArray());

        var files = await Ok(await admin.GetAsync($"/tasks/{a}/files"));
        Assert.Equal("feature.txt", files.GetProperty("files")[0].GetProperty("path").GetString());
        Assert.Equal("A", files.GetProperty("files")[0].GetProperty("status").GetString());
        var file = await Ok(await admin.GetAsync($"/tasks/{a}/file?path=feature.txt"));
        Assert.Equal(JsonValueKind.Null, file.GetProperty("before").ValueKind);
        Assert.Equal("made by the stand-in", file.GetProperty("after").GetString());

        // every call to Claude is one ledger row, with its cost
        var calls = await _f.ScalarAsync<long>("select count(*) from claude_call where entity_id = @t and cost_usd = 0.0123", ("t", a.ToString()));
        Assert.Equal(2, calls);

        var pushed = await Ok(await admin.PostAsync($"/tasks/{a}/push", null));
        Assert.True(pushed.GetProperty("pushed").GetBoolean(), pushed.ToString());
        var branch = pushed.GetProperty("branch").GetString()!;
        Assert.StartsWith("task/WI-", branch);
        var bare = new Uri(origin).LocalPath;
        Assert.True(await Git.ExistsAsync(bare, branch));

        var rolled = await Ok(await admin.PostAsync($"/tasks/{a}/rollback", null));
        Assert.True(rolled.GetProperty("rolledBack").GetBoolean());
        Assert.Equal(1, rolled.GetProperty("invalidatedRuns").GetInt32());
        var after = await Ok(await admin.GetAsync($"/tasks/{a}"));
        Assert.False(after.GetProperty("developed").GetBoolean());
        Assert.Equal(JsonValueKind.Null, after.GetProperty("development").ValueKind);
        Assert.All(after.GetProperty("children").EnumerateArray(), c => Assert.Equal(JsonValueKind.Null, c.GetProperty("checkResult").ValueKind));
        Assert.Equal("rolled_back", after.GetProperty("history")[0].GetProperty("state").GetString());
    }

    [Fact]
    public async Task A_task_developed_by_hand_is_reported_and_its_checks_set_by_hand()
    {
        var (clientId, _, a, _, admin) = await TwoTasks();
        await Ok(await admin.PostAsJsonAsync($"/tasks/{a}/approve", new { }));
        await Ok(await admin.PutAsJsonAsync($"/tasks/{a}/manual", new { manual = true }));

        // not before it is in TFS
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"/tasks/{a}/manual-report", new { summary = "done by me" })).StatusCode);
        await _f.ExecAsync("update task set linked_ado_id = 77 where id = @t", ("t", a));
        await Ok(await admin.PostAsJsonAsync($"/tasks/{a}/manual-report", new { summary = "הוקם שדה", customisation = "CUSTOMISATION:\nFormCancellation" }));

        // implement is refused for a task a person develops
        Assert.Contains("ידנית", (await (await admin.PostAsync($"/tasks/{a}/implement", null)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());

        var page = await Ok(await admin.GetAsync($"/tasks/{a}"));
        Assert.True(page.GetProperty("developed").GetBoolean());
        Assert.Equal("build_pending", page.GetProperty("status").GetProperty("key").GetString());
        foreach (var c in page.GetProperty("children").EnumerateArray())
            await Ok(await admin.PostAsJsonAsync($"/tasks/{c.GetProperty("id").GetGuid()}/manual-result", new { result = "passed" }));
        Assert.Equal("review", (await Ok(await admin.GetAsync($"/tasks/{a}"))).GetProperty("status").GetProperty("key").GetString());

        // a failure needs its reason
        var check = page.GetProperty("children")[1].GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"/tasks/{check}/manual-result", new { result = "failed" })).StatusCode);
        await Ok(await admin.PostAsJsonAsync($"/tasks/{check}/manual-result", new { result = "failed", note = "the total is wrong" }));
        var failed = await Ok(await admin.GetAsync($"/tasks/{a}"));
        Assert.Equal("failed", failed.GetProperty("status").GetProperty("key").GetString());
        Assert.Equal("failed_checks", failed.GetProperty("task").GetProperty("state").GetString());

        await Ok(await admin.PostAsJsonAsync($"/tasks/{check}/manual-result", new { result = "passed" }));
        await Ok(await admin.PostAsJsonAsync($"/tasks/{a}/progress", new { to = "done", clientId }));
        Assert.Equal("done", (await Ok(await admin.GetAsync($"/tasks/{a}"))).GetProperty("status").GetProperty("key").GetString());
    }

    [Fact]
    public async Task Deleting_a_task_names_each_risk_and_needs_it_confirmed()
    {
        var (_, _, a, b, admin) = await TwoTasks();
        await Ok(await admin.PostAsJsonAsync($"/tasks/{a}/approve", new { }));
        var pre = await Ok(await admin.GetAsync($"/tasks/{a}/delete-check"));
        Assert.True(pre.GetProperty("hasChildren").GetBoolean());
        Assert.Equal(4, pre.GetProperty("subtree").GetArrayLength());

        var refused = await admin.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/tasks/{a}"));
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        var body = await refused.Content.ReadFromJsonAsync<JsonElement>();
        Assert.StartsWith("מחיקה חסומה", body.GetProperty("error").GetString());
        Assert.True(body.GetProperty("precheck").GetProperty("hasChildren").GetBoolean());

        var ok = await Ok(await admin.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/tasks/{a}") { Content = JsonContent.Create(new { confirmSubtree = true }) }));
        Assert.Equal(4, ok.GetProperty("subtreeDeleted").GetInt32());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/tasks/{a}")).StatusCode);
        // the task that depended on it waits for nothing now
        Assert.Equal(0, (await Ok(await admin.GetAsync($"/tasks/{b}"))).GetProperty("blockedBy").GetArrayLength());
    }

    [Fact]
    public async Task Starting_to_build_gives_a_key_a_branch_and_moves_the_requirement()
    {
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        var req = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "Loyalty points" }));
        var id = req.GetProperty("id").GetGuid();
        var r = await Ok(await admin.PostAsync($"/workitems/{id}/start", null));
        Assert.Matches(@"^WI-\d+$", r.GetProperty("key").GetString());
        Assert.Equal($"task/{r.GetProperty("key").GetString()}-loyalty-points", r.GetProperty("branch").GetString());
        Assert.Equal("building", (await Ok(await admin.GetAsync($"/workitems/{id}"))).GetProperty("workitem").GetProperty("phase").GetString());
    }

    [Fact]
    public async Task A_research_requirement_has_one_tracking_task_and_closes_with_its_conclusion()
    {
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        var req = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "Which payment provider", requirementType = "research" }));
        var id = req.GetProperty("id").GetGuid();
        var started = await Ok(await admin.PostAsync($"/workitems/{id}/research/start", null));
        Assert.False(started.GetProperty("materialized").GetBoolean());
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/workitems/{id}/research/start", null)).StatusCode);
        await Ok(await admin.PostAsJsonAsync($"/workitems/{id}/research/finish", new { conclusion = "Provider B — lower fees" }));
        var page = await Ok(await admin.GetAsync($"/workitems/{id}"));
        Assert.Equal("done", page.GetProperty("workitem").GetProperty("phase").GetString());
        Assert.Contains(page.GetProperty("events").EnumerateArray(), e => e.GetProperty("payload").TryGetProperty("body", out var body) && body.GetString() == "מסקנות תחקור: Provider B — lower fees");
    }
}
