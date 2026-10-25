using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Dcc.Domain.Onboarding;

/// <summary>A task template of trial-tasks.json: <c>When</c> is rules.json's condition language, <c>{name}</c> in the texts is filled from the rules context.</summary>
public sealed record TrialTemplate(string Key, double Priority, JsonNode? When, string TitleHe, string Prompt, TrialJudge Judge);

/// <summary>A judge's verdict on one trial answer. <c>Passed</c> null = could not judge — never a pass.</summary>
public sealed record TrialVerdict(
    [property: JsonPropertyName("passed")] bool? Passed,
    [property: JsonPropertyName("failureKind")] string? FailureKind,
    [property: JsonPropertyName("detail")] string Detail);

/// <summary>
/// The trial run (repo-onboarding/trials.ts): representative tasks the agent does in the isolated copy with no
/// components, before the build (the baseline) and after it. The task list comes from the profile
/// (trial-tasks.json) and from the processes; the judge is the code where the answer can be checked, a model other
/// than the executor where it cannot. Every failure names the kind of component that would answer it. Pure here; the
/// run engine makes the calls.
/// </summary>
public static partial class Trials
{
    public const int MinTasks = 3;
    public const int MaxTasks = 5;

    /// <summary>The <c>tasks</c> of trial-tasks.json. Parsed once by the caller and passed in — the domain reads no files.</summary>
    public static List<TrialTemplate> ParseTemplates(string trialTasksJson) =>
        (JsonNode.Parse(trialTasksJson)?["tasks"] as JsonArray ?? [])
        .OfType<JsonObject>()
        .Select(t => new TrialTemplate(
            (string?)t["key"] ?? "", t["priority"] is JsonValue p && p.GetValueKind() == JsonValueKind.Number ? p.GetValue<double>() : 0, t["when"],
            (string?)t["title_he"] ?? "", (string?)t["prompt"] ?? "", t["judge"].Deserialize<TrialJudge>()!))
        .ToList();

    public static List<TrialTask> TasksFor(JsonObject profile, string trialTasksJson, IReadOnlyList<DiscoveredProcess>? processes = null) =>
        TasksFor(profile, ParseTemplates(trialTasksJson), processes);

    /// <summary>
    /// Three to five tasks: the templates the profile calls for (by priority, a stable order), then one per process
    /// that has a step the trial can exercise. A model judge is given the profile's facts to judge against.
    /// </summary>
    public static List<TrialTask> TasksFor(JsonObject profile, IReadOnlyList<TrialTemplate> templates, IReadOnlyList<DiscoveredProcess>? processes = null)
    {
        var ctx = Rules.Context(profile);
        var facts = OnboardingProfile.FactsForJudge(profile);
        var output = templates.Where(t => !Processes.Truthy(t.When) || Rules.Evaluate(t.When!, profile)).ToList()
            .OrderBy(t => t.Priority)
            .Select(t => new TrialTask(t.Key, Rules.Fill(t.TitleHe, ctx), Rules.Fill(t.Prompt, ctx), t.Judge.Kind == "model" ? t.Judge with { Facts = facts } : t.Judge, "profile"))
            .ToList();
        foreach (var p in processes ?? [])
        {
            if (output.Count >= MaxTasks) break;
            if (!string.IsNullOrEmpty(p.Impossible)) continue;
            var step = p.Steps.FirstOrDefault(s => s.Decision != "none") ?? p.Steps.FirstOrDefault();
            if (step is null) continue;
            output.Add(new TrialTask(
                Processes.Slice($"process_{p.Key}", 60), $"תהליך: {p.Title}",
                $"In this repository, how is this done: \"{p.Title}\"? Describe the steps in order, naming the files and commands involved (paths that exist). Focus on the step \"{step.Title}\". Do not change anything.",
                new TrialJudge { Kind = "model", Facts = [.. facts, .. p.Evidence.Select(e => $"Evidence: {e}")], FailureKind = FailureKinds.MissingFact }, $"process:{p.Key}"));
        }
        return output.Take(MaxTasks).ToList();
    }

