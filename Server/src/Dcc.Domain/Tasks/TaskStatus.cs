using System.Text.Json.Serialization;

namespace Dcc.Domain.Tasks;

/// <summary>A dependency that is not done — shown beside the status, whatever the status is. Never a gate.</summary>
public sealed record DependencyTag(string Label, string Tone, string Reason);

/// <summary>A task's status as a person reads it — computed, never stored.</summary>
public sealed record TaskStatusView(string Key, string Label, string Tone,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Reason = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DependencyTag? Dependency = null);

public sealed record StatusCheck(int Seq, string? Kind, string? Result, string? Cause, bool Active);

public sealed record StatusDep(int Seq, bool Developed);

public sealed record BuiltWithout(int Seq, bool Available);

public sealed record StatusSubtask(int Seq, bool Developed, bool Done);

/// <summary>The facts a status is computed from — gathered by the caller from the rows, the runs and git.</summary>
public sealed record StatusFacts
{
    public required string Kind { get; init; }
    public required string State { get; init; }
    public bool Active { get; init; } = true;
    public bool Approved { get; init; }
    /// <summary>It has a work item in TFS — nothing is developed before it does.</summary>
    public bool InTfs { get; init; }
    /// <summary>A run of it is going on now, in this phase (develop / build / test).</summary>
    public string? Running { get; init; }
    public string? LastRunError { get; init; }
    public bool Developed { get; init; }
    public IReadOnlyList<StatusCheck> Checks { get; init; } = [];
    public IReadOnlyList<StatusDep> OpenDeps { get; init; } = [];
    public IReadOnlyList<BuiltWithout> BuiltWithout { get; init; } = [];
    public int? OnMovedSeq { get; init; }
    public string? CheckResult { get; init; }
    public string? CheckCause { get; init; }
    public IReadOnlyList<StatusSubtask>? Subtasks { get; init; }
}

/// <summary>
/// The status rules, ported one for one (task-status.ts). The stored <c>task.state</c> stays
/// the small set the rest of the system runs on; everything finer here follows from facts
/// that already exist, so it can never disagree with them. Pure.
/// </summary>
public static class TaskStatuses
{
    private static readonly Dictionary<string, string> PhaseHe = new() { ["develop"] = "בפיתוח", ["build"] = "מקמפלת", ["test"] = "בבדיקות" };
    private static readonly string?[] KindOrder = ["build", "tests", "regression", "e2e", null];
    private static readonly Dictionary<string, string> KindFailLabel = new()
    {
        ["build"] = "נפלה על ה-Build", ["tests"] = "נפלה על בדיקות הפיתוח", ["regression"] = "נפלה על בדיקות רגרסיה", ["e2e"] = "נפלה על בדיקות E2E",
    };
    private static readonly Dictionary<string, string> ResultHe = new() { ["passed"] = "עברה", ["failed"] = "נכשלה", ["waiting"] = "חיכתה לתלות" };

    private static string Refs(IEnumerable<int> seqs) => string.Join(", ", seqs.Select(s => $"#{s}"));

    private static int Order(string? kind) => Array.IndexOf(KindOrder, kind); // an unknown kind sorts first, as indexOf -1 did

    private static string WhyFailed(StatusCheck c, IReadOnlyList<StatusDep> openDeps)
    {
        if (c.Cause == "environment") return c.Kind == "build" ? "אי אפשר לבנות כאן — חסר כלי או SDK" : $"בדיקה #{c.Seq} לא יכלה לרוץ כאן";
        if (c.Cause == "requirement_ambiguity")
        {
            var missing = openDeps.Where(d => !d.Developed).ToList();
            return missing.Count > 0
                ? $"בדיקה #{c.Seq} נכשלה — כנראה עמימות בדרישה, אולי כי {Refs(missing.Select(m => m.Seq))} עוד לא פותחה"
                : $"בדיקה #{c.Seq} נכשלה — כנראה עמימות בדרישה";
        }
        return c.Kind switch
        {
            "build" => "ה-Build נכשל",
            "tests" => "בדיקות הפיתוח נכשלו",
            "regression" => "בדיקות רגרסיה נכשלו",
            "e2e" => "בדיקות E2E נכשלו",
            _ => $"בדיקה #{c.Seq} נכשלה",
        };
    }

    public static TaskStatusView Of(StatusFacts f)
    {
        var s = PhaseStatus(f);
        var dep = DependencyTagFor(f);
        return dep is null ? s : s with { Dependency = dep };
    }

