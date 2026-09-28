using System.Text.RegularExpressions;

namespace Dcc.Domain.Prompts;

/// <summary>
/// What the code needs from each prompt on the Prompts screen. Pure — no
/// database — so the save and the screen use the same check, and it is tested
/// on its own.
///
/// The words of every prompt live in <c>prompt_template</c> and nowhere else.
/// What lives here is only what the CODE depends on: the values it fills in,
/// the switches it sets, and the exact text it reads back out of the answer.
/// An edit may change anything else; an edit that removes one of these is
/// refused on save, because the call would still run and quietly stop working.
/// </summary>
public static partial class PromptContract
{
    /// <param name="Capability">The policy capability that picks the model and effort (config/model-policy.json).</param>
    /// <param name="Vars">Values the code always fills — each <c>{{NAME}}</c> must stay in the body.</param>
    /// <param name="Keeps">Text the code reads back from the answer — the reply's format.</param>
    /// <param name="Optional">Values and switches the body may use or leave out: <c>{{NAME}}</c>, <c>{{#NAME}}…{{/NAME}}</c>, <c>{{^NAME}}…{{/NAME}}</c>.</param>
    /// <param name="ModelPerRun">The person picks the model for each run, starting from the row's default.</param>
    /// <param name="AppendedTo">Sent after these prompts rather than on its own.</param>
    public sealed record PromptUse(string Capability, string[] Vars, string[] Keeps, string[]? Optional = null, bool ModelPerRun = false, string? AppendedTo = null);

    private static readonly PromptUse AssessTier = new("gap_detection", ["REQUIREMENT"], [], ["HAS_REPO", "REPO_NAME"], ModelPerRun: true, AppendedTo: "assess.readiness");
    private static readonly string[] CheckOptional = ["COMPILED", "PATHS", "INTENT"];

    public static readonly IReadOnlyDictionary<string, PromptUse> Uses = new Dictionary<string, PromptUse>
    {
        ["assess.readiness.quick"] = AssessTier,
        ["assess.readiness.standard"] = AssessTier,
        ["assess.readiness.thorough"] = AssessTier,
        ["assess.readiness.audit"] = AssessTier,
        ["assess.readiness.custom"] = AssessTier with { Vars = ["REQUIREMENT", "CUSTOM_EMPHASIS"] },
        ["assess.shared.output_contract"] = new("gap_detection", [],
            ["\"title\"", "\"summary\"", "\"whatChanges\"", "\"baked\"", "\"rationale\"", "\"gaps\"", "\"question\"", "\"why\"", "\"kind\"", "\"whoAnswers\"", "\"options\"", "\"impactIfWrong\"", "\"blocking\"", "\"confidence\""],
            AppendedTo: "assess.readiness"),
        ["breakdown.tasks"] = new("decomposition", ["REQUIREMENT"],
            ["\"seq\"", "\"parentSeq\"", "\"kind\"", "\"intent\"", "\"prompt\"", "\"appetite\"", "\"affectedPaths\"", "\"compiledComponents\"", "\"dependsOnSeq\""],
            ["HAS_REPO", "REPO_NAME"]),
        ["implement.task"] = new("execution", ["INSTRUCTION", "APPETITE", "CONTEXT"],
            ["\"summary\"", "\"filesChanged\"", "\"testsRun\"", "\"followUps\"", "\"affectedConsumers\""],
            ["SHORT_TITLE", "AFFECTED_PATHS", "BUILT_ON", "MISSING"]),
        // After the development: the build checks, then all the others — no write access.
        ["checks.run"] = new("execution", ["INTENT", "CHANGED_FILES", "CONTEXT", "CHECKS"],
            ["\"summary\"", "\"checks\"", "\"seq\"", "\"passed\"", "\"detail\"", "\"likelyCause\""],
            ["BUILT_ON", "MISSING"]),
        // The instruction of each check DCC adds to a task — copied onto the check when it is created.
        ["check.build"] = new("execution", [], [], CheckOptional),
        ["check.tests"] = new("execution", [], [], CheckOptional),
        ["check.regression"] = new("execution", [], [], CheckOptional),
        ["check.e2e"] = new("execution", [], [], CheckOptional),
        ["chat.system"] = new("chat", ["UNANSWERED_MARK"], ["<goto key=\"", "<action key=\"", "<needs_code>"]),
        ["chat.rollover_summary"] = new("conversation_summary", [], []),
        ["chat.code_read.repo"] = new("chat_code_read", [], []),
        ["chat.code_read.pull_request"] = new("chat_code_read", [], []),
        ["chat.code_read.onboarding_run"] = new("chat_code_read", [], []),
        ["gaps.conversation"] = new("chat_code_read", [],
            ["<action key=\"resolve_gap\">", "<action key=\"dismiss_gap\">", "\"gap\":\"REF\"", "\"answer\":", "\"reason\":"]),
        // Marking which pieces of the spec, as it arrived, are requirements, and which task implements each.
        ["spec.map"] = new("decomposition", ["TITLE", "DOC_NAME", "SPEC", "DECISIONS", "TASKS"],
            ["\"requirements\"", "\"id\"", "\"title\"", "\"links\"", "\"seq\"", "\"evidence\"", "\"corrections\"", "\"decision\"", "\"from\"", "\"to\""]),
        ["insights.clusters"] = new("usage_insights", [], ["\"n\"", "\"finding\"", "\"recommendation\""]),
        // Repository onboarding as a coach: the processes map, the trial task and its judge, the marketplace
        // search, the author of one file, the reviewer of the plan, the /init scan, and a person's request.
        ["onboarding.processes"] = new("onboarding_processes", ["REPO_NAME", "PROFILE", "EVIDENCE", "INTERVIEW"],
            ["\"processes\"", "\"steps\"", "\"agentTest\"", "\"judgment\"", "\"externalInfo\"", "\"readsALot\"", "\"parallel\"", "\"failsToday\""]),
        ["onboarding.trial"] = new("onboarding_trial", ["TASK"], ["RESULT: "]),
        ["onboarding.judge"] = new("onboarding_judge", ["TASK", "FACTS", "ANSWER"], ["\"passed\"", "\"failureKind\"", "\"detail\""]),
        ["onboarding.marketplace"] = new("onboarding_marketplace", ["STACK", "PROFILE_SUMMARY", "KNOWN"], ["\"sources\"", "\"kind\"", "\"url\"", "\"publisher\"", "\"official\""]),
        ["onboarding.author"] = new("onboarding_author", ["REPO_NAME", "PROFILE_SUMMARY", "COMPONENT", "FORMAT"], [], ["PROCESS", "EVIDENCE"]),
        ["onboarding.review"] = new("onboarding_review", ["REPO_NAME", "PROFILE_SUMMARY", "PROCESSES", "TRIALS", "COMPONENTS"], ["\"missing\"", "\"redundant\""]),
        ["onboarding.init_scan"] = new("onboarding_init_scan",
            ["REPO_NAME", "PROFILE_SUMMARY", "FACTS", "INTERVIEW", "PROCESSES", "TRIALS", "SESSION_ANSWERS", "OURS_AGENTS", "OUR_CARDS", "DRAFT"],
            ["\"verdict\"", "\"summary\"", "\"compare\"", "\"items\"", "\"decision\"", "\"form\"", "\"target\"", "\"heading\"", "\"text\"", "\"origin\"", "\"question\"", "\"replaces\"", "\"drop_ours\"", "\"reject\""]),
        ["onboarding.request"] = new("onboarding_processes", ["REPO_NAME", "REQUEST", "PROFILE_SUMMARY", "PROCESSES"], ["\"kind\"", "\"title\"", "\"questions\""]),
    };

