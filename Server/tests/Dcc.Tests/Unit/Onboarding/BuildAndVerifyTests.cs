using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Onboarding;

namespace Dcc.Tests.Unit.Onboarding;

/// <summary>
/// A scratch copy of a repository per test (xUnit makes a new instance for each), removed afterwards — the old tests
/// shared one folder across a describe block, which only works when the tests run in order.
/// </summary>
public abstract class BuildVerifyScratch : IDisposable
{
    protected readonly string Dir = ComponentVerifier.ScratchDir();

    protected void Write(string rel, string content)
    {
        var file = Path.Combine(Dir, rel);
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        File.WriteAllText(file, content);
    }

    protected string Read(string rel) => File.ReadAllText(Path.Combine(Dir, rel));

    /// <summary>The old tests' <c>card(o)</c>: an approved knowledge rule unless told otherwise.</summary>
    protected static Component Card(string key = "k", string kind = "rule", string status = ComponentStatuses.Approved, JsonObject? parameters = null,
        List<string>? files = null, int? contextTokens = null, string source = "rule", string? family = null, string title = "t") => new()
    {
        Key = key, Kind = kind, Family = family ?? "knowledge", TitleHe = title, WhyHe = "w", WhatHe = "x", Source = source, Group = "approval",
        Risk = "reversible", VerifyHowHe = "", Status = status, Params = parameters ?? [], Files = files ?? [], ContextTokens = contextTokens,
    };

