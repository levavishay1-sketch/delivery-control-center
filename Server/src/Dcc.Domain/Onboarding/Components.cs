using System.Globalization;
using System.Text.Json.Nodes;
using static System.FormattableString;

namespace Dcc.Domain.Onboarding;

/// <summary>What <see cref="Components.Readiness"/> answers from: the run's record. <c>Firings</c> is carried as the old server carried it, unread.</summary>
public sealed record ReadinessInput(
    IReadOnlyList<Component> Cards,
    IReadOnlyList<DiscoveredProcess> Processes,
    IReadOnlyList<TrialOutcome> Trials,
    TrialDelta? Delta,
    int ReviewerOpen,
    IReadOnlyList<RuleSuppression> Suppressed,
    IReadOnlyList<RuleFiring> Firings,
    bool WindowsOnly,
    bool HasRunner);

/// <summary>
/// Component cards (components.ts): what a rule, a failed trial, a process step, the open search, the reviewer or a
/// person seeds becomes one card with its evidence, its group (built and reported / waits for approval / not
/// recommended here), its risk and its decision. Pure: the grouping, the build order, the readiness gate and the
/// report the pull request carries are all here and tested. The run engine stores the cards and takes the decisions.
/// </summary>
public static class Components
{
    public static IReadOnlyDictionary<string, string> KindHe { get; } = new Dictionary<string, string>
    {
        ["rule"] = "שורת הנחיה", ["hook"] = "hook", ["permission"] = "הרשאה", ["skill"] = "skill", ["agent"] = "סוכן", ["mcp"] = "MCP", ["plugin"] = "plugin", ["lsp"] = "LSP", ["scaffold"] = "קובץ בסיס",
        ["doc"] = "מסמך", ["report"] = "דיווח", ["runner"] = "מריץ", ["settings"] = "הגדרות", ["gitattributes"] = ".gitattributes", ["gitignore"] = ".gitignore", ["review"] = "REVIEW.md", ["pr_template"] = "תבנית PR", ["devcontainer"] = "devcontainer", ["script"] = "סקריפט",
    };

    public static IReadOnlyDictionary<string, string> FamilyHe { get; } = new Dictionary<string, string>
    {
        ["safety"] = "בטיחות", ["verification"] = "אימות", ["knowledge"] = "ידע", ["connections"] = "חיבורים", ["skills"] = "skills", ["agents"] = "סוכנים", ["enforcement"] = "אכיפה", ["measurement"] = "מדידה ודיווח",
    };

    public static IReadOnlyDictionary<string, string> GroupHe { get; } = new Dictionary<string, string> { ["auto"] = "נעשה ודווח", ["approval"] = "מחכה לאישורך", ["not_recommended"] = "לא מומלץ כאן" };

    /// <summary>Which group a seed lands in: by problem and risk, then by the run's automation level. Reads only the kind, the risk and <c>NotRecommended</c>.</summary>
    public static string GroupFor(ComponentSeed seed, string level)
    {
        if (seed.NotRecommended) return "not_recommended";
        if (seed.Kind == "report") return "auto";
        if (seed.Risk == "reversible" && level == Automation.ReversibleAuto) return "auto";
        return "approval";
    }

    /// <summary>The card a seed becomes. Like the old server, the card shares the seed's <c>Params</c> and <c>Questions</c> instead of copying them.</summary>
    public static Component CardFromSeed(ComponentSeed seed, string level)
    {
        var group = GroupFor(seed, level);
        return new Component
        {
            Key = seed.Key, Kind = seed.Kind, Family = seed.Family, TitleHe = seed.TitleHe, WhyHe = seed.WhyHe, WhatHe = seed.WhatHe,
            Source = seed.Source, SourceRef = seed.SourceRef, Group = group, Risk = seed.Risk, ContextTokens = seed.ContextTokens ?? EstimateContextTokens(seed),
            VerifyHowHe = seed.VerifyHowHe,
            Status = group == "not_recommended" ? ComponentStatuses.Declined : seed.Kind == "report" ? ComponentStatuses.Reported : group == "auto" ? ComponentStatuses.Approved : ComponentStatuses.Proposed,
            Params = seed.Params, Files = [], Validation = null, Delta = null, Questions = seed.Questions ?? [], DecidedBy = null, DecidedAt = null,
            DeclineReason = group == "not_recommended" ? seed.WhyHe : null,
        };
    }

