using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Tasks;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Repos;

namespace Dcc.Infrastructure.Tasks;

/// <summary>What a task's branch is (or would be) built on — built: its branch exists; planned: what a first run would build on.</summary>
public sealed record TaskBuiltOn(string State, BuiltOnRef? On, IReadOnlyList<BuiltOnMissing> Missing, bool OnMoved, IReadOnlyList<BuiltOnAvailable> NowAvailable);
public sealed record BuiltOnRef(Guid Id, int Seq, string Intent, string Branch);
public sealed record BuiltOnMissing(Guid Id, int Seq, string Intent, string State, string Why);
public sealed record BuiltOnAvailable(Guid Id, int Seq, string Intent);

/// <summary>
/// The facts task statuses, steps and bases are decided by (ai-assist.ts: statusFactsFor, taskBuiltOn,
/// taskFlowOf). The decisions themselves are pure (Dcc.Domain.Tasks); this gathers what they read — the
/// rows, the runs, the live phase and, only where needed, git in DCC's own clone (never cloned here).
/// </summary>
public sealed class TaskFacts(TaskStore store, FlowRunHub hub)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // ── what a branch is built on (task-base.ts decides) ─────────────

    private async Task<List<(DependencyFacts Facts, string? BaseSha)>> DependencyFactsAsync(Guid clientId, TaskRow t, string? reqKey, string? dir, CancellationToken ct)
    {
        var rel = await store.RelationsAsync(clientId, t.WorkitemId, ct);
        var deps = rel.EffectiveDeps(t.Id).Select(d => d.Row).OrderBy(d => d.Seq).ToList();
        var def = dir is not null ? await Git.DefaultBranchAsync(dir) : null;
        var output = new List<(DependencyFacts, string?)>();
        foreach (var d in deps)
        {
            var branch = store.BranchOf(reqKey, d);
            var own = dir is not null ? await Git.TaskCommitCountAsync(dir, branch, d.BaseSha) : 0;
            var merged = own > 0 && dir is not null && await Git.IsAncestorAsync(dir, branch, $"origin/{def}");
            output.Add((new DependencyFacts(d.Id.ToString(), d.Seq, d.Intent, d.State, own > 0 ? branch : null, merged), d.BaseSha));
        }
        return output;
    }

    /// <summary>What a branch created now would start from.</summary>
    public async Task<BasePlan> PlanBaseAsync(Guid clientId, TaskRow t, string? reqKey, string? dir, CancellationToken ct)
    {
        var deps = (await DependencyFactsAsync(clientId, t, reqKey, dir, ct)).Select(x => x.Facts).ToList();
        var holds = new HashSet<string>();
        var open = deps.Where(d => d.Branch is not null && !d.Merged).ToList();
        foreach (var a in open)
            foreach (var b in open)
                if (!ReferenceEquals(a, b) && dir is not null && await Git.IsAncestorAsync(dir, b.Branch!, a.Branch!)) holds.Add($"{a.Id}|{b.Id}");
        return TaskBranches.ChooseBase(deps, (a, b) => holds.Contains($"{a.Id}|{b.Id}"));
    }

    /// <summary>
    /// What a task's branch is (or would be) built on — for the prompt, the task screen and the preview, from the
    /// same facts a run decides by. <paramref name="dirHint"/>: the clone to read (null = none); unset = DCC's own clone if there.
    /// </summary>
    public async Task<TaskBuiltOn> BuiltOnAsync(Guid clientId, Guid taskId, CancellationToken ct, Optional<string?> dirHint = default)
    {
        var t = await store.RequireAsync(clientId, taskId, ct);
        var key = await store.RequirementKeyAsync(clientId, t.WorkitemId, ct);
        var dir = dirHint.HasValue ? dirHint.Value : await store.ExistingCloneAsync(clientId, t.WorkitemId, ct);
        var branch = store.BranchOf(key, t);
        var own = dir is not null ? await Git.TaskCommitCountAsync(dir, branch, t.BaseSha) : 0;

        // Developed = its branch was made by a run (the base is recorded then, forgotten on rollback) — even one that changed nothing.
        if (own == 0 && t.BaseSha is null)
        {
            var plan = await PlanBaseAsync(clientId, t, key, dir, ct);
            return new TaskBuiltOn("planned",
                plan.On is { } on ? new BuiltOnRef(Guid.Parse(on.Id), on.Seq, on.Intent, on.Branch!) : null,
                plan.Missing.Select(m => new BuiltOnMissing(Guid.Parse(m.Dep.Id), m.Dep.Seq, m.Dep.Intent, m.Dep.State, m.Why)).ToList(), false, []);
        }

        var ids = (t.BaseTaskId is { } b ? new[] { b } : []).Concat(t.BuiltWithout).ToArray();
        var rows = ids.Length == 0 ? [] : await store.WhereAsync(clientId, "id = any(@ids)", new { ids }, ct);
        var byId = rows.ToDictionary(r => r.Id);
        var baseRow = t.BaseTaskId is { } bid ? byId.GetValueOrDefault(bid) : null;
        var onMoved = false;
        if (baseRow is not null && dir is not null && t.BaseBranch is not null && t.BaseSha is not null)
        {
            var tip = (await Git.RunAsync(dir, "rev-parse", "--verify", "--quiet", t.BaseBranch)).Out;
            onMoved = tip.Length > 0 && tip != t.BaseSha && await Git.IsAncestorAsync(dir, t.BaseSha, tip);
        }
        var without = t.BuiltWithout.Select(id => byId.GetValueOrDefault(id)).Where(x => x is not null && x.State != "dropped").Select(x => x!).ToList();
        var nowAvailable = new List<BuiltOnAvailable>();
        foreach (var d in without)
        {
            var has = dir is not null && await Git.TaskCommitCountAsync(dir, store.BranchOf(key, d), d.BaseSha) > 0;
            if (has || d.State == "done") nowAvailable.Add(new BuiltOnAvailable(d.Id, d.Seq, d.Intent));
        }
        return new TaskBuiltOn("built",
            baseRow is not null ? new BuiltOnRef(baseRow.Id, baseRow.Seq, baseRow.Intent, t.BaseBranch ?? store.BranchOf(key, baseRow)) : null,
            without.Select(d => new BuiltOnMissing(d.Id, d.Seq, d.Intent, d.State, "not_in_base")).ToList(), onMoved, nowAvailable);
    }

    // ── statuses (task-status.ts decides) ────────────────────────────

    public sealed record Facts(Dictionary<Guid, StatusFacts> ByTask, Relations Rel, HashSet<Guid> OwnDevelopment);

    /// <summary>The facts every task of a requirement's status is read from — one pass over its rows, runs and dependencies.</summary>
    public async Task<Facts> ForRequirementAsync(Guid clientId, Guid workitemId, CancellationToken ct)
    {
        var rel = await store.RelationsAsync(clientId, workitemId, ct);
        var runs = await store.ImplementRunsAsync("workitem_id = @w", new { w = workitemId }, ct);
        var ownDevelopment = runs.Where(r => Str(r, "state") == "done" && Str(r, "taskId") is not null).Select(r => Guid.Parse(Str(r, "taskId")!)).ToHashSet();
        bool Developed(Guid id) => rel.IsGroup(id) ? rel.SubtasksOf(id).Any(s => Developed(s.Id) || s.State == "done") : ownDevelopment.Contains(id);
        var lastRun = new Dictionary<Guid, JsonObject>();
        foreach (var r in runs) if (Str(r, "taskId") is { } tid && !lastRun.ContainsKey(Guid.Parse(tid))) lastRun[Guid.Parse(tid)] = r;

        string? dir = null;
        var dirRead = false;
        async Task<string?> Clone()
        {
            if (!dirRead) { dir = await store.ExistingCloneAsync(clientId, workitemId, ct); dirRead = true; }
            return dir;
        }

        var facts = new Dictionary<Guid, StatusFacts>();
        foreach (var t in rel.Rows)
        {
            var last = lastRun.GetValueOrDefault(t.Id);
            var group = rel.IsGroup(t.Id);
            var ownChecks = rel.Rows.Where(c => c.ParentTaskId == t.Id && c.Kind == "check" && c.State != "dropped").ToList();
            var running = hub.LiveTaskPhase(t.Id);
            if (running is null && t.Kind == "check" && t.ParentTaskId is { } pid)
            {
                // A check is running when its task's run is at its step.
                var p = hub.LiveTaskPhase(pid);
                if ((p == "build" && t.CheckKind == "build") || (p == "test" && t.CheckKind != "build")) running = p;
            }
            if (running is null && group && ownChecks.Any(c => hub.LiveTaskPhase(c.Id) is not null)) running = "test";
            int? onMoved = null;
            if (!group && t.BaseTaskId is { } baseId && t.BaseBranch is not null && t.BaseSha is not null && ownDevelopment.Contains(t.Id))
            {
                var d = await Clone();
                var tip = d is not null ? (await Git.RunAsync(d, "rev-parse", "--verify", "--quiet", t.BaseBranch)).Out : "";
                if (d is not null && tip.Length > 0 && tip != t.BaseSha && await Git.IsAncestorAsync(d, t.BaseSha, tip))
                    onMoved = rel.ById.GetValueOrDefault(baseId)?.Seq ?? 0;
            }
            facts[t.Id] = new StatusFacts
            {
                Kind = t.Kind, State = t.State, Active = t.Active, Approved = t.Approved, InTfs = t.LinkedAdoId is not null, Running = running,
                LastRunError = !group && last is not null && Str(last, "state") == "error" ? Str(last, "error") ?? "שגיאה" : null,
                Developed = Developed(t.Id),
                Checks = ownChecks.Select(c => new StatusCheck(c.Seq, c.CheckKind, c.CheckResult, c.CheckCause, c.Active)).ToList(),
                OpenDeps = rel.EffectiveDeps(t.Id).Select(d => d.Row).Where(d => d.State != "done").OrderBy(d => d.Seq)
                    .Select(d => new StatusDep(d.Seq, Developed(d.Id))).ToList(),
                BuiltWithout = group ? [] : t.BuiltWithout.Select(id => rel.ById.GetValueOrDefault(id)).Where(x => x is not null && x.InPlay)
                    .Select(d => new BuiltWithout(d!.Seq, Developed(d.Id) || d.State == "done")).ToList(),
                OnMovedSeq = onMoved, CheckResult = t.CheckResult, CheckCause = t.CheckCause,
                Subtasks = group ? rel.SubtasksOf(t.Id).Select(s => new StatusSubtask(s.Seq, Developed(s.Id), s.State == "done")).ToList() : null,
            };
        }
        return new Facts(facts, rel, ownDevelopment);
    }

    /// <summary>Every task (and check) of a requirement, by id: its status as a person reads it.</summary>
    public async Task<Dictionary<Guid, TaskStatusView>> StatusesAsync(Guid clientId, Guid workitemId, CancellationToken ct) =>
        (await ForRequirementAsync(clientId, workitemId, ct)).ByTask.ToDictionary(kv => kv.Key, kv => TaskStatuses.Of(kv.Value));

    public static JsonObject StatusMap(Dictionary<Guid, TaskStatusView> statuses)
    {
        var o = new JsonObject();
        foreach (var (id, s) in statuses) o[id.ToString()] = JsonSerializer.SerializeToNode(s, Json);
        return o;
    }

    /// <summary>What keeps a task from being closed besides its own checks: its dependencies, work it was built without, a base that moved, a group's open sub-tasks.</summary>
    public async Task<List<string>> DoneBlockersAsync(Guid clientId, TaskRow t, CancellationToken ct)
    {
        if (t.Kind == "check") return [];
        var facts = await ForRequirementAsync(clientId, t.WorkitemId, ct);
        if (!facts.ByTask.TryGetValue(t.Id, out var f)) return [];
        var open = (f.Subtasks ?? []).Where(s => !s.Done).ToList();
        var output = new List<string>();
        if (open.Count > 0) output.Add($"{string.Join(", ", open.Select(s => $"#{s.Seq}"))} עוד לא הסתיימה — קבוצה נסגרת אחרי כל תת-המשימות שלה");
        output.AddRange(TaskStatuses.DependencyBlockers(f));
        return output;
    }

    // ── the steps a task went through (task-flow-steps.ts decides) ───

    public async Task<List<FlowStep>> FlowOfAsync(Guid clientId, TaskRow t, CancellationToken ct)
    {
        if (t.Kind == "check" || (await store.RelationsAsync(clientId, t.WorkitemId, ct)).IsGroup(t.Id)) return [];
        var runs = await store.ImplementRunsAsync("task_id = @t", new { t = t.Id }, ct, "started_at");
        var cycles = runs.Where(r => Str(r, "state") != "stopped").Select(r =>
        {
            var res = r["result"] as JsonObject;
            var all = (res?["checks"] as JsonArray)?.OfType<JsonObject>().ToList() ?? [];
            var after = all.Where(c => Str(c, "kind") != "build").ToList();
            bool Passed(JsonObject c) => c["passed"]?.GetValue<bool>() == true;
            return new FlowCycle
            {
                RunId = Str(r, "id"), State = Str(r, "state")!, StartedAt = Str(r, "startedAt")!, Base = ReadBase(res?["base"]),
                BuildVerified = all.Any(c => Str(c, "kind") == "build"),
                BuildFailed = all.Any(c => Str(c, "kind") == "build" && !Passed(c)) || (res?["skipped"] as JsonArray)?.Count > 0,
                Checks = new FlowChecks(after.Count, after.Count(Passed),
                    after.Count(c => !Passed(c) && Str(c, "likelyCause") != "dependency_missing"),
                    after.Count(c => !Passed(c) && Str(c, "likelyCause") == "dependency_missing")),
                Reviewed = res?["pushedAt"] is not null || res?["closedAt"] is not null,
            };
        }).ToList();

        // The last cycle's checks are a snapshot from when that run ended; a check rerun on its own goes past it —
        // overlaid with the live checks, while that cycle's code is in place.
        if (cycles.Count > 0 && cycles[^1].State == "done")
        {
            var live = await store.ChecksOfAsync(clientId, t.Id, ct);
            cycles[^1] = TaskFlowSteps.WithLive(cycles[^1], live.Select(c => new LiveCheck(c.CheckKind, c.CheckResult, c.CheckCause)).ToList());
        }

        var pending = new List<int>();
        var last = cycles.LastOrDefault();
        if (last?.State == "done")
        {
            var f = (await ForRequirementAsync(clientId, t.WorkitemId, ct)).ByTask.GetValueOrDefault(t.Id);
            if (f is not null)
            {
                pending.AddRange(f.BuiltWithout.Where(d => d.Available).Select(d => d.Seq));
                if (f.OnMovedSeq is { } m) pending.Add(m);
            }
        }
        else if (last?.State == "rolled_back" && cycles.LastOrDefault(c => c.Base is not null)?.Base is { } lastBase)
        {
            TaskBuiltOn? plan = null;
            try { plan = await BuiltOnAsync(clientId, t.Id, ct); } catch (AppException) { }
            if (plan is not null)
                pending.AddRange(TaskFlowSteps.GainedDeps(lastBase, new FlowBase(plan.On is { } on ? new FlowBaseOn(on.Seq, null) : null, plan.Missing.Select(m => m.Seq).ToList())));
        }
        return TaskFlowSteps.Steps(cycles, new FlowNow(hub.LiveTaskPhase(t.Id), t.State == "done", pending.Distinct().ToList()));
    }

    public static FlowBase? ReadBase(JsonNode? n)
    {
        if (n is not JsonObject o) return null;
        FlowBaseOn? on = o["on"] is JsonObject x ? new FlowBaseOn(x["seq"]!.GetValue<int>(), Str(x, "sha")) : null;
        var without = (o["without"] as JsonArray)?.Select(v => v!.GetValue<int>()).ToList() ?? [];
        return new FlowBase(on, without);
    }

    public static JsonObject BaseJson(FlowBase b) => new()
    {
        ["on"] = b.On is { } on ? new JsonObject { ["seq"] = on.Seq, ["sha"] = on.Sha } : null,
        ["without"] = new JsonArray(b.Without.Select(x => (JsonNode?)x).ToArray()),
    };

    /// <summary>What each of a task's checks said the last time it ran — the task's own run, or the check's own rerun, whichever ran it last.</summary>
    public async Task<JsonObject> CheckOutcomesAsync(Guid clientId, Guid taskId, CancellationToken ct)
    {
        var checks = await store.WhereAsync(clientId, "parent_task_id = @t and kind = 'check'", new { t = taskId }, ct);
        var output = new JsonObject();
        if (checks.Count == 0) return output;
        var ids = checks.Select(c => c.Id).Append(taskId).ToArray();
        var runs = await store.ImplementRunsAsync("task_id = any(@ids) and state = 'done'", new { ids }, ct);
        foreach (var c in checks)
            foreach (var r in runs)
            {
                var tid = Str(r, "taskId");
                if (tid != taskId.ToString() && tid != c.Id.ToString()) continue;
                var o = ((r["result"] as JsonObject)?["checks"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(x => x["seq"]?.GetValue<int>() == c.Seq);
                if (o is null) continue;
                var copy = (JsonObject)o.DeepClone();
                copy["at"] = Str(r, "startedAt");
                output[c.Id.ToString()] = copy;
                break;
            }
        return output;
    }

    public static string? Str(JsonObject? o, string k) => o?[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}

/// <summary>An argument that may be left unset — distinct from set to null.</summary>
public readonly struct Optional<T>(T value)
{
    public bool HasValue { get; } = true;
    public T Value { get; } = value;
    public static implicit operator Optional<T>(T value) => new(value);
}