    public void Dispose()
    {
        try { Directory.Delete(Dir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        GC.SuppressFinalize(this);
    }
}

/// <summary>The validators that need no repository and no node (repo-onboarding/verify.test.ts): pure on a scratch folder.</summary>
public sealed class VerifyTests : BuildVerifyScratch
{
    [Fact]
    public void A_path_in_backticks_must_exist_and_a_command_is_noted_not_failed()
    {
        Write("src/a.ts", "");
        var r = ComponentVerifier.CheckClaims("Edit `src/a.ts`, never `src/missing.ts`; run `npm run build`.", Dir, ["npm run build"]);
        Assert.Equal(3, r.Checked);
        Assert.Equal(["src/missing.ts"], r.Missing);
    }

    [Fact]
    public void A_skill_needs_a_name_a_description_long_enough_to_trigger_on_and_a_body()
    {
        Write(".claude/skills/x/SKILL.md", "---\nname: x\ndescription: short\n---\nbody");
        Assert.False(ComponentVerifier.ValidateSkill(Card(kind: "skill", files: [".claude/skills/x/SKILL.md"]), Dir).Passed);
        Write("src/a.ts", "");
        Write(".claude/skills/x/SKILL.md", "---\nname: x\ndescription: Runs the affected tests of a change. Use before saying a change is done.\n---\n" + string.Concat(Enumerable.Repeat("# Steps\n\n1. run `src/a.ts`\n", 12)));
        Assert.True(ComponentVerifier.ValidateSkill(Card(kind: "skill", files: [".claude/skills/x/SKILL.md"]), Dir).Passed);
    }

    [Fact]
    public void An_agent_that_can_write_is_refused_and_a_read_only_one_with_a_checklist_passes()
    {
        Write(".claude/agents/r.md", "---\nname: r\ndescription: reviews\ntools: Read, Edit\n---\n- a\n- b\n- c\n- d");
        Assert.False(ComponentVerifier.ValidateAgent(Card(kind: "agent", files: [".claude/agents/r.md"]), Dir).Passed);
        Write(".claude/agents/r.md", "---\nname: r\ndescription: reviews\ntools: Glob, Grep, Read, Bash\n---\n- a\n- b\n- c\n- d");
        var v = ComponentVerifier.ValidateAgent(Card(kind: "agent", files: [".claude/agents/r.md"]), Dir);
        Assert.True(v.Passed);
        Assert.Equal("קריאה בלבד (Glob, Grep, Read, Bash), 4 פריטי בדיקה", v.Detail);
    }

    [Fact]
    public void The_joint_check_flags_a_skill_under_a_read_deny_counts_the_always_loaded_context_and_ignores_shared_files_as_duplicates()
    {
        Write("AGENTS.md", new string('x', 400));
        Component[] cards =
        [
            Card("deny", "permission", ComponentStatuses.Verified, new JsonObject { ["deny"] = new JsonArray { "Read(.claude/skills/**)" } }, [".claude/settings.json"]),
            Card("skill", "skill", ComponentStatuses.Verified, files: [".claude/skills/x/SKILL.md"]),
            Card("rule1", status: ComponentStatuses.Verified, files: ["AGENTS.md"]),
            Card("rule2", status: ComponentStatuses.Verified, files: ["AGENTS.md"]),
            Card("mcp", "mcp", ComponentStatuses.Installed, files: [".mcp.json"], contextTokens: 2100),
        ];
        var j = ComponentVerifier.Joint(cards, Dir);
        Assert.Single(j.Contradictions);
        Assert.Empty(j.Duplicates);
        Assert.Equal(100 + 2100, j.AlwaysLoadedTokens);
    }

    // ── beyond the old tests: where the port could have read the JavaScript differently ──

    [Fact]
    public void A_hebrew_word_is_not_a_path_and_a_branch_name_or_an_address_is_not_a_claim()
    {
        var r = ComponentVerifier.CheckClaims("`תיקייה/קובץ.md`, `fix/`, `ai/onboarding/<run>`, `https://x.io/a`, `docs/x.md`", Dir, []);
        Assert.Equal(1, r.Checked);
        Assert.Equal(["docs/x.md"], r.Missing);
    }

    [Fact]
    public void A_text_passes_with_one_missing_path_in_five_and_is_judged_on_what_the_build_appended()
    {
        Write("src/a.ts", "");
        Write("src/b.ts", "");
        Write("docs/x.md", "`src/a.ts` `src/b.ts` `src/gone.ts`");
        var one = ComponentVerifier.ValidateText(Card(kind: "doc", files: ["docs/x.md"]), Dir, []);
        Assert.True(one.Passed);
        Assert.Equal("3 טענות נבדקו; נתיבים שלא קיימים: src/gone.ts", one.Detail);
        Write("docs/y.md", "`src/a.ts` `src/gone.ts` `src/also-gone.ts`");
        Assert.False(ComponentVerifier.ValidateText(Card(kind: "doc", files: ["docs/y.md"]), Dir, []).Passed);
        var appended = new Dictionary<string, string> { ["docs/y.md"] = "`src/a.ts`" };
        Assert.True(ComponentVerifier.ValidateText(Card(kind: "doc", files: ["docs/y.md"]), Dir, [], appended).Passed);
    }

    [Fact]
    public void A_frontmatter_written_with_CRLF_reads_as_the_old_server_read_it_only_its_last_line_parses()
    {
        Write(".claude/skills/x/SKILL.md", "---\r\nname: x\r\ndescription: Runs the affected tests of a change. Use before saying a change is done.\r\n---\r\n" + new string('b', 300));
        var v = ComponentVerifier.ValidateSkill(Card(kind: "skill", files: [".claude/skills/x/SKILL.md"]), Dir);
        Assert.False(v.Passed);
        Assert.Equal("חסר name או description — Claude Code לא יטען אותו", v.Detail);
    }

    [Fact]
    public void An_mcp_server_with_a_placeholder_address_cannot_be_checked_here_and_a_missing_one_fails()
    {
        Write(".mcp.json", """{"mcpServers":{"crm":{"url":"https://{org}.crm.example/api"}}}""");
        var placeholder = ComponentVerifier.ValidateMcp(Card(kind: "mcp", parameters: new JsonObject { ["server"] = "crm" }), Dir);
        Assert.Null(placeholder.Passed);
        Assert.Contains("(https://{org}.crm.example/api)", placeholder.Detail);
        var missing = ComponentVerifier.ValidateMcp(Card(kind: "mcp", parameters: new JsonObject { ["name"] = "other" }), Dir);
        Assert.False(missing.Passed);
        Assert.Equal("השרת \"other\" לא נמצא בקובץ", missing.Detail);
    }

    [Fact]
    public void A_runner_and_a_report_are_not_installed_and_a_kind_outside_the_vocabulary_has_no_check()
    {
        Assert.Null(ComponentVerifier.Validate(Card(kind: "runner"), Dir, []).Passed);
        Assert.Equal("דיווח, לא התקנה", ComponentVerifier.Validate(Card(kind: "report"), Dir, []).Detail);
        Assert.Throws<ArgumentException>(() => ComponentVerifier.Validate(Card(kind: "nonsense"), Dir, []));
    }
}

/// <summary>The build's merging of shared files, the facts the templates get, and a build with a stand-in author (repo-onboarding/build.ts).</summary>
public sealed class BuildTests : BuildVerifyScratch
{
    private static readonly OnboardingCatalog Catalog =
        new(Path.GetDirectoryName(Path.GetDirectoryName(OnboardingFiles.Data("catalog/templates/hooks/block-paths.mjs")))!);

    private static JsonObject Diagnosis() =>
        JsonNode.Parse(File.ReadAllText(OnboardingFiles.Repo("docs/research/sources/onboarding-v2/repos/diagnosis/altshuler_trade.json")))!.AsObject();

    [Fact]
    public void Settings_json_gains_deny_rules_hooks_and_plugins_from_several_components_without_losing_any()
    {
        JsonObject Hook(string matcher, string command) => new() { ["matcher"] = matcher, ["hooks"] = new JsonArray { new JsonObject { ["type"] = "command", ["command"] = command } } };
        ComponentBuilder.MergeSettings(Dir, new JsonObject { ["permissions"] = new JsonObject { ["deny"] = new JsonArray { "Read(.env)" } } });
        ComponentBuilder.MergeSettings(Dir, new JsonObject
        {
            ["permissions"] = new JsonObject { ["deny"] = new JsonArray { "Read(.env)", "Edit(gen/**)" } },
            ["hooks"] = new JsonObject { ["PreToolUse"] = new JsonArray { Hook("Edit|Write", "node a.mjs") } },
        });
        ComponentBuilder.MergeSettings(Dir, new JsonObject { ["hooks"] = new JsonObject { ["PreToolUse"] = new JsonArray { Hook("Edit|Write", "node b.mjs"), Hook("Bash", "node c.mjs") } } });
        ComponentBuilder.MergeSettings(Dir, new JsonObject { ["enabledPlugins"] = new JsonObject { ["x@y"] = true } });
        var s = JsonNode.Parse(Read(".claude/settings.json"))!.AsObject();
        Assert.Equal(["Read(.env)", "Edit(gen/**)"], s["permissions"]!["deny"]!.AsArray().Select(x => x!.GetValue<string>()));
        Assert.Equal([("Edit|Write", 2), ("Bash", 1)], s["hooks"]!["PreToolUse"]!.AsArray().Select(h => (h!["matcher"]!.GetValue<string>(), h["hooks"]!.AsArray().Count)));
        Assert.True(s["enabledPlugins"]!["x@y"]!.GetValue<bool>());
        Assert.True(ComponentVerifier.ValidateSettings(Dir, Card(kind: "permission", parameters: new JsonObject { ["deny"] = new JsonArray { ".env", "gen/**" } })).Passed);
    }

    [Fact]
    public void Lines_are_appended_once_under_a_header()
    {
        Write(".gitignore", "node_modules/\n");
        ComponentBuilder.AppendLines(Dir, ".gitignore", ["bin/", "obj/"], "# added by DCC");
        ComponentBuilder.AppendLines(Dir, ".gitignore", ["obj/", "packages/"], "# added by DCC");
        Assert.Equal("node_modules/\n\n# added by DCC\nbin/\nobj/\npackages/\n", Read(".gitignore"));
    }

    [Fact]
    public void A_models_answer_loses_its_fence()
    {
        Assert.Equal("# hi\n", ComponentBuilder.StripFence("```md\n# hi\n```"));
        Assert.Equal("plain\n", ComponentBuilder.StripFence("plain"));
    }

    [Fact]
    public void The_facts_the_templates_get_derive_the_commands_from_the_profile()
    {
        var p = JsonNode.Parse("""
            {"build":{"system":["package.json scripts"],"commands":["npm run build   # -> tsc"]},"ci":{"present":true,"systems":["github-actions"],"workflows":[],"commands":["npm test"]},
             "tests":{"frameworks":["vitest"],"test_files":3,"test_dirs":[]},"lint_format":["eslint"],"languages":[{"language":"TypeScript","files":1,"lines":1}],
             "package_managers":["npm"],"windows_build":{"windows_only_build":false}}
            """)!.AsObject();
        var f = ComponentBuilder.RepoFactsOf(p, "r", "main");
        Assert.Equal("npm run build", f.BuildCommand);
        Assert.Equal("npm test", f.TestCommand);
        Assert.Equal("npx eslint .", f.LintCommand);
        Assert.Equal("npm", f.PackageManager);
        Assert.False(f.WindowsOnly);
        Assert.Equal(["TypeScript"], f.Languages);
    }

    // ── from init-scan.test.ts: building what the /init draft gave ──

    [Fact]
    public void A_block_is_appended_as_it_is_blank_lines_and_a_second_fence_kept_once()
    {
        Write("AGENTS.md", "# Repo\n\n```\na\n```\n");
        ComponentBuilder.AppendBlock(Dir, "AGENTS.md", "## Run\n\n```\nnpm test\n```", "<!-- m -->");
        ComponentBuilder.AppendBlock(Dir, "AGENTS.md", "## Run\n\n```\nnpm test\n```", "<!-- m -->");
        var text = Read("AGENTS.md");
        Assert.Single(Regex.Matches(text, "## Run"));
        Assert.Equal(4, Regex.Matches(text, "```").Count);
        Assert.Contains("## Run\n\n```", text);
    }

    [Fact]
    public void A_section_under_a_heading_the_file_already_has_is_added_only_the_same_block_is_skipped()
    {
        Write("AGENTS.md", "# Repo\n\n## Verification\n\n- Build: `npm run build`\n");
        ComponentBuilder.AppendBlock(Dir, "AGENTS.md", "## Verification\n\nRun the smoke test too.", "<!-- m -->");
        Assert.Contains("Run the smoke test too.", Read("AGENTS.md"));
    }

    private static Component Section(string text, string heading = "Where things are", JsonObject? extra = null)
    {
        var parameters = new JsonObject { ["template"] = "init-section", ["text"] = text, ["heading"] = heading };
        foreach (var (k, v) in extra ?? []) parameters[k] = v?.DeepClone();
        return Card("init_section", "doc", parameters: parameters, source: "init", title: heading);
    }

    private static Task<string> NoAuthor(AuthorInput _) => Task.FromResult("");

    [Fact]
    public async Task An_approved_section_goes_into_AGENTS_md_is_imported_from_CLAUDE_md_and_its_paths_are_checked()
    {
        Write("src/app.ts", "x");
        var outcomes = await ComponentBuilder.BuildAsync(Catalog, new BuildInput(Dir, "r", Diagnosis(), [Section("The entry is `src/app.ts`.")], [], NoAuthor, _ => { }));
        Assert.Equal(ComponentStatuses.Verified, outcomes[0].Status);
        Assert.Contains("## Where things are\n\nThe entry is `src/app.ts`.", Read("AGENTS.md"));
        Assert.Equal("@AGENTS.md\n", Read("CLAUDE.md"));
    }

    [Fact]
    public async Task A_section_that_fails_its_check_is_taken_out_again_and_nothing_is_written_outside_the_copy()
    {
        Write("AGENTS.md", "# Ours\n");
        var bad = (await ComponentBuilder.BuildAsync(Catalog, new BuildInput(Dir, "r", Diagnosis(), [Section("See `src/nope/a.ts`, `lib/nope.ts` and `x/nope.ts`.", "Where")], [], NoAuthor, _ => { })))[0];
        Assert.Equal(ComponentStatuses.Failed, bad.Status);
        Assert.Contains("the check failed — the section was taken out of AGENTS.md again", bad.Notes);
        Assert.Equal("# Ours\n", Read("AGENTS.md"));
        var escape = (await ComponentBuilder.BuildAsync(Catalog, new BuildInput(Dir, "r", Diagnosis(),
            [Section("x", "Where", new JsonObject { ["template"] = "init-file", ["file"] = "../escaped.md" })], [], NoAuthor, _ => { })))[0];
        Assert.Equal(ComponentStatuses.Failed, escape.Status);
        Assert.Equal("נתיב מחוץ לעותק: ../escaped.md", escape.Validation!.Detail);
        Assert.False(File.Exists(Path.Combine(Dir, "..", "escaped.md")));
    }

    [Fact]
    public void Our_AGENTS_md_is_previewed_from_the_cards_not_declined_leaving_the_drafts_out()
    {
        Component Rule(string key, string text, string source, string status) => Card(key, "rule", status, new JsonObject { ["text"] = text }, source: source);
        var text = ComponentBuilder.PreviewAgentsMd(Catalog, Dir, Diagnosis(), "r",
            [Rule("a", "keep generated code untouched", "rule", ComponentStatuses.Proposed), Rule("b", "declined line", "rule", ComponentStatuses.Declined), Rule("c", "from the draft", "init", ComponentStatuses.Approved)]);
        Assert.Contains("keep generated code untouched", text);
        Assert.DoesNotContain("declined line", text);
        Assert.DoesNotContain("from the draft", text);
    }

    // ── a build of several cards with a stand-in author ──

    [Fact]
    public async Task A_build_writes_and_checks_each_approved_card_its_own_way_with_the_authors_text()
    {
        Write("src/app.ts", "x");
        Write(".gitignore", "node_modules/\n");
        Component Of(string key, string kind, JsonObject parameters, string status = ComponentStatuses.Approved, string title = "t") =>
            Card(key, kind, status, parameters, family: Components.FamilyOf(kind), title: title);
        Component[] cards =
        [
            Of("deny_env", "permission", new JsonObject { ["deny"] = new JsonArray { ".env", "secrets/" } }),
            Of("ignore_build", "gitignore", new JsonObject { ["entries"] = new JsonArray { "bin/", "obj/" } }),
            Of("run_tests", "skill", new JsonObject { ["process"] = "p1" }),
            Of("api_reviewer", "agent", new JsonObject { ["template"] = "process-agent", ["process"] = "p1", ["stepTitle"] = "Review the API", ["evidence"] = new JsonArray { "a review comment", "a bug" } }),
            Of("ts_lsp", "lsp", new JsonObject { ["url"] = "https://github.com/anthropics/claude-plugins-official", ["pluginName"] = "typescript-lsp" }),
            Of("crm_mcp", "mcp", new JsonObject { ["url"] = "https://github.com/acme/crm-mcp" }, title: "CRM (Dataverse)"),
            Of("windows_runner", "runner", []),
            Of("owners_report", "report", []),
            Of("not_yet", "skill", [], ComponentStatuses.Proposed),
        ];
        var process = new DiscoveredProcess { Key = "p1", Title = "Ship a change", Source = "git" };
        var asked = new List<AuthorInput>();
        Task<string> Author(AuthorInput a)
        {
            asked.Add(a);
            return Task.FromResult(a.Component.Kind == "skill"
                ? "```markdown\n---\nname: run-tests\ndescription: Runs the affected tests of a change. Use before saying a change is done.\nallowed-tools: Read, Grep, Glob, Bash\n---\n"
                  + string.Concat(Enumerable.Repeat("1. Run the tests that cover `src/app.ts` and read their output.\n", 5)) + "```"
                : "---\nname: review-the-api\ndescription: Reviews a change to the API. Call it before a pull request.\ntools: Glob, Grep, Read, Bash\nmodel: sonnet\n---\nYou review.\n\n- [ ] `src/app.ts` keeps its exports\n- [ ] b\n- [ ] c\n");
        }
        var log = new List<string>();
        var outcomes = await ComponentBuilder.BuildAsync(Catalog, new BuildInput(Dir, "r", Diagnosis(), cards, [process], Author, log.Add));
        var by = outcomes.ToDictionary(o => o.Key);

        Assert.DoesNotContain("not_yet", by.Keys);
        Assert.Equal("deny_env", outcomes[0].Key);
        Assert.Equal(ComponentStatuses.Verified, by["deny_env"].Status);
        Assert.Equal(ComponentStatuses.Verified, by["ignore_build"].Status);
        Assert.Equal("node_modules/\n\n# added by DCC onboarding\nbin/\nobj/\n", Read(".gitignore"));
        Assert.Equal(ComponentStatuses.Verified, by["run_tests"].Status);
        Assert.Equal([".claude/skills/run-tests/SKILL.md"], by["run_tests"].Files);
        Assert.StartsWith("---\nname: run-tests\n", Read(".claude/skills/run-tests/SKILL.md"));
        Assert.Equal(ComponentStatuses.Verified, by["api_reviewer"].Status);
        Assert.Equal([".claude/agents/review-the-api.md"], by["api_reviewer"].Files);
        Assert.Equal(ComponentStatuses.Installed, by["ts_lsp"].Status);
        Assert.Null(by["ts_lsp"].Validation!.Passed);
        Assert.Contains("registered as typescript-lsp@claude-plugins-official; Claude Code installs it at the first session", by["ts_lsp"].Notes);
        Assert.Equal(ComponentStatuses.Deferred, by["crm_mcp"].Status);
        Assert.Null(by["crm_mcp"].Validation);
        Assert.Equal("crm", cards.Single(c => c.Key == "crm_mcp").Params["server"]!.GetValue<string>());
        Assert.Equal(ComponentStatuses.Deferred, by["windows_runner"].Status);
        Assert.Equal(ComponentStatuses.Reported, by["owners_report"].Status);

        var settings = JsonNode.Parse(Read(".claude/settings.json"))!.AsObject();
        Assert.Equal(["Read(.env)", "Edit(.env)", "Read(secrets/**)", "Edit(secrets/**)"], settings["permissions"]!["deny"]!.AsArray().Select(x => x!.GetValue<string>()));
        Assert.True(settings["enabledPlugins"]!["typescript-lsp@claude-plugins-official"]!.GetValue<bool>());

        Assert.Equal(2, asked.Count);
        Assert.All(asked, a => Assert.Same(process, a.Process));
        Assert.Contains("name: run-tests;", asked.Single(a => a.Component.Kind == "skill").Format);
        Assert.Equal("a review comment\na bug", asked.Single(a => a.Component.Kind == "agent").Evidence);
        Assert.Equal($"▸ {Components.FamilyHe["safety"]} · {Components.KindHe["permission"]} · t", log[0]);
        Assert.Contains(log, l => l.StartsWith("  ✓ .claude/skills/run-tests/SKILL.md — ", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Rule_lines_without_a_scaffold_get_an_AGENTS_md_of_their_own_with_the_slots_replaced_as_JavaScript_replaced_them()
    {
        Write("README.md", "# Title\n\n![logo](x.png)\n\nThis repository trades funds for clients: it costs $$5 a trade and $& is not a slot at all.\n");
        Component[] cards =
        [
            Card("r1", parameters: new JsonObject { ["text"] = "Never edit `Generated/` by hand" }),
            Card("r2", parameters: new JsonObject { ["text"] = "Run the tests" }),
        ];
        var outcomes = await ComponentBuilder.BuildAsync(Catalog, new BuildInput(Dir, "altshuler_trade", Diagnosis(), cards, [], NoAuthor, _ => { }));
        var agents = Read("AGENTS.md");
        // "$$" is one dollar and "$&" the slot's own text, which the last pass then takes out.
        Assert.Contains("\n\nThis repository trades funds for clients: it costs $5 a trade and  is not a slot at all.\n", agents);
        Assert.Contains("- Never edit `Generated/` by hand\n- Run the tests", agents);
        Assert.Contains("- The build runs only on a Windows runner; without one, do not claim a build or a test run.", agents);
        Assert.DoesNotContain("{{", agents);
        Assert.Equal("@AGENTS.md\n", Read("CLAUDE.md"));
        Assert.Equal(["AGENTS.md", "CLAUDE.md"], outcomes[0].Files);
        Assert.Equal(["AGENTS.md"], outcomes[1].Files);
    }

    private static readonly Lazy<bool> NodeAvailable = new(() =>
    {
        try
        {
            using var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("node", "--version") { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true })!;
            p.WaitForExit(15_000);
            return p.ExitCode == 0;
        }
        catch (System.ComponentModel.Win32Exception) { return false; }
    });

    /// <summary>The hooks and the gate are run with the node on PATH; without one there is nothing to run them with.</summary>
    public sealed class FactWithNodeAttribute : FactAttribute
    {
        public FactWithNodeAttribute()
        {
            if (!NodeAvailable.Value) Skip = "node is not on PATH";
        }
    }

    [FactWithNode]
    public async Task The_catalogs_hooks_and_the_local_gate_are_run_for_real_against_a_forbidden_action()
    {
        Component Hook(string key, JsonObject parameters) => Card(key, "hook", parameters: parameters, family: "enforcement");
        Component[] cards =
        [
            Hook("block_generated", new JsonObject { ["template"] = "block-paths", ["paths"] = new JsonArray { "src/generated/" } }),
            Hook("block_apply", new JsonObject { ["template"] = "block-commands", ["patterns"] = new JsonArray { "terraform apply" } }),
            Hook("secrets", new JsonObject { ["template"] = "secret-scan", ["allowTests"] = true }),
            Hook("gate_hook", new JsonObject { ["template"] = "build-gate" }),
            Card("gate", "script", parameters: new JsonObject { ["template"] = "local-gate" }, family: "verification"),
        ];
        var outcomes = await ComponentBuilder.BuildAsync(Catalog, new BuildInput(Dir, "r", [], cards, [], NoAuthor, _ => { }));
        var by = outcomes.ToDictionary(o => o.Key);
        foreach (var key in new[] { "block_generated", "block_apply", "secrets", "gate_hook", "gate" })
            Assert.True(by[key].Status == ComponentStatuses.Verified, $"{key}: {by[key].Validation?.How} — {by[key].Validation?.Detail}");
        Assert.Equal("ניסיון עריכה של src/generated/file.txt", by["block_generated"].Validation!.How);
        Assert.Equal("VERIFY: nothing to run", by["gate"].Validation!.Detail);
    }

    [Fact]
    public void An_mcp_fragment_is_merged_by_server_name_and_written_as_the_old_server_wrote_it()
    {
        Write(".mcp.json", """{"mcpServers":{"a":{"command":"x"}},"other":1}""");
        ComponentBuilder.MergeMcp(Dir, new JsonObject { ["mcpServers"] = new JsonObject { ["b"] = new JsonObject { ["url"] = "u" } } });
        Assert.Equal("{\n  \"mcpServers\": {\n    \"a\": {\n      \"command\": \"x\"\n    },\n    \"b\": {\n      \"url\": \"u\"\n    }\n  },\n  \"other\": 1\n}\n", Read(".mcp.json"));
    }

    // ── found in review: JSON, slugs and key order as JavaScript has them ──

    [Fact]
    public void A_settings_file_is_read_as_JSON_parse_read_it_and_written_as_JSON_stringify_wrote_it()
    {
        // A key given twice, integer keys, numbers JavaScript prints its own way, characters System.Text.Json escapes and JavaScript does not.
        Write(".claude/settings.json",
            "{\"model\":\"a\",\"permissions\":{\"deny\":[\"Read(.env)\"],\"allow\":[]},\"model\":\"b\",\"10\":1,\"2\":{\"x\":1.0,\"y\":0.0000123,\"z\":1e-7,\"w\":100,\"v\":1e21},"
            + "\"hooks\":{\"PreToolUse\":[{\"matcher\":\"Edit\",\"hooks\":[{\"type\":\"command\",\"command\":\"node a.mjs\",\"timeout\":60.0}]}]},"
            + "\"note\":\"emoji \\uD83D\\uDE00 sep \\u2028 pua \\ue000 del \\u007f ctl \\u0001 \\\"q\\\" <>&'\"}");
        Assert.True(ComponentVerifier.ValidateSettings(Dir, Card(kind: "permission", parameters: new JsonObject { ["deny"] = new JsonArray { ".env" } })).Passed);
        ComponentBuilder.MergeSettings(Dir, new JsonObject
        {
            ["permissions"] = new JsonObject { ["deny"] = new JsonArray { "Read(.env)" } },
            ["hooks"] = new JsonObject { ["PreToolUse"] = new JsonArray { new JsonObject { ["matcher"] = "Edit", ["hooks"] = new JsonArray { new JsonObject { ["type"] = "command", ["command"] = "node a.mjs", ["timeout"] = 60 } } } } },
            ["enabledPlugins"] = new JsonObject { ["x@y"] = true },
        });
        // What the old server's mergeSettings wrote for the same file and fragment (run in node).
        Assert.Equal(
            "{\n  \"2\": {\n    \"x\": 1,\n    \"y\": 0.0000123,\n    \"z\": 1e-7,\n    \"w\": 100,\n    \"v\": 1e+21\n  },\n  \"10\": 1,\n  \"model\": \"b\",\n"
            + "  \"permissions\": {\n    \"deny\": [\n      \"Read(.env)\"\n    ],\n    \"allow\": []\n  },\n"
            + "  \"hooks\": {\n    \"PreToolUse\": [\n      {\n        \"matcher\": \"Edit\",\n        \"hooks\": [\n          {\n            \"type\": \"command\",\n            \"command\": \"node a.mjs\",\n            \"timeout\": 60\n          }\n        ]\n      }\n    ]\n  },\n"
            + "  \"note\": \"emoji \U0001F600 sep " + (char)0x2028 + " pua " + (char)0xE000 + " del " + (char)0x7F + " ctl \\u0001 \\\"q\\\" <>&'\",\n  \"enabledPlugins\": {\n    \"x@y\": true\n  }\n}\n",
            Read(".claude/settings.json"));
    }

    [Fact]
    public async Task A_package_folder_lists_its_own_scripts_and_one_whose_script_is_not_text_keeps_the_fallback()
    {
        Write("pkg/a/package.json", """{"scripts":{"test":"vitest run","postinstall":"x","build":"tsc"}}""");
        Write("pkg/b/package.json", """{"scripts":{"build":"tsc","lint":null}}""");
        var card = Card("per_package", "scaffold", parameters: new JsonObject { ["template"] = "per-package", ["packages"] = new JsonArray { "pkg/a", "pkg/b", "pkg/gone" } });
        var outcome = (await ComponentBuilder.BuildAsync(Catalog, new BuildInput(Dir, "r", Diagnosis(), [card], [], NoAuthor, _ => { })))[0];
        Assert.Equal(["pkg/a/CLAUDE.md", "pkg/b/CLAUDE.md"], outcome.Files);
        Assert.Contains("- `npm run test` → `vitest run`\n- `npm run build` → `tsc`", Read("pkg/a/CLAUDE.md"));
        Assert.Contains("(see the root)", Read("pkg/b/CLAUDE.md"));
        Assert.Contains("pkg/gone does not exist — skipped", outcome.Notes);
    }

    [Fact]
    public async Task A_name_slugged_from_a_title_lowercases_a_dotted_capital_I_as_JavaScript_did()
    {
        var card = Card("izmir_mcp", "mcp", parameters: new JsonObject { ["url"] = "https://github.com/acme/crm-mcp" }, family: "connections", title: (char)0x0130 + "zmir CRM (Dataverse)");
        var outcome = (await ComponentBuilder.BuildAsync(Catalog, new BuildInput(Dir, "r", Diagnosis(), [card], [], NoAuthor, _ => { })))[0];
        Assert.Equal(ComponentStatuses.Deferred, outcome.Status);
        Assert.Equal("i-zmir-crm", card.Params["server"]!.GetValue<string>());
    }

    [Fact]
    public void External_systems_are_listed_in_the_order_a_JavaScript_object_keeps_its_keys()
    {
        var profile = Diagnosis();
        profile["external_systems"] = new JsonObject
        {
            ["crm"] = new JsonObject { ["count"] = 1, ["sample_files"] = new JsonArray { "a.cs" } },
            ["2"] = new JsonObject { ["count"] = 1, ["sample_files"] = new JsonArray { "b.cs" } },
        };
        var scaffold = Card("agents_md", "scaffold", ComponentStatuses.Proposed, new JsonObject { ["template"] = "agents-md" });
        var text = ComponentBuilder.PreviewAgentsMd(Catalog, Dir, profile, "r", [scaffold]);
        Assert.Contains("- 2 (referenced in `b.cs`)\n- crm (referenced in `a.cs`)", text);
    }

    [FactWithNode]
    public void A_gate_whose_build_server_keeps_the_output_open_is_judged_on_what_it_printed()
    {
        // The process left behind holds node's stdout for 15 seconds after node exits; only 10 are waited for.
        Write("scripts/dcc-verify.mjs", """
            import { spawn } from "node:child_process";
            import os from "node:os";
            spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], { cwd: os.tmpdir(), stdio: ["ignore", "inherit", "inherit"], detached: true }).unref();
            console.log("VERIFY: ok");
            """);
        var v = ComponentVerifier.ValidateScript(Card(kind: "script", files: ["scripts/dcc-verify.mjs"]), Dir);
        Assert.True(v.Passed);
        Assert.Equal("VERIFY: ok", v.Detail);
    }

    [Fact]
    public void The_dossier_is_four_files_under_dcc_with_hebrew_as_it_is()
    {
        var card = Card("agents_md", "scaffold", ComponentStatuses.Verified, files: ["AGENTS.md"], title: "AGENTS.md מהאבחון");
        var trial = new TrialOutcome("t1", "משימה", "baseline", true, null, "ok", 0.12, null, "code");
        var files = ComponentBuilder.WriteDossier(Dir, new DossierInput(Diagnosis(), [new ProfileCorrection("tests.frameworks", null, "u1", "2026-10-25T00:00:00.000Z")],
            [card], [trial], [new DiscoveredProcess { Key = "p1", Title = "Ship", Source = "git" }], "run-1", null));
        Assert.Equal([".dcc/profile.json", ".dcc/components.json", ".dcc/processes.json", ".dcc/trials.json"], files);
        var components = Read(".dcc/components.json");
        Assert.Contains("\"title\": \"AGENTS.md מהאבחון\"", components);
        Assert.Contains("\"sourceRef\": null", components);
        var profile = JsonNode.Parse(Read(".dcc/profile.json"))!.AsObject();
        Assert.Equal(["writtenAt", "runId", "baselineSha", "corrections", "profile"], profile.Select(kv => kv.Key));
        Assert.Equal("altshuler_trade", profile["profile"]!["name"]!.GetValue<string>());
        Assert.Equal(0.12, JsonNode.Parse(Read(".dcc/trials.json"))!["trials"]![0]!["costUsd"]!.GetValue<double>());
    }
}