    /// <summary>A shallow copy — the old server's <c>{ ...card }</c>: a new card whose fields can change, sharing <c>Params</c>, the lists and the validation with the original.</summary>
    public static Component Copy(Component c) => new()
    {
        Id = c.Id, Key = c.Key, Kind = c.Kind, Family = c.Family, TitleHe = c.TitleHe, WhyHe = c.WhyHe, WhatHe = c.WhatHe, Source = c.Source, SourceRef = c.SourceRef,
        Group = c.Group, Risk = c.Risk, ContextTokens = c.ContextTokens, VerifyHowHe = c.VerifyHowHe, Status = c.Status, Params = c.Params, Files = c.Files,
        Validation = c.Validation, Delta = c.Delta, Questions = c.Questions, DecidedBy = c.DecidedBy, DecidedAt = c.DecidedAt, DeclineReason = c.DeclineReason,
    };

    /// <summary>What an always-loaded component adds to every session, roughly (a rule line ~30 tokens; a doc is read on demand; an MCP tool ~700).</summary>
    public static int? EstimateContextTokens(ComponentSeed seed)
    {
        switch (seed.Kind)
        {
            case "rule": return Math.Max(20, (int)Math.Round(TextOf(seed.Params["text"]).Length / 4.0, MidpointRounding.AwayFromZero));
            case "scaffold": return seed.Params["template"] is JsonValue t && t.TryGetValue<string>(out var template) && template == "agents-md" ? 1200 : 300;
            case "mcp": return (seed.Params["tools"] is JsonArray tools ? tools.Count : 10) * 700;
            case "plugin": return 400;
            case "lsp": return 0;
            case "skill": return 60;
            case "agent": return 0;
            default: return 0;
        }
    }

    // ── seeds from the other sources ─────────────────────────────────────

    /// <summary>A failed trial with no component already answering it becomes a card of the kind the failure points at.</summary>
    public static List<ComponentSeed> SeedsFromTrials(IEnumerable<TrialOutcome> trials, IEnumerable<ComponentSeed> existing)
    {
        var output = new List<ComponentSeed>();
        var kindsPresent = existing.Where(s => !s.NotRecommended).Select(s => s.Kind).ToHashSet(StringComparer.Ordinal);
        foreach (var t in trials)
        {
            if (t.Passed != false || string.IsNullOrEmpty(t.FailureKind)) continue;
            var (kinds, he) = Trials.FailureToKind[t.FailureKind];
            if (kinds.Any(kindsPresent.Contains)) continue; // the rules already put that kind of component in
            var kind = kinds[0];
            output.Add(new ComponentSeed
            {
                Key = Slice($"trial_{t.TaskKey}_{kind}", 60), Kind = kind, Family = FamilyOf(kind),
                Risk = kind is "mcp" or "runner" ? "external" : kind is "rule" or "doc" ? "reversible" : "significant",
                Source = "trial", SourceRef = t.TaskKey, TitleHe = $"{KindHe[kind]} למשימה \"{t.TitleHe}\"",
                WhyHe = JsTrim($"בריצת הניסיון המשימה \"{t.TitleHe}\" נכשלה: {Trials.FailureHe[t.FailureKind]}. {t.Detail}"),
                WhatHe = $"{he}. הרכיב נכתב מהמשימה עצמה ומהעובדות שחסרו לה.", VerifyHowHe = "אותה משימה רצה שוב אחרי הבנייה — עוברת או לא.",
                Params = new JsonObject { ["fromTrial"] = t.TaskKey, ["failureKind"] = t.FailureKind, ["detail"] = t.Detail },
            });
        }
        return output;
    }

