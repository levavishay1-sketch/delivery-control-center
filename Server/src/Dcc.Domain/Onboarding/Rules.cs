using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using static Dcc.Domain.Onboarding.ProfileJson;

namespace Dcc.Domain.Onboarding;

/// <summary>
/// The decision rules (rules.json; repo-onboarding/rules.ts): a signal in the repository profile → the components
/// that answer it, each with the evidence in words. Pure — no database, no model, no disk: the caller parses the file
/// and hands the rules in — so the eleven stored research diagnoses are its unit test, and a person can read from the
/// screen exactly why a component is there ("כי ראיתי").
///
/// A rule relies on facts (the profile paths its condition reads). When the person marked one of them wrong, the rule
/// does not fire and the plan says which rule was held back by which correction.
///
/// A condition is <c>{all: [...]}</c>, <c>{any: [...]}</c>, <c>{not: c}</c>, <c>{fn, arg?, truthy?, gte?}</c> (a helper
/// below, by name) or <c>{path, empty | truthy | eq | gte | gt | lt | includes | includesAny | hasKey | hasAnyKey}</c>.
/// It is evaluated with JavaScript's meaning of empty, equal and "has a key": the rules were written against the old
/// server, and a rule must fire on exactly the repositories it fired on there.
/// </summary>
public static partial class Rules
{
    /// <summary>The <c>rules</c> array of rules.json, as JSON objects.</summary>
    public static IReadOnlyList<JsonObject> Parse(string rulesJson) =>
        (JsonNode.Parse(rulesJson)?["rules"] as JsonArray ?? throw new InvalidOperationException("rules.json has no \"rules\" array"))
            .Select(r => r as JsonObject ?? throw new InvalidOperationException("a rule in rules.json is not an object")).ToList();

    // ── the helpers the rules name by `fn` ─────────────────────────────

    /// <summary>
    /// Generated directories: path markers with at least two files (a test snapshot folder is not generated code), then
    /// folders whose files carry an auto-generated header. At most six.
    /// </summary>
    public static List<string> GenDirs(JsonObject profile)
    {
        var gc = Obj(profile, "generated_code");
        var dirs = Arr(gc, "paths").Where(p => Num(p, "files") >= 2 && !Str(p, "dir").EndsWith("__tests__", StringComparison.Ordinal)).Select(p => Str(p, "dir")).ToList();
        foreach (var h in Arr(gc, "header_dirs"))
            if (Num(h, "files") >= 2 && !dirs.Contains(Str(h, "dir"))) dirs.Add(Str(h, "dir"));
        return dirs.Take(6).ToList();
    }

    /// <summary>The first hot directory (not the root) that many people changed many times — a copy, so it can go into another JSON tree.</summary>
    public static JsonObject? HotMultiAuthor(JsonObject profile)
    {
        var git = Obj(profile, "git");
        if (!Truthy(Get(git, "available"))) return null;
        return Arr(git, "hot_dirs").OfType<JsonObject>()
            .FirstOrDefault(h => Str(h, "dir") != "." && Num(h, "authors") >= 10 && Num(h, "changes") >= 100)?.DeepClone().AsObject();
    }

    /// <summary>git.repeated_change_shapes with times ≥ 3 and ≥ 3 files — copies, so they can go into another JSON tree.</summary>
    public static List<JsonObject> Shapes(JsonObject profile) =>
        Arr(Obj(profile, "git"), "repeated_change_shapes").OfType<JsonObject>()
            .Where(s => Num(s, "times") >= 3 && Arr(s, "files").Count >= 3).Select(s => s.DeepClone().AsObject()).ToList();

    /// <summary>The first pair of dependency files that changed together at least eight times — a dependency bump, the commonest shape there is.</summary>
    public static JsonObject? DepBumpShape(JsonObject profile) =>
        Arr(Obj(profile, "git"), "cochange_pairs").OfType<JsonObject>()
            .FirstOrDefault(p => DepFiles().IsMatch(Str(p, "a")) && DepFiles().IsMatch(Str(p, "b")) && Num(p, "times") >= 8)?.DeepClone().AsObject();

    /// <summary>How many files of one language the repository has (a number, summed as the old server summed it).</summary>
    public static double LangFiles(JsonObject profile, string language) =>
        Arr(profile, "languages").Where(l => IsString(Get(l, "language"), language)).Aggregate(0d, (a, l) => a + Num(l, "files"));

    private static readonly HashSet<string> BuildSystems = ["maven", "gradle", "cargo", "dotnet", "msbuild", "go", "composer", "turborepo"];

    public static int BuildSystemsCount(JsonObject profile) => Strs(Obj(profile, "build"), "system").Count(BuildSystems.Contains);

    /// <summary>A helper's value (JSON, so emptiness reads the same as a path's value) and the profile paths it reads.</summary>
    private sealed record Helper(Func<JsonObject, JsonNode?, JsonNode?> Run, IReadOnlyList<string> Facts);