    // ── judging ──────────────────────────────────────────────────────

    [GeneratedRegex(@"^" + Processes.JsSpace + @"*(?i:RESULT:)", RegexOptions.CultureInvariant)] private static partial Regex ResultMark();
    [GeneratedRegex(@"^" + Processes.JsSpace + @"*(?i:RESULT:)" + Processes.JsSpace + "*", RegexOptions.CultureInvariant)] private static partial Regex ResultPrefix();

    /// <summary>The last line that starts with "RESULT:", without the mark.</summary>
    private static string ResultLine(string answer)
    {
        var lines = answer.Split('\n');
        for (var i = lines.Length - 1; i >= 0; i--)
            if (ResultMark().IsMatch(lines[i])) return Processes.JsTrim(ResultPrefix().Replace(lines[i], "", 1));
        return "";
    }

    /// <summary>
    /// The code's verdict, when the task's judge is the code; null when it is not. A claim it cannot have checked
    /// fails first; then the answer must say at least one of the things it must mention.
    /// </summary>
    public static TrialVerdict? JudgeByCode(TrialTask task, string answer)
    {
        if (task.Judge.Kind != "code") return null;
        var text = Processes.JsLower(answer);
        var claimed = (task.Judge.MustNotClaim ?? []).FirstOrDefault(c => text.Contains(Processes.JsLower(c), StringComparison.Ordinal));
        if (!string.IsNullOrEmpty(claimed)) return new(false, task.Judge.FailureKind, $"הסוכן טען \"{claimed}\" — טענה שאי אפשר לבסס כאן.");
        var must = task.Judge.MustMention ?? [];
        // A template without expect_he printed "undefined" in the old server; kept so the detail reads the same.
        if (must.Count > 0 && !must.Any(m => text.Contains(Processes.JsLower(m), StringComparison.Ordinal)))
            return new(false, task.Judge.FailureKind, $"התשובה לא אמרה את מה שהיה צריך: {task.Judge.ExpectHe ?? "undefined"}");
        var r = ResultLine(answer);
        return new(true, null, r.Length > 0 ? $"עבר. {Processes.Slice(r, 200)}" : "עבר.");
    }

    private const string Unreadable = "השופט לא ענה בפורמט שאפשר לקרוא.";