    /// <summary>The agent test's five questions, in the order the old server listed them, with the words a card uses for each.</summary>
    private static readonly (string Key, string He)[] CriterionHe =
    [
        ("judgment", "שיפוט עצמאי"), ("externalInfo", "מידע או גישה חסרים"), ("readsALot", "הרבה קריאה"), ("parallel", "ריצה במקביל"), ("failsToday", "כבר נכשל בפועל"),
    ];

    private static bool Answered(AgentTest test, string key) => key switch
    {
        "judgment" => test.Judgment,
        "externalInfo" => test.ExternalInfo,
        "readsALot" => test.ReadsALot,
        "parallel" => test.Parallel,
        "failsToday" => test.FailsToday,
        _ => false,
    };

    /// <summary>The step's own reason per question that came back "yes" — or the older single sentence for a run written before per-question reasons.</summary>
    private static string AgentTestWhy(ProcessStep s)
    {
        var reasons = s.AgentTest.Reasons ?? [];
        var parts = CriterionHe
            .Where(c => Answered(s.AgentTest, c.Key) && reasons.TryGetValue(c.Key, out var r) && !string.IsNullOrEmpty(r))
            .Select(c => $"{c.He}: {reasons[c.Key]}")
            .ToList();
        if (parts.Count > 0) return $"במבחן הסוכן — {string.Join("; ", parts)}.";
        return !string.IsNullOrEmpty(s.AgentTest.Why) ? $"במבחן הסוכן: {s.AgentTest.Why}" : "";
    }

    /// <summary>Every process step decided "agent" gets an agent named after it; every "skill" step gets a skill.</summary>
    public static List<ComponentSeed> SeedsFromProcesses(IEnumerable<DiscoveredProcess> processes)
    {
        var output = new List<ComponentSeed>();
        foreach (var p in processes)
        {
            if (!string.IsNullOrEmpty(p.Impossible)) continue;
            foreach (var s in p.Steps)
            {
                if (s.Decision == "none") continue;
                var kind = s.Decision;
                var agent = kind == "agent";
                var yes = CriterionHe.Select(c => c.Key).Where(k => Answered(s.AgentTest, k));
                output.Add(new ComponentSeed
                {
                    Key = Slice($"{kind}_{p.Key}_{s.Key}", 60), Kind = kind, Family = agent ? "agents" : "skills", Risk = agent ? "significant" : "reversible",
                    Source = "process", SourceRef = $"{p.Key}.{s.Key}",
                    TitleHe = agent ? $"סוכן: {s.Title} ({p.Title})" : $"skill: {s.Title} ({p.Title})",
                    WhyHe = JsTrim($"{s.Reason} {AgentTestWhy(s)}{(p.Evidence.Count > 0 ? $" ראיה לתהליך: {p.Evidence[0]}" : "")}"),
                    WhatHe = agent
                        ? "סוכן משנה עם היקף מהקבצים של הצעד, כלים מינימליים, ורשימת בדיקה שקלוד מנסח מהראיות (הערות סקירה, באגים). \"מתי לקרוא לי\" נבדק על משימות אמיתיות."
                        : $"נוהל אחד לצעד \"{s.Title}\": הקבצים, הפקודות והסדר — כפי שנעשה כאן.",
                    VerifyHowHe = agent ? "מריצים על שינוי עם באג ידוע ורואים שנתפס; בודקים שאין אזעקות שווא; עם ובלי." : "validate; eval עם ובלי על משימה מהתהליך.",
                    Params = new JsonObject
                    {
                        ["process"] = p.Key, ["processTitle"] = p.Title, ["step"] = s.Key, ["stepTitle"] = s.Title, ["what"] = s.What,
                        ["reasons"] = Strings(yes), ["evidence"] = Strings(p.Evidence), ["template"] = agent ? "process-agent" : "process-skill",
                    },
                });
            }
        }
        return output;
    }

