using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Domain.Onboarding;

namespace Dcc.Tests.Unit.Onboarding;

/// <summary>
/// The acceptance test of the design (docs/research/repo-onboarding-recommendation.md §7; rules.test.ts): the same
/// rules on eleven deliberately different repositories give eleven different component sets, and every component points
/// at the fact that justified it. The fixtures are the diagnoses the research produced.
/// </summary>
public sealed class RulesTests
{
    /// <summary>The eleven research diagnoses by name, and the rules of Server/onboarding/rules.json.</summary>
    internal static readonly IReadOnlyDictionary<string, JsonObject> Fixtures = LoadFixtures();

    internal static readonly IReadOnlyList<JsonObject> AllRules = Rules.Parse(OnboardingFiles.ReadData("rules.json"));

    private static Dictionary<string, JsonObject> LoadFixtures()
    {
        var dir = Path.GetDirectoryName(OnboardingFiles.Repo(Path.Combine("docs", "research", "sources", "onboarding-v2", "repos", "diagnosis", "altshuler_trade.json")))!;
        return Directory.GetFiles(dir, "*.json").ToDictionary(f => Path.GetFileNameWithoutExtension(f), f => JsonNode.Parse(File.ReadAllText(f))!.AsObject());
    }

    private static RulesOutcome Apply(string name, params ProfileCorrection[] corrections) => Rules.Apply(Fixtures[name], corrections, AllRules);

    private static List<string> Fired(string name) => Apply(name).Fired.Select(f => f.Rule).ToList();

    [Fact]
    public void Loads_the_same_eleven_repositories_the_research_used()
    {
        Assert.Equal(["altshuler_trade", "cline", "codex", "eshop", "fastapi-template", "gh-cli", "nowinandroid", "phpmyadmin", "pydatasci-handbook", "spring-petclinic", "terraform-aws-eks"],
            Fixtures.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList());
    }

    [Fact]
    public void Fires_on_Trade_exactly_the_thirteen_rules_the_research_recorded()
    {
        Assert.Equal(["R01", "R05", "R06", "R09a", "R10", "R11", "R12", "R14", "R17", "R21", "R22b", "R25", "R32"], Fired("altshuler_trade"));
    }

    [Fact]
    public void Gives_eleven_distinct_sets_the_process_is_fixed_the_result_is_not()
    {
        Assert.Equal(11, Fixtures.Keys.Select(n => string.Join(",", Fired(n))).Distinct().Count());
    }

    [Fact]
    public void Matches_the_research_rule_matrix_for_every_repository()
    {
        var expected = new Dictionary<string, string[]>
        {
            ["cline"] = ["R01", "R03", "R04", "R06", "R07", "R08", "R09a", "R10", "R14", "R15", "R16", "R20", "R22a", "R29"],
            ["codex"] = ["R01", "R03", "R04", "R06", "R07", "R09a", "R10", "R16", "R20", "R22a", "R23", "R28", "R29"],
            ["eshop"] = ["R01", "R03", "R04", "R06", "R07", "R08", "R10", "R13", "R17", "R20", "R29", "R30", "R31"],
            ["fastapi-template"] = ["R01", "R03", "R04", "R06", "R08", "R10", "R13", "R20", "R23", "R30"],
            ["gh-cli"] = ["R01", "R03", "R04", "R07", "R08", "R09b", "R16", "R20", "R22a", "R23", "R28", "R30"],
            ["nowinandroid"] = ["R03", "R04", "R06", "R07", "R08", "R16", "R20", "R22a", "R26", "R28", "R30"],
            ["phpmyadmin"] = ["R01", "R03", "R04", "R07", "R08", "R09b", "R13", "R17", "R20", "R22a", "R24", "R28", "R30"],
            ["pydatasci-handbook"] = ["R02", "R05", "R07", "R17", "R18", "R21"],
            ["spring-petclinic"] = ["R03", "R04", "R07", "R13", "R17", "R20", "R22a", "R23", "R27", "R28"],
            ["terraform-aws-eks"] = ["R03", "R04", "R08", "R14", "R17", "R19", "R20", "R22a", "R28"],
        };
        foreach (var (name, rules) in expected)
            Assert.Equal($"{name}: {string.Join(",", rules)}", $"{name}: {string.Join(",", Fired(name))}");
    }

