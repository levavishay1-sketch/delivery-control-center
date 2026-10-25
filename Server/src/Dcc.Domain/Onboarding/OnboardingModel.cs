using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Dcc.Domain.Onboarding;

/// <summary>
/// Repository onboarding as a coach (repo-onboarding/types.ts; openspec/changes/repository-coach): one fixed,
/// deterministic process whose result — the set of components a repository gets — is different for every
/// repository, each component carrying the evidence that justified it. A run walks seven steps; the coach continues
/// after the run from what real sessions show.
///
/// These are the shapes every onboarding module passes between them, and the JSON the screen reads: names are kept
/// as the old server wrote them (<c>title_he</c>, <c>sourceRef</c>), so the client changes in nothing. The repository
/// profile stays a <see cref="JsonObject"/> on purpose — it is data, snake_case, read by the rules table by dotted path.
/// </summary>
public static class Steps
{
    public static readonly IReadOnlyList<string> Keys = ["connect", "diagnose", "processes", "trial", "plan", "build", "deliver"];

    public const string Pending = "Pending";
    public const string Running = "Running";
    public const string WaitingForUser = "WaitingForUser";
    public const string Completed = "Completed";
    public const string Failed = "Failed";
    public const string Cancelled = "Cancelled";

    /// <summary>A run in one of these is live — one per repository (the database holds that with a partial unique index).</summary>
    public static readonly IReadOnlyList<string> LiveRunStatuses = [Pending, Running, WaitingForUser];

    public static bool IsKey(string k) => Keys.Contains(k);

    public static StepDefinition? Definition(string key) => All.FirstOrDefault(s => s.Key == key);

