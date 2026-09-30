using System.Text.Json.Serialization;

namespace Dcc.Domain.Tasks;

public sealed record FlowBaseOn(int Seq, string? Sha);

/// <summary>What a run was built on and without.</summary>
public sealed record FlowBase(FlowBaseOn? On, IReadOnlyList<int> Without);

public sealed record FlowChecks(int Ran, int Passed, int Failed, int Waiting, int? NotRun = null);

public sealed record FlowCycle
{
    /// <summary>The development run this cycle is — what the step's record is read from.</summary>
    public string? RunId { get; init; }
    /// <summary>running / done / error / rolled_back.</summary>
    public required string State { get; init; }
    public required string StartedAt { get; init; }
    /// <summary>What the run was built on and without; absent on a run from before that was recorded.</summary>
    public FlowBase? Base { get; init; }
    /// <summary>Whether the run actually verified the build.</summary>
    public bool BuildVerified { get; init; }
    public bool BuildFailed { get; init; }
    /// <summary>The checks after the build — tests, regression, E2E; NotRun read live.</summary>
    public required FlowChecks Checks { get; init; }
    /// <summary>It was pushed, or the task was closed on it.</summary>
    public bool Reviewed { get; init; }
}

public sealed record FlowNow(string? Running, bool Closed, IReadOnlyList<int> PendingDeps);

public sealed record FlowStep(
    string Kind,
    string State,
    int Round,
    bool Past,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<int>? Deps = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? At = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Note = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RunId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Pending = null);

public sealed record LiveCheck(string? Kind, string? Result, string? Cause);

/// <summary>
/// The steps a task went through, as its screen draws them: development (with the build), checks,
/// review — and a "dependency" step wherever a dependency's work came into the task after it had
/// already started. Pure (task-flow-steps.ts, one for one).
/// </summary>
public static class TaskFlowSteps
{
    private static string Refs(IEnumerable<int> xs) => string.Join(", ", xs.Select(s => $"#{s}"));

    /// <summary>The last cycle's build/checks state read live from the task's current active checks, not from the saved snapshot.</summary>
    public static (bool BuildVerified, bool BuildFailed, FlowChecks Checks) LiveCycleState(IReadOnlyList<LiveCheck> checks)
    {
        var build = checks.FirstOrDefault(c => c.Kind == "build");
        var after = checks.Where(c => c.Kind != "build" && c.Result is not null).ToList();
        return (build is not null && build.Result is not null, build?.Result == "failed",
            new FlowChecks(after.Count, after.Count(c => c.Result == "passed"),
                after.Count(c => c.Result == "failed" && c.Cause != "dependency_missing"),
                after.Count(c => c.Result == "waiting"),
                checks.Count(c => c.Kind != "build" && c.Result is null)));
    }

    public static FlowCycle WithLive(FlowCycle c, IReadOnlyList<LiveCheck> checks)
    {
        var (v, f, k) = LiveCycleState(checks);
        return c with { BuildVerified = v, BuildFailed = f, Checks = k };
    }

    /// <summary>The dependencies whose work is in <paramref name="next"/> and was not in <paramref name="prev"/>.</summary>
    public static List<int> GainedDeps(FlowBase prev, FlowBase next)
    {
        var o = new SortedSet<int>();
        foreach (var s in prev.Without) if (!next.Without.Contains(s)) o.Add(s);
        var moved = prev.On is not null && next.On is not null && prev.On.Seq == next.On.Seq
            && !string.IsNullOrEmpty(prev.On.Sha) && !string.IsNullOrEmpty(next.On.Sha) && prev.On.Sha != next.On.Sha;
        if (next.On is not null && (prev.On is null || prev.On.Seq != next.On.Seq || moved)) o.Add(next.On.Seq);
        return o.ToList();
    }

    private static string? BaseNote(FlowBase? b)
    {
        if (b is null) return null;
        var parts = new[] { b.On is not null ? $"נבנתה על גבי #{b.On.Seq}" : "", b.Without.Count > 0 ? $"בלי {Refs(b.Without)}" : "" }.Where(p => p.Length > 0).ToList();
        return parts.Count > 0 ? string.Join(", ", parts) : null;
    }

    private static string ChecksNote(FlowChecks c) =>
        $"{c.Passed}/{c.Ran} עברו{(c.Failed > 0 ? $", {c.Failed} נכשלו" : "")}{(c.Waiting > 0 ? $", {c.Waiting} מחכות לתלות" : "")}";