    [Fact]
    public void Fills_every_reason_and_every_card_from_the_profile_no_placeholder_left()
    {
        var placeholder = new Regex(@"\{[a-z_0-9]+\}");
        foreach (var name in Fixtures.Keys)
            foreach (var f in Apply(name).Fired)
            {
                Assert.False(placeholder.IsMatch(f.ReasonHe), $"{name} {f.Rule}: {f.ReasonHe}");
                foreach (var c in f.Components)
                {
                    var text = c.TitleHe + c.WhatHe + c.WhyHe + c.VerifyHowHe;
                    Assert.False(placeholder.IsMatch(text), $"{name} {c.Key}: {text}");
                    Assert.Equal(f.Rule, c.SourceRef);
                }
            }
    }

    [Fact]
    public void Holds_a_rule_back_when_the_person_marked_the_fact_it_reads_as_wrong_and_says_which()
    {
        var r = Apply("altshuler_trade", new ProfileCorrection("windows_build.windows_only_build", "יש לנו מריץ", "u", "now"));
        Assert.DoesNotContain("R11", r.Fired.Select(f => f.Rule));
        Assert.Equal([new RuleSuppression("R11", "windows_build.windows_only_build", "יש לנו מריץ")], r.Suppressed);
        // a correction on the parent holds back every rule under it
        var r2 = Apply("altshuler_trade", new ProfileCorrection("secrets", null, "u", "now"));
        Assert.Equal(["R09a", "R09b", "R10"], r2.Suppressed.Select(s => s.Rule).ToList());
    }

    [Fact]
    public void Names_Trades_evidence_in_words_a_manager_reads()
    {
        var r = Apply("altshuler_trade");
        var r11 = r.Fired.Single(f => f.Rule == "R11");
        Assert.Contains("1 .sln", r11.ReasonHe);
        Assert.Contains("58 .snk", r11.ReasonHe);
        Assert.Contains("67", r.Fired.Single(f => f.Rule == "R06").ReasonHe);
        var deny = r.Fired.Single(f => f.Rule == "R10").Components[0];
        Assert.Contains("40", deny.TitleHe);
        Assert.Equal(40, deny.Params["deny"]!.AsArray().Count);
    }

    [Fact]
    public void Every_rule_reads_facts_a_correction_can_name()
    {
        foreach (var r in AllRules) Assert.True(Rules.FactsOf(r["when"]!).Count > 0, r["id"]!.GetValue<string>());
    }

    [Fact]
    public void Derives_stack_tags_from_the_profile_not_from_a_list()
    {
        var trade = Rules.StackTags(Fixtures["altshuler_trade"]);
        foreach (var t in new[] { "c#", "dataverse-dynamics-365", "powerapps-pcf-control", "nuget" }) Assert.Contains(t, trade);
        var eks = Rules.StackTags(Fixtures["terraform-aws-eks"]);
        foreach (var t in new[] { "terraform", "aws-sdk" }) Assert.Contains(t, eks);
        var monoN = Rules.RawContext(Fixtures["cline"])["mono_n"]!;
        Assert.Equal(System.Text.Json.JsonValueKind.Number, monoN.GetValueKind());
        Assert.Equal(24, monoN.GetValue<int>());
    }

    // ── beyond rules.test.ts: what the port must keep from JavaScript ─────

    [Fact]
    public void Conditions_read_the_profile_the_way_the_old_server_did()
    {
        var d = JsonNode.Parse("""
            {"languages":[{"language":"PHP","files":3}],
             "extra":{"list":[1,null,"a",0],"empty":{},"zero":0,"nul":null,"f":false,"s":"","t":true,"nested":{"0":"x","k":[]}}}
            """)!.AsObject();
        bool E(string json) => Rules.Evaluate(JsonNode.Parse(json)!, d);
        Assert.True(E("""{"path":"extra.list.length","gte":4}"""));
        Assert.True(E("""{"path":"extra.list.1","eq":null}"""));
        Assert.False(E("""{"path":"extra.missing","eq":null}"""));  // undefined is not null
        Assert.True(E("""{"path":"extra.list","includes":null}"""));
        Assert.True(E("""{"path":"extra.list","hasKey":"3"}"""));
        Assert.False(E("""{"path":"extra.list","hasKey":"4"}"""));
        Assert.True(E("""{"path":"extra.empty","empty":true}"""));  // an object without keys is empty
        Assert.False(E("""{"path":"extra.empty"}"""));
        Assert.False(E("""{"path":"extra.t","truthy":1}"""));        // only a boolean equals a boolean
        Assert.True(E("""{"path":"extra.zero","gte":null}"""));      // null compares as 0
        Assert.False(E("""{"path":"extra.zero","eq":false}"""));
        Assert.False(E("""{"path":"extra.s.length","gt":-1}"""));    // text is not walked into
        Assert.True(E("""{"path":"extra.nested.0","eq":"x"}"""));
        Assert.True(E("""{"fn":"lang_files","arg":"PHP","gte":3}"""));
        Assert.True(E("""{"fn":"lang_files","arg":5,"truthy":false}"""));
        Assert.False(E("""{"not":{"any":[{"path":"extra.zero"},{"all":[]}]}}"""));
        Assert.False(E("""{"any":[]}"""));
        Assert.Equal(["extra.list.3"], Rules.FactsOf(JsonNode.Parse("""{"path":"extra.list","hasKey":"3"}""")!));
    }