    /// <summary>The step catalogue, word for word as the old server had it — the screen shows it before a run starts.</summary>
    public static readonly IReadOnlyList<StepDefinition> All =
    [
        new("connect", 0, "deterministic", false,
            "חיבור הריפו", "עותק מבודד על ענף חדש",
            "צריך עותק מבודד לעבוד עליו, בלי לגעת בריפו שלך.",
            "DCC מושך את הריפו, פותח ענף ai/onboarding/<הרצה> ורושם את נקודת ההתחלה. שום קריאה למודל, שום כתיבה לריפו של הלקוח.",
            "ענף מבודד ונקודת התחלה (commit).",
            "חינם", "בוחרים עד כמה אוטומטי. בלי בחירה: הפיך נעשה ומדווח, משמעותי מחכה לאישור."),
        new("diagnose", 1, "deterministic", false,
            "אבחון", "מה יש בריפו הזה — בלי מודל",
            "כל רכיב נכנס רק כשיש ראיה שהבעיה שלו קיימת בריפו הזה. האבחון הוא הראיה.",
            "סקריפט אחד לכל הריפואים קורא את הקוד וההיסטוריה: שפות, build, בדיקות, CI, קוד מג'ונרט, סודות (מיקום בלבד), מערכות חיצוניות, הגדרות AI קיימות, תיעוד, נקודות חמות.",
            "פרופיל הריפו, כל עובדה עם המקור שלה.",
            "חינם", "אפשר לסמן עובדה כ\"זה לא נכון\". בלי פעולה: ממשיכים עם הפרופיל כפי שהוא."),
        new("processes", 2, "ai", true,
            "תהליכים וראיון", "איך עובדים כאן, ומה הקוד לא אומר",
            "סוכן או skill נבנים לתהליך של הריפו הזה, לא לרשימה קבועה. קודם מגלים את התהליכים.",
            "DCC אוסף ראיות לתהליכים (היסטוריית git, CI, CONTRIBUTING, תבנית PR, תיעוד), שואל עד ארבע שאלות עם ברירת מחדל, ומבקש מקלוד לפרק כל תהליך לצעדים. לכל צעד נערך \"מבחן הסוכן\": חמש שאלות שמכריעות אם צריך סוכן, skill או כלום.",
            "רשימת תהליכים, כל אחד עם צעדים והחלטה מנומקת לכל צעד.",
            "קריאה אחת למודל, סנטים בודדים", "עונים על השאלות או משאירים את ברירת המחדל. בלי פעולה: ההנחות נרשמות כהנחות."),
        new("trial", 3, "ai", true,
            "ריצת ניסיון", "מה קלוד מצליח כאן בלי שום רכיב",
            "בלי נקודת התחלה אי אפשר לדעת אם רכיב עזר. כל כישלון כאן אומר איזה סוג רכיב חסר.",
            "שלוש עד חמש משימות ייצוגיות לריפו רצות ב-Claude Code בלי שום רכיב, בקריאה בלבד. הקוד שופט כשאפשר לבדוק, ומודל אחר שופט כשלא. כל כישלון מסווג: לא ידע עובדה, ידע ועבר על כלל, חסר מידע חיצוני, לא יכול לאמת, שיפוט שגוי.",
            "נקודת ההתחלה: כמה משימות עברו, למה נכשלו, וכמה זה עלה.",
            "בערך $1–3", "מאשרים את ההרצה על העלות המוצהרת. במדרגה \"הפיך = עושה ומדווח\" היא רצה לבד."),
        new("plan", 4, "human", true,
            "תוכנית הרכיבים", "\"שמתי X כי ראיתי Y\" — לאישורך",
            "ל-Claude אין מילה אחרונה. כל רכיב מוצג עם הראיה שלו, ואדם מחליט.",
            "כללי ההחלטה רצים על הפרופיל, הראיון, סיווג הכישלונות ומבחן הסוכן; קלוד מחפש רכיבים מוכנים לסטאק במקורות פתוחים והקוד בודק אמון; סוקר נפרד שואל מה חסר ומה מיותר. יוצאים כרטיסים בשלוש קבוצות: נעשה ודווח, מחכה לאישורך, לא מומלץ כאן.",
            "כרטיס לכל רכיב: למה, מה, מקור, סיכון, עלות הקשר, איך נבדוק. וכרטיס כנות: מה אי אפשר לאמת כאן.",
            "שתיים-שלוש קריאות למודל, עד דולר", "אשר / שאל / דחה לכל כרטיס, או אישור כסט. בלי פעולה: רק \"נעשה ודווח\" נבנה; השאר ממתין ולא נכתב."),
        new("build", 5, "ai", false,
            "בנייה ואימות", "התקנה בענף, אימות לכל רכיב, ניסיון חוזר",
            "רכיב שלא אומת הוא השערה. רכיב שלא שיפר — יוצא.",
            "הרכיבים המאושרים נבנים לפי סוג בסדר תלות: בטיחות, אימות, ידע, חיבורים, skills, סוכנים, אכיפה. לכל סוג מאמת משלו: hook נבדק בפעולה אסורה, הרשאה בפענוח, skill ב-validate, מסמך בציטוט. ואז ריצת הניסיון שוב מול נקודת ההתחלה.",
            "קבצים בענף המבודד, תוצאת אימות לכל רכיב, ולפני/אחרי.",
            "עד כמה דולרים, מוצהר לפי הרכיבים", "רואים לפני/אחרי. רכיב שלא הוכח מסומן ומוצע להסרה."),
        new("deliver", 6, "deterministic", true,
            "מסירה", "PR בזהות שלך, עם דו\"ח שאדם מבין",
            "השינויים צריכים להגיע ל-git כדי שהצוות יקבל אותם, ורק מה שאושר.",
            "commit של הקבצים המאושרים על שמך, push לענף ו-PR עם דו\"ח שנכתב מהכרטיסים: התקנתי X כי Y, נבדק כך, לא התקנתי W כי. וכרטיס מוכנות: מה יש, מה חסר, מה צריך מהלקוח.",
            "PR פתוח שממתין למיזוג ידני, והמאמן ממשיך מכאן.",
            "חינם", "לוחצים על המסירה. בלי פעולה: שום דבר לא יוצא מהמחשב."),
    ];
}

/// <summary>One step of the process. <c>Kind</c>: deterministic (DCC alone), ai (Claude does part) or human (waits for a decision). <c>Gate</c>: waits for a person before it is over.</summary>
public sealed record StepDefinition(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("order")] int Order,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("gate")] bool Gate,
    [property: JsonPropertyName("title_he")] string TitleHe,
    [property: JsonPropertyName("short_he")] string ShortHe,
    [property: JsonPropertyName("why_he")] string WhyHe,
    [property: JsonPropertyName("what_he")] string WhatHe,
    [property: JsonPropertyName("output_he")] string OutputHe,
    [property: JsonPropertyName("cost_he")] string CostHe,
    [property: JsonPropertyName("you_he")] string YouHe);