    private static readonly Dictionary<string, Helper> Fn = new()
    {
        ["gen_dirs"] = new((d, _) => JsonList(GenDirs(d)), ["generated_code"]),
        ["hot_multi_author"] = new((d, _) => HotMultiAuthor(d), ["git.hot_dirs"]),
        ["shapes"] = new((d, _) => new JsonArray(Shapes(d).ToArray<JsonNode?>()), ["git.repeated_change_shapes"]),
        ["dep_bump_shape"] = new((d, _) => DepBumpShape(d), ["git.cochange_pairs"]),
        // An `arg` that is not text names no language, as `language === 5` matched none.
        ["lang_files"] = new((d, arg) => arg is null ? LangFiles(d, "") : IsString(arg) ? LangFiles(d, arg.GetValue<string>()) : 0, ["languages"]),
        ["build_systems_count"] = new((d, _) => BuildSystemsCount(d), ["build.system"]),
    };

    // ── evaluating a condition ─────────────────────────────────────────

    public static bool Evaluate(JsonNode condition, JsonObject profile)
    {
        var cond = Condition(condition);
        if (cond.ContainsKey("all")) return Required(cond, "all").All(c => Evaluate(c!, profile));
        if (cond.ContainsKey("any")) return Required(cond, "any").Any(c => Evaluate(c!, profile));
        if (cond.ContainsKey("not")) return !Evaluate(cond["not"]!, profile);
        if (cond.ContainsKey("fn"))
        {
            var name = Text(cond["fn"]);
            if (!Fn.TryGetValue(name, out var f)) throw new InvalidOperationException($"rules.json names an unknown helper: {name}");
            var v = f.Run(profile, cond["arg"]);
            if (cond.ContainsKey("gte")) return IsNumber(v) && ToNumber(v) >= ToNumber(cond["gte"]);
            // `truthy` defaults to true; a value that is not a boolean never equals one.
            return cond["truthy"] is not { } want ? !IsEmpty(v) : IsBool(want, out var w) && w == !IsEmpty(v);
        }
        var path = cond["path"] is { } p && IsString(p) ? p.GetValue<string>() : throw new InvalidOperationException($"a condition has no path: {cond.ToJsonString()}");
        var defined = TryAt(profile, path, out var value);
        return Compare(defined, value, cond);
    }

    /// <summary>The first test the condition names decides; with none, the value must be non-empty.</summary>
    private static bool Compare(bool defined, JsonNode? v, JsonObject c)
    {
        if (c.ContainsKey("empty")) return IsBool(c["empty"], out var empty) && empty == IsEmpty(v);
        if (c.ContainsKey("truthy")) return IsBool(c["truthy"], out var truthy) && truthy == !IsEmpty(v);
        if (c.ContainsKey("eq")) return StrictEquals(defined, v, c["eq"]);
        if (c.ContainsKey("gte")) return IsNumber(v) && ToNumber(v) >= ToNumber(c["gte"]);
        if (c.ContainsKey("gt")) return IsNumber(v) && ToNumber(v) > ToNumber(c["gt"]);
        if (c.ContainsKey("lt")) return IsNumber(v) && ToNumber(v) < ToNumber(c["lt"]);
        if (c.ContainsKey("includes")) return v is JsonArray a && a.Any(x => SameValueZero(x, c["includes"]));
        if (c.ContainsKey("includesAny")) return v is JsonArray b && Required(c, "includesAny").Any(x => b.Any(y => SameValueZero(y, x)));
        if (c.ContainsKey("hasKey")) return v is JsonObject or JsonArray && HasKey(v, Text(c["hasKey"]));
        if (c.ContainsKey("hasAnyKey")) return v is JsonObject or JsonArray && Required(c, "hasAnyKey").Any(k => HasKey(v, Text(k)));
        return !IsEmpty(v);
    }

    /// <summary>The profile paths a condition reads — what a correction can hold back.</summary>
    public static IReadOnlyList<string> FactsOf(JsonNode condition)
    {
        var cond = Condition(condition);
        if (cond.ContainsKey("all")) return Required(cond, "all").SelectMany(c => FactsOf(c!)).ToList();
        if (cond.ContainsKey("any")) return Required(cond, "any").SelectMany(c => FactsOf(c!)).ToList();
        if (cond.ContainsKey("not")) return FactsOf(cond["not"]!);
        if (cond.ContainsKey("fn")) return Fn.TryGetValue(Text(cond["fn"]), out var f) ? f.Facts : [];
        var path = Show(cond, "path");
        if (Truthy(cond["hasKey"])) return [$"{path}.{Text(cond["hasKey"])}"];
        if (Truthy(cond["hasAnyKey"])) return Required(cond, "hasAnyKey").Select(k => $"{path}.{Text(k)}").ToList();
        return [path];
    }

    /// <summary>A correction on <c>tests</c> holds back a rule on <c>tests.frameworks</c>, and one on <c>tests.frameworks</c> holds back a rule on <c>tests</c>.</summary>
    internal static bool Touches(string fact, string correction) =>
        fact == correction || fact.StartsWith(correction + ".", StringComparison.Ordinal) || correction.StartsWith(fact + ".", StringComparison.Ordinal);

    private static JsonObject Condition(JsonNode? node) =>
        node as JsonObject ?? throw new InvalidOperationException($"a condition must be an object: {node?.ToJsonString() ?? "null"}");

    private static JsonArray Required(JsonObject o, string key) =>
        o[key] as JsonArray ?? throw new InvalidOperationException($"\"{key}\" must be an array: {o.ToJsonString()}");