    [GeneratedRegex(@"\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{/\2\}\}")] private static partial Regex Section();
    [GeneratedRegex(@"\{\{(\w+)\}\}")] private static partial Regex Plain();
    [GeneratedRegex(@"\{\{[#^](\w+)\}\}")] private static partial Regex Opened();
    [GeneratedRegex(@"\{\{/(\w+)\}\}")] private static partial Regex Closed();

    /// <summary>
    /// Fills a template: <c>{{NAME}}</c> becomes its value; <c>{{#NAME}}…{{/NAME}}</c> stays only
    /// when NAME is set (true, or a non-empty text) and <c>{{^NAME}}…{{/NAME}}</c> only when it is
    /// not. An unknown <c>{{NAME}}</c> is left as it is — visible, not silently swallowed.
    /// </summary>
    public static string Render(string body, IReadOnlyDictionary<string, object?> vars)
    {
        bool On(string k) => vars.TryGetValue(k, out var v) && v switch { string s => s.Trim().Length > 0, bool b => b, null => false, _ => true };
        var output = body;
        // Innermost first, until nothing is left to open — so a section may sit inside another.
        for (var prev = ""; prev != output;)
        {
            prev = output;
            output = Section().Replace(output, m => (m.Groups[1].Value == "#") == On(m.Groups[2].Value) ? m.Groups[3].Value : "");
        }
        return Plain().Replace(output, m => vars.TryGetValue(m.Groups[1].Value, out var v) && v is string s ? s : m.Value);
    }

    /// <summary>Why this body would break its caller — plain Hebrew, one line each; empty when fine.</summary>
    public static List<string> Problems(string key, string body)
    {
        if (!Uses.TryGetValue(key, out var use)) return [];
        var problems = new List<string>();
        var known = use.Vars.Concat(use.Optional ?? []).ToHashSet();
        var plain = Plain().Matches(body).Select(m => m.Groups[1].Value).ToHashSet();
        var opened = Opened().Matches(body).Select(m => m.Groups[1].Value).ToList();
        var closed = Closed().Matches(body).Select(m => m.Groups[1].Value).ToList();

        foreach (var v in use.Vars.Where(v => !plain.Contains(v)))
            problems.Add($"חסר {{{{{v}}}}} — הקוד ממלא כאן ערך, ובלעדיו קלוד לא יקבל אותו.");
        foreach (var v in plain.Concat(opened).Concat(closed).Distinct().Where(v => !known.Contains(v)))
            problems.Add($"{{{{{v}}}}} לא מוכר — הקוד לא ממלא אותו, והוא יישלח לקלוד כמו שהוא.");
        foreach (var v in opened.Concat(closed).Distinct().Where(v => opened.Count(x => x == v) != closed.Count(x => x == v)))
            problems.Add($"קטע {{{{#{v}}}}} / {{{{^{v}}}}} לא נסגר ב-{{{{/{v}}}}} (או להפך).");
        foreach (var k in use.Keeps.Where(k => !body.Contains(k, StringComparison.Ordinal)))
            problems.Add($"חסר {k} — הקוד קורא את זה מהתשובה של קלוד; בלעדיו הקריאה תרוץ ולא תעבוד.");
        return problems;
    }
}