/// <summary>
/// How much a run does without asking: <c>reversible_auto</c> — a reversible, cheap component is built and reported,
/// the rest waits; <c>all_approval</c> — every component waits; <c>locked</c> — every component waits and nothing that
/// costs money runs before a person says so.
/// </summary>
public static class Automation
{
    public const string ReversibleAuto = "reversible_auto";
    public const string AllApproval = "all_approval";
    public const string Locked = "locked";

    public static readonly IReadOnlyList<string> Levels = [ReversibleAuto, AllApproval, Locked];

    /// <summary>Anything that is not a known level is the default.</summary>
    public static string Normalize(JsonNode? raw) =>
        raw?["level"] is JsonValue v && v.TryGetValue<string>(out var level) && Levels.Contains(level) ? level : ReversibleAuto;

    public static JsonObject ToJson(string level) => new() { ["level"] = level };
}

/// <summary>A fact the person marked as wrong: <c>Path</c> is its dotted path in the profile (<c>tests.frameworks</c>). A rule relying on it does not fire, and the plan says so.</summary>
public sealed record ProfileCorrection(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("note")] string? Note,
    [property: JsonPropertyName("by")] string By,
    [property: JsonPropertyName("at")] string At);

/// <summary>One line of the profile as the screen shows it. <c>Tone</c>: plain, warn or bad.</summary>
public sealed record ProfileFact(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("concept")] string Concept,
    [property: JsonPropertyName("label_he")] string LabelHe,
    [property: JsonPropertyName("value_he")] string ValueHe,
    [property: JsonPropertyName("tone")] string Tone,
    [property: JsonPropertyName("corrected")] bool Corrected);

// ── processes and the agent test ──────────────────────────────────────

/// <summary>The five questions that decide whether a step of a process needs an agent of its own: any true makes it a candidate.</summary>
public sealed record AgentTest
{
    [JsonPropertyName("judgment")] public bool Judgment { get; init; }
    [JsonPropertyName("externalInfo")] public bool ExternalInfo { get; init; }
    [JsonPropertyName("readsALot")] public bool ReadsALot { get; init; }
    [JsonPropertyName("parallel")] public bool Parallel { get; init; }
    [JsonPropertyName("failsToday")] public bool FailsToday { get; init; }
    /// <summary>One shared sentence — kept for runs written before <see cref="Reasons"/> existed.</summary>
    [JsonPropertyName("why")] public string Why { get; init; } = "";
    /// <summary>Per question (judgment, externalInfo, readsALot, parallel, failsToday), in plain Hebrew and specific to the step.</summary>
    [JsonPropertyName("reasons"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public Dictionary<string, string>? Reasons { get; init; }
}

/// <summary><c>Decision</c>: agent, skill or none — decided by code from the answers.</summary>
public sealed record ProcessStep(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("what")] string What,
    [property: JsonPropertyName("agentTest")] AgentTest AgentTest,
    [property: JsonPropertyName("decision")] string Decision,
    [property: JsonPropertyName("reason")] string Reason);

/// <summary><c>Source</c>: git, ci, contributing, pr_template, docs, tracker, interview or model.</summary>
public sealed record DiscoveredProcess
{
    [JsonPropertyName("key")] public required string Key { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }
    [JsonPropertyName("source")] public required string Source { get; init; }
    /// <summary>What showed it: file paths, counts, quotes.</summary>
    [JsonPropertyName("evidence")] public IReadOnlyList<string> Evidence { get; init; } = [];
    [JsonPropertyName("steps")] public IReadOnlyList<ProcessStep> Steps { get; init; } = [];
    /// <summary>The trial task that exercises this process, when one does.</summary>
    [JsonPropertyName("trialTaskKey")] public string? TrialTaskKey { get; init; }
    /// <summary>Why it cannot be exercised here ("no Windows runner"), when it cannot.</summary>
    [JsonPropertyName("impossible")] public string? Impossible { get; init; }
}

public sealed record InterviewOption(
    [property: JsonPropertyName("value")] string Value,
    [property: JsonPropertyName("label_he")] string LabelHe);

public sealed record InterviewQuestion(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("question_he")] string QuestionHe,
    [property: JsonPropertyName("why_he")] string WhyHe,
    [property: JsonPropertyName("options")] IReadOnlyList<InterviewOption> Options,
    [property: JsonPropertyName("default")] string Default);