    // ── the context the Hebrew texts are filled from ───────────────────

    private static readonly HashSet<string> FormatterPick = ["@biomejs/biome", "biome", "prettier", "ruff", "black", "spotless", "ktlint", "golangci-lint", "rustfmt/clippy (toolchain pinned)", "php-cs-fixer", "spring-javaformat", "terraform_fmt", "eslint"];
    private static readonly HashSet<string> BuildFiles = ["pom.xml", "build.gradle", "build.gradle.kts", "Cargo.toml", "package.json"];

    /// <summary>
    /// The context the rule texts are filled from, as raw values: numbers, text, lists and objects — what a param
    /// <c>{"$ctx": "name"}</c> takes. A value the profile does not have is JSON null.
    /// </summary>
    public static Dictionary<string, JsonNode?> RawContext(JsonObject d)
    {
        var g = Obj(d, "git");
        var hot = HotMultiAuthor(d);
        var sh = Shapes(d);
        var dep = DepBumpShape(d);
        var i18n = Arr(g, "hot_dirs").FirstOrDefault(h => I18nDir().IsMatch(Show(h, "dir")));
        var secrets = Obj(d, "secrets");
        var secOut = Arr(secrets, "files").Select(f => Str(f, "path")).Where(p => !LooksLikeTest(p)).ToList();
        var ai = Obj(d, "ai_config");
        var aiFiles = Strs(ai, "files");
        var aiMd = aiFiles.Where(f => (f.EndsWith("AGENTS.md", StringComparison.Ordinal) || f.EndsWith("CLAUDE.md", StringComparison.Ordinal)) && !f.Contains('/')).ToList();
        var pairs = Arr(g, "cochange_pairs");
        var tfPair = pairs.FirstOrDefault(p => Str(p, "a").Contains("variables.tf", StringComparison.Ordinal) || Str(p, "b").Contains("variables.tf", StringComparison.Ordinal));
        var bp = pairs.FirstOrDefault(p => BuildFiles.Contains(Base(Str(p, "a"))) && BuildFiles.Contains(Base(Str(p, "b"))));
        var build = Obj(d, "build");
        var commands = Strs(build, "commands");
        var tfms = Keys(Obj(build, "dotnet_target_frameworks")).ToList();
        var ci = Obj(d, "ci");
        var ciCommands = Strs(ci, "commands");
        var tests = Obj(d, "tests");
        var testFrameworks = Strs(tests, "frameworks");
        var testDirs = TestDirNodes(tests);
        var testCmd = ciCommands.FirstOrDefault(c => TestCommand().IsMatch(c)) ?? FirstOr(Arr(tests, "frameworks"), "-");
        var lint = Strs(d, "lint_format");
        var formatter = lint.FirstOrDefault(l => FormatterPick.Contains(l)) ?? FirstOr(Arr(d, "lint_format"), "-");
        var docs = Obj(d, "docs");
        var docPointer = FirstOr(Arr(docs, "architecture_docs"), Truthy(Get(docs, "docs_files")) ? "docs/" : ShowOr(docs, "readme", "README"));
        var env = Obj(d, "environment");
        var envKind = string.Join(", ", new[]
        {
            Truthy(Get(env, "devcontainer")) ? "devcontainer" : null,
            Arr(env, "dockerfile").Count > 0 ? "Dockerfile" : null,
            Arr(env, "docker_compose").Count > 0 ? "compose" : null,
        }.OfType<string>());
        var ext = Obj(d, "external_systems");
        string[] Present(params string[] names) => names.Where(ext.ContainsKey).ToArray();
        var buildSystems = Strs(build, "system").Where(BuildSystems.Contains).ToList();
        var genList = GenDirs(d);
        var frameworks = Strs(d, "frameworks");
        var mobile = frameworks.Where(f => f is "android" or "flutter/dart" or "jetpack-compose" or "react-native (sub-package)").ToList();
        var pcfAreas = frameworks.Contains("PowerApps PCF control")
            ? new JsonArray(
                new JsonObject { ["dir"] = "Pcf", ["toolchain"] = "node", ["command"] = "npm run build" },
                new JsonObject { ["dir"] = "CrmEntryPoints", ["toolchain"] = "msbuild", ["command"] = FirstOr(Arr(build, "commands"), "msbuild") })
            : [];
        var mono = Obj(d, "monorepo");
        var sensitive = Strs(secrets, "sensitive_files");
        var wb = Obj(d, "windows_build");

        return new()
        {
            ["gen_dirs"] = Or(Join(genList), "-"), ["gen_dirs_arr"] = JsonList(genList),
            ["test_files"] = Raw(tests, "test_files"), ["test_frameworks"] = Or(Join(Texts(tests, "frameworks").Take(3)), "-"), ["test_frameworks_arr"] = RawList(tests, "frameworks"),
            ["test_cmd"] = testCmd, ["test_dirs"] = Or(Join(TestDirTexts(tests)), "-"), ["test_dirs_arr"] = new JsonArray(testDirs.Select(t => t?.DeepClone()).ToArray()),
            ["ci_systems"] = Join(Texts(ci, "systems")), ["ci_systems_arr"] = RawList(ci, "systems"),
            ["ci_n"] = Raw(ci, "workflow_count") ?? Arr(ci, "workflows").Count,
            ["ci_cmds"] = string.Join("; ", ciCommands.Take(3)), ["ci_cmds_arr"] = RawList(ci, "commands", 10),
            ["mono_ws"] = Or(string.Join("; ", Texts(mono, "workspaces").Take(2)), "workspace"), ["mono_n"] = Raw(mono, "package_count") ?? "?",
            ["mono_packages_arr"] = RawList(mono, "packages", 40),
            ["hot_dir"] = Raw(hot, "dir") ?? "-", ["hot_changes"] = Raw(hot, "changes") ?? 0, ["hot_authors"] = Raw(hot, "authors") ?? 0,
            ["shape_n"] = sh.Count,
            ["shape_example"] = sh.Count > 0 ? $"{string.Join(" + ", Strs(sh[0], "files").Take(4).Select(Base))} ({Show(sh[0], "times")}x)" : "-",
            ["shapes_arr"] = new JsonArray(sh.Take(5).ToArray<JsonNode?>()),
            ["sec_outside"] = Raw(secrets, "outside_tests"), ["sec_total"] = Raw(secrets, "total"), ["sec_kinds"] = Join(Keys(Obj(secrets, "by_kind"))),
            ["sec_files_outside"] = Join(secOut.Take(3)), ["sec_files_outside_arr"] = JsonList(secOut.Take(25)),
            ["sens_n"] = sensitive.Count, ["sens_sample"] = Join(sensitive.Take(3).Select(Base)), ["sens_files_arr"] = RawList(secrets, "sensitive_files"),
            ["sln_n"] = Raw(wb, "sln"), ["snk_n"] = Raw(wb, "snk"), ["tfm"] = Or(Join(tfms.Take(2)), "-"),
            ["sln_first"] = commands.FirstOrDefault(c => c.Contains("msbuild ", StringComparison.Ordinal)) is { } msbuild ? SolutionOf().Replace(msbuild, "$1", 1) : "",
            ["dv_n"] = Raw(Get(ext, "Dataverse/Dynamics 365"), "count") ?? 0,
            ["db_kinds"] = Join(Present("PostgreSQL", "MySQL/MariaDB", "SQL Server")),
            ["compose"] = Arr(env, "docker_compose").Count > 0 ? "compose present" : "no compose - skip the MCP",
            ["cloud"] = Join(Present("AWS SDK", "Azure SDK", "GCP SDK")),
            ["ai_kinds"] = Join(Strs(ai, "kinds").Where(k => k is "cursor" or "clinerules" or "copilot" or "windsurf" or "kiro")), ["ai_n"] = Raw(ai, "count"),
            ["ai_files"] = Or(Join(aiMd), Join(Texts(ai, "files").Take(2))), ["ai_files_arr"] = RawList(ai, "files", 20), ["ai_md_arr"] = JsonList(aiMd),
            ["ai_missing"] = "build/test commands, generated paths, external systems - whichever the file lacks",
            ["build_cmd"] = Or(string.Join("; ", commands.Take(2)), "(none inferable)"), ["build_cmd_raw"] = FirstCommand(build) ?? "",
            ["lint"] = Or(Join(Texts(d, "lint_format").Take(4)), "-"), ["lint_arr"] = RawList(d, "lint_format"), ["formatter"] = formatter,
            ["nb_n"] = LangFiles(d, "Jupyter"),
            ["tf_n"] = LangFiles(d, "HCL/Terraform"), ["tf_lint"] = Join(lint.Where(l => l.StartsWith("terraform", StringComparison.Ordinal) || l.StartsWith("tflint", StringComparison.Ordinal))),
            ["tf_pair"] = Raw(tfPair, "times") ?? 0,
            ["doc_pointer"] = docPointer, ["readme_kb"] = Round(Num(docs, "readme_bytes") / 102.4) / 10, ["docs_files"] = Raw(docs, "docs_files"),
            ["arch"] = Or(Join(Texts(docs, "architecture_docs").Take(2)), "none"),
            ["env_kind"] = envKind,
            ["php_files"] = LangFiles(d, "PHP"), ["i18n_dir"] = Raw(i18n, "dir") ?? "-", ["i18n_changes"] = Raw(i18n, "changes") ?? 0,
            ["bin_n"] = Raw(g, "tracked_binaries_dll_exe_pdb") ?? 0, ["pkg_n"] = Raw(g, "tracked_package_dirs") ?? 0, ["ide_n"] = Raw(g, "tracked_ide_junk") ?? 0,
            ["screenshot"] = Or(Join(testFrameworks.Where(t => t.Contains("screenshot", StringComparison.Ordinal))), "none found"),
            ["mobile"] = Join(mobile),
            ["build_systems"] = string.Join(" + ", buildSystems), ["build_pair_times"] = Raw(bp, "times") ?? 0,
            ["authors"] = Raw(g, "authors_in_clone") ?? 0, ["contrib"] = Or(Join(Texts(docs, "contributing")), "no CONTRIBUTING"), ["contrib_arr"] = RawList(docs, "contributing"),
            ["llm"] = Join(Present("OpenAI API", "Anthropic API")),
            ["dep_files"] = dep is null ? "-" : $"{Base(Str(dep, "a"))} + {Base(Str(dep, "b"))}", ["dep_times"] = Raw(dep, "times") ?? 0,
            ["containers"] = Join(Present("PostgreSQL", "Redis", "RabbitMQ/AMQP")),
            ["top_langs_arr"] = new JsonArray(Arr(d, "languages").Take(3).Select(l => Raw(l, "language")).ToArray()),
            ["pcf_areas_arr"] = pcfAreas,
        };
    }

