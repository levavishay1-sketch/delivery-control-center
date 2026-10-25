using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dcc.Tests.Support;

namespace Dcc.Tests.Integration;

/// <summary>
/// The old <c>task-base.prove.ts</c>: a task can be developed before the task it depends on, and what its branch is built
/// on is right at every step — developed first it starts from the default branch "without" its dependency (a check that
/// needs it waits); once the dependency has code, a rollback and a new run build it on the dependency's branch; push says
/// to push the dependency first; the dependency moving on is said; a rollback never goes into the dependency's work; a
/// branch is recorded when it is created. Then bringing a dependency in by a merge, and two tasks that changed one file.
/// (The old repair of branches from before they were recorded was not ported, on purpose.)
/// </summary>
[Collection(DbCollection.Name)]
public sealed class TaskBuiltOnTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<JsonElement> BuiltOnAsync(TaskWorld w, Guid id) => await TaskWorld.Ok(await w.Admin.GetAsync($"/tasks/{id}/built-on"));

    private static async Task<JsonElement> PushAsync(TaskWorld w, Guid id) => await TaskWorld.Ok(await w.Admin.PostAsync($"/tasks/{id}/push", null));

    private static async Task<JsonElement> MergeAsync(TaskWorld w, Guid id, Guid dependencyId) =>
        await TaskWorld.Ok(await w.Admin.PostAsJsonAsync($"/tasks/{id}/merge-dependency", new { dependencyId }));

    private static async Task<JsonElement> FilesAsync(TaskWorld w, Guid id) => (await TaskWorld.Ok(await w.Admin.GetAsync($"/tasks/{id}/files"))).GetProperty("files");

    private static List<Guid> Ids(JsonElement arr) => arr.EnumerateArray().Select(x => x.GetGuid()).ToList();

    [Fact]
    public async Task A_task_developed_before_its_dependency_is_built_without_it_then_on_it_and_says_so_at_every_step()
    {
        var w = await TaskWorld.CreateAsync(_f, "built on");
        var a = await w.TaskAsync("A", "write a.txt");
        var b = await w.TaskAsync("B", "write b.txt", a);
        var c = await w.CheckAsync("C", "B works — needs a.txt", b);
        await w.ReadyAsync(a);
        await w.ReadyAsync(b);
        var seqA = await w.SeqAsync(a);

        // 1. Before anything is developed: B would start from the default branch, without A.
        var on = await BuiltOnAsync(w, b);
        Assert.Equal("planned", on.GetProperty("state").GetString());
        Assert.Equal(JsonValueKind.Null, on.GetProperty("on").ValueKind);
        var missing = Assert.Single(on.GetProperty("missing").EnumerateArray());
        Assert.Equal(a, missing.GetProperty("id").GetGuid());
        Assert.Equal("not_developed", missing.GetProperty("why").GetString());

        // 2. B first: it is told A is not here yet, records it was built without A, and its check that needs A waits.
        var from = w.CallCount;
        await w.DevelopAsync(b);
        Assert.Contains($"NOT HERE YET — this task depends on work that is not in this branch: #{seqA} (A).", TaskWorld.PromptOf(w.CallsSince(from)[0]));
        var rb = await w.RowAsync(b);
        Assert.Equal(JsonValueKind.Null, rb.GetProperty("baseTaskId").ValueKind);
        Assert.Equal("main", rb.GetProperty("baseBranch").GetString());
        Assert.Equal([a], Ids(rb.GetProperty("builtWithout")));
        Assert.Equal("waiting", await w.CheckResultAsync(c));
        Assert.Equal("in_progress", rb.GetProperty("state").GetString());

        // 3. A is developed: B says A is available now.
        await w.DevelopAsync(a);
        on = await BuiltOnAsync(w, b);
        Assert.Equal("built", on.GetProperty("state").GetString());
        Assert.Contains(on.GetProperty("nowAvailable").EnumerateArray(), x => x.GetProperty("id").GetGuid() == a);

        // 4. Rollback forgets what B was built on; the next run builds it on A's branch, and the check passes.
        await w.RollbackAsync(b);
        rb = await w.RowAsync(b);
        Assert.Equal(JsonValueKind.Null, rb.GetProperty("baseTaskId").ValueKind);
        Assert.Equal(JsonValueKind.Null, rb.GetProperty("baseSha").ValueKind);
        Assert.Empty(Ids(rb.GetProperty("builtWithout")));
        on = await BuiltOnAsync(w, b);
        Assert.Equal("planned", on.GetProperty("state").GetString());
        Assert.Equal(a, on.GetProperty("on").GetProperty("id").GetGuid());
        Assert.Equal(0, on.GetProperty("missing").GetArrayLength());
        from = w.CallCount;
        await w.DevelopAsync(b);
        Assert.Contains($"BUILT ON — this branch starts from the branch of a task this one depends on, which is not in the default branch yet: #{seqA} (A).",
            TaskWorld.PromptOf(w.CallsSince(from)[0]));
        var branchA = await w.BranchOfAsync(a);
        var branchB = await w.BranchOfAsync(b);
        rb = await w.RowAsync(b);
        Assert.Equal(a, rb.GetProperty("baseTaskId").GetGuid());
        Assert.Equal(branchA, rb.GetProperty("baseBranch").GetString());
        Assert.Empty(Ids(rb.GetProperty("builtWithout")));
        Assert.Contains("a.txt", await w.FilesOnAsync(branchB));
        Assert.Equal("1", await w.GitAsync("rev-list", "--count", $"{rb.GetProperty("baseSha").GetString()}..{branchB}"));
        Assert.Equal("passed", await w.CheckResultAsync(c));

        // 5. Push: B before A says to push A first; once A is on the host, B's request targets A's branch.
        var p = await PushAsync(w, b);
        Assert.True(p.GetProperty("pushed").GetBoolean(), p.ToString());
        Assert.Equal("main", p.GetProperty("base").GetString());
        Assert.False(string.IsNullOrEmpty(p.GetProperty("note").GetString()));
        Assert.True((await PushAsync(w, a)).GetProperty("pushed").GetBoolean());
        p = await PushAsync(w, b);
        Assert.True(p.GetProperty("pushed").GetBoolean());
        Assert.Equal(branchA, p.GetProperty("base").GetString());
        Assert.False(p.TryGetProperty("note", out _), p.ToString());

        // 6. A gains work after B was built on it: B says so.
        await w.GitAsync("checkout", "--quiet", branchA);
        await File.WriteAllTextAsync(Path.Combine(w.Clone, "a2.txt"), "more\n");
        await w.GitAsync("add", "-A");
        await w.GitAsync("commit", "--quiet", "-m", "A moves");
        on = await BuiltOnAsync(w, b);
        Assert.Equal("built", on.GetProperty("state").GetString());
        Assert.True(on.GetProperty("onMoved").GetBoolean(), on.ToString());

        // 7. Rollback returns B to A's tip of the time — never into A's work.
        await w.RollbackAsync(b);
        var files = await w.FilesOnAsync(branchB);
        Assert.Contains("a.txt", files);
        Assert.DoesNotContain("b.txt", files);

        // 8. The requirement gets another key and B's wording changes after B was developed: B still finds its own
        //    branch — it is recorded when the run creates it, never worked out again.
        await w.DevelopAsync(b);
        Assert.Equal(branchB, (await w.RowAsync(b)).GetProperty("branch").GetString());
        await _f.ExecAsync("update workitem set key = @k where id = @w", ("k", "WI-" + Random.Shared.Next(100000, 999999)), ("w", w.ReqId));
        await _f.ExecAsync("update task set intent = 'B, reworded' where id = @t", ("t", b));
        Assert.Equal("built", (await BuiltOnAsync(w, b)).GetProperty("state").GetString());
        Assert.Contains((await FilesAsync(w, b)).EnumerateArray(), f => f.GetProperty("path").GetString() == "b.txt");
        // Without the recorded branch the name looked for no longer exists: "not found" (null), not "changed nothing" ([]).
        await _f.ExecAsync("update task set branch = null where id = @t", ("t", b));
        Assert.Equal(JsonValueKind.Null, (await FilesAsync(w, b)).ValueKind);
    }

    [Fact]
    public async Task A_dependency_is_merged_in_only_when_it_is_one_and_clean_and_tasks_on_one_file_are_told_about_each_other()
    {
        var w = await TaskWorld.CreateAsync(_f, "merging a dependency");
        var e = await w.TaskAsync("E", "write e.txt");
        var d = await w.TaskAsync("D", "write d.txt", e);
        var dCheck = await w.CheckAsync("Dchk", "D works", d);
        await w.ReadyAsync(e);
        await w.ReadyAsync(d);
        await w.DevelopAsync(d);
        await w.DevelopAsync(e);

        Assert.Contains("לא תלות", await TaskWorld.Refused(w.Admin.PostAsJsonAsync($"/tasks/{e}/merge-dependency", new { dependencyId = d })));
        await _f.ExecAsync("update task set check_result = 'passed', state = 'done' where id = @t", ("t", dCheck));
        var merged = await MergeAsync(w, d, e);
        Assert.True(merged.GetProperty("merged").GetBoolean(), merged.ToString());
        Assert.False(merged.GetProperty("already").GetBoolean());
        var onD = await w.FilesOnAsync(await w.BranchOfAsync(d));
        Assert.Contains("e.txt", onD);
        Assert.Contains("d.txt", onD);
        var rd = await w.RowAsync(d);
        Assert.Equal(e, rd.GetProperty("baseTaskId").GetGuid());
        Assert.Empty(Ids(rd.GetProperty("builtWithout")));
        // D's own work is still only its own file; its checks ran on other code, so they are reset.
        Assert.Equal(["d.txt"], (await FilesAsync(w, d)).EnumerateArray().Select(f => f.GetProperty("path").GetString()));
        Assert.Null(await w.CheckResultAsync(dCheck));
        var again = await MergeAsync(w, d, e);
        Assert.True(again.GetProperty("merged").GetBoolean());
        Assert.True(again.GetProperty("already").GetBoolean());

        // Two tasks tied by a dependency that write one file differently: the merge is refused and changes nothing.
        var s = await w.TaskAsync("S", "write shared.txt for S");
        var r = await w.TaskAsync("R", "write shared.txt for R", s);
        await w.ReadyAsync(s);
        await w.ReadyAsync(r);
        await w.DevelopAsync(r);
        await w.DevelopAsync(s);
        var branchR = await w.BranchOfAsync(r);
        var tipBefore = await w.GitAsync("rev-parse", branchR);
        var clash = await MergeAsync(w, r, s);
        Assert.False(clash.GetProperty("merged").GetBoolean());
        Assert.Contains("shared.txt", clash.GetProperty("conflictFiles").EnumerateArray().Select(f => f.GetString()));
        Assert.Contains("Rollback", clash.GetProperty("reason").GetString());
        Assert.Equal(tipBefore, await w.GitAsync("rev-parse", branchR));
        Assert.Equal(JsonValueKind.Null, (await w.RowAsync(r)).GetProperty("baseTaskId").ValueKind);
        var seqS = await w.SeqAsync(s);
        var overlapR = Assert.Single((await TaskWorld.Ok(await w.Admin.GetAsync($"/tasks/{r}/overlaps"))).EnumerateArray());
        Assert.Equal(seqS, overlapR.GetProperty("seq").GetInt32());
        Assert.Equal("waits_for", overlapR.GetProperty("relation").GetString());
        Assert.Contains("shared.txt", overlapR.GetProperty("files").EnumerateArray().Select(f => f.GetString()));
        Assert.False(overlapR.GetProperty("merge").GetProperty("clean").GetBoolean());

        // Two tasks with no dependency on each other that changed one file: told the same way.
        var p = await w.TaskAsync("P", "write clash.txt for P");
        var q = await w.TaskAsync("Q", "write clash.txt for Q");
        await w.ReadyAsync(p);
        await w.ReadyAsync(q);
        await w.DevelopAsync(p);
        await w.DevelopAsync(q);
        var overlapP = Assert.Single((await TaskWorld.Ok(await w.Admin.GetAsync($"/tasks/{p}/overlaps"))).EnumerateArray());
        Assert.Equal(await w.SeqAsync(q), overlapP.GetProperty("seq").GetInt32());
        Assert.Equal("none", overlapP.GetProperty("relation").GetString());
        Assert.False(overlapP.GetProperty("merge").GetProperty("clean").GetBoolean());
        // tasks that touch different files are not told about each other
        var seqP = await w.SeqAsync(p);
        var seqQ = await w.SeqAsync(q);
        Assert.DoesNotContain((await TaskWorld.Ok(await w.Admin.GetAsync($"/tasks/{e}/overlaps"))).EnumerateArray(),
            o => o.GetProperty("seq").GetInt32() == seqP || o.GetProperty("seq").GetInt32() == seqQ);
    }

    /// <summary>
    /// The wall between clients on everything above: a person who runs one client end to end can neither read nor change
    /// another client's task — its base, its files, its overlaps, a run, a push, a rollback, a merge — and another client's
    /// task is not even found when named as the dependency to merge, in either direction (not by the admin either).
    /// </summary>
    [Fact]
    public async Task Another_clients_task_is_never_read_changed_or_merged_in()
    {
        var w = await TaskWorld.CreateAsync(_f, "client A's work");
        var a = await w.TaskAsync("A", "write a.txt");
        await w.ReadyAsync(a);
        await w.DevelopAsync(a);
        var other = await TaskWorld.CreateAsync(_f, "client B's work");
        var b = await other.TaskAsync("B", "write b.txt");
        await other.ReadyAsync(b);
        await other.DevelopAsync(b);

        var (managerId, _, password) = await _f.NewUserAsync();
        await _f.AssignAsync("user", managerId, "client_manager", "client", other.ClientId);
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", managerId));
        var manager = _f.Client((await _f.LoginAsync(email, password)).AccessToken);
        // the positive control: their own client's task is theirs
        Assert.Equal(HttpStatusCode.OK, (await manager.GetAsync($"/tasks/{b}/built-on")).StatusCode);

        foreach (var path in new[] { "", "/built-on", "/files", "/overlaps", "/implement-preview", "/flow-run" })
            Assert.Equal(HttpStatusCode.Forbidden, (await manager.GetAsync($"/tasks/{a}{path}")).StatusCode);
        foreach (var path in new[] { "/implement", "/push", "/rollback" })
            Assert.Equal(HttpStatusCode.Forbidden, (await manager.PostAsync($"/tasks/{a}{path}", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.PostAsJsonAsync($"/tasks/{a}/merge-dependency", new { dependencyId = b })).StatusCode);

        // Named as the dependency, the other client's task does not exist — from either side, whoever asks.
        Assert.Equal(HttpStatusCode.NotFound, (await manager.PostAsJsonAsync($"/tasks/{b}/merge-dependency", new { dependencyId = a })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await w.Admin.PostAsJsonAsync($"/tasks/{a}/merge-dependency", new { dependencyId = b })).StatusCode);
        // and nothing moved: A's work is where it was, still one commit of its own
        Assert.DoesNotContain("b.txt", await w.FilesOnAsync(await w.BranchOfAsync(a)));
        Assert.Equal(["a.txt"], (await FilesAsync(w, a)).EnumerateArray().Select(f => f.GetProperty("path").GetString()));
    }
}