    /// <summary>The family a kind belongs to. Every caller passes a known kind (each checks the model's answer against a list first); an unknown one is a bug and throws.</summary>
    public static string FamilyOf(string kind) => kind switch
    {
        "permission" or "gitignore" or "gitattributes" or "settings" => "safety",
        "hook" => "enforcement",
        "script" or "runner" or "devcontainer" => "verification",
        "rule" or "doc" or "scaffold" => "knowledge",
        "mcp" or "plugin" or "lsp" => "connections",
        "skill" => "skills",
        "agent" or "review" or "pr_template" => "agents",
        "report" => "measurement",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Not a component kind."),
    };

    /// <summary>Two seeds for the same key: the later one's evidence joins the earlier one's, nothing is lost. The first seed of a key is copied, never changed in place.</summary>
    public static List<ComponentSeed> MergeSeeds(params IEnumerable<ComponentSeed>[] lists)
    {
        var merged = new List<ComponentSeed>();
        var byKey = new Dictionary<string, ComponentSeed>(StringComparer.Ordinal);
        foreach (var list in lists)
        foreach (var s in list)
        {
            if (!byKey.TryGetValue(s.Key, out var prev))
            {
                var copy = CopySeed(s);
                byKey[s.Key] = copy;
                merged.Add(copy);
                continue;
            }
            if (!prev.WhyHe.Contains(s.WhyHe, StringComparison.Ordinal)) prev.WhyHe = $"{prev.WhyHe} וגם: {s.WhyHe}";
            prev.SourceRef = string.Join(",", new[] { prev.SourceRef, s.SourceRef }.Where(r => !string.IsNullOrEmpty(r)));
        }
        return merged;
    }

    private static ComponentSeed CopySeed(ComponentSeed s) => new()
    {
        Key = s.Key, Kind = s.Kind, Family = s.Family, TitleHe = s.TitleHe, WhyHe = s.WhyHe, WhatHe = s.WhatHe, Source = s.Source, SourceRef = s.SourceRef,
        Risk = s.Risk, VerifyHowHe = s.VerifyHowHe, Params = s.Params, ContextTokens = s.ContextTokens, Questions = s.Questions, NotRecommended = s.NotRecommended,
    };

    // ── the build order and the readiness gate ───────────────────────────

    /// <summary>
    /// By family; within a family, what was taken from the <c>/init</c> draft comes after ours, so it is added to the
    /// files ours wrote and never shapes them; then by key. The key compares the way the old server's
    /// <c>localeCompare</c> did (ICU's root collation: "_" before "-" before digits before letters, case second), so
    /// rule lines land in the same order in the files.
    /// </summary>
    public static List<Component> BuildOrder(IEnumerable<Component> cards) =>
        cards.OrderBy(c => FamilyIndex(c.Family)).ThenBy(c => c.Source == "init" ? 1 : 0).ThenBy(c => c.Key, StringComparer.InvariantCulture).ToList();

    private static int FamilyIndex(string family)
    {
        for (var i = 0; i < Families.Order.Count; i++) if (Families.Order[i] == family) return i;
        return -1;
    }

