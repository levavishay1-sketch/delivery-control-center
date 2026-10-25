using System.Globalization;
using System.Text.Json.Nodes;
using static Dcc.Domain.Onboarding.ProfileJson;

namespace Dcc.Domain.Onboarding;

/// <summary>
/// The profile as a person reads it (repo-onboarding/profile.ts): the facts of the diagnosis as a list of lines, each
/// with the dotted path a correction ("זה לא נכון") is recorded against, and a one-paragraph summary the prompts hand to
/// the model. Pure.
/// </summary>
public static class OnboardingProfile
{
    public static List<ProfileFact> Facts(JsonObject profile) => Facts(profile, []);

    /// <summary>
    /// One line per fact, in the order the screen shows them. A line is "corrected" when a correction names it, a part
    /// of it, or something it is part of. Tone: warn — something the plan will have to work around; bad — something
    /// the owner must know.
    /// </summary>
    public static List<ProfileFact> Facts(JsonObject profile, IReadOnlyList<ProfileCorrection> corrections)
    {
        var d = profile;
        ProfileFact F(string path, string concept, string label, string value, string tone = "plain") =>
            new(path, concept, label, value, tone, corrections.Any(c => Rules.Touches(path, c.Path)));
        var facts = new List<ProfileFact>();

        facts.Add(F("languages", "profile_languages", "שפות", Or(string.Join(" · ", Arr(d, "languages").Take(5).Select(l =>
            $"{Show(l, "language")} ({Grouped(Num(l, "files"))} קבצים{(Truthy(Get(l, "lines")) ? $", {Grouped(Num(l, "lines"))} שורות" : "")})")), "—")));
        facts.Add(F("frameworks", "profile_frameworks", "מסגרות וספריות", ListOf(Texts(d, "frameworks"), 8)));

        var build = Obj(d, "build");
        var commands = Strs(build, "commands");
        var wb = Obj(d, "windows_build");
        var windowsOnly = Truthy(Get(wb, "windows_only_build"));
        facts.Add(F("build", "profile_build", "build",
            commands.Count > 0 ? string.Join(" · ", commands.Select(Rules.WithoutComment))
                : Arr(build, "system").Count > 0 ? $"{ListOf(Texts(build, "system"))} — לא נמצאה פקודה" : "לא זוהתה מערכת build",
            windowsOnly ? "warn" : commands.Count > 0 ? "plain" : "warn"));
        if (windowsOnly)
            facts.Add(F("windows_build.windows_only_build", "profile_windows_only", "build רק ב-Windows",
                $"{Show(wb, "sln")} .sln · {Show(wb, "csproj")} csproj · {Show(wb, "snk")} .snk · {Or(string.Join(", ", Keys(Obj(build, "dotnet_target_frameworks")).Take(2)), "msbuild")}", "warn"));

        var tests = Obj(d, "tests");
        var testFrameworks = Texts(tests, "frameworks");
        var testDirs = Rules.TestDirTexts(tests);
        facts.Add(F("tests", "profile_tests", "בדיקות",
            testFrameworks.Count > 0
                ? $"{ListOf(testFrameworks, 3)} · {Grouped(Num(tests, "test_files"))} קובצי בדיקה{(testDirs.Count > 0 ? $" ב-{ListOf(testDirs, 3)}" : "")}"
                : $"לא נמצאה מסגרת בדיקות ({Grouped(Num(tests, "test_files"))} קבצים שנראים כמו בדיקות)",
            testFrameworks.Count > 0 ? "plain" : "warn"));

        var lint = Texts(d, "lint_format");
        facts.Add(F("lint_format", "profile_lint", "lint ופורמט", lint.Count > 0 ? ListOf(lint, 6) : "אין", lint.Count > 0 ? "plain" : "warn"));

        var ci = Obj(d, "ci");
        var ciPresent = Truthy(Get(ci, "present"));
        var ciCommands = Texts(ci, "commands");
        facts.Add(F("ci", "profile_ci", "CI",
            ciPresent ? $"{ListOf(Texts(ci, "systems"))} · {WorkflowCount(ci)} workflows{(ciCommands.Count > 0 ? $" · מריץ: {ListOf(ciCommands, 3)}" : "")}" : "אין CI — שום דבר לא מגדיר \"ירוק\"",
            ciPresent ? "plain" : "warn"));

        var mono = Obj(d, "monorepo");
        facts.Add(F("monorepo", "profile_monorepo", "מבנה", Truthy(Get(mono, "is_monorepo"))
            ? $"ריפו רב-חבילות: {Or(string.Join("; ", Texts(mono, "workspaces").Take(2)), "workspace")} · {PackageCount(mono)} חבילות"
            : $"חבילה אחת · תיקיות ראשיות: {ListOf(Texts(Obj(d, "size"), "top_level_dirs"), 8)}"));

        var gc = Obj(d, "generated_code");
        var gen = GeneratedPaths(gc);
        var headerMarked = Get(gc, "header_marked_files");
        facts.Add(F("generated_code", "profile_generated", "קוד מג'ונרט", gen.Count > 0 || Truthy(headerMarked)
            ? $"{Or(string.Join(", ", gen.Select(p => $"{Show(p, "dir")} ({Show(p, "files")})")), "—")}{(Truthy(headerMarked) ? $" · {Text(headerMarked)} קבצים עם כותרת auto-generated" : "")}"
            : "לא נמצא"));

        var secrets = Obj(d, "secrets");
        var sensitive = Strs(secrets, "sensitive_files");
        var total = Get(secrets, "total");
        var outside = Get(secrets, "outside_tests");
        var found = Truthy(outside)
            ? $"{Text(outside)} מחרוזות בצורת סוד מחוץ לבדיקות ({ListOf(Keys(Obj(secrets, "by_kind")).ToList(), 3)}) ב-{ListOf(Arr(secrets, "files").Select(x => Str(x, "path")).Where(p => !Rules.LooksLikeTest(p)).ToList(), 3)}"
            : Truthy(total) ? $"{Text(total)} מחרוזות בצורת סוד, כולן בקובצי בדיקה (מזויפות)" : "אין מחרוזות בצורת סוד";
        facts.Add(F("secrets", "profile_secrets", "סודות", Truthy(total) || sensitive.Count > 0
            ? $"{found} · {sensitive.Count} קבצים רגישים לפי השם ({ListOf(sensitive.Select(Base).ToList(), 3)}). רק מיקום נרשם, לעולם לא הערך."
            : "לא נמצאו מחרוזות בצורת סוד ולא קבצים רגישים", Truthy(outside) ? "bad" : sensitive.Count > 0 ? "warn" : "plain"));

        var ext = Entries(Obj(d, "external_systems")).Take(8).ToList();
        facts.Add(F("external_systems", "profile_external", "מערכות חיצוניות", ext.Count > 0 ? string.Join(" · ", ext.Select(e => $"{e.Key} ({Show(e.Value, "count")})")) : "לא זוהו"));

        var ai = Obj(d, "ai_config");
        var sizes = Obj(ai, "sizes");
        facts.Add(F("ai_config", "profile_ai_config", "הגדרות AI קיימות", Truthy(Get(ai, "present"))
            ? $"{ListOf(Texts(ai, "kinds"), 5)} · {Show(ai, "count")} קבצים{(sizes.Count > 0 ? $" ({string.Join(", ", Entries(sizes).Take(3).Select(e => $"{Base(e.Key)} {Number(Round(ToNumber(e.Value) / 100) / 10)}KB"))})" : "")}"
            : "אין — הסוכן מתחיל מאפס עובדות"));

        var docs = Obj(d, "docs");
        var readmeBytes = Num(docs, "readme_bytes");
        var docsFiles = Get(docs, "docs_files");
        var arch = Texts(docs, "architecture_docs");
        var contributing = Arr(docs, "contributing");
        facts.Add(F("docs", "profile_docs", "תיעוד",
            $"{(Truthy(Get(docs, "readme")) ? $"README {Number(Round(readmeBytes / 102.4) / 10)}KB" : "אין README")} · {(Truthy(docsFiles) ? $"{Text(docsFiles)} קבצים ב-docs/" : "אין docs/")}"
            + (arch.Count > 0 ? $" · ארכיטקטורה: {ListOf(arch, 2)}" : "")
            + (contributing.Count > 0 ? $" · {Base(Item(contributing[0]))}" : "")
            + (Arr(docs, "pr_template").Count > 0 ? " · תבנית PR" : ""),
            readmeBytes < 2000 && !Truthy(docsFiles) ? "warn" : "plain"));

        var env = Obj(d, "environment");
        var envParts = new List<string?>
        {
            Truthy(Get(env, "devcontainer")) ? "devcontainer" : null,
            Arr(env, "dockerfile").Count > 0 ? "Dockerfile" : null,
            Arr(env, "docker_compose").Count > 0 ? "compose" : null,
            Truthy(Get(env, "makefile")) ? "Makefile" : null,
        };
        envParts.AddRange(Strs(env, "tool_versions").Select(Base));
        facts.Add(F("environment", "profile_environment", "סביבה", Or(string.Join(" · ", envParts.Where(p => !string.IsNullOrEmpty(p))), "לא נמצאה הגדרת סביבה")));

        var g = Obj(d, "git");
        var commits = NumOr(g, "commits_in_clone", 0);
        var hotDirs = Arr(g, "hot_dirs");
        var shapes = Arr(g, "repeated_change_shapes").Count;
        facts.Add(F("git", "profile_history", "היסטוריית git", Truthy(Get(g, "available"))
            ? $"{Grouped(commits)} commits{(Truthy(Get(g, "shallow")) ? " (עותק רדוד)" : "")} · {ShowOr(g, "authors_in_clone", "0")} מחברים · {ShowOr(g, "first_commit_date_in_clone", "?")} עד {ShowOr(g, "last_commit_date", "?")}"
              + (hotDirs.Count > 0 ? $" · נקודה חמה: {Show(hotDirs[0], "dir")} ({Show(hotDirs[0], "changes")} שינויים, {Show(hotDirs[0], "authors")} מחברים)" : "")
              + (shapes > 0 ? $" · {shapes} צורות שינוי חוזרות" : " · אין צורות שינוי חוזרות לקרוא")
            : "אין היסטוריה לקרוא", commits <= 1 ? "warn" : "plain"));
        var binaries = NumOr(g, "tracked_binaries_dll_exe_pdb", 0);
        var packages = NumOr(g, "tracked_package_dirs", 0);
        var ideJunk = NumOr(g, "tracked_ide_junk", 0);
        if (binaries > 20 || packages > 50 || ideJunk > 20)
            facts.Add(F("git.tracked_binaries_dll_exe_pdb", "profile_hygiene", "היגיינה", $"{Grouped(binaries)} dll/exe/pdb · {Grouped(packages)} קובצי package cache · {Grouped(ideJunk)} קובצי IDE בתוך git", "warn"));

        var size = Obj(d, "size");
        facts.Add(F("size", "profile_size", "גודל", $"{Grouped(Num(size, "files"))} קבצים · {Grouped(Num(size, "code_lines"))} שורות קוד · {Number(Round(Num(size, "bytes_on_disk_excl_git") / 1048576))}MB"));
        facts.Add(F("docs.license_kind", "profile_license", "רישיון", Str(docs, "license_kind") == "none" ? "אין קובץ רישיון" : Str(docs, "license_kind")));
        return facts;
    }