    [Fact]
    public void A_rule_naming_an_unknown_helper_fails_with_the_rules_id()
    {
        var rule = JsonNode.Parse("""{"id":"RX","signal":"s","when":{"fn":"nope"},"reason_he":"r","components":[]}""")!.AsObject();
        var e = Assert.Throws<InvalidOperationException>(() => Rules.Apply(Fixtures["cline"], [rule]));
        Assert.Equal("rule RX: rules.json names an unknown helper: nope", e.Message);
    }

    [Fact]
    public void Stores_firings_under_the_names_the_old_server_wrote()
    {
        var r02 = Apply("pydatasci-handbook").Fired.Single(f => f.Rule == "R02");
        var expected = JsonNode.Parse("""
            {"rule":"R02","signal":"no test framework detected","reason_he":"לא נמצאה מסגרת בדיקות (0 קבצים שנראים כמו בדיקות). סוכן ש\"מוסיף בדיקות\" היה ממציא מסגרת.","components":[
             {"key":"first_tests_scaffold","kind":"scaffold","family":"verification","risk":"significant","source":"rule","sourceRef":"R02","title_he":"בדיקה ראשונה במסגרת של השפה","what_he":"בדיקת עשן אחת במסגרת הטבעית של השפה, כדי שיהיה מה להריץ. הסוכן מרחיב ממנה במקום להמציא.","why_he":"לא נמצאה מסגרת בדיקות (0 קבצים שנראים כמו בדיקות). סוכן ש\"מוסיף בדיקות\" היה ממציא מסגרת.","verifyHow_he":"הבדיקה רצה ועוברת בעותק המבודד, כשיש מריץ.","params":{"template":"first-test","languages":["Jupyter","Python","HTML"]}},
             {"key":"build_gate_hook","kind":"hook","family":"verification","risk":"reversible","source":"rule","sourceRef":"R02","title_he":"hook: build עובר לפני \"סיימתי\"","what_he":"כשהסוכן מסיים תור, ה-hook מריץ את ה-build ומחזיר לו את השגיאות אם יש. אין שער בדיקות עדיין — אין בדיקות.","why_he":"לא נמצאה מסגרת בדיקות (0 קבצים שנראים כמו בדיקות). סוכן ש\"מוסיף בדיקות\" היה ממציא מסגרת.","verifyHow_he":"מריצים את ה-hook על העותק ורואים שהוא מריץ את פקודת ה-build.","params":{"template":"build-gate","command":""}},
             {"key":"no_test_writer_agent","kind":"report","family":"agents","risk":"reversible","source":"rule","sourceRef":"R02","title_he":"לא: סוכן שכותב בדיקות","what_he":"אין מסגרת בדיקות ואין מריץ. בדיקות שאי אפשר להריץ הן טקסט.","why_he":"אין מסגרת בדיקות ואין מריץ. בדיקות שאי אפשר להריץ הן טקסט.","verifyHow_he":"","params":{},"notRecommended":true}]}
            """);
        var actual = Rules.FiringsJson([r02])[0];
        Assert.True(JsonNode.DeepEquals(expected, actual), actual!.ToJsonString());
        Assert.Equal(expected!.ToJsonString(), actual.ToJsonString());  // and in the same key order
    }

    [Fact]
    public void Object_keys_keep_JavaScripts_order_and_unknown_placeholders_stay_visible()
    {
        var d = JsonNode.Parse("""{"external_systems":{"zeta":{},"10":{},"2":{},"017":{},"Azure SDK":{}},"languages":[{"language":"C#","files":1}]}""")!.AsObject();
        Assert.Equal(["2", "10", "zeta", "017", "azure-sdk", "c#"], Rules.StackTags(d));
        var ctx = Rules.Context(Fixtures["cline"]);
        Assert.Equal("bun run test {nope} 9 [object Object]",Rules.Fill("{test_cmd} {nope} {readme_kb} {shapes_arr}", ctx));
    }