    private static string ChecksState(FlowCycle last) =>
        last.Checks.Ran == 0 ? "current"
        : last.Checks.Failed > 0 ? "failed"
        : last.Checks.Waiting > 0 ? "waiting"
        : (last.Checks.NotRun ?? 0) > 0 ? "current"
        : "done";

    public static List<FlowStep> Steps(IReadOnlyList<FlowCycle> cycles, FlowNow now)
    {
        var rounds = new List<(List<int> Deps, List<FlowCycle> Cycles)>();
        FlowBase? lastBase = null;
        foreach (var c in cycles)
        {
            var gained = lastBase is not null && c.Base is not null ? GainedDeps(lastBase, c.Base) : [];
            if (rounds.Count == 0 || gained.Count > 0) rounds.Add((gained, [c]));
            else rounds[^1].Cycles.Add(c);
            if (c.Base is not null) lastBase = c.Base;
        }
        var pending = now.Running is not null ? [] : now.PendingDeps;
        if (rounds.Count == 0 && pending.Count == 0) rounds.Add(([], []));

        var steps = new List<FlowStep>();
        for (var i = 0; i < rounds.Count; i++)
        {
            var r = rounds[i];
            var round = i + 1;
            var at = r.Cycles.FirstOrDefault()?.StartedAt;
            var first = i == 0;
            var live = i == rounds.Count - 1 && pending.Count == 0;
            var workKind = first ? "develop" : "dependency";
            IReadOnlyList<int>? deps = first ? null : r.Deps;

            if (!live)
            {
                var built = r.Cycles.Where(c => c.State is "done" or "rolled_back").ToList();
                var withChecks = built.Where(c => c.Checks.Ran > 0).ToList();
                var runId = (built.LastOrDefault() ?? r.Cycles.LastOrDefault())?.RunId;
                var lastBuilt = built.LastOrDefault();
                steps.Add(new FlowStep(workKind, lastBuilt is null || lastBuilt.BuildFailed ? "failed" : "done", round, true, deps, at, BaseNote(lastBuilt?.Base), runId));
                var lastChecked = withChecks.LastOrDefault();
                if (lastChecked is not null) steps.Add(new FlowStep("checks", lastChecked.Checks.Failed > 0 ? "failed" : "done", round, true, null, at, ChecksNote(lastChecked.Checks), lastChecked.RunId));
                if (r.Cycles.Any(c => c.Reviewed)) steps.Add(new FlowStep("review", "done", round, true, null, at, null, runId));
                continue;
            }

            var last = r.Cycles.LastOrDefault();
            var work =
                now.Running is "develop" or "build" ? "current"
                : now.Running == "test" ? "done"
                : last is null || last.State == "rolled_back" ? "current"
                : last.State == "error" || last.BuildFailed ? "failed"
                : !last.BuildVerified ? "current"
                : "done";
            var checks =
                now.Running == "test" ? "current"
                : work != "done" ? "todo"
                : last is null ? "current"
                : ChecksState(last);
            var review = now.Closed ? "done" : checks is "done" or "waiting" ? "current" : "todo";
            steps.Add(new FlowStep(workKind, work, round, false, deps, at, BaseNote(last?.Base)));
            steps.Add(new FlowStep("checks", checks, round, false, null, at, last is not null && last.Checks.Ran > 0 ? ChecksNote(last.Checks) : null));
            steps.Add(new FlowStep("review", review, round, false, null, at));
        }

        if (pending.Count > 0)
        {
            var round = rounds.Count + 1;
            var prev = rounds.Count > 0 ? rounds[^1].Cycles.LastOrDefault() : null;
            var prevBuilt = prev is not null && prev.State == "done" && !prev.BuildFailed && prev.BuildVerified;
            var checks = !prevBuilt ? "todo" : ChecksState(prev!);
            var review = now.Closed ? "done" : checks is "done" or "waiting" ? "current" : "todo";
            steps.Add(new FlowStep("dependency", "current", round, false, pending, null,
                $"{Refs(pending)} פותחה מאז — אפשר להמשיך לבדיקות כמו שהן, או Rollback והרצה חוזרת שיבנו את המשימה עליה", Pending: true));
            steps.Add(new FlowStep("checks", checks, round, false, null, null, prev is not null && prev.Checks.Ran > 0 ? ChecksNote(prev.Checks) : null));
            steps.Add(new FlowStep("review", review, round, false));
        }
        return steps;
    }
}