    /// <summary>One paragraph for the prompts — the facts, English, compact.</summary>
    public static string Summary(JsonObject profile)
    {
        var d = profile;
        var parts = new List<string>();
        parts.Add($"Languages: {Or(string.Join(", ", Arr(d, "languages").Take(4).Select(l => $"{Show(l, "language")} ({Show(l, "files")} files)")), "none detected")}.");
        var frameworks = Strs(d, "frameworks");
        if (frameworks.Count > 0) parts.Add($"Frameworks: {string.Join(", ", frameworks.Take(10))}.");

        var build = Obj(d, "build");
        var windowsOnly = Truthy(Get(Obj(d, "windows_build"), "windows_only_build"));
        parts.Add($"Build: {Or(string.Join("; ", Strs(build, "commands").Select(Rules.WithoutComment)), Or(string.Join(", ", Strs(build, "system")), "none detected"))}{(windowsOnly ? " (Windows-only: msbuild, signed assemblies)" : "")}.");

        var tests = Obj(d, "tests");
        var testFrameworks = Strs(tests, "frameworks");
        parts.Add($"Tests: {(testFrameworks.Count > 0
            ? $"{string.Join(", ", testFrameworks.Take(3))}, {Show(tests, "test_files")} test files in {Or(string.Join(", ", Rules.TestDirNodes(tests).Take(3).Select(Item)), "?")}"
            : $"no test framework ({Show(tests, "test_files")} test-like files)")}.");
        parts.Add($"Lint/format: {Or(string.Join(", ", Strs(d, "lint_format").Take(5)), "none")}.");