    [Fact]
    public void Commands_and_names_are_read_with_JavaScripts_whitespace_dot_and_lower_case()
    {
        var d = Fixtures["altshuler_trade"].DeepClone().AsObject();
        d["build"]!["commands"] = new JsonArray("msbuild A.sln # c\r", "make build # comment\r", "npm test\u0085# x", "x\uFEFF# y");
        d["frameworks"] = new JsonArray("\u0130stanbul", "Foo\u0085(bar)", "Q (a\rb)");
        // JavaScript's `.` stops at \r, so a command from a CRLF file keeps its comment; U+0085 is not JavaScript whitespace, U+FEFF is.
        Assert.Equal("msbuild A.sln # c\r · make build # comment\r · npm test\u0085# x · x", OnboardingProfile.Facts(d)[2].ValueHe);
        Assert.Equal("Build command: msbuild A.sln # c\r — it runs ONLY on Windows (msbuild); it cannot run on Linux or macOS.", OnboardingProfile.FactsForJudge(d)[0]);
        var ctx = Rules.Context(d);
        Assert.Equal("msbuild A.sln # c\r", ctx["build_cmd_raw"]);
        Assert.Equal("msbuild A.sln # c\r", ctx["sln_first"]);
        // toLowerCase turns İ into "i" + U+0307 (→ "i-"); "(a\rb)" is not a trailing parenthesis to JavaScript.
        Assert.Equal(["dataverse-dynamics-365", "soap-wcf-web-services", "azure-sdk", "rabbitmq-amqp", "sharepoint-office365", "i-stanbul", "foo", "q-a-b", "nuget", "c#", "javascript"],
            Rules.StackTags(d));
    }
}

/// <summary>The profile as a person reads it (profile.ts has no test of its own): the lines, the summary, the judge's facts.</summary>
public sealed class ProfileFactsTests
{
    private static JsonObject Trade => RulesTests.Fixtures["altshuler_trade"];
    private static JsonObject Cline => RulesTests.Fixtures["cline"];

    [Fact]
    public void Reads_Trade_line_by_line_as_the_old_server_wrote_it()
    {
        (string Path, string Concept, string Label, string Tone, string Value)[] expected =
        [
            ("languages", "profile_languages", "שפות", "plain", "C# (804 קבצים, 169,379 שורות) · JavaScript (59 קבצים, 13,106 שורות) · JSON (30 קבצים) · TypeScript (26 קבצים, 1,612 שורות) · XML (16 קבצים)"),
            ("frameworks", "profile_frameworks", "מסגרות וספריות", "plain", ".NET, .NET Framework (legacy, msbuild), MSTest, Microsoft.CrmSdk, Microsoft.PowerPlatform.Dataverse.Client, PowerApps PCF control, react (sub-package)"),
            ("build", "profile_build", "build", "warn", "msbuild Altshuler.sln /t:Build"),
            ("windows_build.windows_only_build", "profile_windows_only", "build רק ב-Windows", "warn", "1 .sln · 69 csproj · 58 .snk · netframework v4.6.2, netframework v4.7.2"),
            ("tests", "profile_tests", "בדיקות", "plain", "MSTest · 6 קובצי בדיקה ב-Test"),
            ("lint_format", "profile_lint", "lint ופורמט", "warn", "אין"),
            ("ci", "profile_ci", "CI", "warn", "אין CI — שום דבר לא מגדיר \"ירוק\""),
            ("monorepo", "profile_monorepo", "מבנה", "plain", "ריפו רב-חבילות: 69 .NET projects in 1 solution(s) · 67 חבילות"),
            ("generated_code", "profile_generated", "קוד מג'ונרט", "plain", "— · 3 קבצים עם כותרת auto-generated"),
            ("secrets", "profile_secrets", "סודות", "bad", "1 מחרוזות בצורת סוד מחוץ לבדיקות (connection_string_with_password) ב-Stuff/OneTimeConsole/Program.cs · 40 קבצים רגישים לפי השם (Alt.BusinessLogicLayer.Crm.External.snk, app.config, Alt.BusinessLogicLayer.Crm.snk ועוד 37). רק מיקום נרשם, לעולם לא הערך."),
            ("external_systems", "profile_external", "מערכות חיצוניות", "plain", "Dataverse/Dynamics 365 (251) · SOAP/WCF web services (142) · Azure SDK (68) · RabbitMQ/AMQP (40) · OAuth/OIDC/Identity (4) · SharePoint/Office365 (1)"),
            ("ai_config", "profile_ai_config", "הגדרות AI קיימות", "plain", "אין — הסוכן מתחיל מאפס עובדות"),
            ("docs", "profile_docs", "תיעוד", "warn", "אין README · אין docs/"),
            ("environment", "profile_environment", "סביבה", "plain", "לא נמצאה הגדרת סביבה"),
            ("git", "profile_history", "היסטוריית git", "warn", "1 commits (עותק רדוד) · 1 מחברים · 2026-09-23 עד 2026-09-23 · נקודה חמה: Shared/Framework (1680 שינויים, 1 מחברים) · אין צורות שינוי חוזרות לקרוא"),
            ("git.tracked_binaries_dll_exe_pdb", "profile_hygiene", "היגיינה", "warn", "3,215 dll/exe/pdb · 2,963 קובצי package cache · 1,020 קובצי IDE בתוך git"),
            ("size", "profile_size", "גודל", "plain", "1,333 קבצים · 184,097 שורות קוד · 1611MB"),
            ("docs.license_kind", "profile_license", "רישיון", "plain", "אין קובץ רישיון"),
        ];
        var facts = OnboardingProfile.Facts(Trade);
        Assert.Equal(expected.Length, facts.Count);
        for (var i = 0; i < expected.Length; i++)
            Assert.Equal(expected[i], (facts[i].Path, facts[i].Concept, facts[i].LabelHe, facts[i].Tone, facts[i].ValueHe));
        Assert.All(facts, f => Assert.False(f.Corrected));
    }