    /// <summary>The context, each value already turned to text the way JavaScript's String() would.</summary>
    public static Dictionary<string, string> Context(JsonObject profile) => RawContext(profile).ToDictionary(kv => kv.Key, kv => Text(kv.Value));

    /// <summary><c>{name}</c> → the context's value; an unknown name stays visible, never silently blank.</summary>
    public static string Fill(string text, IReadOnlyDictionary<string, string> context) =>
        Placeholder().Replace(text, m => context.TryGetValue(m.Groups[1].Value, out var v) ? v : m.Value);

    /// <summary>A param <c>{"$ctx": name}</c> takes the raw value; text (alone or in a list) is filled; anything else is kept.</summary>
    private static JsonObject FillParams(JsonObject parameters, Dictionary<string, JsonNode?> raw, Dictionary<string, string> context)
    {
        var filled = new JsonObject();
        foreach (var (k, v) in Entries(parameters))
        {
            if (v is JsonObject o && o.ContainsKey("$ctx")) filled[k] = raw.TryGetValue(Text(o["$ctx"]), out var r) ? r?.DeepClone() : null;
            else if (IsString(v)) filled[k] = Fill(v!.GetValue<string>(), context);
            else if (v is JsonArray a) filled[k] = new JsonArray(a.Select(x => IsString(x) ? Fill(x!.GetValue<string>(), context) : x?.DeepClone()).ToArray());
            else filled[k] = v?.DeepClone();
        }
        return filled;
    }