        var ci = Obj(d, "ci");
        parts.Add($"CI: {(Truthy(Get(ci, "present"))
            ? $"{string.Join(", ", Strs(ci, "systems"))} ({WorkflowCount(ci)} workflows) running {Or(string.Join("; ", Strs(ci, "commands").Take(4)), "?")}"
            : "none")}.");

        var mono = Obj(d, "monorepo");
        parts.Add(Truthy(Get(mono, "is_monorepo"))
            ? $"Multi-package: {string.Join("; ", Texts(mono, "workspaces").Take(2))} ({PackageCount(mono)} packages)."
            : $"Single package; top-level: {string.Join(", ", Strs(Obj(d, "size"), "top_level_dirs").Take(10))}.");

        var gc = Obj(d, "generated_code");
        var gen = GeneratedPaths(gc);
        var headerMarked = Get(gc, "header_marked_files");
        if (gen.Count > 0 || Truthy(headerMarked))
            parts.Add($"Generated code: {Or(string.Join(", ", gen.Select(p => Str(p, "dir"))), "—")}{(Truthy(headerMarked) ? $"; {Text(headerMarked)} files with auto-generated headers" : "")}.");

        var secrets = Obj(d, "secrets");
        var sensitive = Arr(secrets, "sensitive_files").Count;
        if (Truthy(Get(secrets, "total")) || sensitive > 0)
            parts.Add($"Secrets: {Show(secrets, "outside_tests")} secret-shaped strings outside tests, {Show(secrets, "in_test_files")} in tests; {sensitive} sensitive-by-name files (locations only, never values).");

        var ext = Keys(Obj(d, "external_systems")).Take(8).ToList();
        if (ext.Count > 0) parts.Add($"External systems referenced: {string.Join(", ", ext)}.");

        var ai = Obj(d, "ai_config");
        parts.Add($"AI configuration: {(Truthy(Get(ai, "present")) ? $"{string.Join(", ", Strs(ai, "kinds"))} ({Show(ai, "count")} files)" : "none")}.");

        var docs = Obj(d, "docs");
        parts.Add($"Docs: {(Truthy(Get(docs, "readme")) ? $"README {Number(Round(Num(docs, "readme_bytes") / 1024))}KB" : "no README")}, {Show(docs, "docs_files")} files in docs/, "
            + $"architecture docs: {Or(string.Join(", ", Strs(docs, "architecture_docs").Take(2)), "none")}, contributing: {FirstOr(Arr(docs, "contributing"), "none")}, PR template: {FirstOr(Arr(docs, "pr_template"), "none")}.");

        var env = Obj(d, "environment");
        var envKinds = new[]
        {
            Truthy(Get(env, "devcontainer")) ? "devcontainer" : null,
            Arr(env, "dockerfile").Count > 0 ? "Dockerfile" : null,
            Arr(env, "docker_compose").Count > 0 ? "compose" : null,
        }.OfType<string>().ToList();
        if (envKinds.Count > 0) parts.Add($"Environment: {string.Join(", ", envKinds)}.");

        var g = Obj(d, "git");
        parts.Add(Truthy(Get(g, "available"))
            ? $"History: {ShowOr(g, "commits_in_clone", "0")} commits, {ShowOr(g, "authors_in_clone", "0")} authors, {ShowOr(g, "first_commit_date_in_clone", "?")}..{ShowOr(g, "last_commit_date", "?")}; "
              + $"hot dirs: {Or(string.Join(", ", Arr(g, "hot_dirs").Take(3).Select(h => $"{Show(h, "dir")} ({Show(h, "changes")} changes/{Show(h, "authors")} authors)")), "none")}; "
              + $"repeated change shapes: {Arr(g, "repeated_change_shapes").Count}."
            : "History: not available.");

        var size = Obj(d, "size");
        parts.Add($"Size: {Show(size, "files")} files, {Show(size, "code_lines")} code lines.");
        return string.Join(" ", parts);
    }

    /// <summary>The facts a trial's judge is handed — only the ones that bear on the task.</summary>
    public static List<string> FactsForJudge(JsonObject profile)
    {
        var d = profile;
        var facts = new List<string>();
        var windowsOnly = Truthy(Get(Obj(d, "windows_build"), "windows_only_build"));
        facts.Add($"Build command: {Rules.FirstCommand(Obj(d, "build")) ?? "none detected"}{(windowsOnly ? " — it runs ONLY on Windows (msbuild); it cannot run on Linux or macOS" : "")}.");

        var tests = Obj(d, "tests");
        var testFrameworks = Strs(tests, "frameworks");
        facts.Add(testFrameworks.Count > 0
            ? $"Test framework: {string.Join(", ", testFrameworks.Take(3))}; {Show(tests, "test_files")} test files under {Or(string.Join(", ", Rules.TestDirNodes(tests).Take(3).Select(Item)), "?")}."
            : "There is NO test framework in this repository.");

        var ci = Obj(d, "ci");
        facts.Add(Truthy(Get(ci, "present")) ? $"CI: {string.Join(", ", Strs(ci, "systems"))} runs {Or(string.Join("; ", Strs(ci, "commands").Take(4)), "?")}." : "There is NO CI in this repository.");

        var lint = Strs(d, "lint_format");
        facts.Add(lint.Count > 0 ? $"Lint/format: {string.Join(", ", lint.Take(4))}." : "There is NO linter or formatter configured.");

        var mono = Obj(d, "monorepo");
        if (Truthy(Get(mono, "is_monorepo"))) facts.Add($"Multi-package repository: {PackageCount(mono)} packages ({string.Join(", ", Strs(mono, "packages").Take(8))}).");
        var managers = Strs(d, "package_managers");
        if (managers.Count > 0) facts.Add($"Package manager(s): {string.Join(", ", managers)}.");
        var gen = GeneratedPaths(Obj(d, "generated_code")).Select(p => Item(Get(p, "dir"))).ToList();
        if (gen.Count > 0) facts.Add($"Generated code lives in: {string.Join(", ", gen)} — it is not edited by hand.");
        var ext = Keys(Obj(d, "external_systems")).Take(6).ToList();
        if (ext.Count > 0) facts.Add($"External systems: {string.Join(", ", ext)} — their live schema or data is not in the repository.");
        return facts;
    }

    /// <summary>Generated paths with at least two files, the first four.</summary>
    private static List<JsonNode?> GeneratedPaths(JsonObject generatedCode) => Arr(generatedCode, "paths").Where(p => Num(p, "files") >= 2).Take(4).ToList();

    /// <summary><c>workflow_count ?? workflows.length</c>, as printed.</summary>
    private static string WorkflowCount(JsonObject ci) => ShowOr(ci, "workflow_count", Arr(ci, "workflows").Count.ToString(CultureInfo.InvariantCulture));

    /// <summary><c>package_count ?? packages.length</c>, as printed.</summary>
    private static string PackageCount(JsonObject mono) => ShowOr(mono, "package_count", Arr(mono, "packages").Count.ToString(CultureInfo.InvariantCulture));

    /// <summary>The first few, then how many more: "a, b, c ועוד 2"; "—" when there are none.</summary>
    private static string ListOf(IReadOnlyList<string> xs, int max = 4) =>
        xs.Count == 0 ? "—" : string.Join(", ", xs.Take(max)) + (xs.Count > max ? $" ועוד {xs.Count - max}" : "");
}
