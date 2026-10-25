using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Onboarding;

namespace Dcc.Tests.Unit.Onboarding;

/// <summary>
/// Phase 4.7: the scan of the <c>/init</c> draft — which files are the draft, how the editor's answer is read, what it
/// takes becoming cards, and those cards built (init-scan.test.ts). Each test gets its own scratch copy holding
/// <c>src/app.ts</c>; the old tests shared one across a describe block.
/// </summary>
public sealed class InitScanTests : IDisposable
{
    private readonly string dir = ComponentVerifier.ScratchDir();

    private static readonly OnboardingCatalog Catalog =
        new(Path.GetDirectoryName(Path.GetDirectoryName(OnboardingFiles.Data("catalog/templates/hooks/block-paths.mjs")))!);

    private static JsonObject Profile() =>
        JsonNode.Parse(File.ReadAllText(OnboardingFiles.Repo("docs/research/sources/onboarding-v2/repos/diagnosis/altshuler_trade.json")))!.AsObject();

    private static readonly List<Component> Ours = [new() { Key = "agents_md", TitleHe = "AGENTS.md מהאבחון" }];

    public InitScanTests()
    {
        Directory.CreateDirectory(Path.Combine(dir, "src"));
        File.WriteAllText(Path.Combine(dir, "src/app.ts"), "x");
    }