    // ── applying the rules ─────────────────────────────────────────────

    public static RulesOutcome Apply(JsonObject profile, IReadOnlyList<JsonObject> rules) => Apply(profile, [], rules);

    public static RulesOutcome Apply(JsonObject profile, IReadOnlyList<ProfileCorrection> corrections, IReadOnlyList<JsonObject> rules)
    {
        var raw = RawContext(profile);
        var ctx = raw.ToDictionary(kv => kv.Key, kv => Text(kv.Value));
        var fired = new List<RuleFiring>();
        var suppressed = new List<RuleSuppression>();
        foreach (var r in rules)
        {
            var id = Str(r, "id");
            var facts = FactsOf(r["when"]!);
            var hit = corrections.FirstOrDefault(c => facts.Any(f => Touches(f, c.Path)));
            if (hit is not null) { suppressed.Add(new(id, hit.Path, hit.Note)); continue; }
            bool ok;
            try { ok = Evaluate(r["when"]!, profile); }
            catch (Exception e) { throw new InvalidOperationException($"rule {Show(r, "id")}: {e.Message}", e); }
            if (!ok) continue;
            var reason = Fill(Str(r, "reason_he"), ctx);
            fired.Add(new(id, Str(r, "signal"), reason, Arr(r, "components").OfType<JsonObject>().Select(c =>
            {
                var notRecommended = Truthy(c["notRecommended"]);
                return new ComponentSeed
                {
                    Key = Str(c, "key"), Kind = Str(c, "kind"), Family = Str(c, "family"), Risk = Str(c, "risk"), Source = "rule", SourceRef = id,
                    TitleHe = Fill(Str(c, "title_he"), ctx), WhatHe = Fill(Str(c, "what_he"), ctx),
                    WhyHe = notRecommended ? Fill(Str(c, "what_he"), ctx) : reason, VerifyHowHe = Fill(Str(c, "verify_he"), ctx),
                    Params = FillParams(Obj(c, "params"), raw, ctx), NotRecommended = notRecommended,
                };
            }).ToList()));
        }
        return new(fired, suppressed, rules.Count);
    }

    /// <summary>
    /// The firings as the old server stored them on the plan step (<c>firings</c>, which the screen reads): rule, signal,
    /// reason_he and each component seed under its old name, <c>notRecommended</c> only when it is set.
    /// </summary>
    public static JsonArray FiringsJson(IEnumerable<RuleFiring> fired) => new(fired.Select(f => (JsonNode?)new JsonObject
    {
        ["rule"] = f.Rule, ["signal"] = f.Signal, ["reason_he"] = f.ReasonHe,
        ["components"] = new JsonArray(f.Components.Select(c =>
        {
            var seed = new JsonObject
            {
                ["key"] = c.Key, ["kind"] = c.Kind, ["family"] = c.Family, ["risk"] = c.Risk, ["source"] = c.Source, ["sourceRef"] = c.SourceRef,
                ["title_he"] = c.TitleHe, ["what_he"] = c.WhatHe, ["why_he"] = c.WhyHe, ["verifyHow_he"] = c.VerifyHowHe, ["params"] = c.Params.DeepClone(),
            };
            if (c.NotRecommended) seed["notRecommended"] = true;
            return (JsonNode?)seed;
        }).ToArray()),
    }).ToArray());

