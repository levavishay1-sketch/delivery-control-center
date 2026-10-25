using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Onboarding;
using Dcc.Infrastructure.Repos;

namespace Dcc.Tests.Unit.Onboarding;

/// <summary>
/// Phase 4.7: the operator catalog (catalog/index.test.ts). The catalog only reads its template files, so this renders
/// every template and then runs what it produced the way Claude Code would: each hook as a Node child process with the
/// event on stdin, exit 2 = denied. Nothing here touches the database.
/// </summary>
public sealed class CatalogTests : IDisposable
{
    private static readonly string TemplatesDir =
        Path.GetDirectoryName(Path.GetDirectoryName(OnboardingFiles.Data("catalog/templates/hooks/block-paths.mjs")))!;

    private static readonly OnboardingCatalog Catalog = new(TemplatesDir);

    private static readonly RepoFacts Repo = new("acme-shop", "npm run build", "npm test", "npm run lint", ["TypeScript", "C#"], "npm", "main", false);
    private static readonly RepoFacts Bare = new("bare", null, null, null, [], null, null, false);
    private static readonly int Executable = Convert.ToInt32("755", 8);

    /// <summary>Representative params for every template — the shapes rules.json passes.</summary>
    private static readonly Dictionary<string, string> SampleJson = new()
    {
        ["block-paths"] = """{ "paths": ["src/generated", "*.snk"], "reason": "generated — change the source and regenerate" }""",
        ["block-commands"] = """{ "patterns": ["terraform apply", "terraform destroy"], "reason": "plan is the deliverable; apply is a person's" }""",
        ["secret-scan"] = """{ "allowTests": true }""",
        ["build-gate"] = """{ "command": "npm run build" }""",
        ["post-format"] = """{ "formatter": "prettier" }""",
        ["post-validate"] = """{ "match": "\\.ipynb$", "command": "python -m nbformat --validate" }""",
        ["deny"] = """{ "deny": ["secrets/", ".env", "Bash(rm -rf *)"] }""",
        ["gitignore"] = """{ "entries": ["bin/", "obj/"] }""",
        ["gitattributes"] = """{ "paths": ["src/generated", "Model.g.cs"] }""",
        ["local-gate"] = """{ "build": "npm run build", "test": "npm test" }""",
        ["first-test"] = """{ "languages": ["TypeScript", "C#"] }""",
        ["agents-md"] = """{ "mergeFrom": [".cursorrules", ".github/copilot-instructions.md"] }""",
        ["agents-md-delta"] = """{ "existing": ["CLAUDE.md"], "date": "2026-09-27" }""",
        ["per-package"] = """{ "packages": ["packages/core", "apps/web"] }""",
        ["per-area"] = """{ "areas": [{ "dir": "Pcf", "toolchain": "node", "command": "npm run build" }, { "dir": "CrmEntryPoints", "toolchain": "msbuild", "command": "msbuild Crm.sln" }] }""",
        ["docs-set"] = """{ "docs": ["architecture", "integrations", "build-and-run", "glossary"] }""",
        ["hot-dir-doc"] = """{ "dir": "src/Entities", "changes": "312", "authors": "14" }""",
        ["run-affected-tests"] = """{ "command": "npm test", "dirs": ["tests", "src/__tests__"], "frameworks": ["vitest"] }""",
        ["verify-like-ci"] = """{ "commands": ["npm ci", "npm run lint", "npm test"], "systems": ["github-actions"] }""",
        ["which-package"] = """{ "packages": ["packages/core", "apps/web"], "workspaces": "packages/*; apps/*" }""",
        ["change-recipe"] = """{ "shapes": [{ "files": ["src/a.ts", "src/b.ts", "src/c.test.ts"], "times": 7 }] }""",
        ["build-on-runner"] = """{ "solution": "Acme.sln" }""",
        ["terraform-docs"] = "{}",
        ["docs-sync"] = """{ "pointer": "docs/architecture.md" }""",
        ["emulator-free-verify"] = """{ "screenshot": "roborazzi" }""",
        ["contribution-style"] = """{ "contributing": ["CONTRIBUTING.md", ".github/CONTRIBUTING.md"] }""",
        ["scoped-reviewer"] = """{ "dir": "src/Entities", "changes": 312, "authors": 14, "withReviewMd": true }""",
        ["security-reviewer"] = """{ "languages": ["PHP", "JavaScript"] }""",
        ["reviewer"] = "{}",
        ["pr-template"] = "{}",
        ["mcp"] = """{ "server": "dataverse", "url": "https://{org}.crm.dynamics.com/api/mcp", "tools": ["describe_table", "read_query", "search"], "readOnly": true, "needs": ["org", "admin consent"] }""",
    };

    private static JsonObject Json(string json) => JsonNode.Parse(json)!.AsObject();

    private static JsonObject Sample(string name) => Json(SampleJson[name]);

    private readonly string _dir = Directory.CreateTempSubdirectory("dcc-catalog-").FullName;
    private int _n;

    public void Dispose() => RepoCheckouts.ForceDelete(_dir);

    private sealed record Run(int Status, string Stdout, string Stderr);

