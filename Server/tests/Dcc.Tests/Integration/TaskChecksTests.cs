using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dcc.Domain.Tasks;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Repos;
using Dcc.Tests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace Dcc.Tests.Integration;

/// <summary>
/// The old prove kit's world, through the API: a requirement whose repository is a real npm package (its build fails
/// while <c>broken.txt</c> is there), tasks inserted the way the breakdown inserts them — the stand-in claude steered by
/// their words (<see cref="FakeClaude"/>) — and the steps a person takes: approve, put in TFS, develop, close, roll back.
/// </summary>
internal sealed class TaskWorld
{
    private readonly DccFactory _f;

    private TaskWorld(DccFactory f, HttpClient admin, Guid adminId, Guid clientId, Guid reqId, Guid repoId, string key, string origin)
    {
        _f = f; Admin = admin; AdminId = adminId; ClientId = clientId; ReqId = reqId; RepoId = repoId; Key = key; Origin = origin;
    }

    public HttpClient Admin { get; }
    public Guid AdminId { get; }
    public Guid ClientId { get; }
    public Guid ReqId { get; }
    public Guid RepoId { get; }
    public string Key { get; }
    public string Origin { get; }

    /// <summary>The bare repository that stands for the host.</summary>
    public string Bare => new Uri(Origin).LocalPath;

    /// <summary>DCC's own clone, where every run works.</summary>
    public string Clone => _f.CloneOf(RepoId);