    /// <summary>The stack tags the open marketplace search is keyed by — derived, never a fixed list.</summary>
    public static List<string> StackTags(JsonObject profile)
    {
        var tags = new List<string>();
        void Add(string t) { if (t.Length > 0 && !tags.Contains(t)) tags.Add(t); }
        // What the search is really for comes first: the systems the code talks to, then the frameworks, then how it is built.
        foreach (var k in Keys(Obj(profile, "external_systems"))) Add(Norm(k));
        foreach (var f in Strs(profile, "frameworks")) Add(Norm(f));
        foreach (var pm in Strs(profile, "package_managers")) Add(Norm(pm));
        foreach (var s in Strs(Obj(profile, "ci"), "systems")) Add(Norm(s));
        foreach (var l in Arr(profile, "languages").Take(3)) Add(Norm(Str(l, "language")));
        return tags.Where(t => t is not ("json" or "yaml" or "xml" or "markdown" or "html" or "css" or "shell" or "docker" or "oauth-oidc-identity")).Take(16).ToList();
    }

    /// <summary>
    /// A name as a tag. JavaScript's toLowerCase maps İ (U+0130) to "i" + U+0307, which then turns into "i-";
    /// ToLowerInvariant leaves it as it is, and the tag would lose the "i".
    /// </summary>
    private static string Norm(string s) =>
        EdgeDashes().Replace(NotTagChars().Replace(ParenTail().Replace(s.Replace("\u0130", "i\u0307", StringComparison.Ordinal).ToLowerInvariant(), "", 1), "-"), "");

    // ── shared with the profile's own lines ────────────────────────────

    /// <summary>A command without its trailing <c># comment</c>.</summary>
    internal static string WithoutComment(string command) => CommentTail().Replace(command, "", 1);

    /// <summary>The first build command without its comment, or null when there is none.</summary>
    internal static string? FirstCommand(JsonObject build) => Arr(build, "commands") is [{ } first, ..] ? WithoutComment(Text(first)) : null;

    /// <summary>A secret found in a test, a spec, a fixture or a snapshot is a fake one.</summary>
    internal static bool LooksLikeTest(string path) => TestLikePath().IsMatch(path);

    /// <summary>The folder of each <c>[folder, count]</c> in tests.test_dirs.</summary>
    internal static List<JsonNode?> TestDirNodes(JsonObject tests) =>
        Arr(tests, "test_dirs").Select(t => t is JsonArray { Count: > 0 } pair ? pair[0] : null).ToList();

    /// <summary>The same folders as <c>.map(String)</c> writes them: a pair without a folder is "undefined".</summary>
    internal static List<string> TestDirTexts(JsonObject tests) =>
        Arr(tests, "test_dirs").Select(t => t is JsonArray { Count: > 0 } pair ? Text(pair[0]) : "undefined").ToList();

    private static JsonArray JsonList(IEnumerable<string> xs) => new(xs.Select(x => (JsonNode?)x).ToArray());

    private static string Join(IEnumerable<string> xs) => string.Join(", ", xs);

    private static JsonNode? Raw(JsonNode? node, string key) => Get(node, key)?.DeepClone();

    /// <summary>A copy of a profile list as it is (at most <paramref name="max"/> of it) — what a param receives untouched.</summary>
    private static JsonArray RawList(JsonNode? node, string key, int max = int.MaxValue) => new(Arr(node, key).Take(max).Select(x => x?.DeepClone()).ToArray());