    /// <summary>Runs a program with the input on stdin, as spawnSync does: no shell, UTF-8 both ways, no byte-order mark.</summary>
    private static Run Spawn(string file, IEnumerable<string> args, string cwd, string input = "")
    {
        var psi = new ProcessStartInfo(file)
        {
            WorkingDirectory = cwd, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var stdout = p.StandardOutput.ReadToEndAsync();
        var stderr = p.StandardError.ReadToEndAsync();
        p.StandardInput.Write(input);
        p.StandardInput.Close();
        if (!p.WaitForExit(60_000))
        {
            p.Kill(entireProcessTree: true);
            throw new TimeoutException($"{file} {string.Join(' ', args)} did not finish");
        }
        return new Run(p.ExitCode, stdout.GetAwaiter().GetResult(), stderr.GetAwaiter().GetResult());
    }

    private static readonly Lazy<bool> GitAvailable = new(() =>
    {
        try { return Spawn("git", ["--version"], Path.GetTempPath()).Status == 0; }
        catch (Win32Exception) { return false; }
    });

    /// <summary>it.skipIf(!gitAvailable).</summary>
    public sealed class FactWithGitAttribute : FactAttribute
    {
        public FactWithGitAttribute()
        {
            if (!GitAvailable.Value) Skip = "git is not on PATH";
        }
    }

    /// <summary>it.skipIf(process.platform === "win32").</summary>
    public sealed class FactNotOnWindowsAttribute : FactAttribute
    {
        public FactNotOnWindowsAttribute()
        {
            if (OperatingSystem.IsWindows()) Skip = "on Windows a Windows-only build can run";
        }
    }

    /// <summary>path.join: the parts joined and normalised to the platform's separators.</summary>
    private static string P(params string[] parts) => Path.GetFullPath(Path.Combine(parts));

    /// <summary>Writes one rendered file into a fresh sub-folder of the temp folder and returns its absolute path.</summary>
    private string Place(Rendered r, string rel)
    {
        var f = r.Files.FirstOrDefault(x => x.Path == rel)
            ?? throw new InvalidOperationException($"no file {rel} among {(r.Files.Count > 0 ? string.Join(", ", r.Files.Select(x => x.Path)) : "(none)")}");
        var abs = P(_dir, (_n++).ToString(CultureInfo.InvariantCulture), rel);
        Directory.CreateDirectory(Path.GetDirectoryName(abs)!);
        File.WriteAllText(abs, f.Content);
        return abs;
    }

    private Run RunScript(string script, JsonNode evt, string? cwd = null) => Spawn("node", [script], cwd ?? _dir, evt.ToJsonString());

    private string Hook(string name, string parameters, RepoFacts? facts = null) =>
        Place(Catalog.Render(name, Json(parameters), facts ?? Repo), $".claude/hooks/{name}.mjs");

    private JsonObject Edit(string file, JsonObject? extra = null, string? cwd = null)
    {
        cwd ??= _dir;
        var input = new JsonObject { ["file_path"] = P(cwd, file), ["old_string"] = "a", ["new_string"] = "b" };
        foreach (var (k, v) in extra ?? new JsonObject()) input[k] = v?.DeepClone();
        return new JsonObject { ["tool_name"] = "Edit", ["tool_input"] = input, ["cwd"] = cwd };
    }

    private static JsonObject Bash(string command, string? cwd = null)
    {
        var e = new JsonObject { ["tool_name"] = "Bash", ["tool_input"] = new JsonObject { ["command"] = command } };
        if (cwd is not null) e["cwd"] = cwd;
        return e;
    }

    private static void JsonEqual(string expected, JsonNode? actual) =>
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(expected), actual), $"expected {expected}, got {actual?.ToJsonString() ?? "(nothing)"}");

    /* ── the catalog ── */

    [Fact]
    public void Has_a_version() => Assert.Equal(1, OnboardingCatalog.Version);

    [Fact]
    public void Renders_every_listed_template_with_representative_params_and_a_missing_template_file_fails_here()
    {
        var list = Catalog.List();
        Assert.Equal(SampleJson.Keys.OrderBy(k => k, StringComparer.Ordinal), list.Select(t => t.Name).OrderBy(k => k, StringComparer.Ordinal));
        foreach (var t in list)
        {
            Assert.False(string.IsNullOrEmpty(t.Kind), t.Name);
            Assert.True(t.Produces.Count > 0, t.Name);
            var r = Catalog.Render(t.Name, Sample(t.Name), Repo);
            Assert.NotNull(r.Files);
            Assert.NotNull(r.Notes);
            foreach (var f in r.Files)
            {
                Assert.DoesNotMatch(@"^/|\\", f.Path);
                // DCC's own slots are all filled; only the builder's {{UPPERCASE}} slots may remain.
                Assert.False(Regex.IsMatch(f.Content, @"\{\{[a-z][a-z0-9_]*\}\}"), $"{t.Name} {f.Path}");
                Assert.False(f.Content.Contains("@dcc:config", StringComparison.Ordinal), $"{t.Name} {f.Path}");
            }
            if (t.Kind == "hook")
            {
                var h = r.Files.FirstOrDefault(f => f.Path.StartsWith(".claude/hooks/", StringComparison.Ordinal));
                Assert.NotNull(h);
                Assert.StartsWith("#!/usr/bin/env node\n", h.Content, StringComparison.Ordinal);
                Assert.Equal(Executable, h.Mode);
                Assert.NotNull(r.Settings?["hooks"]);
            }
        }
    }

    [Fact]
    public void Throws_on_a_template_it_does_not_have()
    {
        var e = Assert.ThrowsAny<Exception>(() => Catalog.Render("no-such-template", new JsonObject(), Repo));
        Assert.Matches("unknown catalog template", e.Message);
    }

    [Fact]
    public void Wires_hooks_in_Claude_Codes_settings_format()
    {
        var r = Catalog.Render("block-paths", Sample("block-paths"), Repo);
        JsonEqual("""{ "PreToolUse": [{ "matcher": "Edit|Write|MultiEdit", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/block-paths.mjs\"" }] }] }""", r.Settings?["hooks"]);
        Assert.Equal("Bash", (string?)Catalog.Render("block-commands", Sample("block-commands"), Repo).Settings?["hooks"]?["PreToolUse"]?[0]?["matcher"]);
        Assert.Equal(2, Catalog.Render("secret-scan", new JsonObject(), Repo).Settings?["hooks"]?["PreToolUse"]?.AsArray().Count);
        var stop = Catalog.Render("build-gate", Sample("build-gate"), Repo).Settings!["hooks"]!["Stop"]![0]!.AsObject();
        Assert.False(stop.ContainsKey("matcher"));
        Assert.True((int)stop["hooks"]![0]!["timeout"]! >= 600);
        Assert.Single(Catalog.Render("post-format", Sample("post-format"), Repo).Settings!["hooks"]!["PostToolUse"]!.AsArray());
    }

    /* ── block-paths ── */

    private string BlockPaths() =>
        Hook("block-paths", """{ "paths": ["src/generated", "Keys/**", "*.snk", "Entities.cs"], "reason": "generated — change the source and regenerate" }""");

    [Fact]
    public void Block_paths_denies_a_file_under_a_forbidden_path_with_the_reason()
    {
        var r = RunScript(BlockPaths(), Edit("src/generated/Model.cs"));
        Assert.Equal(2, r.Status);
        Assert.Contains("generated — change the source and regenerate", r.Stderr);
        // On Windows the hook compares (and so reports) the path lowercased — the old test assumed a case-sensitive platform.
        Assert.Contains(OperatingSystem.IsWindows() ? "src/generated/model.cs" : "src/generated/Model.cs", r.Stderr);
    }

    [Fact]
    public void Block_paths_allows_a_file_elsewhere_and_a_sibling_whose_name_merely_starts_the_same()
    {
        Assert.Equal(0, RunScript(BlockPaths(), Edit("src/app.ts")).Status);
        Assert.Equal(0, RunScript(BlockPaths(), Edit("src/generatedByHand/x.ts")).Status);
    }

    [Fact]
    public void Block_paths_understands_globstar_entries_file_name_patterns_and_bare_file_names()
    {
        Assert.Equal(2, RunScript(BlockPaths(), Edit("Keys/deep/x.txt")).Status);
        Assert.Equal(2, RunScript(BlockPaths(), Edit("Signing/Acme.snk")).Status);
        Assert.Equal(2, RunScript(BlockPaths(), Edit("Crm/Entities.cs")).Status);
        Assert.Equal(0, RunScript(BlockPaths(), Edit("Crm/EntitiesHelper.cs")).Status);
    }

    [Fact]
    public void Block_paths_ignores_other_tools_and_files_outside_the_repository()
    {
        var read = new JsonObject { ["tool_name"] = "Read", ["tool_input"] = new JsonObject { ["file_path"] = P(_dir, "src/generated/a") }, ["cwd"] = _dir };
        Assert.Equal(0, RunScript(BlockPaths(), read).Status);
        var outside = new JsonObject { ["tool_name"] = "Edit", ["tool_input"] = new JsonObject { ["file_path"] = P(_dir, "..", "src/generated/a") }, ["cwd"] = P(_dir, "inner") };
        Assert.Equal(0, RunScript(BlockPaths(), outside).Status);
    }

    /* ── block-commands ── */

    private string BlockCommands() =>
        Hook("block-commands", """{ "patterns": ["terraform apply", "terraform destroy", "terraform state "], "reason": "plan is the deliverable; apply is a person's" }""");

    [Fact]
    public void Block_commands_denies_terraform_apply_and_allows_terraform_plan()
    {
        var denied = RunScript(BlockCommands(), Bash("cd infra && terraform apply -auto-approve"));
        Assert.Equal(2, denied.Status);
        Assert.Contains("plan is the deliverable", denied.Stderr);
        Assert.Equal(0, RunScript(BlockCommands(), Bash("terraform plan -out=tfplan")).Status);
    }

    [Fact]
    public void A_dollar_sign_in_a_pattern_is_baked_in_as_written_and_the_hook_still_runs()
    {
        // The old server read "$$", "$&", "$`" and "$'" in the config as replacement patterns and wrote a hook that did not parse.
        var hook = Hook("block-commands", """{ "patterns": ["kill $$", "echo $'x' $& $`"], "reason": "no" }""");
        Assert.Contains("""kill $$""", File.ReadAllText(hook));
        Assert.Equal(2, RunScript(hook, Bash("kill $$")).Status);
        Assert.Equal(0, RunScript(hook, Bash("ls")).Status);
    }

    [Fact]
    public void Block_commands_compares_case_insensitively_with_whitespace_collapsed()
    {
        Assert.Equal(2, RunScript(BlockCommands(), Bash("Terraform \\\n   APPLY")).Status);
        Assert.Equal(2, RunScript(BlockCommands(), Bash("terraform state list")).Status);
        Assert.Equal(0, RunScript(BlockCommands(), new JsonObject { ["tool_name"] = "Edit", ["tool_input"] = new JsonObject { ["file_path"] = "terraform apply" } }).Status);
    }

    /* ── secret-scan ── */

    private JsonObject WriteEvent(string file, string content) =>
        new() { ["tool_name"] = "Write", ["tool_input"] = new JsonObject { ["file_path"] = P(_dir, file), ["content"] = content }, ["cwd"] = _dir };

    private const string AllowTestsOff = """{ "allowTests": false }""";
    private const string AllowTestsOn = """{ "allowTests": true }""";

    [Fact]
    public void Secret_scan_denies_a_connection_string_password_and_never_prints_the_value()
    {
        var r = RunScript(Hook("secret-scan", AllowTestsOff), WriteEvent("appsettings.json", """{ "Db": "Server=x;Password=Sup3rSecret123;" }"""));
        Assert.Equal(2, r.Status);
        Assert.DoesNotContain("Sup3rSecret123", r.Stderr);
        Assert.Contains("***", r.Stderr);
        Assert.Contains("password in a connection string", r.Stderr);
        Assert.Contains("appsettings.json:1", r.Stderr);
    }

    [Fact]
    public void Secret_scan_lets_a_placeholder_through()
    {
        Assert.Equal(0, RunScript(Hook("secret-scan", AllowTestsOff), WriteEvent("appsettings.json", "Password=changethis;")).Status);
        Assert.Equal(0, RunScript(Hook("secret-scan", AllowTestsOff), WriteEvent("appsettings.json", "Password=${DB_PASSWORD};")).Status);
    }

    [Fact]
    public void Secret_scan_catches_the_other_kinds_in_an_Edits_new_string_and_a_MultiEdit()
    {
        var s = Hook("secret-scan", AllowTestsOff);
        string[] cases =
        [
            "const key = \"AKIAIOSFODNN7EXAMPL0\";", "-----BEGIN RSA PRIVATE KEY-----", "url = postgres://app:hunter22@db:5432/app", "api_key = \"9f8e7d6c5b4a3f2e1d\"",
            "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789", "SLACK=xoxb-1234567890-abcdefghij", "stripe: sk_live_Qm7xZp2Lk9",
        ];
        foreach (var c in cases) Assert.True(RunScript(s, Edit("src/config.ts", new() { ["new_string"] = c })).Status == 2, c);
        var multi = new JsonObject
        {
            ["tool_name"] = "MultiEdit",
            ["tool_input"] = new JsonObject
            {
                ["file_path"] = P(_dir, "src/x.ts"),
                ["edits"] = JsonNode.Parse("""[{ "old_string": "a", "new_string": "b" }, { "old_string": "c", "new_string": "password = \"hunter2hunter2\"" }]"""),
            },
            ["cwd"] = _dir,
        };
        Assert.Equal(2, RunScript(s, multi).Status);
        Assert.Equal(0, RunScript(s, Edit("src/config.ts", new() { ["new_string"] = "const x = 1;" })).Status);
    }

    [Fact]
    public void Secret_scan_skips_test_files_when_allowTests_is_on_and_only_then()
    {
        const string content = "Password=Sup3rSecret123;";
        Assert.Equal(0, RunScript(Hook("secret-scan", AllowTestsOn), WriteEvent("tests/x.test.ts", content)).Status);
        Assert.Equal(0, RunScript(Hook("secret-scan", AllowTestsOn), WriteEvent("src/fixtures/db.ts", content)).Status);
        Assert.Equal(2, RunScript(Hook("secret-scan", AllowTestsOn), WriteEvent("src/db.ts", content)).Status);
        Assert.Equal(2, RunScript(Hook("secret-scan", AllowTestsOff), WriteEvent("tests/x.test.ts", content)).Status);
    }

    [FactWithGit]
    public void Secret_scan_scans_the_staged_diff_on_git_commit()
    {
        var repoDir = P(_dir, "git-repo");
        Directory.CreateDirectory(Path.Combine(repoDir, "tests"));
        Assert.Equal(0, Spawn("git", ["init", "-q"], repoDir).Status);
        File.WriteAllText(Path.Combine(repoDir, "tests", "fixture.txt"), "Password=Sup3rSecret123;\n");
        File.WriteAllText(Path.Combine(repoDir, "config.txt"), "ok\nPassword=Sup3rSecret123;\n");
        Assert.Equal(0, Spawn("git", ["add", "-A"], repoDir).Status);
        var r = RunScript(Hook("secret-scan", AllowTestsOn), Bash("git commit -m \"add config\"", repoDir), repoDir);
        Assert.Equal(2, r.Status);
        Assert.Contains("config.txt:2", r.Stderr);
        Assert.DoesNotContain("tests/fixture.txt", r.Stderr);
        Assert.DoesNotContain("Sup3rSecret123", r.Stderr);
        Assert.Equal(0, RunScript(Hook("secret-scan", AllowTestsOn), Bash("git status", repoDir), repoDir).Status);
    }

    /* ── build-gate ── */

    private JsonObject Stop(bool active = false)
    {
        var e = new JsonObject { ["cwd"] = _dir };
        if (active) e["stop_hook_active"] = true;
        return e;
    }

    [Fact]
    public void Build_gate_sends_a_failing_build_back_to_Claude_and_lets_a_passing_one_stop()
    {
        var failing = RunScript(Hook("build-gate", """{ "command": "node -e \"console.log(1); console.error('boom'); process.exit(1)\"" }"""), Stop());
        Assert.Equal(2, failing.Status);
        Assert.Contains("boom", failing.Stderr);
        Assert.Equal(0, RunScript(Hook("build-gate", """{ "command": "node -e \"process.exit(0)\"" }"""), Stop()).Status);
    }

    [Fact]
    public void Build_gate_never_loops_stop_hook_active_ends_it_and_no_command_is_a_pass()
    {
        Assert.Equal(0, RunScript(Hook("build-gate", """{ "command": "node -e \"process.exit(1)\"" }"""), Stop(active: true)).Status);
        var r = RunScript(Hook("build-gate", """{ "command": "" }""", Bare), Stop());
        Assert.Equal(0, r.Status);
        Assert.Equal("", r.Stdout + r.Stderr);
    }

    /* ── post-format ── */

    [Fact]
    public void Post_format_maps_a_formatter_to_its_command_and_keeps_to_its_extensions()
    {
        var r = Catalog.Render("post-format", Json("""{ "formatter": "rustfmt/clippy (toolchain pinned)" }"""), Repo);
        Assert.Contains("\"rustfmt\"", r.Files[0].Content);
        Assert.Contains("\".rs\"", r.Files[0].Content);
        Assert.Contains("@biomejs/biome", Catalog.Render("post-format", Json("""{ "formatter": "@biomejs/biome" }"""), Repo).Files[0].Content);
    }

    [Fact]
    public void Post_format_exits_0_for_an_unknown_formatter_and_says_so_in_the_notes_and_spotless_is_skipped()
    {
        var r = Catalog.Render("post-format", Json("""{ "formatter": "made-up-fmt" }"""), Repo);
        Assert.Contains("no command known for made-up-fmt", string.Join("\n", r.Notes));
        Assert.Equal(0, RunScript(Place(r, ".claude/hooks/post-format.mjs"), Edit("src/a.ts")).Status);
        var spotless = Catalog.Render("post-format", Json("""{ "formatter": "spotless" }"""), Repo);
        Assert.Empty(spotless.Files);
        Assert.Matches("spotless", spotless.Notes[0]);
    }

    [Fact]
    public void Post_format_never_blocks_even_when_the_formatter_fails()
    {
        var r = Catalog.Render("post-format", Json("""{ "formatter": "prettier" }"""), Repo);
        var content = r.Files[0].Content.Replace("\"npx\",\n    \"prettier\",\n    \"--write\"", "\"node\",\n    \"-e\",\n    \"\\\"process.exit(1)\\\"\"", StringComparison.Ordinal);
        Assert.Contains("process.exit(1)", content);
        Assert.DoesNotContain("\"--write\"", content);
        var abs = P(_dir, (_n++).ToString(CultureInfo.InvariantCulture), "post-format.mjs");
        Directory.CreateDirectory(Path.GetDirectoryName(abs)!);
        File.WriteAllText(abs, content);
        var run = RunScript(abs, Edit("src/a.ts"));
        Assert.Equal(0, run.Status);
        Assert.Contains("did not format", run.Stdout);
    }

    /* ── post-validate ── */

    [Fact]
    public void Post_validate_runs_the_command_on_a_matching_file_and_hands_a_failure_back()
    {
        var failing = Hook("post-validate", """{ "match": "\\.ipynb$", "command": "node -e \"console.error('invalid notebook'); process.exit(1)\"" }""");
        var r = RunScript(failing, Edit("notebooks/a.ipynb"));
        Assert.Equal(2, r.Status);
        Assert.Contains("invalid notebook", r.Stderr);
        Assert.Contains("notebooks/a.ipynb", r.Stderr);
        Assert.Equal(0, RunScript(failing, Edit("src/a.ts")).Status);
        Assert.Equal(0, RunScript(Hook("post-validate", """{ "match": "\\.ipynb$", "command": "node -e \"process.exit(0)\"" }"""), Edit("notebooks/a.ipynb")).Status);
    }

    [Theory]
    [InlineData("\\.ipynb$", true)]
    [InlineData("\\k", true)]
    [InlineData("\\x", true)]
    [InlineData("[]", true)]
    [InlineData("\\pL", true)]
    [InlineData("a{", true)]
    [InlineData("(?i:a)", true)]
    [InlineData("(?<a>x)|(?<a>y)", true)]
    [InlineData("(?<a>x)(?:|(?<a>y))", true)]
    [InlineData("*.json", false)]
    [InlineData("(?i)abc", false)]
    [InlineData("^*", false)]
    [InlineData("(?>a)", false)]
    [InlineData("(?<=a)*", false)]
    [InlineData("[z-a]", false)]
    [InlineData("(?<a>x)\\k<b>", false)]
    [InlineData("(?<a>x)(|(?<a>y))", false)]
    public void Post_validate_flags_a_match_exactly_when_Node_would_refuse_it(string match, bool nodeTakesIt)
    {
        // Not in the old test: the hook runs new RegExp(match) when it loads, so the note must agree with Node, not .NET.
        var r = Catalog.Render("post-validate", new JsonObject { ["match"] = match, ["command"] = "x" }, Repo);
        Assert.Equal(!nodeTakesIt, r.Notes.Contains($"match is not a valid regular expression: {match}"));
    }

    /* ── deny ── */

    [Fact]
    public void Deny_normalises_to_Claude_Codes_permission_rules()
    {
        var r = Catalog.Render("deny", Json("""{ "deny": ["secrets/", ".env", "Bash(rm -rf *)", "./certs/server.key", "Read(**/bin/**)", "id_rsa", "secrets/"] }"""), Repo);
        string[] expected =
        [
            "Read(secrets/**)", "Edit(secrets/**)",
            "Read(.env)", "Edit(.env)",
            "Bash(rm -rf *)",
            "Read(certs/server.key)", "Edit(certs/server.key)",
            "Read(**/bin/**)",
            "Read(id_rsa)", "Edit(id_rsa)",
        ];
        Assert.Equal(expected, r.Settings!["permissions"]!["deny"]!.AsArray().Select(x => (string)x!));
        Assert.Empty(r.Files);
    }

    /* ── files ── */

    [Fact]
    public void Gitattributes_marks_a_directory_with_globstar_and_a_file_as_it_is()
    {
        var r = Catalog.Render("gitattributes", Json("""{ "paths": ["src/generated", "Model.g.cs", "gen/"] }"""), Repo);
        Assert.Equal(".gitattributes", r.Files[0].Path);
        Assert.Contains("src/generated/** linguist-generated=true -diff\n", r.Files[0].Content);
        Assert.Contains("Model.g.cs linguist-generated=true -diff\n", r.Files[0].Content);
        Assert.Contains("gen/** linguist-generated=true -diff\n", r.Files[0].Content);
    }

    [Fact]
    public void Gitignore_returns_only_the_lines_under_the_DCC_header()
    {
        var r = Catalog.Render("gitignore", Json("""{ "entries": ["bin/", "*.user"] }"""), Repo);
        Assert.Equal("# added by DCC onboarding\nbin/\n*.user\n", r.Files[0].Content);
        Assert.Matches("^merge", r.Notes[0]);
    }

    [Fact]
    public void Local_gate_prints_one_verdict_line()
    {
        var nothing = Catalog.Render("local-gate", Json("""{ "build": "", "test": "-" }"""), Bare);
        Assert.Contains("\"verify\": \"node scripts/dcc-verify.mjs\"", string.Join("\n", nothing.Notes));
        var r0 = RunScript(Place(nothing, "scripts/dcc-verify.mjs"), new JsonObject());
        Assert.Equal(0, r0.Status);
        Assert.Equal("VERIFY: nothing to run", r0.Stdout.Trim());
        var ok = RunScript(Place(Catalog.Render("local-gate", Json("""{ "build": "node -e \"process.exit(0)\"", "test": "node -e \"process.exit(0)\"" }"""), Bare), "scripts/dcc-verify.mjs"), new JsonObject());
        Assert.Equal(0, ok.Status);
        Assert.Equal("VERIFY: ok", ok.Stdout.Trim().Split('\n')[^1]);
        var failed = RunScript(Place(Catalog.Render("local-gate", Json("""{ "build": "node -e \"process.exit(0)\"", "test": "node -e \"process.exit(3)\"" }"""), Bare), "scripts/dcc-verify.mjs"), new JsonObject());
        Assert.Equal(1, failed.Status);
        Assert.Equal("VERIFY: failed test", failed.Stdout.Trim().Split('\n')[^1]);
    }

    [FactNotOnWindows]
    public void Local_gate_says_when_the_build_is_Windows_only()
    {
        var r = RunScript(Place(Catalog.Render("local-gate", Json("""{ "build": "msbuild Acme.sln", "test": "" }"""), Bare with { WindowsOnly = true }), "scripts/dcc-verify.mjs"), new JsonObject());
        Assert.Equal(3, r.Status);
        Assert.Equal("VERIFY: cannot run here (Windows-only build)", r.Stdout.Trim());
    }

    [Fact]
    public void First_test_picks_the_first_supported_language_in_the_native_framework()
    {
        Assert.Equal("tests/smoke.test.mjs", Catalog.Render("first-test", Json("""{ "languages": ["Markdown", "TypeScript"] }"""), Repo).Files[0].Path);
        Assert.Equal("tests/test_smoke.py", Catalog.Render("first-test", Json("""{ "languages": ["Jupyter", "Python"] }"""), Repo).Files[0].Path);
        var go = Catalog.Render("first-test", Json("""{ "languages": ["Go"] }"""), Repo);
        Assert.Equal("smoke_test.go", go.Files[0].Path);
        Assert.Contains("package main", go.Notes[0]);
        var cs = Catalog.Render("first-test", Json("""{ "languages": ["C#"] }"""), Repo);
        Assert.Equal("Tests/Smoke/SmokeTests.cs", cs.Files[0].Path);
        Assert.Contains("[TestMethod]", cs.Files[0].Content);
        Assert.Contains("test project", cs.Notes[0]);
        Assert.Contains("org.junit.jupiter", Catalog.Render("first-test", Json("""{ "languages": ["Java"] }"""), Repo).Files[0].Content);
        var none = Catalog.Render("first-test", Json("""{ "languages": ["Kotlin", "XML"] }"""), Repo);
        Assert.Empty(none.Files);
        Assert.Equal("no first-test template for Kotlin (nor for XML)", none.Notes[0]);
    }

    [Fact]
    public void The_node_smoke_test_really_runs()
    {
        var abs = Place(Catalog.Render("first-test", Json("""{ "languages": ["JavaScript"] }"""), Repo), "tests/smoke.test.mjs");
        Assert.Equal(0, Spawn("node", ["--test", abs], _dir).Status);
    }

    /* ── instructions ── */

    [Fact]
    public void Agents_md_has_the_sections_the_commands_from_the_facts_and_a_one_line_CLAUDE_md()
    {
        var r = Catalog.Render("agents-md", Json("""{ "mergeFrom": [".cursorrules"] }"""), Repo);
        var agents = r.Files.First(f => f.Path == "AGENTS.md").Content;
        string[] headings = ["# acme-shop", "## What this is", "## Build, test, lint", "## Layout", "## External systems", "## Rules for this repository", "## Verification", "## Merged from"];
        foreach (var h in headings) Assert.Contains(Regex.Replace($"\n{h}\n", "^\n# ", "# "), agents);
        foreach (var slot in new[] { "{{PURPOSE}}", "{{LAYOUT}}", "{{EXTERNAL}}", "{{RULES}}", "{{VERIFICATION}}" }) Assert.Contains(slot, agents);
        Assert.Contains("```sh\nnpm run build\n```", agents);
        Assert.Contains("- `.cursorrules`", agents);
        Assert.True(agents.Split('\n').Length < 80);
        Assert.Equal("@AGENTS.md\n", r.Files.First(f => f.Path == "CLAUDE.md").Content);
        var windows = Catalog.Render("agents-md", new JsonObject(), Bare with { Name = "crm", WindowsOnly = true }).Files[0].Content;
        Assert.Contains("Build: not available here.", windows);
        Assert.Contains("Windows runner", windows);
        Assert.DoesNotContain("## Merged from", windows);
    }

    [Fact]
    public void Agents_md_delta_is_a_dated_section_to_append()
    {
        var r = Catalog.Render("agents-md-delta", Json("""{ "existing": ["CLAUDE.md"], "date": "2026-09-27" }"""), Repo);
        Assert.Equal("AGENTS.md", r.Files[0].Path);
        Assert.Contains("## Facts from DCC's diagnosis (2026-09-27)", r.Files[0].Content);
        Assert.Contains("- Build: `npm run build`", r.Files[0].Content);
        Assert.Contains("{{RULES}}", r.Files[0].Content);
        Assert.Matches("^append", r.Notes[0]);
    }

    [Fact]
    public void Per_package_caps_at_12_and_says_so_and_per_area_names_the_toolchain()
    {
        var packages = new JsonArray([.. Enumerable.Range(0, 15).Select(i => (JsonNode?)$"packages/p{i}")]);
        var r = Catalog.Render("per-package", new JsonObject { ["packages"] = packages }, Repo);
        Assert.Equal(12, r.Files.Count);
        Assert.Equal("packages/p0/CLAUDE.md", r.Files[0].Path);
        Assert.Contains("# packages/p0\n\nRun commands from this folder.\n\n{{PACKAGE_COMMANDS}}", r.Files[0].Content);
        Assert.Contains("12 of 15", r.Notes.First(x => x.StartsWith("capped", StringComparison.Ordinal)));
        var area = Catalog.Render("per-area", Sample("per-area"), Repo);
        Assert.Equal(new[] { "Pcf/CLAUDE.md", "CrmEntryPoints/CLAUDE.md" }, area.Files.Select(f => f.Path));
        Assert.Contains("Toolchain: msbuild", area.Files[1].Content);
        Assert.Contains("msbuild Crm.sln", area.Files[1].Content);
    }

    [Fact]
    public void Docs_set_writes_the_known_skeletons_and_reports_an_unknown_name_and_hot_dir_doc_carries_the_numbers()
    {
        var r = Catalog.Render("docs-set", Json("""{ "docs": ["architecture", "glossary", "bogus"] }"""), Repo);
        Assert.Equal(new[] { "docs/architecture.md", "docs/glossary.md" }, r.Files.Select(f => f.Path));
        Assert.Contains("> Written by DCC onboarding from the repository's diagnosis; verify before relying on it.", r.Files[0].Content);
        Assert.Contains("{{BODY}}", r.Files[0].Content);
        Assert.Contains("unknown doc \"bogus\"", r.Notes[0]);
        var hot = Catalog.Render("hot-dir-doc", Json("""{ "dir": "src/Entities", "changes": "312", "authors": "14" }"""), Repo);
        Assert.Equal("docs/architecture-src-entities.md", hot.Files[0].Path);
        Assert.Contains("312 changes by 14 authors", hot.Files[0].Content);
        // Not in the old test: the slug lowercases as JavaScript does, where a dotted capital I becomes "i" and a combining dot.
        Assert.Equal("docs/architecture-i-stanbul.md", Catalog.Render("hot-dir-doc", new JsonObject { ["dir"] = $"{(char)0x0130}stanbul" }, Repo).Files[0].Path);
    }

    /* ── skills and agents ── */

    private static Dictionary<string, string> Frontmatter(string content)
    {
        var m = Regex.Match(content, @"^---\n([\s\S]*?)\n---\n");
        if (!m.Success) throw new InvalidOperationException("no frontmatter");
        var fm = new Dictionary<string, string>();
        foreach (var l in m.Groups[1].Value.Split('\n'))
        {
            var i = l.IndexOf(':');
            fm[i >= 0 ? l[..i] : l.Length > 0 ? l[..^1] : ""] = l[(i + 1)..].Trim();
        }
        return fm;
    }

    [Fact]
    public void Every_skill_is_a_SKILL_md_with_name_and_description_and_read_only_ones_list_their_tools()
    {
        foreach (var t in Catalog.List().Where(x => x.Kind == "skill"))
        {
            var f = Catalog.Render(t.Name, Sample(t.Name), Repo).Files[0];
            Assert.Equal($".claude/skills/{t.Name}/SKILL.md", f.Path);
            var fm = Frontmatter(f.Content);
            Assert.Equal(t.Name, fm["name"]);
            Assert.True(fm["description"].Length > 80, t.Name);
            Assert.Matches("Use (when|before|whenever)", fm["description"]);
            if (fm.TryGetValue("allowed-tools", out var tools) && tools.Length > 0) Assert.Equal("Read, Grep, Glob, Bash", tools);
        }
        var tests = Catalog.Render("run-affected-tests", Sample("run-affected-tests"), Repo).Files[0].Content;
        Assert.Contains("```sh\nnpm test\n```", tests);
        Assert.Contains("`tests`, `src/__tests__`", tests);
        var ci = Catalog.Render("verify-like-ci", Sample("verify-like-ci"), Repo).Files[0].Content;
        Assert.Contains("# 1\nnpm ci\n# 2\nnpm run lint\n# 3\nnpm test", ci);
        var recipe = Catalog.Render("change-recipe", Sample("change-recipe"), Repo).Files[0].Content;
        Assert.Contains("these 3 files changed together 7 times", recipe);
        Assert.Contains("1. `src/a.ts`\n2. `src/b.ts`\n3. `src/c.test.ts`", recipe);
        var runner = Catalog.Render("build-on-runner", Sample("build-on-runner"), Repo).Files[0].Content;
        Assert.Contains("Acme.sln", runner);
        Assert.Contains("{{RUNNER}}", runner);
        Assert.Contains("cannot build here", runner);
    }

    [Fact]
    public void Every_agent_is_read_only_with_a_JSON_findings_format()
    {
        foreach (var t in Catalog.List().Where(x => x.Kind == "agent"))
        {
            var r = Catalog.Render(t.Name, Sample(t.Name), Repo);
            var agent = r.Files.First(f => f.Path.StartsWith(".claude/agents/", StringComparison.Ordinal));
            var fm = Frontmatter(agent.Content);
            Assert.Equal("Glob, Grep, Read, Bash", fm["tools"]);
            Assert.Equal(Path.GetFileNameWithoutExtension(agent.Path), fm["name"]);
            Assert.Contains("\"severity\": \"block\"", agent.Content);
            Assert.Contains("do not approve", agent.Content);
        }
        var scoped = Catalog.Render("scoped-reviewer", Sample("scoped-reviewer"), Repo);
        Assert.Equal(new[] { ".claude/agents/reviewer-src-entities.md", "REVIEW.md" }, scoped.Files.Select(f => f.Path));
        Assert.Contains("{{CHECKLIST}}", scoped.Files[0].Content);
        Assert.Contains("312 changes by 14 authors", scoped.Files[0].Content);
        Assert.Contains("{{CHECKLIST}}", scoped.Files[1].Content);
        Assert.Single(Catalog.Render("scoped-reviewer", Json("""{ "dir": "src/Entities" }"""), Repo).Files);
        var sec = Catalog.Render("security-reviewer", Json("""{ "languages": ["PHP", "JavaScript", "Brainfuck"] }"""), Repo).Files[0].Content;
        Assert.Contains("**PHP**", sec);
        Assert.Contains("**JavaScript**", sec);
        Assert.Contains("**Brainfuck** — the checklist above applies", sec);
        foreach (var item in new[] { "Injection", "Cross-site scripting", "CSRF", "Path traversal", "Secrets" }) Assert.Contains($"**{item}**", sec);
        Assert.Equal(new[] { ".claude/agents/reviewer.md", "REVIEW.md" }, Catalog.Render("reviewer", new JsonObject(), Repo).Files.Select(f => f.Path));
    }

    /* ── other ── */

    [Fact]
    public void Pr_template_has_the_four_sections()
    {
        var r = Catalog.Render("pr-template", new JsonObject(), Repo);
        Assert.Equal(".github/pull_request_template.md", r.Files[0].Path);
        foreach (var h in new[] { "## What", "## Why", "## How verified", "## Risks" }) Assert.Contains(h, r.Files[0].Content);
    }

    [Fact]
    public void Mcp_returns_an_mcp_json_entry_and_the_rule_line_that_limits_the_tools()
    {
        var http = Catalog.Render("mcp", Sample("mcp"), Repo);
        JsonEqual("""{ "mcpServers": { "dataverse": { "type": "http", "url": "https://{org}.crm.dynamics.com/api/mcp" } } }""", http.Mcp);
        Assert.Empty(http.Files);
        Assert.Equal("rule: MCP `dataverse`: use only these tools: describe_table, read_query, search; it is read-only — never write through it.", http.Notes[0]);
        Assert.Contains("placeholder", string.Join("\n", http.Notes));
        Assert.Contains("needs from the client: org, admin consent", string.Join("\n", http.Notes));
        var stdio = Catalog.Render("mcp", Json("""{ "server": "db", "command": "npx", "args": ["-y", "pg-mcp"], "env": { "PGURL": "postgres://ro@db/app" }, "tools": ["query"] }"""), Repo);
        JsonEqual("""{ "mcpServers": { "db": { "command": "npx", "args": ["-y", "pg-mcp"], "env": { "PGURL": "postgres://ro@db/app" } } } }""", stdio.Mcp);
    }
}