    public static async Task<TaskWorld> CreateAsync(DccFactory f, string title)
    {
        var admin = f.Client(await f.AdminTokenAsync());
        var adminId = await f.ScalarAsync<Guid>("select id from users where email = @e", ("e", f.AdminEmail));
        var clientId = await f.NewClientAsync();
        var key = "PRV-" + Random.Shared.Next(10000, 99999);
        var req = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title, key }));
        var reqId = req.GetProperty("id").GetGuid();
        var origin = await f.NewPackageOriginAsync();
        var repoId = await f.LinkRepoAsync(clientId, reqId, origin);
        return new TaskWorld(f, admin, adminId, clientId, reqId, repoId, key, origin);
    }

    public static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    /// <summary>A 409, and the sentence it says to the person.</summary>
    public static async Task<string> Refused(Task<HttpResponseMessage> call)
    {
        var res = await call;
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(res.StatusCode == HttpStatusCode.Conflict, $"expected 409, got {(int)res.StatusCode}: {body}");
        return body.GetProperty("message").GetString()!;
    }

    // ── rows, as the breakdown inserts them ──────────────────────────

    private async Task<Guid> InsertAsync(string kind, string intent, string prompt, Guid? parent, Guid[] dependsOn)
    {
        var id = await _f.ScalarAsync<Guid>("""
            insert into task (client_id, workitem_id, seq, kind, intent, prompt, origin, parent_task_id)
            values (@c, @w, (select coalesce(max(seq), 0) + 1 from task where workitem_id = @w), @k, @i, @p, 'ai', @parent) returning id
            """, ("c", ClientId), ("w", ReqId), ("k", kind), ("i", intent), ("p", prompt), ("parent", (object?)parent ?? DBNull.Value));
        foreach (var d in dependsOn)
            await _f.ExecAsync("insert into task_dependency (client_id, task_id, depends_on_task_id, reason) values (@c, @t, @d, 'prove')", ("c", ClientId), ("t", id), ("d", d));
        return id;
    }

    /// <summary>A task of the requirement.</summary>
    public Task<Guid> TaskAsync(string intent, string prompt, params Guid[] dependsOn) => InsertAsync("task", intent, prompt, null, dependsOn);

    /// <summary>A check of a task, written by the breakdown (no kind of its own).</summary>
    public Task<Guid> CheckAsync(string intent, string prompt, Guid of) => InsertAsync("check", intent, prompt, of, []);

    /// <summary>A sub-task of a group.</summary>
    public Task<Guid> SubtaskAsync(string intent, string prompt, Guid group, params Guid[] dependsOn) => InsertAsync("task", intent, prompt, group, dependsOn);

    public async Task ApproveAsync(Guid id) => await Ok(await Admin.PostAsJsonAsync($"/tasks/{id}/approve", new { }));

    /// <summary>What creating the task in TFS does: a work item id on it, and on its checks (they are recorded on the task's item).</summary>
    public async Task InTfsAsync(Guid id) =>
        await _f.ExecAsync("update task set linked_ado_id = 90000 + seq where id = @t or parent_task_id = @t", ("t", id));

    public async Task ReadyAsync(Guid id)
    {
        await ApproveAsync(id);
        await InTfsAsync(id);
    }

    // ── runs ─────────────────────────────────────────────────────────

    /// <summary>Hands the task (or one check) to Claude and waits for that run to end, whatever its end.</summary>
    public async Task<JsonElement> RunAsync(Guid id)
    {
        var started = await Ok(await Admin.PostAsync($"/tasks/{id}/implement", null));
        var runId = started.GetProperty("runId").GetString();
        for (var i = 0; i < 2400; i++)
        {
            var run = await Ok(await Admin.GetAsync($"/tasks/{id}/flow-run"));
            if (run.GetProperty("id").ValueKind == JsonValueKind.String && run.GetProperty("id").GetString() == runId
                && run.GetProperty("state").GetString() is not ("running" or "idle")) return run;
            await Task.Delay(250);
        }
        throw new TimeoutException($"the run of {id} did not finish");
    }

    /// <summary>A run that must end done.</summary>
    public async Task<JsonElement> DevelopAsync(Guid id)
    {
        var run = await RunAsync(id);
        if (run.GetProperty("state").GetString() != "done") throw new Xunit.Sdk.XunitException($"run {run.GetProperty("state")}: {run.GetProperty("error")}");
        return run;
    }

    public static List<string> Lines(JsonElement run) => run.GetProperty("lines").EnumerateArray().Select(l => l.GetString()!).ToList();

    // ── what the screens say ─────────────────────────────────────────

    public async Task<JsonElement> PageAsync(Guid id) => await Ok(await Admin.GetAsync($"/tasks/{id}"));

    public async Task<JsonElement> RowAsync(Guid id) => (await PageAsync(id)).GetProperty("task");

    public async Task<JsonElement> StatusAsync(Guid id) => (await PageAsync(id)).GetProperty("status");

    public async Task<string> StatusKeyAsync(Guid id) => (await StatusAsync(id)).GetProperty("key").GetString()!;

    public async Task<int> SeqAsync(Guid id) => (await RowAsync(id)).GetProperty("seq").GetInt32();

    public async Task<string?> CheckResultAsync(Guid id) => (await RowAsync(id)).GetProperty("checkResult").GetString();

    /// <summary>A task's checks, in order (its sub-tasks are not among them).</summary>
    public async Task<List<JsonElement>> ChecksOfAsync(Guid id) =>
        (await PageAsync(id)).GetProperty("children").EnumerateArray().Where(c => c.GetProperty("kind").GetString() == "check").ToList();

    public async Task<Guid> CheckOfKindAsync(Guid id, string kind) =>
        (await ChecksOfAsync(id)).Single(c => c.GetProperty("checkKind").GetString() == kind).GetProperty("id").GetGuid();

    /// <summary>The task's steps as <c>kind:state</c>, in order.</summary>
    public async Task<string> StepsAsync(Guid id) =>
        string.Join(" ", (await PageAsync(id)).GetProperty("flow").EnumerateArray().Select(s => $"{s.GetProperty("kind").GetString()}:{s.GetProperty("state").GetString()}"));

    /// <summary>Closes the task — null when it closed, else the refusal's sentence.</summary>
    public async Task<string?> CloseRefusalAsync(Guid id, string? overrideReason = null)
    {
        var res = await Admin.PostAsJsonAsync($"/tasks/{id}/progress", new { to = "done", overrideChecks = overrideReason is not null, overrideReason });
        if (res.IsSuccessStatusCode) return null;
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString();
    }

    public async Task<JsonElement> RollbackAsync(Guid id) => await Ok(await Admin.PostAsync($"/tasks/{id}/rollback", null));

    /// <summary>The branch DCC works the task on — the one recorded on it, else the name derived from the requirement's key.</summary>
    public async Task<string> BranchOfAsync(Guid id)
    {
        var row = await RowAsync(id);
        var key = await _f.ScalarAsync<string>("select key from workitem where id = @w", ("w", ReqId));
        return TaskBranches.BranchOf(key, row.GetProperty("seq").GetInt32(), row.GetProperty("intent").GetString()!, row.GetProperty("branch").GetString());
    }

    /// <summary>git in DCC's own clone, as a person working in it would.</summary>
    public async Task<string> GitAsync(params string[] args) =>
        (await Git.RunAsync(["-c", "user.name=prove", "-c", "user.email=prove@example.com", .. args], Clone)).Out;

    public async Task<List<string>> FilesOnAsync(string branch) => Git.Lines(await GitAsync("ls-tree", "--name-only", branch));

    // ── the stand-in's calls ─────────────────────────────────────────

    public int CallCount => _f.FakeCalls().Count;

    public List<JsonElement> CallsSince(int from) => _f.FakeCalls().Skip(from).ToList();

    public static string ToolsOf(JsonElement call) => ArgOf(call, "--allowed-tools");

    /// <summary>The value a call was given for one flag of the CLI ("" when it was not given).</summary>
    public static string ArgOf(JsonElement call, string flag)
    {
        var args = call.GetProperty("args").EnumerateArray().Select(a => a.GetString()!).ToList();
        var i = args.IndexOf(flag);
        return i >= 0 ? args[i + 1] : "";
    }

    public static string PromptOf(JsonElement call) => call.GetProperty("prompt").GetString()!;
}