    /// <summary>"Have we done everything we could for this repository?" — the four questions, each answered from the record.</summary>
    public static Readiness Readiness(ReadinessInput i)
    {
        var items = new List<ReadinessItem>();
        // 1. Every process has a passing trial, or an explicit "impossible here because".
        var after = i.Trials.Where(t => t.Phase == "after").ToList();
        var pool = after.Count > 0 ? after : i.Trials.Where(t => t.Phase == "baseline").ToList();
        var noTrial = i.Processes.Where(p => string.IsNullOrEmpty(p.Impossible) && !pool.Any(t => t.TaskKey == Slice($"process_{p.Key}", 60) && t.Passed == true)).ToList();
        items.Add(new("processes", "לכל תהליך יש ריצת ניסיון שעוברת, או הסבר למה אי אפשר כאן", noTrial.Count == 0,
            noTrial.Count > 0
                ? $"בלי ניסיון שעובר: {string.Join(", ", noTrial.Select(p => p.Title).Take(4))}"
                : Invariant($"{i.Processes.Count} תהליכים, {i.Processes.Count(p => !string.IsNullOrEmpty(p.Impossible))} מסומנים כבלתי אפשריים כאן")));
        // 2. Every family has a written decision.
        var undecided = Families.Order.Where(f => i.Cards.Any(c => c.Family == f && c.Status == ComponentStatuses.Proposed)).ToList();
        var familiesWithCards = i.Cards.Select(c => c.Family).ToHashSet(StringComparer.Ordinal);
        var familiesEmpty = Families.Order.Where(f => !familiesWithCards.Contains(f)).ToList();
        items.Add(new("families", "לכל משפחת רכיבים יש החלטה: הותקן / לא צריך כי / אי אפשר כי / נדחה", undecided.Count == 0,
            undecided.Count > 0 ? $"מחכים להחלטה: {string.Join(", ", undecided.Select(f => FamilyHe[f]))}"
            : familiesEmpty.Count > 0 ? $"בלי רכיב, כי שום כלל לא ירה: {string.Join(", ", familiesEmpty.Select(f => FamilyHe[f]))}"
            : "כל המשפחות הוכרעו"));
        // 3. The reviewer raised no open gap.
        items.Add(new("reviewer", "הסוקר לא השאיר פער פתוח", i.ReviewerOpen == 0,
            i.ReviewerOpen != 0 ? Invariant($"{i.ReviewerOpen} כרטיסים מהסוקר עוד לא הוכרעו") : "כל מה שהסוקר העלה הוכרע"));
        // 4. The last addition improved — or nothing was measured yet.
        var d = i.Delta;
        var improved = d is not null && (d.After.Passed > d.Before.Passed || (d.After.Passed == d.Before.Passed && (d.CostPerTaskChange ?? 0) < 0));
        var same = d is not null && d.After.Passed == d.Before.Passed && !improved;
        items.Add(new("delta", "הניסיון החוזר מראה שיפור מול נקודת ההתחלה", d is not null && !(d.After.Passed < d.Before.Passed),
            d is null ? "עוד לא נמדד — הבנייה מריצה את הניסיון שוב"
            : improved ? Invariant($"{d.Before.Passed}/{d.Before.Total} → {d.After.Passed}/{d.After.Total}")
            : same ? "אותה תוצאה — התוספת האחרונה לא שיפרה; רכיב שלא הוכח מוצע להסרה"
            : "פחות משימות עוברות — משהו בסט מפריע; לבדוק את הרכיבים שנוספו"));
        var honesty = new List<string>();
        if (i.WindowsOnly && !i.HasRunner)
            honesty.Add("בריפו הזה אי אפשר להריץ build ובדיקות מהמכונה של DCC (build רק ב-Windows). עד שיהיה מריץ Windows, כל משימה מסומנת \"לא אומת כאן\" והסוקר עובד review-only. מה צריך: מכונת Windows אחת עם Claude Code ו-Visual Studio Build Tools.");
        foreach (var c in i.Cards) if (c.Kind == "runner" && c.Status != ComponentStatuses.Declined) honesty.Add($"{c.TitleHe}: {c.WhatHe}");
        foreach (var t in pool) if (t.Passed == false && t.FailureKind == FailureKinds.CannotVerify) honesty.Add($"המשימה \"{t.TitleHe}\" לא ניתנת לאימות כאן: {t.Detail}");
        foreach (var s in i.Suppressed) honesty.Add($"הכלל {s.Rule} לא הופעל כי סימנת את העובדה \"{s.Fact}\" כלא נכונה{(string.IsNullOrEmpty(s.Note) ? "" : $" ({s.Note})")}.");
        foreach (var c in i.Cards) if (c.Status == ComponentStatuses.Failed) honesty.Add($"{c.TitleHe}: האימות נכשל — {c.Validation?.Detail ?? ""}");
        return new Readiness(items.All(x => x.Ok), items, Unique(honesty));
    }