/// <summary><c>Assumed</c>: nobody answered; the default was taken and recorded as an assumption.</summary>
public sealed record InterviewAnswer(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("value")] string Value,
    [property: JsonPropertyName("assumed")] bool Assumed);

// ── trials ────────────────────────────────────────────────────────────

/// <summary>Why a trial task failed — each kind points at a kind of component.</summary>
public static class FailureKinds
{
    public const string MissingFact = "missing_fact";
    public const string RuleViolated = "rule_violated";
    public const string NeedsExternal = "needs_external";
    public const string CannotVerify = "cannot_verify";
    public const string BadJudgment = "bad_judgment";
    public static readonly IReadOnlyList<string> All = [MissingFact, RuleViolated, NeedsExternal, CannotVerify, BadJudgment];
}

/// <summary>
/// How a trial task is judged. <c>Kind</c> "code": the answer must mention (or must not claim) these; "model": a
/// model other than the executor decides against <c>Facts</c>.
/// </summary>
public sealed record TrialJudge
{
    [JsonPropertyName("kind")] public required string Kind { get; init; }
    [JsonPropertyName("mustMention"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public IReadOnlyList<string>? MustMention { get; init; }
    [JsonPropertyName("mustNotClaim"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public IReadOnlyList<string>? MustNotClaim { get; init; }
    [JsonPropertyName("facts"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public IReadOnlyList<string>? Facts { get; init; }
    [JsonPropertyName("failureKind")] public required string FailureKind { get; init; }
    [JsonPropertyName("expect_he"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? ExpectHe { get; init; }
}

/// <summary><c>From</c>: where the task came from — the profile, the git history, or a process.</summary>
public sealed record TrialTask(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("title_he")] string TitleHe,
    [property: JsonPropertyName("prompt")] string Prompt,
    [property: JsonPropertyName("judge")] TrialJudge Judge,
    [property: JsonPropertyName("from")] string From);

/// <summary><c>Phase</c>: baseline or after. <c>JudgedBy</c>: by the code, or by which model.</summary>
public sealed record TrialOutcome(
    [property: JsonPropertyName("taskKey")] string TaskKey,
    [property: JsonPropertyName("title_he")] string TitleHe,
    [property: JsonPropertyName("phase")] string Phase,
    [property: JsonPropertyName("passed")] bool? Passed,
    [property: JsonPropertyName("failureKind")] string? FailureKind,
    [property: JsonPropertyName("detail")] string Detail,
    [property: JsonPropertyName("costUsd")] double CostUsd,
    [property: JsonPropertyName("callId")] string? CallId,
    [property: JsonPropertyName("judgedBy")] string JudgedBy);

public sealed record TrialTally(
    [property: JsonPropertyName("passed")] int Passed,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("costUsd")] double CostUsd);

/// <summary><c>CostPerTaskChange</c>: after against before, as a fraction (−0.18 = 18% cheaper).</summary>
public sealed record TrialDelta(
    [property: JsonPropertyName("before")] TrialTally Before,
    [property: JsonPropertyName("after")] TrialTally After,
    [property: JsonPropertyName("costPerTaskChange")] double? CostPerTaskChange);

// ── components ────────────────────────────────────────────────────────

/// <summary>The families are the build order (dependencies first) and the readiness checklist.</summary>
public static class Families
{
    public static readonly IReadOnlyList<string> Order = ["safety", "verification", "knowledge", "connections", "skills", "agents", "enforcement", "measurement"];
}

/// <summary>
/// The vocabulary of a component card. Kinds: rule, hook, permission, skill, agent, mcp, plugin, lsp, scaffold, doc,
/// report, runner, settings, gitattributes, gitignore, review, pr_template, devcontainer, script. Sources: rule, trial,
/// process, marketplace, reviewer, user, init, coach. Groups: auto, approval, not_recommended. Risks: reversible,
/// significant, external. Statuses: proposed, approved, declined, installed, verified, failed, removed, deferred, reported.
/// </summary>
public static class ComponentStatuses
{
    public const string Proposed = "proposed";
    public const string Approved = "approved";
    public const string Declined = "declined";
    public const string Installed = "installed";
    public const string Verified = "verified";
    public const string Failed = "failed";
    public const string Removed = "removed";
    public const string Deferred = "deferred";
    public const string Reported = "reported";
}

/// <summary>A question a card asks before it can be built; <c>Answer</c> null until a person (or the default) answers.</summary>
public sealed record ClarifyingQuestion(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("question_he")] string QuestionHe,
    [property: JsonPropertyName("default")] string Default,
    [property: JsonPropertyName("answer")] string? Answer);

/// <summary>How a component was checked: <c>Passed</c> null = could not be checked here.</summary>
public sealed record ComponentValidation(
    [property: JsonPropertyName("how")] string How,
    [property: JsonPropertyName("passed")] bool? Passed,
    [property: JsonPropertyName("detail")] string Detail,
    [property: JsonPropertyName("at")] string At);

/// <summary><c>Verdict</c>: improved, same, worse or unmeasured.</summary>
public sealed record ComponentDelta(
    [property: JsonPropertyName("before")] int Before,
    [property: JsonPropertyName("after")] int After,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("costPerTaskChange")] double? CostPerTaskChange,
    [property: JsonPropertyName("verdict")] string Verdict);

/// <summary>
/// One component card — what is proposed for the repository, why ("כי ראיתי"), and what became of it. Mutable on
/// purpose: a card's status, files and validation change as the plan and the build move it along. Stored in
/// <c>onboarding_component</c> (title/why/what/verify_how there are title_he/why_he/what_he/verifyHow_he here).
/// </summary>
public sealed class Component
{
    /// <summary>The row's id once stored; the screen keys a card by <see cref="Key"/>.</summary>
    [JsonPropertyName("id"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Id { get; set; }
    [JsonPropertyName("key")] public string Key { get; set; } = "";
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("family")] public string Family { get; set; } = "";
    [JsonPropertyName("title_he")] public string TitleHe { get; set; } = "";
    /// <summary>"כי ראיתי" — the evidence, in words a manager reads.</summary>
    [JsonPropertyName("why_he")] public string WhyHe { get; set; } = "";
    [JsonPropertyName("what_he")] public string WhatHe { get; set; } = "";
    [JsonPropertyName("source")] public string Source { get; set; } = "";
    /// <summary>The rule id, the trial task, the process step, the marketplace source — what produced it.</summary>
    [JsonPropertyName("sourceRef")] public string? SourceRef { get; set; }
    [JsonPropertyName("group")] public string Group { get; set; } = "approval";
    [JsonPropertyName("risk")] public string Risk { get; set; } = "reversible";
    /// <summary>What it adds to every session's context, when it is always loaded.</summary>
    [JsonPropertyName("contextTokens")] public int? ContextTokens { get; set; }
    [JsonPropertyName("verifyHow_he")] public string VerifyHowHe { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = ComponentStatuses.Proposed;
    /// <summary>What the builder needs: paths, commands, patterns, an MCP spec.</summary>
    [JsonPropertyName("params")] public JsonObject Params { get; set; } = [];
    /// <summary>Files written for it in the isolated copy, relative to its root.</summary>
    [JsonPropertyName("files")] public List<string> Files { get; set; } = [];
    [JsonPropertyName("validation")] public ComponentValidation? Validation { get; set; }
    [JsonPropertyName("delta")] public ComponentDelta? Delta { get; set; }
    [JsonPropertyName("questions")] public List<ClarifyingQuestion> Questions { get; set; } = [];
    [JsonPropertyName("decidedBy")] public string? DecidedBy { get; set; }
    [JsonPropertyName("decidedAt")] public string? DecidedAt { get; set; }
    [JsonPropertyName("declineReason")] public string? DeclineReason { get; set; }
}

/// <summary>What a rule (or a trial, a process, a source, the reviewer) contributes before it becomes a card.</summary>
public sealed class ComponentSeed
{
    public string Key { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Family { get; set; } = "";
    public string TitleHe { get; set; } = "";
    public string WhyHe { get; set; } = "";
    public string WhatHe { get; set; } = "";
    public string Source { get; set; } = "";
    public string? SourceRef { get; set; }
    public string Risk { get; set; } = "reversible";
    public string VerifyHowHe { get; set; } = "";
    public JsonObject Params { get; set; } = [];
    public int? ContextTokens { get; set; }
    public List<ClarifyingQuestion>? Questions { get; set; }
    /// <summary>Deliberately NOT recommended here, with the reason in <see cref="WhyHe"/>.</summary>
    public bool NotRecommended { get; set; }
}

public sealed record ReadinessItem(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("title_he")] string TitleHe,
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("detail_he")] string DetailHe);

/// <summary><c>Honesty</c>: what cannot be verified here and what it would take — the honesty card.</summary>
public sealed record Readiness(
    [property: JsonPropertyName("ready")] bool Ready,
    [property: JsonPropertyName("items")] IReadOnlyList<ReadinessItem> Items,
    [property: JsonPropertyName("honesty")] IReadOnlyList<string> Honesty);

// ── the rules table ───────────────────────────────────────────────────

public sealed record RuleFiring(string Rule, string Signal, string ReasonHe, IReadOnlyList<ComponentSeed> Components);

public sealed record RuleSuppression(
    [property: JsonPropertyName("rule")] string Rule,
    [property: JsonPropertyName("fact")] string Fact,
    [property: JsonPropertyName("note")] string? Note);

public sealed record RulesOutcome(IReadOnlyList<RuleFiring> Fired, IReadOnlyList<RuleSuppression> Suppressed, int Considered);

// ── the operator catalog ──────────────────────────────────────────────

/// <summary>A file a template renders; <c>Path</c> is relative to the repository root.</summary>
public sealed record CatalogFile(string Path, string Content, int? Mode = null);

/// <summary>
/// What a template produces: files, and fragments the builder merges — of <c>.claude/settings.json</c> (in Claude
/// Code's own format: permissions.deny/allow, hooks) and of <c>.mcp.json</c> (<c>{ mcpServers: { name: spec } }</c>) —
/// and notes on what the builder must still do or know.
/// </summary>
public sealed record Rendered(IReadOnlyList<CatalogFile> Files, JsonObject? Settings, JsonObject? Mcp, IReadOnlyList<string> Notes);

/// <summary>The facts about a repository a template is filled with.</summary>
public sealed record RepoFacts(
    string Name, string? BuildCommand, string? TestCommand, string? LintCommand, IReadOnlyList<string> Languages,
    string? PackageManager, string? DefaultBranch, bool WindowsOnly);

// ── step results (stored as JSON on the step row; the screen reads them by field name) ──

public sealed record ExistingSetup(
    [property: JsonPropertyName("claudeMdLines")] int? ClaudeMdLines,
    [property: JsonPropertyName("agentsMd")] bool AgentsMd,
    [property: JsonPropertyName("rules")] int Rules,
    [property: JsonPropertyName("skills")] int Skills,
    [property: JsonPropertyName("hooks")] int Hooks,
    [property: JsonPropertyName("agents")] int Agents,
    [property: JsonPropertyName("settings")] bool Settings);

/// <summary>A file a run changed against its baseline. <c>Status</c>: A, M, D, R or T.</summary>
public sealed record ChangedFile(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("additions")] int Additions,
    [property: JsonPropertyName("deletions")] int Deletions);

public sealed record JointCheck(
    [property: JsonPropertyName("duplicates")] IReadOnlyList<string> Duplicates,
    [property: JsonPropertyName("contradictions")] IReadOnlyList<string> Contradictions,
    [property: JsonPropertyName("alwaysLoadedTokens")] int AlwaysLoadedTokens);

public sealed record DeliverResult
{
    [JsonPropertyName("branch")] public required string Branch { get; init; }
    [JsonPropertyName("base")] public required string Base { get; init; }
    [JsonPropertyName("commitSha")] public string? CommitSha { get; init; }
    [JsonPropertyName("filesCommitted")] public int FilesCommitted { get; init; }
    [JsonPropertyName("remote")] public string? Remote { get; init; }
    [JsonPropertyName("pushed")] public bool Pushed { get; init; }
    [JsonPropertyName("prNumber")] public int? PrNumber { get; init; }
    [JsonPropertyName("prUrl")] public string? PrUrl { get; init; }
    [JsonPropertyName("compareUrl")] public string? CompareUrl { get; init; }
    [JsonPropertyName("localOnly")] public bool LocalOnly { get; init; }
    [JsonPropertyName("note"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Note { get; init; }
    /// <summary>The report the pull request carries, generated from the cards.</summary>
    [JsonPropertyName("report")] public string Report { get; init; } = "";
}