    [Fact]
    public void Prints_sizes_and_counts_the_way_the_screen_showed_them()
    {
        var facts = OnboardingProfile.Facts(Cline).ToDictionary(f => f.Path, f => f.ValueHe);
        Assert.Equal("TypeScript (3,195 קבצים, 981,961 שורות) · Markdown (195 קבצים) · JSON (173 קבצים) · JavaScript (44 קבצים, 8,554 שורות) · CSS (32 קבצים)", facts["languages"]);
        Assert.Equal(".agents/, .claude/, AGENTS.md, clinerules, copilot ועוד 1 · 70 קבצים (SKILL.md 8.8KB, REFERENCE.md 3.6KB, api.md 5.2KB)", facts["ai_config"]);
        Assert.Equal("README 9KB · 160 קבצים ב-docs/ · ארכיטקטורה: apps/examples/desktop-app/sidecar/ARCHITECTURE.md, evals/ARCHITECTURE.md ועוד 1 · CONTRIBUTING.md", facts["docs"]);
        Assert.Equal("5 מחרוזות בצורת סוד מחוץ לבדיקות (password_assignment, slack_token, aws_access_key) ב-— · 1 קבצים רגישים לפי השם (.env.example). רק מיקום נרשם, לעולם לא הערך.", facts["secrets"]);
        Assert.Equal("apps/vscode/src/types (2), sdk/packages/llms/src/catalog (2), sdk/packages/llms/src/providers (2) · 8 קבצים עם כותרת auto-generated", facts["generated_code"]);
    }

    [Fact]
    public void A_correction_marks_the_line_it_names_and_the_lines_above_and_below_it()
    {
        var corrected = OnboardingProfile.Facts(Trade, [new("tests.frameworks", null, "u", "now"), new("git.hot_dirs", "x", "u", "now")])
            .Where(f => f.Corrected).Select(f => f.Path).ToList();
        Assert.Equal(["tests", "git"], corrected);
        var parent = OnboardingProfile.Facts(Trade, [new("git", null, "u", "now")]).Where(f => f.Corrected).Select(f => f.Path).ToList();
        Assert.Equal(["git", "git.tracked_binaries_dll_exe_pdb"], parent);
    }