    /// <summary>The judge model's JSON → a verdict; a malformed answer is "could not judge", never a pass. A failure with an unknown kind is bad judgment.</summary>
    public static TrialVerdict ParseJudge(string raw)
    {
        var start = raw.IndexOf('{');
        var end = raw.LastIndexOf('}');
        if (start < 0 || end <= start) return new(null, null, Unreadable);
        try
        {
            // JsonDocument rather than JsonNode: on a repeated key it keeps the last one, as JSON.parse does.
            using var doc = JsonDocument.Parse(raw.AsMemory(start, end - start + 1), Processes.JsonOptions);
            var o = doc.RootElement;
            JsonElement? Prop(string name) => Processes.Prop(o, name);
            bool? passed = Prop("passed")?.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => null };
            var kindValue = KindText(Prop("failureKind"));
            var kind = passed == false && kindValue is not null && FailureKinds.All.Contains(kindValue) ? kindValue : passed == false ? FailureKinds.BadJudgment : null;
            var detail = Prop("detail") is { ValueKind: JsonValueKind.String } d ? Processes.Slice(Processes.JsonText(d), 400) : "";
            return new(passed, kind, detail);
        }
        catch (Exception e) when (e is JsonException or ArgumentException)
        {
            return new(null, null, Unreadable);
        }
    }

    /// <summary>
    /// The judge's failureKind as the old server's <c>String(failureKind)</c> could name a kind: the text, or a list of
    /// one (["missing_fact"] printed, counted and looked up as missing_fact there). Anything else names no kind.
    /// </summary>
    private static string? KindText(JsonElement? v) => v switch
    {
        { ValueKind: JsonValueKind.String } s => Processes.JsonText(s),
        { ValueKind: JsonValueKind.Array } a when a.GetArrayLength() == 1 => KindText(a[0]),
        _ => null,
    };

    /// <summary>A failure kind → the component kinds that answer it, and its Hebrew phrase — the rule that replaces "what /init decided".</summary>
    public static IReadOnlyDictionary<string, (IReadOnlyList<string> Kinds, string He)> FailureToKind { get; } = new Dictionary<string, (IReadOnlyList<string> Kinds, string He)>
    {
        [FailureKinds.MissingFact] = (["rule", "doc"], "לא ידע עובדה → שורת הנחיה או מסמך"),
        [FailureKinds.RuleViolated] = (["hook", "permission"], "ידע ועבר על כלל → hook או הרשאה"),
        [FailureKinds.NeedsExternal] = (["mcp", "agent"], "חסר מידע חיצוני → MCP או סוכן עם גישה"),
        [FailureKinds.CannotVerify] = (["script", "runner"], "לא יכול לאמת → סקריפט build/בדיקות או מריץ"),
        [FailureKinds.BadJudgment] = (["agent", "skill"], "שיפוט שגוי → סוכן בודק או skill"),
    };

    public static IReadOnlyDictionary<string, string> FailureHe { get; } = new Dictionary<string, string>
    {
        [FailureKinds.MissingFact] = "לא ידע עובדה",
        [FailureKinds.RuleViolated] = "ידע ועבר על כלל",
        [FailureKinds.NeedsExternal] = "חסר מידע חיצוני",
        [FailureKinds.CannotVerify] = "לא יכול לאמת",
        [FailureKinds.BadJudgment] = "שיפוט שגוי",
    };

    /// <summary>Before against after: how many passed, and the change in cost per task as a fraction rounded to hundredths (null when the baseline cost nothing).</summary>
    public static TrialDelta? Delta(IReadOnlyList<TrialOutcome> before, IReadOnlyList<TrialOutcome> after)
    {
        if (before.Count == 0 || after.Count == 0) return null;
        // Summed in order, as reduce did — Enumerable.Sum may add doubles in another order.
        static TrialTally Sum(IReadOnlyList<TrialOutcome> xs) => new(xs.Count(t => t.Passed == true), xs.Count, xs.Aggregate(0.0, (a, t) => a + t.CostUsd));
        var b = Sum(before);
        var a = Sum(after);
        var perB = b.Total > 0 ? b.CostUsd / b.Total : 0;
        var perA = a.Total > 0 ? a.CostUsd / a.Total : 0;
        return new TrialDelta(b, a, perB > 0 ? JsRound((perA - perB) / perB * 100) / 100 : null);
    }

    /// <summary>JavaScript's Math.round: a half goes up, toward +∞ (−20.5 → −20), unlike MidpointRounding.AwayFromZero.</summary>
    private static double JsRound(double x)
    {
        var floor = Math.Floor(x);
        return x - floor >= 0.5 ? floor + 1 : floor;
    }

    /// <summary>How many failed of each kind, in the order first seen.</summary>
    public static Dictionary<string, int> ByKind(IReadOnlyList<TrialOutcome> outcomes)
    {
        var output = new Dictionary<string, int>();
        foreach (var t in outcomes)
            if (!string.IsNullOrEmpty(t.FailureKind)) output[t.FailureKind] = output.GetValueOrDefault(t.FailureKind) + 1;
        return output;
    }

    public static string Render(IReadOnlyList<TrialOutcome> outcomes) => outcomes.Count > 0
        ? string.Join("\n", outcomes.Select(t =>
            $"- {t.TitleHe} ({t.TaskKey}): {(t.Passed == true ? "passed" : t.Passed == false ? $"FAILED — {t.FailureKind ?? "null"}" : "not judged")}{(string.IsNullOrEmpty(t.Detail) ? "" : $" — {t.Detail}")}"))
        : "(no trial run yet)";
}