/// <summary>
/// The old <c>task-checks.prove.ts</c>, for what the other task tests do not cover: how every task is verified and what its
/// status says. The build is the package's own (run directly, never a model); a build that fails stops the checks and a
/// lone rerun of it leaves "failed checks"; a task that changed nothing has nothing to build; a check that waits for a
/// dependency, a check that changes a file, E2E on request, a group's integration check (and two sub-tasks that collide);
/// and the dependency step that comes in when a dependency gets its code after the checks ran.
/// </summary>
[Collection(DbCollection.Name)]
public sealed class TaskChecksTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    [Fact]
    public async Task Development_is_the_code_then_the_build_run_directly_then_the_other_checks_and_a_dependent_task_waits()
    {
        var w = await TaskWorld.CreateAsync(_f, "checks");
        var a = await w.TaskAsync("A", "write a.txt");
        await w.ApproveAsync(a);
        var checks = await w.ChecksOfAsync(a);
        // Each check carries its own copy of its instruction, editable on it.
        Assert.StartsWith("Build לשינוי", (await w.RowAsync(checks[0].GetProperty("id").GetGuid())).GetProperty("prompt").GetString());
        Assert.StartsWith("בדיקות רגרסיה", (await w.RowAsync(checks[2].GetProperty("id").GetGuid())).GetProperty("prompt").GetString());
        await w.InTfsAsync(a);
        Assert.Equal("ready", await w.StatusKeyAsync(a));

        var from = w.CallCount;
        var run = await w.DevelopAsync(a);
        var calls = w.CallsSince(from);
        Assert.Equal(2, calls.Count);
        // the code, with write access — told to write tests, not to report checks
        Assert.Equal("Read,Grep,Glob,Edit,Write,Bash", TaskWorld.ToolsOf(calls[0]));
        Assert.Contains("3. Tests: add tests", TaskWorld.PromptOf(calls[0]));
        Assert.DoesNotContain("\"checks\"", TaskWorld.PromptOf(calls[0]));
        // the other checks after the build, without write access, and without the build
        Assert.Equal("Read,Grep,Glob,Bash", TaskWorld.ToolsOf(calls[1]));
        Assert.Contains("[tests]", TaskWorld.PromptOf(calls[1]));
        Assert.Contains("[regression]", TaskWorld.PromptOf(calls[1]));
        Assert.DoesNotContain("[build]", TaskWorld.PromptOf(calls[1]));
        // Each call is routed: running the checks is mechanical work, so it goes one tier down from the code's model.
        var router = _f.Services.GetRequiredService<ModelRouter>();
        var codeModel = router.Route("execution", new RoutingSignals { Mechanical = false }).Model;
        var checksModel = router.Route("execution", new RoutingSignals { Mechanical = true }).Model;
        Assert.NotEqual(codeModel, checksModel);
        Assert.Equal(codeModel, TaskWorld.ArgOf(calls[0], "--model"));
        Assert.Equal(checksModel, TaskWorld.ArgOf(calls[1], "--model"));
        var lines = TaskWorld.Lines(run);
        Assert.Contains(lines, l => l.Contains("Build ישירות (בלי AI): package.json"));
        int At(string s) => lines.FindIndex(l => l.Contains(s));
        Assert.True(At("שלב 1 מתוך 3") >= 0 && At("שלב 1 מתוך 3") < At("שלב 2 מתוך 3") && At("שלב 2 מתוך 3") < At("שלב 3 מתוך 3"), string.Join(" / ", lines));
        Assert.All(await w.ChecksOfAsync(a), c => Assert.Equal("passed", c.GetProperty("checkResult").GetString()));
        Assert.Equal("review", await w.StatusKeyAsync(a));

        // A dependent task passes everything and still waits for its dependency.
        var seqA = await w.SeqAsync(a);
        var b = await w.TaskAsync("B", "write b.txt", a);
        await w.ReadyAsync(b);
        var readyB = await w.StatusAsync(b);
        Assert.Equal("ready", readyB.GetProperty("key").GetString());
        Assert.Equal("warning", readyB.GetProperty("dependency").GetProperty("tone").GetString());
        Assert.Equal($"🔗 תלויה ב-#{seqA}", readyB.GetProperty("dependency").GetProperty("label").GetString());
        await w.DevelopAsync(b);
        var waitB = await w.StatusAsync(b);
        Assert.Equal("waiting_dependency", waitB.GetProperty("key").GetString());
        Assert.Equal("warning", waitB.GetProperty("tone").GetString());
        Assert.Contains($"#{seqA} עוד לא הושלמה", await w.CloseRefusalAsync(b));
        Assert.Null(await w.CloseRefusalAsync(a));
        var reviewB = await w.StatusAsync(b);
        Assert.Equal("review", reviewB.GetProperty("key").GetString());
        Assert.False(reviewB.TryGetProperty("dependency", out _), reviewB.ToString());
        Assert.Null(await w.CloseRefusalAsync(b));
    }

    [Fact]
    public async Task A_failed_build_stops_the_checks_its_lone_rerun_leaves_failed_checks_and_rollback_clears_them()
    {
        var w = await TaskWorld.CreateAsync(_f, "a broken build");
        var c = await w.TaskAsync("C", "write broken.txt");
        await w.ReadyAsync(c);

        var from = w.CallCount;
        await w.DevelopAsync(c);
        // the one model call is the code; the tests never ran
        Assert.Single(w.CallsSince(from));
        var checks = await w.ChecksOfAsync(c);
        Assert.Equal("failed", checks[0].GetProperty("checkResult").GetString());
        Assert.All(checks.Skip(1), x => Assert.Equal(JsonValueKind.Null, x.GetProperty("checkResult").ValueKind));
        var fell = await w.StatusAsync(c);
        Assert.Equal("failed", fell.GetProperty("key").GetString());
        Assert.Equal("ה-Build נכשל", fell.GetProperty("reason").GetString());
        Assert.Equal("critical", fell.GetProperty("tone").GetString());
        Assert.Equal("failed_checks", (await w.RowAsync(c)).GetProperty("state").GetString());

        // The build is fixed and passes on its own rerun; the other checks have not run — nothing failed any more,
        // so the stored state leaves failed_checks, and the status says what is left.
        await w.GitAsync("checkout", "--quiet", await w.BranchOfAsync(c));
        await w.GitAsync("rm", "--quiet", "broken.txt");
        await w.GitAsync("commit", "--quiet", "-m", "fix the build");
        var build = await w.CheckOfKindAsync(c, "build");
        from = w.CallCount;
        await w.DevelopAsync(build);
        Assert.Empty(w.CallsSince(from));
        var rerun = await w.ChecksOfAsync(c);
        Assert.Equal("passed", rerun[0].GetProperty("checkResult").GetString());
        Assert.All(rerun.Skip(1), x => Assert.Equal(JsonValueKind.Null, x.GetProperty("checkResult").ValueKind));
        Assert.Equal("in_progress", (await w.RowAsync(c)).GetProperty("state").GetString());
        Assert.Equal("checks_pending", await w.StatusKeyAsync(c));
        // the check's last outcome is its own rerun's, not the stale one of the task's run
        Assert.True((await w.PageAsync(c)).GetProperty("checkOutcomes").GetProperty(build.ToString()).GetProperty("passed").GetBoolean());

        // Rollback: the checks verified code that is gone — they read as not run, and the task as ready again.
        await w.RollbackAsync(c);
        Assert.All(await w.ChecksOfAsync(c), x => Assert.Equal(JsonValueKind.Null, x.GetProperty("checkResult").ValueKind));
        Assert.Equal("pending", (await w.RowAsync(c)).GetProperty("state").GetString());
        Assert.Equal("ready", await w.StatusKeyAsync(c));
    }

    [Fact]
    public async Task A_task_that_changed_nothing_has_nothing_to_build_and_a_builds_preview_is_the_real_command()
    {
        var w = await TaskWorld.CreateAsync(_f, "nothing to build");
        var n = await w.TaskAsync("N", "decide the wording, no code");
        var a = await w.TaskAsync("A", "write a.txt");
        await w.ReadyAsync(n);
        await w.ReadyAsync(a);
        await w.DevelopAsync(n);
        await w.DevelopAsync(a);

        var buildN = await w.CheckOfKindAsync(n, "build");
        Assert.Equal("passed", await w.CheckResultAsync(buildN));
        Assert.Contains("אין מה לבנות", (await w.PageAsync(n)).GetProperty("checkOutcomes").GetProperty(buildN.ToString()).GetProperty("detail").GetString());
        var previewN = await TaskWorld.Ok(await w.Admin.GetAsync($"/tasks/{buildN}/implement-preview"));
        Assert.True(previewN.GetProperty("deterministic").GetBoolean());
        Assert.Contains("אין מה לבנות", previewN.GetProperty("prompt").GetString());
        var previewA = await TaskWorld.Ok(await w.Admin.GetAsync($"/tasks/{await w.CheckOfKindAsync(a, "build")}/implement-preview"));
        Assert.True(previewA.GetProperty("deterministic").GetBoolean());
        Assert.Contains("npm run build", previewA.GetProperty("prompt").GetString());
    }

    [Fact]
    public async Task Developed_without_its_dependency_a_check_waits_and_the_task_closes_only_with_a_reason()
    {
        var w = await TaskWorld.CreateAsync(_f, "a dependency not here yet");
        var e = await w.TaskAsync("E", "write e.txt");
        var d = await w.TaskAsync("D", "write d.txt", e);
        var uses = await w.CheckAsync("D uses E", "D works — needs e.txt", d);
        await w.ReadyAsync(d);
        var readyD = await w.StatusAsync(d);
        Assert.Equal("ready", readyD.GetProperty("key").GetString());
        Assert.Equal("critical", readyD.GetProperty("dependency").GetProperty("tone").GetString());

        await w.DevelopAsync(d);
        Assert.Equal("waiting", await w.CheckResultAsync(uses));
        Assert.Equal("waiting_dependency", await w.StatusKeyAsync(d));
        var refused = await w.CloseRefusalAsync(d);
        Assert.Contains("מחכות לתלות", refused);
        Assert.Contains("פותחה בלי #", refused);
        // a person can still close it, with a reason — and it is recorded
        Assert.Null(await w.CloseRefusalAsync(d, "E is dropped from scope"));
        Assert.Equal("done", (await w.RowAsync(d)).GetProperty("state").GetString());
        var events = (await TaskWorld.Ok(await w.Admin.GetAsync($"/workitems/{w.ReqId}"))).GetProperty("events").EnumerateArray().ToList();
        Assert.Contains(events, x => x.GetProperty("payload").ToString().Contains("E is dropped from scope"));
    }

    [Fact]
    public async Task What_a_check_changed_is_put_back_and_E2E_is_added_once_on_request()
    {
        var w = await TaskWorld.CreateAsync(_f, "a check that tampers");
        var f = await w.TaskAsync("F", "write f.txt");
        await w.CheckAsync("F check", "tamper with base.txt", f);
        await w.ReadyAsync(f);
        var run = await w.DevelopAsync(f);
        Assert.Equal("", await w.GitAsync("status", "--porcelain", "--untracked-files=no"));
        Assert.Equal("base", await w.GitAsync("show", $"{await w.BranchOfAsync(f)}:base.txt"));
        Assert.Contains(TaskWorld.Lines(run), l => l.Contains("השינוי בוטל"));

        var added = await TaskWorld.Ok(await w.Admin.PostAsync($"/tasks/{f}/checks/e2e", null));
        Assert.Equal(["בדיקות E2E"], added.GetProperty("added").EnumerateArray().Select(x => x.GetString()));
        var again = await TaskWorld.Ok(await w.Admin.PostAsync($"/tasks/{f}/checks/e2e", null));
        Assert.Equal(0, again.GetProperty("added").GetArrayLength());
        Assert.Contains(await w.ChecksOfAsync(f), c => c.GetProperty("checkKind").GetString() == "e2e");

        // A task with sub-tasks gets no checks of its own — its sub-tasks do.
        var p = await w.TaskAsync("P", "a grouping");
        await w.SubtaskAsync("P child", "write p.txt", p);
        await w.ApproveAsync(p);
        Assert.Empty(await w.ChecksOfAsync(p));
        Assert.Equal(0, (await TaskWorld.Ok(await w.Admin.PostAsync($"/tasks/{p}/checks/e2e", null))).GetProperty("added").GetArrayLength());
    }

    [Fact]
    public async Task A_group_is_never_developed_its_status_follows_its_subtasks_and_its_check_runs_on_their_work_together()
    {
        var w = await TaskWorld.CreateAsync(_f, "groups");
        var z = await w.TaskAsync("Z", "write z.txt");
        var q = await w.TaskAsync("Q", "the q feature", z);
        var q1 = await w.SubtaskAsync("Q1", "write q1.txt", q);
        var q2 = await w.SubtaskAsync("Q2", "write q2.txt", q);
        var together = await w.CheckAsync("Q together", "Q works — needs q2.txt", q);
        foreach (var x in new[] { z, q, q1, q2 }) await w.ReadyAsync(x);

        Assert.Contains("קבוצה", await TaskWorld.Refused(w.Admin.PostAsync($"/tasks/{q}/implement", null)));
        Assert.DoesNotContain(await w.ChecksOfAsync(q), c => c.GetProperty("checkKind").ValueKind == JsonValueKind.String);
        var open = await w.StatusAsync(q);
        Assert.Equal("group_open", open.GetProperty("key").GetString());
        Assert.Equal("0/2 תת-משימות הסתיימו", open.GetProperty("label").GetString());
        // a sub-task waits for what its group waits for — the tag names it
        Assert.Equal($"🔗 קיימת תלות · #{await w.SeqAsync(z)}", (await w.StatusAsync(q1)).GetProperty("dependency").GetProperty("label").GetString());

        // Z first — a sub-task developed before its group's dependency would have to be rebuilt on it.
        await w.DevelopAsync(z);
        Assert.Null(await w.CloseRefusalAsync(z));
        Assert.False((await w.StatusAsync(q1)).TryGetProperty("dependency", out _));
        var early = await w.RunAsync(together);
        Assert.Equal("error", early.GetProperty("state").GetString());
        Assert.Contains($"#{await w.SeqAsync(q2)}", early.GetProperty("error").GetString());
        Assert.Contains("עוד לא פותחה", early.GetProperty("error").GetString());

        await w.DevelopAsync(q1);
        await w.DevelopAsync(q2);
        Assert.Equal("checks_pending", await w.StatusKeyAsync(q));
        await w.DevelopAsync(together);
        Assert.Equal("passed", await w.CheckResultAsync(together));
        Assert.Contains("עוד לא הסתיימה", await w.CloseRefusalAsync(q));
        Assert.Null(await w.CloseRefusalAsync(q1));
        Assert.Null(await w.CloseRefusalAsync(q2));
        Assert.Equal("review", await w.StatusKeyAsync(q));
        Assert.Null(await w.CloseRefusalAsync(q));

        // Two sub-tasks that change the same lines differently: the group's check fails, naming the file.
        var r = await w.TaskAsync("R", "the r feature");
        var r1 = await w.SubtaskAsync("R1", "write same.txt now", r);
        var r2 = await w.SubtaskAsync("R2", "write same.txt later", r);
        var rc = await w.CheckAsync("R together", "R works", r);
        foreach (var x in new[] { r, r1, r2 }) await w.ReadyAsync(x);
        await w.DevelopAsync(r1);
        await w.DevelopAsync(r2);
        await w.DevelopAsync(rc);
        Assert.Equal("failed", await w.CheckResultAsync(rc));
        Assert.Contains("same.txt", (await w.PageAsync(r)).GetProperty("checkOutcomes").ToString());
        Assert.Equal("failed", await w.StatusKeyAsync(r));
    }

    [Fact]
    public async Task A_dependency_that_gets_its_code_after_the_checks_ran_is_a_step_of_its_own_and_the_checks_run_again_after_it()
    {
        var w = await TaskWorld.CreateAsync(_f, "the dependency step");
        var h = await w.TaskAsync("H", "write h.txt");
        var g = await w.TaskAsync("G", "write g.txt", h);
        await w.ReadyAsync(g);
        await w.ReadyAsync(h);

        Assert.Equal("develop:current checks:todo review:todo", await w.StepsAsync(g));
        await w.DevelopAsync(g);
        Assert.Equal("develop:done checks:done review:current", await w.StepsAsync(g));
        // the dependency tag stays on — red, H has no code
        Assert.Equal("critical", (await w.StatusAsync(g)).GetProperty("dependency").GetProperty("tone").GetString());
        await w.DevelopAsync(h);
        Assert.Equal("develop:done checks:done dependency:current checks:done review:current", await w.StepsAsync(g));
        // orange now — H has code but is not done
        Assert.Equal("warning", (await w.StatusAsync(g)).GetProperty("dependency").GetProperty("tone").GetString());
        await w.RollbackAsync(g);
        // nothing is built to check: the dependency step is still next, and the checks wait
        Assert.Equal("develop:done checks:done dependency:current checks:todo review:todo", await w.StepsAsync(g));
        await w.DevelopAsync(g);
        Assert.Equal("develop:done checks:done dependency:done checks:done review:current", await w.StepsAsync(g));
        var flow = (await w.PageAsync(g)).GetProperty("flow").EnumerateArray().ToList();
        Assert.All(flow.Take(2), s => Assert.True(s.GetProperty("past").GetBoolean()));
        Assert.Equal([await w.SeqAsync(h)], flow[2].GetProperty("deps").EnumerateArray().Select(x => x.GetInt32()));
        Assert.Null(await w.CloseRefusalAsync(h));
        Assert.Null(await w.CloseRefusalAsync(g));
        Assert.EndsWith("review:done", await w.StepsAsync(g));
    }
}