    // ── the report the pull request carries — from the cards, never free text ──

    public static string PullRequestReport(string repoName, IReadOnlyList<Component> cards, TrialDelta? delta, Readiness readiness, string branch, string? baselineSha)
    {
        var installed = cards.Where(c => c.Status is ComponentStatuses.Verified or ComponentStatuses.Installed).ToList();
        var failed = cards.Where(c => c.Status == ComponentStatuses.Failed).ToList();
        var declined = cards.Where(c => c.Status == ComponentStatuses.Declined && c.Group != "not_recommended").ToList();
        var notHere = cards.Where(c => c.Group == "not_recommended").ToList();
        var reported = cards.Where(c => c.Kind == "report" && c.Status == ComponentStatuses.Reported).ToList();
        var deferred = cards.Where(c => c.Status == ComponentStatuses.Deferred || c.Kind == "runner").ToList();

        static string Line(Component c)
        {
            var files = c.Files.Count > 0
                ? $": {string.Join(", ", c.Files.Take(3).Select(f => $"`{f}`"))}{(c.Files.Count > 3 ? Invariant($" +{c.Files.Count - 3}") : "")}"
                : "";
            var check = c.Validation is { } v
                ? $" נבדק: {v.How} → {(v.Passed == true ? "עבר" : v.Passed == false ? "נכשל" : "לא נבדק")}{(string.IsNullOrEmpty(v.Detail) ? "" : $" ({v.Detail})")}."
                : "";
            // A card's kind is always one of the known kinds; the raw kind stands in rather than the old server's "undefined".
            return $"- **{c.TitleHe}** ({KindHe.GetValueOrDefault(c.Kind, c.Kind)}{files}) — כי: {c.WhyHe}{check}";
        }

        var output = new List<string> { $"# הטמעת AI ל-{repoName}", "" };
        output.AddRange(["## התקנתי", ""]);
        output.AddRange(installed.Count > 0 ? installed.Select(Line) : ["- (שום רכיב לא הותקן)"]);
        output.Add("");
        if (failed.Count > 0) output.AddRange(["## הותקן אבל האימות נכשל", "", .. failed.Select(Line), ""]);
        if (deferred.Count > 0) output.AddRange(["## דורש משהו מהלקוח", "", .. deferred.Select(c => $"- **{c.TitleHe}** — {c.WhatHe}"), ""]);
        if (declined.Count > 0) output.AddRange(["## לא התקנתי (נדחה)", "", .. declined.Select(c => $"- {c.TitleHe}{(string.IsNullOrEmpty(c.DeclineReason) ? "" : $" — {c.DeclineReason}")}"), ""]);
        if (notHere.Count > 0) output.AddRange(["## לא מומלץ כאן — ולמה", "", .. notHere.Select(c => $"- {c.TitleHe} — {c.WhyHe}"), ""]);
        if (reported.Count > 0) output.AddRange(["## לתשומת לב הבעלים", "", .. reported.Select(c => $"- **{c.TitleHe}** — {c.WhatHe}"), ""]);
        if (delta is not null)
        {
            var cost = delta.CostPerTaskChange is not { } change ? "לא נמדד" : $"{(change > 0 ? "+" : "")}{JsRound(change * 100)}%";
            output.AddRange(["## לפני / אחרי", "", Invariant($"- משימות ניסיון שעברו: {delta.Before.Passed}/{delta.Before.Total} → {delta.After.Passed}/{delta.After.Total}"), $"- עלות למשימה: {cost}", ""]);
        }
        output.AddRange(["## כרטיס כנות ומוכנות", "", .. readiness.Items.Select(x => $"- {(x.Ok ? "✓" : "✗")} {x.TitleHe} — {x.DetailHe}")]);
        if (readiness.Honesty.Count > 0) output.AddRange(["", .. readiness.Honesty.Select(h => $"- {h}")]);
        output.Add("");
        output.AddRange(["## איך זה נעשה", "",
            $"אבחון דטרמיניסטי של המאגר, כללי החלטה גלויים, ריצת ניסיון לפני ואחרי, ואימות לכל רכיב — ב-DCC, בענף `{branch}`{(string.IsNullOrEmpty(baselineSha) ? "" : $" מנקודת ההתחלה `{Slice(baselineSha, 7)}`")}. אף קובץ לא נכתב מחוץ לענף הזה, ורק מה שאושר נמצא ב-PR. הכול רשום ביומן ההטמעה."]);
        return string.Join("\n", output);
    }