    private static TaskStatusView PhaseStatus(StatusFacts f)
    {
        if (f.Kind == "check") return CheckStatus(f);
        if (!f.Active) return new("inactive", "לא פעילה", "inactive");
        if (f.State == "dropped") return new("dropped", "נדחתה", "inactive");
        if (f.State == "done") return new("done", "הסתיימה", "healthy");
        if (!f.Approved) return new("awaiting_approval", "ממתינה לאישור והקמה ב-TFS", "inactive");
        if (f.Running is { Length: > 0 } phase) return new("running", $"בעבודה · {PhaseHe.GetValueOrDefault(phase, phase)}", "active");
        if (!f.InTfs && !f.Developed) return new("awaiting_tfs", "ממתינה להקמה ב-TFS", "warning", "אי אפשר להתחיל לפתח לפני שהמשימה קיימת ב-TFS");

        var checks = f.Checks.Where(c => c.Active).OrderBy(c => Order(c.Kind)).ThenBy(c => c.Seq).ToList();
        if (f.Subtasks is { Count: > 0 }) return GroupStatus(f, checks);

        var failed = checks.Where(c => c.Result == "failed").ToList();
        if (failed.Count > 0)
        {
            var first = failed[0];
            var label = first.Kind is { } k && KindFailLabel.TryGetValue(k, out var l) ? l : "נפלה";
            return new("failed", label, "critical", WhyFailed(first, f.OpenDeps) + (failed.Count > 1 ? $" (ועוד {failed.Count - 1})" : ""));
        }
        if (f.LastRunError is { Length: > 0 } err) return new("failed", "נפלה", "critical", $"ההרצה לא הסתיימה: {(err.Length > 120 ? err[..120] : err)}");
        if (f.State == "blocked") return new("blocked", "חסומה", "critical", "סומנה כחסומה ידנית");
        if (!f.Developed) return new("ready", "מוכנה לפיתוח", "neutral");

        var build = checks.FirstOrDefault(c => c.Kind == "build");
        if (build is null || build.Result is null)
        {
            var disabled = f.Checks.FirstOrDefault(c => c.Kind == "build" && !c.Active && c.Result is not null);
            if (disabled is not null)
                return new("build_pending", "ה-Build מושבת", "inactive",
                    $"הריצה האחרונה {ResultHe.GetValueOrDefault(disabled.Result!, disabled.Result!)} — אבל הבדיקה מושבתת, כך שזה לא נספר. הפעילו אותה כדי שתרוץ שוב.");
            return new("build_pending", "ממתינה להרצת Build", "warning", "ה-Build — חלק משלב הפיתוח — עדיין לא רץ אף פעם");
        }
        var notRun = checks.Where(c => c.Kind != "build" && c.Result is null).ToList();
        if (notRun.Count > 0) return new("checks_pending", "ממתינה להרצת בדיקות", "warning", $"{notRun.Count} בדיקות עדיין לא רצו אף פעם — לחצו כדי להריץ אותן");

        var waiting = checks.Where(c => c.Result == "waiting").ToList();
        var available = f.BuiltWithout.Where(d => d.Available).ToList();
        if (available.Count > 0)
            return new("waiting_dependency", "הסתיימה — ממתינה לתלות", "warning", $"{Refs(available.Select(a => a.Seq))} פותחה מאז — Rollback והרצה חוזרת כדי לבנות עליה ולהריץ שוב את הבדיקות");
        if (f.OnMovedSeq is { } moved)
            return new("waiting_dependency", "הסתיימה — ממתינה לתלות", "warning", $"#{moved} השתנתה אחרי שהמשימה נבנתה — Rollback והרצה חוזרת");
        if (f.BuiltWithout.Count > 0 || waiting.Count > 0 || f.OpenDeps.Count > 0)
        {
            var on = f.BuiltWithout.Select(b => b.Seq).Concat(f.OpenDeps.Select(d => d.Seq)).Distinct().ToList();
            return new("waiting_dependency", "הסתיימה — ממתינה לתלות", "warning",
                on.Count > 0 ? $"{Refs(on)} עוד לא הושלמה — אחרי שתושלם, הבדיקות ירוצו שוב" : $"{waiting.Count} בדיקות מחכות לעבודה שעוד לא קיימת");
        }
        return new("review", "ממתינה לסקירה וסגירה", "ai", "הפיתוח והבדיקות עברו — נשאר לסקור, לדחוף ולסמן כהסתיימה");
    }