    [Fact]
    public void Summarises_Trade_in_one_paragraph_for_the_prompts()
    {
        Assert.Equal("Languages: C# (804 files), JavaScript (59 files), JSON (30 files), TypeScript (26 files). Frameworks: .NET, .NET Framework (legacy, msbuild), MSTest, Microsoft.CrmSdk, Microsoft.PowerPlatform.Dataverse.Client, PowerApps PCF control, react (sub-package). Build: msbuild Altshuler.sln /t:Build (Windows-only: msbuild, signed assemblies). Tests: MSTest, 6 test files in Test. Lint/format: none. CI: none. Multi-package: 69 .NET projects in 1 solution(s) (67 packages). Generated code: —; 3 files with auto-generated headers. Secrets: 1 secret-shaped strings outside tests, 1 in tests; 40 sensitive-by-name files (locations only, never values). External systems referenced: Dataverse/Dynamics 365, SOAP/WCF web services, Azure SDK, RabbitMQ/AMQP, OAuth/OIDC/Identity, SharePoint/Office365. AI configuration: none. Docs: no README, 0 files in docs/, architecture docs: none, contributing: none, PR template: none. History: 1 commits, 1 authors, 2026-09-23..2026-09-23; hot dirs: Shared/Framework (1680 changes/1 authors), Shared/DataModel (806 changes/1 authors), ExternalEntryPoints/WebJobs (689 changes/1 authors); repeated change shapes: 0. Size: 1333 files, 184097 code lines.",
            OnboardingProfile.Summary(Trade));
    }

    [Fact]
    public void Hands_the_judge_only_the_facts_that_bear_on_a_task()
    {
        Assert.Equal(
        [
            "Build command: msbuild Altshuler.sln /t:Build — it runs ONLY on Windows (msbuild); it cannot run on Linux or macOS.",
            "Test framework: MSTest; 6 test files under Test.",
            "There is NO CI in this repository.",
            "There is NO linter or formatter configured.",
            "Multi-package repository: 67 packages (BusinessLogicLayer/Crm/Alt.BusinessLogicLayer.Crm, BusinessLogicLayer/Crm/Alt.BusinessLogicLayer.Crm.External, Client/Webresources/Alt.Client.Webresources, CrmEntryPoints/Actions/Alt.Crm.Actions.DownloadFile, CrmEntryPoints/Actions/Alt.Crm.Actions.FetchConfigurationManager, CrmEntryPoints/Actions/Alt.Crm.Actions.IncidentStatusChange, CrmEntryPoints/Actions/Alt.Crm.Actions.Logger, CrmEntryPoints/Actions/Alt.Crm.Actions.OTPManager).",
            "Package manager(s): nuget.",
            "External systems: Dataverse/Dynamics 365, SOAP/WCF web services, Azure SDK, RabbitMQ/AMQP, OAuth/OIDC/Identity, SharePoint/Office365 — their live schema or data is not in the repository.",
        ], OnboardingProfile.FactsForJudge(Trade));
        Assert.Equal(
        [
            "Build command: bun run build.",
            "Test framework: package.json:test -> bun --parallel -F './sdk/packages/**' -F @cline/cli -F @cline/cline-hub -F @clin, vitest; 946 test files under .github, apps, evals.",
            "CI: github-actions runs bun run build:sdk; NODE_FILE=\"node_modules/better-sqlite3/build/Release/better_sqlite3.node\"; npm install -g @vscode/vsce ovsx; NPM_VERSION=$(npm --version).",
            "Lint/format: @biomejs/biome, biome.json.",
            "Multi-package repository: 24 packages (apps/cli, apps/cline-hub, apps/examples/cli-agent, apps/examples/cline-core-cli-agent, apps/examples/code-review-bot, apps/examples/desktop-app, apps/examples/menubar, apps/examples/multi-agent).",
            "Package manager(s): bun.",
            "Generated code lives in: apps/vscode/src/types, sdk/packages/llms/src/catalog, sdk/packages/llms/src/providers — it is not edited by hand.",
            "External systems: gRPC/Protobuf, SAP, OpenAI API, OAuth/OIDC/Identity, Anthropic API, AWS SDK — their live schema or data is not in the repository.",
        ], OnboardingProfile.FactsForJudge(Cline));
    }

    [Fact]
    public void Every_research_diagnosis_reads_without_a_hole()
    {
        foreach (var (name, d) in RulesTests.Fixtures)
        {
            var text = string.Join("\n", OnboardingProfile.Facts(d).Select(f => f.ValueHe)) + OnboardingProfile.Summary(d) + string.Join("\n", OnboardingProfile.FactsForJudge(d));
            Assert.False(text.Contains("undefined") || text.Contains("NaN") || text.Contains("[object Object]"), name);
        }
    }
}