    // ── what a process step needs for its agent — read from the cards ──

    public static List<(DiscoveredProcess Process, ProcessStep Step)> StepsDeciding(IEnumerable<DiscoveredProcess> processes, string decision) =>
        processes.SelectMany(p => p.Steps.Where(s => s.Decision == decision).Select(s => (Process: p, Step: s))).ToList();

    /// <summary>The failure kinds the trials hit, each once, in the order they first appeared.</summary>
    public static List<string> FailureKindsOf(IEnumerable<TrialOutcome> trials) =>
        Unique(trials.Where(t => !string.IsNullOrEmpty(t.FailureKind)).Select(t => t.FailureKind!));

    // ── JavaScript's semantics, where the old server's output depends on them ──

    /// <summary><c>s.slice(0, n)</c>: UTF-16 units, like JavaScript.</summary>
    private static string Slice(string s, int n) => s.Length > n ? s[..n] : s;

    /// <summary>Each value once, first occurrence first — <c>[...new Set(xs)]</c>.</summary>
    private static List<string> Unique(IEnumerable<string> values)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        return values.Where(seen.Add).ToList();
    }

    private static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());

    /// <summary><c>Math.round</c>: the nearest integer, a half toward +∞ (−20.5 → −20), written without a culture's minus sign and never as "-0".</summary>
    private static string JsRound(double x)
    {
        if (!double.IsFinite(x)) return x.ToString(CultureInfo.InvariantCulture);
        var floor = Math.Floor(x);
        var rounded = x - floor >= 0.5 ? floor + 1 : floor;
        return ((long)rounded).ToString(CultureInfo.InvariantCulture);
    }

    /// <summary><c>String.prototype.trim</c>: JavaScript's whitespace set (U+FEFF yes, U+0085 no), not .NET's.</summary>
    private static string JsTrim(string s)
    {
        int start = 0, end = s.Length;
        while (start < end && IsJsSpace(s[start])) start++;
        while (end > start && IsJsSpace(s[end - 1])) end--;
        return s[start..end];
    }

    private static bool IsJsSpace(char c) =>
        c is '\t' or '\n' or '\v' or '\f' or '\r' or ' ' or '\u00A0' or '\u1680' or '\u2028' or '\u2029' or '\u202F' or '\u205F' or '\u3000' or '\uFEFF' or (>= '\u2000' and <= '\u200A');

    /// <summary><c>String(value ?? "")</c> for a param: a string as it is, a number or a boolean as JavaScript writes it, an array joined by commas.</summary>
    private static string TextOf(JsonNode? node) => node switch
    {
        null => "",
        JsonValue v when v.TryGetValue<string>(out var s) => s,
        JsonValue v when v.GetValueKind() == System.Text.Json.JsonValueKind.True => "true",
        JsonValue v when v.GetValueKind() == System.Text.Json.JsonValueKind.False => "false",
        JsonValue v when v.TryGetValue<double>(out var n) => n.ToString("R", CultureInfo.InvariantCulture),
        JsonArray a => string.Join(",", a.Select(TextOf)),
        JsonObject => "[object Object]",
        _ => node.ToJsonString(),
    };
}