    /// <summary>A group: what is left is its sub-tasks' — then its own checks, which verify them together — then closing.</summary>
    private static TaskStatusView GroupStatus(StatusFacts f, List<StatusCheck> checks)
    {
        var subs = f.Subtasks!;
        var failed = checks.Where(c => c.Result == "failed").ToList();
        if (failed.Count > 0) return new("failed", "נפלה בבדיקת השילוב", "critical", WhyFailed(failed[0], f.OpenDeps));
        if (f.State == "blocked") return new("blocked", "חסומה", "critical", "סומנה כחסומה ידנית");
        var progress = $"{subs.Count(s => s.Done)}/{subs.Count} תת-משימות הסתיימו";
        var undeveloped = subs.Where(s => !s.Developed && !s.Done).ToList();
        if (undeveloped.Count > 0)
            return new("group_open", progress, subs.Any(s => s.Developed || s.Done) ? "active" : "neutral",
                $"{Refs(undeveloped.Select(s => s.Seq))} עוד לא פותחה — הקבוצה עצמה לא מפותחת, העבודה שלה היא תת-המשימות");
        if (checks.Any(c => c.Result is null))
            return new("checks_pending", "ממתינה לבדיקת השילוב", "warning", "כל תת-המשימות פותחו — אפשר להריץ את בדיקת השילוב על כל הענפים שלהן יחד");
        var open = subs.Where(s => !s.Done).ToList();
        if (open.Count > 0) return new("group_open", progress, "active", $"{Refs(open.Select(s => s.Seq))} עוד לא נסגרה");
        if (f.OpenDeps.Count > 0) return new("waiting_dependency", "הסתיימה — ממתינה לתלות", "warning", $"{Refs(f.OpenDeps.Select(d => d.Seq))} עוד לא הושלמה");
        return new("review", "ממתינה לסגירה", "ai", $"כל תת-המשימות הסתיימו{(checks.Count > 0 ? " ובדיקת השילוב עברה" : "")} — נשאר לסמן כהסתיימה");
    }

    /// <summary>The stored, coarse <c>task.state</c> after a task's checks changed. Null = no change.</summary>
    public static (string State, bool WasDone)? StoredStateAfterChecks(string current, bool wasDone, int failedChecks)
    {
        if (current == "dropped") return null;
        if (failedChecks > 0) return current == "failed_checks" ? null : ("failed_checks", current == "done");
        if (current == "failed_checks") return (wasDone ? "done" : "in_progress", false);
        return null;
    }

    private static TaskStatusView CheckStatus(StatusFacts f)
    {
        if (!f.Active) return new("inactive", "לא פעילה", "inactive");
        if (f.Running is not null) return new("running", "רצה", "active");
        return f.CheckResult switch
        {
            "passed" => new("check_passed", "עברה", "healthy"),
            "waiting" => new("check_waiting", "מחכה לתלות", "warning"),
            "failed" => f.CheckCause == "environment" ? new("check_failed", "לא יכלה לרוץ כאן", "critical") : new("check_failed", "נכשלה", "critical"),
            _ => new("check_not_run", "לא רצה עדיין", "inactive"),
        };
    }

    /// <summary>The dependency beside the status: red while one of them has no code at all, orange once they all do.</summary>
    public static DependencyTag? DependencyTagFor(StatusFacts f)
    {
        if (f.Kind == "check" || !f.Active || f.State == "dropped" || f.OpenDeps.Count == 0) return null;
        var noCode = f.OpenDeps.Where(d => !d.Developed).ToList();
        var all = Refs(f.OpenDeps.Select(d => d.Seq));
        return noCode.Count > 0
            ? new DependencyTag($"🔗 קיימת תלות · {all}", "critical", $"{Refs(noCode.Select(d => d.Seq))} עוד לא פותחה — אפשר לפתח בכל זאת, אבל בלי העבודה שלה")
            : new DependencyTag($"🔗 תלויה ב-{all}", "warning", $"{all} פותחה, אבל עוד לא הושלמה — המשימה נסגרת רק אחריה");
    }

    /// <summary>What stops a task from being closed — the dependency side (checks are counted apart). Empty = nothing.</summary>
    public static List<string> DependencyBlockers(StatusFacts f)
    {
        var o = new List<string>();
        if (f.OpenDeps.Count > 0) o.Add($"{Refs(f.OpenDeps.Select(d => d.Seq))} עוד לא הושלמה — משימה תלויה נסגרת רק אחרי התלות שלה");
        if (f.BuiltWithout.Count > 0) o.Add($"המשימה פותחה בלי {Refs(f.BuiltWithout.Select(b => b.Seq))} — Rollback והרצה חוזרת כדי שתיבנה עליה והבדיקות ירוצו שוב");
        if (f.OnMovedSeq is { } m) o.Add($"#{m} השתנתה אחרי שהמשימה נבנתה — Rollback והרצה חוזרת כדי שהבדיקות ירוצו על המצב הסופי שלה");
        return o;
    }
}