    // The regular expressions keep JavaScript's meaning: `\z` where the old one said `$` (the very end, not "before a
    // final newline"), explicit ASCII word characters where it said `\b`, and JavaScript's own whitespace and `.` where
    // it said `\s`, `\S` and `.` — .NET's `\s` also takes U+0085 and not U+FEFF, and its `.` also takes \r, so a
    // command ending in \r (a CRLF file) would lose its `# comment` here and keep it there.
    private const string JsSpace = @"[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]";
    private const string JsNotSpace = @"[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]";
    private const string JsDot = @"[^\n\r\u2028\u2029]";
    [GeneratedRegex(JsSpace + "+#" + JsDot + @"*\z")] private static partial Regex CommentTail();
    [GeneratedRegex("(test|spec|fixture|snapshot)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex TestLikePath();
    [GeneratedRegex(@"(?:^|/)(?:po|locale|locales|i18n|lang|translations?)\z")] private static partial Regex I18nDir();
    [GeneratedRegex("(?<![A-Za-z0-9_])(?:test|verify|pytest|phpunit|vitest|jest)(?![A-Za-z0-9_])")] private static partial Regex TestCommand();
    [GeneratedRegex("^msbuild" + JsSpace + "+(" + JsNotSpace + "+)" + JsDot + @"*\z")] private static partial Regex SolutionOf();
    [GeneratedRegex(@"(go\.mod|go\.sum|package\.json|pnpm-lock|yarn\.lock|uv\.lock|Cargo\.lock|Cargo\.toml|composer\.lock|libs\.versions\.toml|Directory\.Packages\.props|pyproject\.toml|\.csproj\z|build\.gradle)")] private static partial Regex DepFiles();
    [GeneratedRegex(@"\{([a-z_0-9]+)\}")] private static partial Regex Placeholder();
    [GeneratedRegex(JsSpace + @"*\(" + JsDot + @"*\)\z")] private static partial Regex ParenTail();
    [GeneratedRegex("[^a-z0-9#+.]+")] private static partial Regex NotTagChars();
    [GeneratedRegex(@"^-|-\z")] private static partial Regex EdgeDashes();
}

/// <summary>
/// Reading the repository profile the way the old server's JavaScript read it. The profile is data a script wrote
/// (snake_case JSON, read by dotted path), and the texts and rules built on it were tuned against JavaScript: what is
/// empty, what is truthy, how a number prints, in which order an object's keys come. A field the profile lacks reads as
/// empty or zero here instead of throwing.
/// </summary>
internal static class ProfileJson
{
    public static JsonNode? Get(JsonNode? node, string key) => (node as JsonObject)?[key];

    public static JsonObject Obj(JsonNode? node, string key) => Get(node, key) as JsonObject ?? [];

    public static JsonArray Arr(JsonNode? node, string key) => Get(node, key) as JsonArray ?? [];

    /// <summary>A text field; missing or null reads as "".</summary>
    public static string Str(JsonNode? node, string key) => Item(Get(node, key));

    /// <summary>The elements as <c>.map(String)</c> writes them (null is "null").</summary>
    public static List<string> Texts(JsonNode? node, string key) => Arr(node, key).Select(Text).ToList();

    /// <summary>The elements as <c>Array.prototype.join</c> writes them (null is "").</summary>
    public static List<string> Strs(JsonNode? node, string key) => Arr(node, key).Select(Item).ToList();

    /// <summary><c>`${node.key}`</c>: a missing field prints "undefined", null prints "null".</summary>
    public static string Show(JsonNode? node, string key) => node is JsonObject o && o.TryGetPropertyValue(key, out var v) ? Text(v) : "undefined";

    /// <summary><c>`${node.key ?? fallback}`</c>.</summary>
    public static string ShowOr(JsonNode? node, string key, string fallback) => Get(node, key) is { } v ? Text(v) : fallback;

    /// <summary><c>Number(node.key)</c>: a missing field is NaN (every comparison with it is false), null is 0.</summary>
    public static double Num(JsonNode? node, string key) => node is JsonObject o && o.TryGetPropertyValue(key, out var v) ? ToNumber(v) : double.NaN;

    /// <summary><c>node.key ?? fallback</c>, as a number.</summary>
    public static double NumOr(JsonNode? node, string key, double fallback) => Get(node, key) is { } v ? ToNumber(v) : fallback;

    /// <summary><c>`${xs[0] ?? fallback}`</c>.</summary>
    public static string FirstOr(JsonArray xs, string fallback) => xs is [{ } first, ..] ? Text(first) : fallback;

    /// <summary>An array element as <c>Array.prototype.join</c> writes it: null is "".</summary>
    public static string Item(JsonNode? node) => node is null ? "" : Text(node);

    /// <summary>JavaScript's <c>String(value)</c>.</summary>
    public static string Text(JsonNode? node) => node switch
    {
        null => "null",
        JsonArray a => string.Join(",", a.Select(Item)),
        JsonObject => "[object Object]",
        JsonValue v => v.GetValueKind() switch
        {
            JsonValueKind.String => v.GetValue<string>(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Number => Number(ToNumber(v)),
            _ => v.ToJsonString(),
        },
        _ => node.ToJsonString(),
    };

    /// <summary>JavaScript's <c>String(number)</c> for the magnitudes a profile holds: integers in full, fractions shortest round-trip.</summary>
    public static string Number(double d)
    {
        if (double.IsNaN(d)) return "NaN";
        if (double.IsInfinity(d)) return d > 0 ? "Infinity" : "-Infinity";
        if (d == 0) return "0";
        return Math.Abs(d) < 1e21 && d == Math.Floor(d) ? d.ToString("F0", CultureInfo.InvariantCulture) : d.ToString("R", CultureInfo.InvariantCulture);
    }

    /// <summary><c>x.toLocaleString("en-US")</c>: thousands separated by commas, at most three decimals.</summary>
    public static string Grouped(double d) => d.ToString("#,##0.###", CultureInfo.InvariantCulture);

    /// <summary><c>Math.round</c>: halves go up (toward +∞), unlike Math.Round's default.</summary>
    public static double Round(double x)
    {
        var f = Math.Floor(x);
        return x - f >= 0.5 ? f + 1 : f;
    }

    /// <summary>JavaScript's <c>Number(value)</c> for JSON values: null is 0, a boolean 0 or 1, text is parsed, a list or an object is NaN.</summary>
    public static double ToNumber(JsonNode? node) => node switch
    {
        null => 0,
        JsonValue v => v.GetValueKind() switch
        {
            JsonValueKind.Number => v.TryGetValue(out double d) ? d : double.Parse(v.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture),
            JsonValueKind.True => 1,
            JsonValueKind.False => 0,
            JsonValueKind.String => ParseNumber(v.GetValue<string>()),
            _ => double.NaN,
        },
        _ => double.NaN,
    };

    private static double ParseNumber(string text)
    {
        var s = text.Trim();
        return s.Length == 0 ? 0 : double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : double.NaN;
    }

    public static bool IsNumber(JsonNode? node) => node is JsonValue v && v.GetValueKind() == JsonValueKind.Number;

    public static bool IsString(JsonNode? node) => node is JsonValue v && v.GetValueKind() == JsonValueKind.String;

    public static bool IsString(JsonNode? node, string value) => IsString(node) && node!.GetValue<string>() == value;

    public static bool IsBool(JsonNode? node, out bool value)
    {
        var kind = (node as JsonValue)?.GetValueKind();
        value = kind == JsonValueKind.True;
        return kind is JsonValueKind.True or JsonValueKind.False;
    }

    /// <summary>JavaScript truthiness: false, 0, NaN, "" and null are falsy; every list and object is truthy, even an empty one.</summary>
    public static bool Truthy(JsonNode? node) => node switch
    {
        null => false,
        JsonValue v => v.GetValueKind() switch
        {
            JsonValueKind.False => false,
            JsonValueKind.Number => ToNumber(v) is var d && d != 0 && !double.IsNaN(d),
            JsonValueKind.String => v.GetValue<string>().Length > 0,
            _ => true,
        },
        _ => true,
    };

    /// <summary>The rules' "empty": null, false, 0, "", an empty list or an object without keys. NaN is not empty.</summary>
    public static bool IsEmpty(JsonNode? node) => node switch
    {
        null => true,
        JsonArray a => a.Count == 0,
        JsonObject o => o.Count == 0,
        JsonValue v => v.GetValueKind() switch
        {
            JsonValueKind.False => true,
            JsonValueKind.Number => ToNumber(v) == 0,
            JsonValueKind.String => v.GetValue<string>().Length == 0,
            _ => false,
        },
        _ => false,
    };

    /// <summary>
    /// The value at a dotted path, as JavaScript walks it: a list answers to an index and to <c>length</c>; anything
    /// that is not an object or a list ends the walk. False when the value is undefined (missing), as against null.
    /// </summary>
    public static bool TryAt(JsonNode? root, string dotted, out JsonNode? value)
    {
        value = root;
        foreach (var part in dotted.Split('.'))
        {
            switch (value)
            {
                case JsonObject o when o.TryGetPropertyValue(part, out var next):
                    value = next;
                    break;
                case JsonArray a when part == "length":
                    value = a.Count;
                    break;
                case JsonArray a when IsIndex(part, out var i) && i < a.Count:
                    value = a[(int)i];
                    break;
                default:
                    value = null;
                    return false;
            }
        }
        return true;
    }

    /// <summary><c>key in value</c> for an object or a list.</summary>
    public static bool HasKey(JsonNode? node, string key) => node switch
    {
        JsonObject o => o.ContainsKey(key),
        JsonArray a => key == "length" || (IsIndex(key, out var i) && i < a.Count),
        _ => false,
    };

    /// <summary><c>a === b</c> between a value read from the profile (possibly undefined) and one written in the rules.</summary>
    public static bool StrictEquals(bool defined, JsonNode? a, JsonNode? b) => b is null ? defined && a is null : SameValueZero(a, b) && !(IsNumber(a) && double.IsNaN(ToNumber(a)));

    /// <summary>
    /// <c>Array.prototype.includes</c>' equality: primitives by value, NaN equal to itself, two objects never (they are
    /// never the same object across two JSON trees).
    /// </summary>
    public static bool SameValueZero(JsonNode? a, JsonNode? b)
    {
        if (a is null || b is null) return a is null && b is null;
        if (a is not JsonValue x || b is not JsonValue y) return false;
        var kind = x.GetValueKind();
        if (kind != y.GetValueKind()) return false;
        return kind switch
        {
            JsonValueKind.String => x.GetValue<string>() == y.GetValue<string>(),
            JsonValueKind.Number => ToNumber(x) is var p && ToNumber(y) is var q && (p == q || (double.IsNaN(p) && double.IsNaN(q))),
            _ => true,
        };
    }

    /// <summary>An object's keys in JavaScript's order: integer-like keys first, ascending, then the rest as written.</summary>
    public static IEnumerable<string> Keys(JsonObject o) => Entries(o).Select(e => e.Key);

    /// <summary>An object's entries in JavaScript's order (see <see cref="Keys"/>).</summary>
    public static IEnumerable<KeyValuePair<string, JsonNode?>> Entries(JsonObject o) =>
        o.Where(e => IsIndex(e.Key, out _)).OrderBy(e => IsIndex(e.Key, out var i) ? i : 0).Concat(o.Where(e => !IsIndex(e.Key, out _)));

    /// <summary>A canonical array index ("0", "17" — not "017" or "-1").</summary>
    private static bool IsIndex(string key, out uint index)
    {
        index = 0;
        return key.Length > 0 && (key == "0" || (key[0] != '0' && key.All(char.IsAsciiDigit))) && uint.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out index) && index < uint.MaxValue;
    }

    /// <summary>The last segment of a '/' path.</summary>
    public static string Base(string path) => path[(path.LastIndexOf('/') + 1)..];

    /// <summary><c>a || b</c> between two texts.</summary>
    public static string Or(string s, string fallback) => s.Length > 0 ? s : fallback;
}