    public void Dispose()
    {
        try { Directory.Delete(dir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    /// <summary>The old tests' <c>item(o)</c>: a line to take as it is; a test changes what it needs with <c>with</c>.</summary>
    private static readonly InitScanItem Item = new()
    {
        Decision = "take", Form = "line", Title = "t", Target = "AGENTS.md", Heading = null, Text = "x", Origin = "theirs",
        Need = "", Evidence = "", Alternative = "", Verify = "", Cost = "", Question = null, Replaces = [],
    };

    private static InitScan ScanOf(params InitScanItem[] items) => new("partial", "", [], items, [], []);

    private ScanSeeds Seeds(InitScan scan, IReadOnlyList<Component>? ours = null, Func<string, bool>? inBaseline = null) =>
        InitScanSeeds.SeedsFromScan(new ScanSeedsInput(scan, dir, [], ours ?? Ours, inBaseline ?? (_ => false)));

    private static Task<string> NoAuthor(AuthorInput _) => Task.FromResult("");

    private static ComponentSeed Seed(string key, string kind, string source, JsonObject? parameters = null) => new()
    {
        Key = key, Kind = kind, Family = "knowledge", TitleHe = key, WhyHe = "", WhatHe = "", Source = source, SourceRef = null, Risk = "reversible", VerifyHowHe = "",
        Params = parameters ?? [],
    };

    private static Component WithStatus(Component c, string status)
    {
        c.Status = status;
        return c;
    }

    // ── the draft ────────────────────────────────────────────────────────

    [Fact]
    public void Is_what_the_session_wrote_plus_the_changed_instruction_files_never_DCCs_own()
    {
        Assert.Equal([".claude/skills/a/SKILL.md", "AGENTS.md", "pkg/CLAUDE.md", "src/x.ts"],
            InitScans.DraftPaths(["src/x.ts", ".dcc/profile.json"], ["AGENTS.md", "pkg/CLAUDE.md", ".claude/skills/a/SKILL.md", "README.md"]));
    }

    [Fact]
    public void Reads_the_files_the_session_wrote_from_its_transcript_relative_to_the_copy()
    {
        var t = Path.Combine(dir, "t.jsonl");
        string Use(string name, string filePath) => new JsonObject
        {
            ["type"] = "assistant",
            ["message"] = new JsonObject { ["content"] = new JsonArray { new JsonObject { ["type"] = "tool_use", ["name"] = name, ["input"] = new JsonObject { ["file_path"] = filePath } } } },
        }.ToJsonString();
        File.WriteAllText(t, string.Join("\n", Use("Write", Path.Combine(dir, "AGENTS.md")), Use("Edit", "docs/a.md"), Use("Read", Path.Combine(dir, "x.md")), Use("Write", "/elsewhere/y.md"), ""));
        Assert.Equal(["AGENTS.md", "docs/a.md"], Transcript.WrittenPaths(t, dir));
    }

    [Fact]
    public void Shows_a_new_file_whole_a_changed_one_before_and_after_and_names_a_deleted_one()
    {
        var text = InitScans.RenderDraft([new("AGENTS.md", null, "new"), new("CLAUDE.md", "old", "changed"), new("x.md", "gone", null)]);
        Assert.Contains("AGENTS.md (NEW", text);
        Assert.Matches(new Regex(@"CLAUDE\.md \(CHANGED[\s\S]*old[\s\S]*changed"), text);
        Assert.Contains("x.md (DELETED", text);
        Assert.Contains("more characters not shown", InitScans.RenderDraft([new("big.md", null, new string('a', 30_000))], 1000, 5000));
    }

    // ── the editor's answer ──────────────────────────────────────────────

    [Fact]
    public void Reads_the_JSON_inside_a_fence_and_drops_what_is_malformed()
    {
        const string json = """{"verdict":"merge","summary":"s","items":[{"decision":"take","form":"line","text":"- Use `npm test`","title":"t"},{"decision":"maybe","form":"line","text":"x"},{"decision":"ask","form":"section","text":"","title":"empty"}],"drop_ours":[{"key":"a","why":"w"},{"why":"no key"}],"reject":[{"what":"generic","why":"g"}]}""";
        var s = InitScans.ParseInitScan("here:\n```json\n" + json + "\n```");
        Assert.Equal("merge", s.Verdict);
        Assert.Single(s.Items);
        Assert.Null(s.Items[0].Question);
        Assert.Equal([new InitScanDrop("a", "w")], s.DropOurs);
        Assert.Single(s.Reject);
    }

    [Fact]
    public void Falls_back_to_a_verdict_that_matches_what_it_took_and_refuses_an_answer_with_no_JSON()
    {
        Assert.Equal("keep_ours", InitScans.ParseInitScan("""{"items":[]}""").Verdict);
        Assert.Equal("partial", InitScans.ParseInitScan("""{"items":[{"decision":"check","form":"line","text":"x"}]}""").Verdict);
        Assert.Throws<FormatException>(() => InitScans.ParseInitScan("I could not decide"));
    }

    // Not in init-scan.test.ts: what String(v) gives for a number where a text was asked for, and a nesting JSON.parse reads.
    [Fact]
    public void Reads_a_number_where_a_text_was_asked_for_as_JavaScript_prints_it_and_reads_deep_JSON()
    {
        var s = InitScans.ParseInitScan("""{"summary":-0,"items":[{"decision":"take","form":"line","text":1e21,"title":1152921504606846976,"need":1.5e-7,"cost":0.000001,"replaces":[100,1.0,0.1]}]}""");
        Assert.Equal("0", s.Summary);
        var t = Assert.Single(s.Items);
        Assert.Equal(("1e+21", "1152921504606847000", "1.5e-7", "0.000001"), (t.Text, t.Title, t.Need, t.Cost));
        Assert.Equal(["100", "1", "0.1"], t.Replaces);
        var deep = new string('[', 100) + new string(']', 100);
        Assert.Equal("deep", InitScans.ParseInitScan($$"""{"summary":"deep","x":{{deep}}}""").Summary);
    }

    // ── from what it takes to cards ──────────────────────────────────────

    [Fact]
    public void Takes_only_files_DCC_can_build_and_verify_as_a_kind()
    {
        Assert.Equal("skill", InitScans.FileKind(".claude/skills/release/SKILL.md"));
        Assert.Equal("agent", InitScans.FileKind(".claude/agents/reviewer.md"));
        Assert.Equal("doc", InitScans.FileKind("packages/api/CLAUDE.md"));
        Assert.Null(InitScans.FileKind(".claude/settings.json"));
        Assert.Null(InitScans.FileKind(".mcp.json"));
        Assert.Null(InitScans.FileKind("AGENTS.md"));
    }

    [Fact]
    public void Never_lets_a_path_the_model_wrote_leave_the_copy()
    {
        foreach (var p in new[] { "../../.claude/CLAUDE.md", "../other/CLAUDE.md", "docs/../../../tmp/x.md", "/etc/CLAUDE.md", "C:/x/CLAUDE.md", "a\\CLAUDE.md", "./CLAUDE.md", "a//CLAUDE.md" })
            Assert.True(InitScans.FileKind(p) is null, p);
        Assert.True(InitScans.InsideCopy("docs/v1..v2.md"));
    }

    [Fact]
    public void Makes_one_card_of_the_same_text_given_twice()
    {
        var scan = ScanOf(Item with { Text = "Use `npm test`" }, Item with { Text = "- Use `npm test`" });
        Assert.Single(Seeds(scan).Seeds);
    }

    [Fact]
    public void Makes_a_card_per_item_with_its_reasoning_the_same_key_for_the_same_text_and_says_what_it_refused()
    {
        var scan = ScanOf(
            Item with { Text = "- Handlers live in `src/app.ts`", Need = "the trial missed it", Evidence = "src/app.ts", Replaces = ["agents_md", "not_a_card"] },
            Item with { Form = "file", Target = ".claude/settings.json", Text = "{}" },
            Item with { Form = "file", Target = ".claude/skills/x/SKILL.md", Text = "---\nname: x\n---" },
            Item with { Decision = "ask", Form = "line", Text = "Deploy to the client's environment after merge", Question = "מותר לפרוס?" });
        var a = Seeds(scan, inBaseline: p => p == ".claude/skills/x/SKILL.md");
        var b = Seeds(scan);
        Assert.Equal(2, a.Seeds.Count);
        Assert.Matches(new Regex(@"settings\.json[\s\S]*כבר קיים"), string.Join(" ", a.Refused.Select(r => r.Why)));
        var line = a.Seeds[0];
        Assert.Equal("rule", line.Kind);
        Assert.Equal("init", line.Source);
        Assert.Equal("Handlers live in `src/app.ts`", line.Params["text"]!.GetValue<string>());
        Assert.Equal(["agents_md"], line.Params["replaces"]!.AsArray().Select(k => k!.GetValue<string>()));
        Assert.Contains("הצורך: the trial missed it", line.WhyHe);
        Assert.Contains("מחליף את: AGENTS.md מהאבחון", line.WhyHe);
        Assert.Contains("צריך החלטה שלך: מותר לפרוס?", a.Seeds[1].WhyHe);
        Assert.Subset(b.Seeds.Select(s => s.Key).ToHashSet(), a.Seeds.Select(s => s.Key).ToHashSet());
    }

    [Fact]
    public void Puts_text_that_names_paths_the_code_does_not_have_under_not_recommended()
    {
        var scan = ScanOf(Item with { Form = "section", Heading = "Layout", Text = "- `src/nope/` has the api\n- `lib/missing.ts` too\n- `src/app.ts` is the entry" });
        var seeds = Seeds(scan).Seeds;
        Assert.True(seeds[0].NotRecommended);
        Assert.Equal("not_recommended", Components.CardFromSeed(seeds[0], Automation.ReversibleAuto).Group);
    }

    [Fact]
    public void Notes_a_card_of_ours_once_and_takes_the_note_off_again()
    {
        var once = InitScans.WithScanNote("because X.", "duplicated by the draft");
        Assert.Equal("because X. סריקת /init: still duplicated", InitScans.WithScanNote(once, "still duplicated"));
        Assert.Equal("because X.", InitScans.WithScanNote(once, null));
    }

    // ── building what was taken ──────────────────────────────────────────

    [Fact]
    public void Appends_a_block_as_it_is_blank_lines_and_a_second_fence_kept_once()
    {
        File.WriteAllText(Path.Combine(dir, "AGENTS.md"), "# Repo\n\n```\na\n```\n");
        ComponentBuilder.AppendBlock(dir, "AGENTS.md", "## Run\n\n```\nnpm test\n```", "<!-- m -->");
        ComponentBuilder.AppendBlock(dir, "AGENTS.md", "## Run\n\n```\nnpm test\n```", "<!-- m -->");
        var text = File.ReadAllText(Path.Combine(dir, "AGENTS.md"));
        Assert.Single(Regex.Matches(text, "## Run"));
        Assert.Equal(4, Regex.Matches(text, "```").Count);
        Assert.Contains("## Run\n\n```", text);
    }

    [Fact]
    public void Adds_a_section_under_a_heading_the_file_already_has_the_text_is_new_only_the_same_block_is_skipped()
    {
        File.WriteAllText(Path.Combine(dir, "AGENTS.md"), "# Repo\n\n## Verification\n\n- Build: `npm run build`\n");
        ComponentBuilder.AppendBlock(dir, "AGENTS.md", "## Verification\n\nRun the smoke test too.", "<!-- m -->");
        Assert.Contains("Run the smoke test too.", File.ReadAllText(Path.Combine(dir, "AGENTS.md")));
    }

    [Fact]
    public void Builds_the_drafts_cards_after_ours_in_the_same_family()
    {
        Component C(string key, string source) => WithStatus(Components.CardFromSeed(Seed(key, "doc", source), Automation.AllApproval), ComponentStatuses.Approved);
        Assert.Equal(["z_ours", "a_init"], Components.BuildOrder([C("a_init", "init"), C("z_ours", "rule")]).Select(x => x.Key));
    }

    [Fact]
    public async Task Writes_an_approved_section_into_AGENTS_md_imports_it_from_CLAUDE_md_and_checks_its_paths()
    {
        var seed = Seeds(ScanOf(Item with { Form = "section", Heading = "Where things are", Text = "The entry is `src/app.ts`." }), ours: []).Seeds[0];
        var card = WithStatus(Components.CardFromSeed(seed, Automation.AllApproval), ComponentStatuses.Approved);
        var output = await ComponentBuilder.BuildAsync(Catalog, new BuildInput(dir, "r", Profile(), [card], [], NoAuthor, _ => { }));
        Assert.Equal(ComponentStatuses.Verified, output[0].Status);
        Assert.Contains("## Where things are\n\nThe entry is `src/app.ts`.", File.ReadAllText(Path.Combine(dir, "AGENTS.md")));
        Assert.True(File.Exists(Path.Combine(dir, "CLAUDE.md")));
    }

    [Fact]
    public async Task Takes_a_section_that_fails_its_check_out_of_AGENTS_md_again_and_never_writes_outside_the_copy()
    {
        File.WriteAllText(Path.Combine(dir, "AGENTS.md"), "# Ours\n");
        Component Approved(string text, JsonObject? extra = null)
        {
            var seed = Seeds(ScanOf(Item with { Form = "section", Heading = "Where", Text = text }), ours: []).Seeds[0];
            seed.NotRecommended = false;
            var card = WithStatus(Components.CardFromSeed(seed, Automation.AllApproval), ComponentStatuses.Approved);
            var parameters = (JsonObject)seed.Params.DeepClone();
            foreach (var (k, v) in extra ?? []) parameters[k] = v?.DeepClone();
            card.Params = parameters;
            return card;
        }
        var bad = (await ComponentBuilder.BuildAsync(Catalog, new BuildInput(dir, "r", Profile(), [Approved("See `src/nope/a.ts`, `lib/nope.ts` and `x/nope.ts`.")], [], NoAuthor, _ => { })))[0];
        Assert.Equal(ComponentStatuses.Failed, bad.Status);
        Assert.Equal("# Ours\n", File.ReadAllText(Path.Combine(dir, "AGENTS.md")));
        var escape = (await ComponentBuilder.BuildAsync(Catalog, new BuildInput(dir, "r", Profile(),
            [Approved("x", new JsonObject { ["template"] = "init-file", ["file"] = "../escaped.md" })], [], NoAuthor, _ => { })))[0];
        Assert.Equal(ComponentStatuses.Failed, escape.Status);
        Assert.False(File.Exists(Path.Combine(dir, "..", "escaped.md")));
    }

    [Fact]
    public void Previews_our_AGENTS_md_from_the_cards_not_declined_leaving_the_drafts_out()
    {
        Component Rule(string key, string text, string source, string status) =>
            WithStatus(Components.CardFromSeed(Seed(key, "rule", source, new JsonObject { ["text"] = text }), Automation.AllApproval), status);
        var text = ComponentBuilder.PreviewAgentsMd(Catalog, ComponentVerifier.ScratchDir(), Profile(), "r",
            [Rule("a", "keep generated code untouched", "rule", ComponentStatuses.Proposed), Rule("b", "declined line", "rule", ComponentStatuses.Declined), Rule("c", "from the draft", "init", ComponentStatuses.Approved)]);
        Assert.Contains("keep generated code untouched", text);
        Assert.DoesNotContain("declined line", text);
        Assert.DoesNotContain("from the draft", text);
    }
}

/// <summary>
/// Phase 4.7: reading a Claude Code transcript and the status-line snapshot back (transcript.ts) — the old server had no
/// tests of its own for it; these are written from small .jsonl samples shaped like the real ones.
/// </summary>
public sealed class TranscriptTests : IDisposable
{
    private readonly string dir = ComponentVerifier.ScratchDir();

    public void Dispose()
    {
        try { Directory.Delete(dir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    /// <summary>A transcript of complete lines, each ended by a newline — plus <paramref name="partial"/>, a last line still being written.</summary>
    private string Jsonl(IEnumerable<string> lines, string partial = "")
    {
        var file = Path.Combine(dir, "t.jsonl");
        File.WriteAllText(file, string.Concat(lines.Select(l => l + "\n")) + partial);
        return file;
    }

    private static string UserSays(string text) => new JsonObject { ["type"] = "user", ["message"] = new JsonObject { ["role"] = "user", ["content"] = text } }.ToJsonString();

    private static string AssistantEnds(string stop) =>
        new JsonObject { ["type"] = "assistant", ["message"] = new JsonObject { ["content"] = new JsonArray { new JsonObject { ["type"] = "text", ["text"] = "ok" } }, ["stop_reason"] = stop } }.ToJsonString();

    // ── the decision log ─────────────────────────────────────────────────

    [Fact]
    public void Scan_turns_what_the_person_typed_ran_and_answered_into_facts_and_skips_the_rest()
    {
        var file = Jsonl(
        [
            """{"type":"user","timestamp":"t1","message":{"role":"user","content":"  Please   write AGENTS.md "}}""",
            """{"type":"user","isMeta":true,"message":{"content":"meta text"}}""",
            """{"type":"user","message":{"content":"<command-name>/init</command-name>\n<command-args> --fast </command-args>"}}""",
            """{"type":"user","message":{"content":"<local-command-stdout>ok</local-command-stdout>"}}""",
            """{"type":"user","message":{"content":"<system-reminder>x</system-reminder>"}}""",
            """{"type":"user","toolUseResult":{"answers":{"Which tests?":"vitest","Which branches?":["main","dev"]}},"message":{"content":[{"type":"tool_result","content":"ignored"}]}}""",
            """{"type":"user","message":{"content":[{"type":"tool_result","content":"User has answered your questions: \"Deploy?\"=\"No\" \"CI?\"=\"\""}]}}""",
            """{"type":"user","message":{"content":[{"type":"text","text":"first"},{"type":"image"},{"type":"text","text":"second"}]}}""",
            "not json",
            """{"type":"assistant","message":{"id":"m1","content":[]}}""",
            """{"type":"assistant","message":{"id":"m1","content":[]}}""",
            """{"type":"assistant","message":{"id":"m2","content":[]}}""",
        ], partial: """{"type":"user","message":{"content":"half""");
        var scan = Transcript.Scan(file, 0, null);
        Assert.Equal(
        [
            TranscriptFact.Prompt("Please   write AGENTS.md", "t1"),
            TranscriptFact.CommandRun("/init --fast", null),
            TranscriptFact.AnswerGiven("Which tests?", "vitest", null),
            TranscriptFact.AnswerGiven("Which branches?", "main, dev", null),
            TranscriptFact.AnswerGiven("Deploy?", "No", null),
            TranscriptFact.AnswerGiven("CI?", "", null),
            TranscriptFact.Prompt("first\nsecond", null),
        ], scan.Facts);
        Assert.Equal((12, 2, "m2"), (scan.Cursor, scan.ApiCalls, scan.LastMessageId));

        // Idempotent: from the cursor nothing is new; the half-written line is read once it is complete.
        var again = Transcript.Scan(file, 12, "m2");
        Assert.Equal((0, 12, 0, "m2"), (again.Facts.Count, again.Cursor, again.ApiCalls, again.LastMessageId));
        File.AppendAllText(file, " done\"}}\n");
        var next = Transcript.Scan(file, 12, "m2");
        Assert.Equal([TranscriptFact.Prompt("half done", null)], next.Facts);
        Assert.Equal(13, next.Cursor);
    }

    [Fact]
    public void Scan_clips_a_long_prompt_and_leaves_a_missing_file_as_it_was()
    {
        var fact = Transcript.Scan(Jsonl([UserSays(new string('a', 400))]), 0, null).Facts.Single();
        Assert.Equal(new string('a', 299) + "…", fact.Text);
        var missing = Transcript.Scan(Path.Combine(dir, "nope.jsonl"), 5, "x");
        Assert.Equal((0, 5, 0, "x"), (missing.Facts.Count, missing.Cursor, missing.ApiCalls, missing.LastMessageId));
    }

    [Fact]
    public void Answers_come_in_JavaScripts_key_order_and_a_cut_emoji_is_kept_as_it_was_written()
    {
        var file = Jsonl(
        [
            """{"type":"user","toolUseResult":{"answers":{"b":"1","2":"x","1":"y","b":"last"}}}""",
            """{"type":"user","message":{"content":"cut \ud83d"}}""",
            """{"type":"user","toolUseResult":{"answers":{"q\udc00":"a\ud83d"}}}""",
        ]);
        var facts = Transcript.Scan(file, 0, null).Facts;
        Assert.Equal([("1", "y"), ("2", "x"), ("b", "last")], facts.Take(3).Select(f => (f.Question, f.Answer)));
        Assert.Equal("cut \ud83d", facts[3].Text);
        Assert.Equal(("q\udc00", "a\ud83d"), (facts[4].Question, facts[4].Answer));
    }

    [Fact]
    public void An_answer_that_is_a_number_reads_as_JavaScript_prints_it()
    {
        var file = Jsonl(["""{"type":"user","toolUseResult":{"answers":{"a":-0,"b":1e21,"c":1.5e-7,"d":1152921504606846976,"e":[0.1,100]}}}"""]);
        Assert.Equal(["0", "1e+21", "1.5e-7", "1152921504606847000", "0.1, 100"], Transcript.Scan(file, 0, null).Facts.Select(f => f.Answer));
    }

    [Fact]
    public void A_fact_becomes_the_payload_the_old_server_spread()
    {
        Assert.Equal("""{"text":"hi","at":"t"}""", TranscriptFact.Prompt("hi", "t").Payload().ToJsonString());
        Assert.Equal("""{"command":"/init","at":null}""", TranscriptFact.CommandRun("/init", null).Payload().ToJsonString());
        Assert.Equal("""{"question":"q","answer":"a","at":null}""", TranscriptFact.AnswerGiven("q", "a", null).Payload().ToJsonString());
    }

    [Fact]
    public void Reads_the_status_snapshot_normalised()
    {
        var file = Path.Combine(dir, "status.json");
        File.WriteAllText(file, """
            {"session_id":"s1","transcript_path":"C:/x/t.jsonl","cost":{"total_cost_usd":0.42,"total_api_duration_ms":1200,"total_duration_ms":"oops","total_lines_added":3},
             "context_window":{"total_input_tokens":100,"total_output_tokens":50},"model":{"display_name":"Opus","id":"claude-opus"},"effort":{"level":"high"}}
            """);
        var snap = Transcript.ReadStatusSnapshot(file)!;
        Assert.Equal(("s1", "C:/x/t.jsonl"), (snap.SessionId, snap.TranscriptPath));
        var s = snap.Status;
        Assert.Equal((0.42, 1200d, 0d, 100d, 50d, 3d, 0d), (s.CostUsd, s.ApiDurationMs, s.DurationMs, s.InputTokens, s.OutputTokens, s.LinesAdded, s.LinesRemoved));
        Assert.Equal(("Opus", "claude-opus", "high"), (s.Model, s.ModelId, s.Effort));
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", s.UpdatedAt);
        Assert.StartsWith("""{"costUsd":0.42,"apiDurationMs":1200,"durationMs":0,"inputTokens":100,"outputTokens":50,"model":"Opus","modelId":"claude-opus","effort":"high","linesAdded":3,"linesRemoved":0,"updatedAt":""", JsonSerializer.Serialize(s));

        File.WriteAllText(file, """{"model":"Opus"}""");
        Assert.Null(Transcript.ReadStatusSnapshot(file)!.Status.Model);
        File.WriteAllText(file, "{ half");
        Assert.Null(Transcript.ReadStatusSnapshot(file));
        File.WriteAllText(file, "null");
        Assert.Null(Transcript.ReadStatusSnapshot(file));
        Assert.Null(Transcript.ReadStatusSnapshot(Path.Combine(dir, "none.json")));
    }

    // ── for the assistant ────────────────────────────────────────────────

    [Fact]
    public void Digest_tells_the_assistant_what_was_said_and_run_and_what_is_still_waiting()
    {
        var file = Jsonl(
        [
            UserSays("Write the docs"),
            """{"type":"assistant","message":{"content":[{"type":"text","text":"  Sure.  "},{"type":"tool_use","name":"Bash","input":{"command":"npm   test\n --run"}}]}}""",
            """{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"exit 1\n failed"}]}}""",
            """{"type":"assistant","isSidechain":true,"message":{"content":[{"type":"text","text":"sub agent"}]}}""",
            """{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"AGENTS.md"}},{"type":"tool_use","name":"AskUserQuestion","input":{"questions":[{"question":"Deploy?"},{"question":"CI?"}]}},{"type":"tool_use","name":"WebFetch","input":{}}]}}""",
        ]);
        var d = Transcript.Digest(file, 0, 10_000);
        Assert.Equal(string.Join("\n",
            "אתה: Write the docs",
            "Claude: Sure.",
            "→ Bash: npm test --run",
            "✗ שגיאה בכלי: exit 1 failed",
            "→ Write: AGENTS.md",
            "→ AskUserQuestion: Deploy? / CI?",
            "→ WebFetch",
            "⏳ עדיין ממתין (אישור שלך או פעולה שרצה): Write: AGENTS.md ; AskUserQuestion: Deploy? / CI? ; WebFetch"), d.Text);
        Assert.Equal((5, 6), (d.Cursor, d.Entries));

        // From the cursor on only the call still waiting is said again.
        var later = Transcript.Digest(file, d.Cursor, 10_000);
        Assert.Equal(("⏳ עדיין ממתין (אישור שלך או פעולה שרצה): Write: AGENTS.md ; AskUserQuestion: Deploy? / CI? ; WebFetch", 0), (later.Text, later.Entries));
    }

    [Fact]
    public void Digest_leaves_out_the_oldest_lines_when_it_is_too_long_and_says_so()
    {
        var file = Jsonl(
        [
            """{"type":"user","toolUseResult":{"answers":{"Deploy?":"No","CI?":["a","b"]}}}""",
            UserSays("one"), UserSays("two"), UserSays("three"),
        ]);
        var full = Transcript.Digest(file, 0, 10_000);
        Assert.Equal("התשובה שלך: Deploy? → No\nהתשובה שלך: CI? → a, b\nאתה: one\nאתה: two\nאתה: three", full.Text);
        Assert.Equal(4, full.Entries);
        Assert.Equal("[… 3 שורות ישנות יותר הושמטו]\nאתה: two\nאתה: three", Transcript.Digest(file, 0, 20).Text);
    }

    [Fact]
    public void The_session_is_idle_only_when_its_last_real_entry_ended_a_turn()
    {
        var missing = Path.Combine(dir, "none.jsonl");
        Assert.Equal((false, "הסשן עוד לא התחיל לעבוד"), Transcript.SessionIdle(missing));
        Assert.Equal((false, 0), Transcript.TurnEnded(missing));
        Assert.Equal((false, "Claude עובד עכשיו"), Transcript.SessionIdle(Jsonl([UserSays("hi")])));
        Assert.Equal((false, "Claude ממתין לאישור שלך או מריץ פעולה"), Transcript.SessionIdle(Jsonl([UserSays("hi"), AssistantEnds("tool_use")])));

        // A meta line and a subagent's entry after the answer do not count; nor does a line still being written.
        var file = Jsonl(
        [
            UserSays("hi"), AssistantEnds("end_turn"),
            """{"type":"user","isMeta":true,"message":{"content":"x"}}""",
            """{"type":"assistant","isSidechain":true,"message":{"content":[],"stop_reason":"tool_use"}}""",
        ], partial: """{"type":"user","message":""");
        Assert.Equal((true, ""), Transcript.SessionIdle(file));
        Assert.Equal((true, 4), Transcript.TurnEnded(file));
    }

    [Fact]
    public void Written_paths_take_every_writing_tool_once_sorted_and_never_the_copy_itself()
    {
        string Use(string name, string key, string value) => new JsonObject
        {
            ["type"] = "assistant",
            ["message"] = new JsonObject { ["content"] = new JsonArray { new JsonObject { ["type"] = "tool_use", ["name"] = name, ["input"] = new JsonObject { [key] = value } } } },
        }.ToJsonString();
        var file = Jsonl(
        [
            Use("MultiEdit", "file_path", Path.Combine(dir, "b.md")),
            Use("NotebookEdit", "notebook_path", "nb/x.ipynb"),
            Use("Write", "file_path", dir),
            Use("Edit", "file_path", " b.md "),
            Use("Write", "file_path", "  "),
            Use("Bash", "command", "touch c.md"),
            """{"type":"user","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"user.md"}}]}}""",
        ]);
        Assert.Equal(["b.md", "nb/x.ipynb"], Transcript.WrittenPaths(file, dir));
    }

    [Fact]
    public void A_typed_prompt_is_seen_only_after_the_line_it_was_sent_at_white_space_folded()
    {
        var file = Jsonl(
        [
            UserSays("old instruction"),
            AssistantEnds("end_turn"),
            """{"type":"user","isMeta":true,"message":{"content":"Please run the tests"}}""",
            UserSays("Please  run\n the   tests now and report"),
        ]);
        Assert.Equal(4, Transcript.LineCount(file));
        Assert.Equal(0, Transcript.LineCount(Path.Combine(dir, "none.jsonl")));
        Assert.True(Transcript.PromptSeenAfter(file, 0, "Please run   the tests"));
        Assert.False(Transcript.PromptSeenAfter(file, 4, "Please run the tests"));
        Assert.True(Transcript.PromptSeenAfter(file, 0, "old instruction"));
        Assert.False(Transcript.PromptSeenAfter(file, 1, "old instruction"));
    }
}
