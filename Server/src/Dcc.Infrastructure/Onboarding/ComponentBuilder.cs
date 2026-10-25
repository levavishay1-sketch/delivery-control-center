using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Dcc.Domain.Onboarding;
using static Dcc.Infrastructure.Onboarding.ComponentVerifier;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>What a model is asked to write for a card: the format its text must have, and the process or evidence behind it.</summary>
public sealed record AuthorInput(Component Component, string Format, DiscoveredProcess? Process = null, string? Evidence = null);

/// <summary>
/// One build. <c>Author</c> is the model writing text (a paragraph, a document body, a skill, an agent) — injected, so
/// the build can run with a stand-in; <c>Log</c> is the run's terminal.
/// </summary>
public sealed record BuildInput(
    string Dir, string RepoName, JsonObject Profile, IReadOnlyList<Component> Cards, IReadOnlyList<DiscoveredProcess> Processes,
    Func<AuthorInput, Task<string>> Author, Action<string> Log);

/// <summary>What became of one approved card: its status after the build, the files written for it, how it was checked.</summary>
public sealed record BuildOutcome(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("files")] IReadOnlyList<string> Files,
    [property: JsonPropertyName("validation")] ComponentValidation? Validation,
    [property: JsonPropertyName("notes")] IReadOnlyList<string> Notes);

/// <summary>What the repository's own <c>.dcc/</c> folder records of a run.</summary>
public sealed record DossierInput(
    JsonObject Profile, IReadOnlyList<ProfileCorrection> Corrections, IReadOnlyList<Component> Cards, IReadOnlyList<TrialOutcome> Trials,
    IReadOnlyList<DiscoveredProcess> Processes, string RunId, string? BaselineSha);

/// <summary>
/// The build (repo-onboarding/build.ts): approved cards become files in the isolated copy, by family in dependency
/// order — safety (deny lists, .gitignore, .gitattributes, the secret hook), verification (scripts, the gate),
/// knowledge (AGENTS.md and the thin CLAUDE.md, per-path rules, docs), connections (MCP, plugins, LSP), skills,
/// agents, enforcement hooks — then each component is validated its own way (<see cref="ComponentVerifier"/>).
/// Files nobody owns alone (settings.json, .mcp.json, AGENTS.md, .gitignore) are merged, never overwritten, and
/// nothing is written outside the copy. The text a model must write comes through <see cref="BuildInput.Author"/>,
/// so the build itself is only the file system and can run with a stand-in.
/// </summary>
public static partial class ComponentBuilder
{
    private const string InitMarker = "<!-- DCC onboarding: taken from the /init draft, approved on its card -->";
    private const string AgentsHeader = "## Rules for this repository (from DCC's diagnosis)";
    private const string DefaultSkeleton = "# {{PURPOSE}}\n\n{{RULES}}\n";
    private const string DeltaSkeleton = AgentsHeader + "\n{{RULES}}\n";

    // ── merging the shared files ───────────────────────────────────────

    /// <summary>The JSON object in a file; a missing or unreadable file, or one that is not an object, reads as an empty one.</summary>
    private static JsonObject ReadJson(string file)
    {
        try { return Exists(file) ? ParseJson(ReadText(file)) as JsonObject ?? [] : []; }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException) { return []; }
    }

    /// <summary>JSON.stringify(x) — to compare two values the way the old server did.</summary>
    private static string Json(JsonNode? n) => StringifyJson(n, false);

    /// <summary>[...new Set([...a, ...b])]: a primitive once by value; an object or an array always (JavaScript compares those by reference).</summary>
    private static JsonArray Union(JsonNode? existing, JsonArray add)
    {
        var output = new JsonArray();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var n in (existing as JsonArray ?? []).Concat(add))
        {
            if (n is null or JsonValue && !seen.Add(Json(n))) continue;
            output.Add(n?.DeepClone());
        }
        return output;
    }

    private static string MatcherOf(JsonNode? entry) => entry is JsonObject o && o["matcher"] is { } m ? Json(m) : Json("");

    /// <summary>
    /// A fragment of <c>.claude/settings.json</c> merged into the copy's: deny and allow rules once each, a hook entry
    /// joined to the one with the same matcher (each hook once), plugins and marketplaces added by key.
    /// </summary>
    public static string MergeSettings(string dir, JsonObject fragment)
    {
        var file = Path.Join(dir, ".claude", "settings.json");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var cur = ReadJson(file);
        foreach (var list in PermissionLists)
            if ((fragment["permissions"] as JsonObject)?[list] is JsonArray { Count: > 0 } add)
            {
                if (cur["permissions"] is not JsonObject permissions) cur["permissions"] = permissions = [];
                permissions[list] = Union(permissions[list], add);
            }
        if (Truthy(fragment["hooks"]))
        {
            if (cur["hooks"] is not JsonObject hooks) cur["hooks"] = hooks = [];
            foreach (var (hookEvent, entries) in fragment["hooks"] as JsonObject ?? [])
            {
                if (hooks[hookEvent] is not JsonArray list) hooks[hookEvent] = list = [];
                foreach (var e in entries as JsonArray ?? [])
                {
                    var matcher = MatcherOf(e);
                    if (list.FirstOrDefault(x => MatcherOf(x) == matcher) is not JsonObject same)
                    {
                        list.Add(e?.DeepClone());
                        continue;
                    }
                    if (same["hooks"] is not JsonArray sameHooks) same["hooks"] = sameHooks = [];
                    foreach (var h in (e as JsonObject)?["hooks"] as JsonArray ?? [])
                        if (!sameHooks.Any(x => Json(x) == Json(h))) sameHooks.Add(h?.DeepClone());
                }
            }
        }
        foreach (var key in KeyedSettings)
            if (Truthy(fragment[key]))
            {
                if (cur[key] is not JsonObject target) cur[key] = target = [];
                foreach (var (k, v) in fragment[key] as JsonObject ?? []) target[k] = v?.DeepClone();
            }
        WriteText(file, StringifyJson(cur, true) + "\n");
        return ".claude/settings.json";
    }

    private static readonly string[] PermissionLists = ["deny", "allow"];
    private static readonly string[] KeyedSettings = ["enabledPlugins", "extraKnownMarketplaces"];

    /// <summary>A fragment of <c>.mcp.json</c> (<c>{ mcpServers: { name: spec } }</c>) merged in by server name.</summary>
    public static string MergeMcp(string dir, JsonObject fragment)
    {
        var file = Path.Join(dir, ".mcp.json");
        var cur = ReadJson(file);
        if (cur["mcpServers"] is not JsonObject servers) cur["mcpServers"] = servers = [];
        foreach (var (k, v) in fragment["mcpServers"] as JsonObject ?? []) servers[k] = v?.DeepClone();
        WriteText(file, StringifyJson(cur, true) + "\n");
        return ".mcp.json";
    }

    [GeneratedRegex(@"\r?\n")] private static partial Regex LineBreak();

    /// <summary>
    /// Lines appended once, under a header, to a file that may already exist. <paramref name="appended"/> collects the
    /// text added to a file that already had some — what its validation reads, not the whole file. Like every write of
    /// the build, only inside the copy (the old server trusted its fixed names here; the check costs nothing).
    /// </summary>
    public static string AppendLines(string dir, string rel, IReadOnlyList<string> lines, string header, Dictionary<string, string>? appended = null)
    {
        var file = Inside(dir, rel);
        var cur = Exists(file) ? ReadText(file) : "";
        var have = LineBreak().Split(cur).Select(JsTrim).ToHashSet(StringComparer.Ordinal);
        var add = lines.Where(l => JsTrim(l).Length > 0 && !have.Contains(JsTrim(l))).ToList();
        if (add.Count > 0)
        {
            var body = $"{(cur.Length > 0 && !cur.EndsWith('\n') ? "\n" : "")}{(cur.Contains(header, StringComparison.Ordinal) ? "" : $"\n{header}\n")}{string.Join("\n", add)}\n";
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            WriteText(file, cur + body);
            if (appended is not null && cur.Length > 0) appended[rel] = appended.GetValueOrDefault(rel, "") + body;
        }
        return rel;
    }

    /// <summary>
    /// A block appended as it is — blank lines and repeated lines (a code fence) kept, unlike <see cref="AppendLines"/>.
    /// Once: the same block already in the file is not added again; a block under a heading the file already has is
    /// added (its text is new).
    /// </summary>
    public static string AppendBlock(string dir, string rel, string block, string marker, Dictionary<string, string>? appended = null)
    {
        var file = Inside(dir, rel);
        var cur = Exists(file) ? ReadText(file) : "";
        var text = JsTrim(block);
        if (cur.Replace("\r\n", "\n", StringComparison.Ordinal).Contains(text, StringComparison.Ordinal)) return rel;
        var body = $"{(cur.Length > 0 && !cur.EndsWith('\n') ? "\n" : "")}{(cur.Length > 0 ? "\n" : "")}{marker}\n{text}\n";
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        WriteText(file, cur + body);
        if (appended is not null && cur.Length > 0) appended[rel] = appended.GetValueOrDefault(rel, "") + body;
        return rel;
    }

    /// <summary>The file a relative path names inside the copy; a path that lands outside it (or on the copy itself) is refused.</summary>
    private static string Inside(string dir, string rel)
    {
        var file = Path.GetFullPath(Path.Join(dir, rel));
        var inside = Path.GetRelativePath(Path.GetFullPath(dir), file);
        if (inside == "." || inside.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(inside)) throw new InvalidOperationException($"נתיב מחוץ לעותק: {rel}");
        return file;
    }

    /// <summary>A whole file, written only inside the copy.</summary>
    private static string WriteFile(string dir, string rel, string content, int? mode = null)
    {
        var file = Inside(dir, rel);
        var created = !File.Exists(file);
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        WriteText(file, content);
        // Node gives a mode to a file it creates, where the file system keeps one (a hook is executable).
        if (mode is { } m && created && !OperatingSystem.IsWindows()) File.SetUnixFileMode(file, (UnixFileMode)m);
        return rel;
    }

    // ── the facts the templates need ───────────────────────────────────

    private static JsonNode? At(JsonNode? n, params string[] path)
    {
        foreach (var k in path) n = (n as JsonObject)?[k];
        return n;
    }

    [GeneratedRegex(JsWs + "+#" + Dot + @"*\z")] private static partial Regex TrailingComment();
    // JavaScript's \b is ASCII: a Hebrew letter next to "test" is still a boundary.
    [GeneratedRegex(@"(?<![A-Za-z0-9_])(test|vitest|jest|pytest|phpunit)(?![A-Za-z0-9_])")] private static partial Regex TestWord();
    [GeneratedRegex(@"^package\.json:(" + JsNonWs + "+)" + Dot + @"*\z")] private static partial Regex PackageScriptFramework();

    /// <summary>repoFacts: the commands and facts a template is filled with, from the profile.</summary>
    public static RepoFacts RepoFactsOf(JsonObject profile, string repoName, string? defaultBranch)
    {
        static string? Cmd(string? c) => c is null ? null : JsTrim(TrailingComment().Replace(c, "", 1)) is { Length: > 0 } s ? s : null;
        var ciCommands = Strings(At(profile, "ci", "commands"));
        var frameworks = Strings(At(profile, "tests", "frameworks"));
        var lintFormat = Strings(At(profile, "lint_format"));
        var test = ciCommands.FirstOrDefault(c => TestWord().IsMatch(c))
            ?? (frameworks.FirstOrDefault(f => f.StartsWith("package.json:", StringComparison.Ordinal)) is { } script ? PackageScriptFramework().Replace(script, "npm run $1", 1) : null)
            ?? (frameworks.Contains("go test") ? "go test ./..." : frameworks.Contains("cargo test") ? "cargo test" : frameworks.Contains("pytest") ? "pytest" : null);
        var lint = lintFormat.Contains("eslint") ? "npx eslint ." : lintFormat.Contains("ruff") ? "ruff check ." : lintFormat.Contains("golangci-lint") ? "golangci-lint run" : null;
        var build = At(profile, "build", "commands") is JsonArray { Count: > 0 } commands && commands[0] is { } first ? JsString(first) : null;
        var languages = (At(profile, "languages") as JsonArray ?? []).Take(4).Select(l => l is JsonObject o ? JsString(o, "language") : "undefined").ToList();
        var packageManager = At(profile, "package_managers") is JsonArray { Count: > 0 } managers && managers[0] is { } pm ? JsString(pm) : null;
        return new RepoFacts(repoName, Cmd(build), test, lint, languages, packageManager, defaultBranch, IsTrue(At(profile, "windows_build", "windows_only_build")));
    }

    [GeneratedRegex("[^a-z0-9]+")] private static partial Regex NotSlug();
    [GeneratedRegex(@"^-|-\z")] private static partial Regex EdgeDash();

    /// <summary>
    /// The old server's slug. Its toLowerCase() turns U+0130 (I with a dot) into "i" and a combining dot, where .NET
    /// leaves the letter as it is — so "İzmir" slugs to "i-zmir" as it did, not to "zmir".
    /// </summary>
    private static readonly string DottedCapitalI = ((char)0x0130).ToString();
    private static readonly string DottedSmallI = "i" + (char)0x0307;

    private static string Slug(string s)
    {
        var lower = s.Replace(DottedCapitalI, DottedSmallI, StringComparison.Ordinal).ToLowerInvariant();
        var slug = Head(EdgeDash().Replace(NotSlug().Replace(lower, "-"), ""), 40);
        return slug.Length > 0 ? slug : "x";
    }

    /// <summary>
    /// JavaScript's <c>text.replace("pattern", replacement)</c>: the first occurrence only, with <c>$$</c>, <c>$&amp;</c>,
    /// <c>$`</c> and <c>$'</c> in the replacement expanded as JavaScript expands them.
    /// </summary>
    internal static string ReplaceFirst(string text, string pattern, string replacement)
    {
        var i = text.IndexOf(pattern, StringComparison.Ordinal);
        if (i < 0) return text;
        var before = text[..i];
        var after = text[(i + pattern.Length)..];
        var sb = new StringBuilder(before);
        for (var k = 0; k < replacement.Length; k++)
        {
            var sub = replacement[k] == '$' && k + 1 < replacement.Length
                ? replacement[k + 1] switch { '$' => "$", '&' => pattern, '`' => before, '\'' => after, _ => null }
                : null;
            if (sub is null) sb.Append(replacement[k]);
            else
            {
                sb.Append(sub);
                k++;
            }
        }
        return sb.Append(after).ToString();
    }

    // ── AGENTS.md: the one file every tool reads, and the thin CLAUDE.md ──

    private static string LayoutText(JsonObject p)
    {
        var lines = new List<string>();
        if (At(p, "monorepo") is JsonObject mono && Truthy(mono["is_monorepo"]))
        {
            var packages = Strings(mono["packages"]);
            var count = mono["package_count"] is { } n ? JsString(n) : packages.Count.ToString(CultureInfo.InvariantCulture);
            lines.Add($"Packages ({count}): {string.Join(", ", packages.Take(12).Select(x => $"`{x}`"))}");
        }
        lines.AddRange(Strings(At(p, "size", "top_level_dirs")).Take(14).Select(d => $"- `{d}/`"));
        var text = string.Join("\n", lines);
        return text.Length > 0 ? text : "(flat)";
    }

    private static string ExternalText(JsonObject p)
    {
        var text = string.Join("\n", (At(p, "external_systems") is JsonObject systems ? JsEntries(systems) : []).Take(8)
            .Select(kv => $"- {kv.Key} (referenced in {string.Join(", ", Strings((kv.Value as JsonObject)?["sample_files"]).Take(2).Select(f => $"`{f}`"))})"));
        return text.Length > 0 ? text : "- none detected";
    }

    private static string VerificationText(RepoFacts facts, bool gate) => string.Join("\n", new[]
    {
        facts.WindowsOnly ? "- The build runs only on a Windows runner; without one, do not claim a build or a test run."
            : !string.IsNullOrEmpty(facts.BuildCommand) ? $"- Build: `{facts.BuildCommand}`" : "- No build command was detected.",
        !string.IsNullOrEmpty(facts.TestCommand) ? $"- Tests: `{facts.TestCommand}`" : "- No test framework was detected.",
        !string.IsNullOrEmpty(facts.LintCommand) ? $"- Lint: `{facts.LintCommand}`" : null,
        gate ? "- Before saying a change is done: `node scripts/dcc-verify.mjs`" : null,
    }.Where(x => !string.IsNullOrEmpty(x)));

    private static readonly string[] ReadmeNames = ["README.md", "readme.md", "README"];

    [GeneratedRegex(LineStart + "#" + Dot + "*")] private static partial Regex HeadingLine();
    [GeneratedRegex(@"!\[[^\]]*\]\([^)]*\)")] private static partial Regex ImageLink();
    [GeneratedRegex(@"\n" + JsWs + @"*\n")] private static partial Regex ParagraphBreak();
    [GeneratedRegex(JsWs + "+")] private static partial Regex Spaces();

    /// <summary>The README's first real paragraph (headings and images taken out), when it has one.</summary>
    private static string? ReadmePurpose(string dir)
    {
        foreach (var n in ReadmeNames)
        {
            var f = Abs(dir, n);
            if (!Exists(f)) continue;
            var text = JsTrim(ImageLink().Replace(HeadingLine().Replace(ReadText(f), ""), ""));
            var para = ParagraphBreak().Split(text).Select(s => JsTrim(Spaces().Replace(s, " ")))
                .FirstOrDefault(s => s.Length > 60 && !s.StartsWith('[') && !s.StartsWith('<'));
            if (para is not null) return Head(para, 500);
        }
        return null;
    }

    [GeneratedRegex(@"\{\{[A-Z_]+\}\}")] private static partial Regex Slot();

    /// <summary>The builder's slots of an AGENTS.md skeleton, filled from the diagnosis; a slot left over is taken out.</summary>
    private static string FillAgentsText(string skeleton, string? purpose, JsonObject profile, RepoFacts facts, IReadOnlyList<string> ruleLines, bool hasGate)
    {
        var text = ReplaceFirst(skeleton, "{{PURPOSE}}", string.IsNullOrEmpty(purpose) ? "(not described in the repository)" : purpose);
        text = ReplaceFirst(text, "{{LAYOUT}}", LayoutText(profile));
        text = ReplaceFirst(text, "{{EXTERNAL}}", ExternalText(profile));
        text = ReplaceFirst(text, "{{RULES}}", ruleLines.Count > 0 ? string.Join("\n", ruleLines.Select(r => $"- {r}")) : "- (no rules beyond the facts above)");
        text = ReplaceFirst(text, "{{VERIFICATION}}", VerificationText(facts, hasGate));
        return Slot().Replace(text, "");
    }

    private static List<string> RuleLines(IEnumerable<Component> cards) =>
        cards.Where(c => c.Kind == "rule").Select(c => JsTrim(Str(c.Params, "text"))).Where(s => s.Length > 0).ToList();

    /// <summary>
    /// What the build would write into AGENTS.md now, from the cards not declined and not taken from the <c>/init</c>
    /// draft — "ours" in the scan of the draft. No model: without a README paragraph, the purpose says the build writes it.
    /// </summary>
    public static string PreviewAgentsMd(OnboardingCatalog catalog, string dir, JsonObject profile, string repoName, IReadOnlyList<Component> cards)
    {
        var facts = RepoFactsOf(profile, repoName, null);
        var live = cards.Where(c => c.Source != "init" && c.Status != ComponentStatuses.Declined && c.Status != ComponentStatuses.Removed).ToList();
        var ruleLines = RuleLines(live);
        var hasGate = live.Any(c => c.Kind == "script");
        var scaffold = live.FirstOrDefault(c => c.Kind == "scaffold" && IsString(c.Params["template"], "agents-md"));
        var delta = live.FirstOrDefault(c => c.Kind == "doc" && IsString(c.Params["template"], "agents-md-delta"));
        var purpose = ReadmePurpose(dir) ?? "(one paragraph the build writes from the code: what this repository is for)";
        string Fill(string skeleton) => FillAgentsText(skeleton, purpose, profile, facts, ruleLines, hasGate);
        if (scaffold is not null) return Fill(catalog.Render("agents-md", scaffold.Params, facts).Files.FirstOrDefault(f => f.Path == "AGENTS.md")?.Content ?? DefaultSkeleton);
        if (delta is not null) return $"(appended to the repository's existing instructions file)\n{Fill(catalog.Render("agents-md-delta", delta.Params, facts).Files.FirstOrDefault()?.Content ?? DeltaSkeleton)}";
        return ruleLines.Count > 0 ? $"{AgentsHeader}\n{string.Join("\n", ruleLines.Select(r => $"- {r}"))}\n" : "(no card of ours writes AGENTS.md)";
    }

    // ── the build ──────────────────────────────────────────────────────

    /// <summary>A template literal of <c>o[first] ?? o[last]</c>: a missing last one prints "undefined", as JavaScript would.</summary>
    private static string Coalesce(JsonObject o, string first, string last) => o[first] is { } v ? JsString(v) : JsString(o, last);

    /// <summary>FAMILY_HE[x] in a template literal: an unknown key prints "undefined".</summary>
    private static string He(IReadOnlyDictionary<string, string> names, string key) => names.TryGetValue(key, out var he) ? he : "undefined";

    private static string Mark(string status) => status == ComponentStatuses.Verified ? "✓" : status == ComponentStatuses.Failed ? "✗" : "·";

    /// <summary>path.dirname of a template's relative path, separators as written: "packages/api/CLAUDE.md" → "packages/api", "CLAUDE.md" → ".".</summary>
    private static string Dirname(string p)
    {
        var t = p.TrimEnd('/', '\\');
        var i = t.LastIndexOfAny(['/', '\\']);
        return i < 0 ? "." : i == 0 ? t[..1] : t[..i];
    }

    private static readonly HashSet<string> PackageScripts = ["build", "test", "lint", "dev", "start", "check", "typecheck"];

    [GeneratedRegex("^#+" + JsWs + "*")] private static partial Regex HeadingHashes();
    [GeneratedRegex(@"github\.com|learn\.microsoft\.com|docs\.|/blob/|/tree/", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex SourcePage();
    [GeneratedRegex("use only", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex UseOnly();
    [GeneratedRegex("github\\.com/([^/]+)/([^/#?]+)")] private static partial Regex GitHubRepo();
    [GeneratedRegex(@"\.git\z")] private static partial Regex GitSuffix();
    [GeneratedRegex(@"github\.com/anthropics/claude-plugins-official", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex Official();

    /// <summary><c>{ ...c, files, status }</c>: the card as its check sees it, the card itself untouched.</summary>
    private static Component WithFiles(Component c, List<string> files, string status)
    {
        var copy = Components.Copy(c);
        copy.Files = files;
        copy.Status = status;
        return copy;
    }

    /// <summary>
    /// buildComponents: every approved card, in build order, written and then checked. A card whose writing throws is
    /// failed with the reason and the build goes on; its check runs outside that guard, as it did in the old server.
    /// An MCP card gets its server name written back into its <c>Params</c> (the check reads it there).
    /// </summary>
    public static async Task<List<BuildOutcome>> BuildAsync(OnboardingCatalog catalog, BuildInput input)
    {
        var dir = input.Dir;
        var profile = input.Profile;
        var log = input.Log;
        var facts = RepoFactsOf(profile, input.RepoName, null);
        var output = new List<BuildOutcome>();
        var appended = new Dictionary<string, string>();
        var cards = Components.BuildOrder(input.Cards.Where(c => c.Status == ComponentStatuses.Approved));
        List<string> knownCommands = [.. Strings(At(profile, "build", "commands")), .. Strings(At(profile, "ci", "commands")), facts.TestCommand ?? "", facts.LintCommand ?? ""];
        knownCommands.RemoveAll(k => k.Length == 0);
        var ruleLines = RuleLines(cards);
        var hasGate = cards.Any(c => c.Kind == "script");
        var agentsWritten = false;
        var agentsPath = Abs(dir, "AGENTS.md");
        var claudePath = Abs(dir, "CLAUDE.md");

        async Task<string> FillAgentsAsync(Component c, string skeleton, bool forDelta)
        {
            var purpose = ReadmePurpose(dir);
            if (purpose is null && !forDelta)
            {
                var answer = await input.Author(new AuthorInput(c, "One paragraph of at most 60 words, plain text, no heading: what this repository is and what it is for, from the code itself. Nothing else."));
                purpose = ParagraphBreak().Split(JsTrim(answer))[0];
            }
            return FillAgentsText(skeleton, purpose, profile, facts, ruleLines, hasGate);
        }

        foreach (var c in cards)
        {
            var notes = new List<string>();
            var files = new List<string>();
            var status = ComponentStatuses.Installed;
            try
            {
                log($"▸ {He(Components.FamilyHe, c.Family)} · {He(Components.KindHe, c.Kind)} · {c.TitleHe}");
                var template = Str(c.Params, "template");
                // Taken from the /init draft: the approved text, as it is on the card — a whole new file, or a section added to AGENTS.md after ours.
                if (template is "init-file" or "init-section")
                {
                    var text = Str(c.Params, "text");
                    // What this card alone added is what its check reads; a section that fails is taken out again, since AGENTS.md is delivered through other cards too.
                    var own = new Dictionary<string, string>();
                    var beforeAgents = Exists(agentsPath) ? ReadText(agentsPath) : null;
                    var beforeClaude = Exists(claudePath) ? ReadText(claudePath) : null;
                    var hadAppended = appended.TryGetValue("AGENTS.md", out var beforeAppended);
                    if (template == "init-file") files.Add(WriteFile(dir, JsString(c.Params, "file"), text.EndsWith('\n') ? text : $"{text}\n"));
                    else
                    {
                        var heading = HeadingHashes().Replace(Str(c.Params, "heading", c.TitleHe), "", 1);
                        var block = $"## {heading}\n\n{text}";
                        files.Add(AppendBlock(dir, "AGENTS.md", block, InitMarker, appended));
                        own["AGENTS.md"] = block;
                        if (beforeAgents is null && beforeClaude is null) files.Add(WriteFile(dir, "CLAUDE.md", "@AGENTS.md\n"));
                        else if (beforeAgents is null && !beforeClaude!.Contains("@AGENTS.md", StringComparison.Ordinal))
                            files.Add(AppendLines(dir, "CLAUDE.md", ["@AGENTS.md"], "<!-- the shared instructions -->", appended));
                        own["CLAUDE.md"] = "";
                    }
                    var uniq = files.Distinct().ToList();
                    var checkedInit = Validate(WithFiles(c, uniq, status), dir, knownCommands, template == "init-section" ? own : appended);
                    var initStatus = checkedInit.Passed == false ? ComponentStatuses.Failed : checkedInit.Passed == true ? ComponentStatuses.Verified : ComponentStatuses.Installed;
                    if (initStatus == ComponentStatuses.Failed && template == "init-section")
                    {
                        if (beforeAgents is null) File.Delete(agentsPath); else WriteText(agentsPath, beforeAgents);
                        if (beforeClaude is null) File.Delete(claudePath); else WriteText(claudePath, beforeClaude);
                        if (!hadAppended) appended.Remove("AGENTS.md"); else appended["AGENTS.md"] = beforeAppended!;
                        notes.Add("the check failed — the section was taken out of AGENTS.md again");
                    }
                    log($"  {Mark(initStatus)} {string.Join(", ", uniq)} — {checkedInit.How}: {checkedInit.Detail}");
                    output.Add(new BuildOutcome(c.Key, initStatus, uniq, checkedInit, notes));
                    continue;
                }
                switch (c.Kind)
                {
                    case "permission":
                    {
                        var parameters = new JsonObject();
                        if (c.Params.TryGetPropertyValue("deny", out var deny)) parameters["deny"] = deny?.DeepClone();
                        var r = catalog.Render("deny", parameters, facts);
                        if (r.Settings is not null) files.Add(MergeSettings(dir, r.Settings));
                        notes.AddRange(r.Notes);
                        break;
                    }
                    case "hook":
                    {
                        var r = catalog.Render(template, c.Params, facts);
                        foreach (var f in r.Files) files.Add(WriteFile(dir, f.Path, f.Content, f.Mode));
                        if (r.Settings is not null) files.Add(MergeSettings(dir, r.Settings));
                        notes.AddRange(r.Notes);
                        break;
                    }
                    case "gitignore":
                    {
                        var r = catalog.Render("gitignore", c.Params, facts);
                        var lines = r.Files.Count > 0 ? r.Files[0].Content.Split('\n').Where(l => l.Length > 0 && !l.StartsWith('#')).ToList() : Strings(c.Params["entries"]);
                        files.Add(AppendLines(dir, ".gitignore", lines, "# added by DCC onboarding"));
                        break;
                    }
                    case "gitattributes":
                    {
                        var r = catalog.Render("gitattributes", c.Params, facts);
                        var lines = r.Files.Count > 0 ? r.Files[0].Content.Split('\n').Where(l => l.Length > 0 && !l.StartsWith('#')).ToList() : [];
                        files.Add(AppendLines(dir, ".gitattributes", lines, "# generated code, marked by DCC onboarding"));
                        break;
                    }
                    case "script":
                    {
                        var r = catalog.Render(template.Length > 0 ? template : "local-gate", c.Params, facts);
                        foreach (var f in r.Files) files.Add(WriteFile(dir, f.Path, f.Content, f.Mode));
                        var pkg = Abs(dir, "package.json");
                        if (Exists(pkg))
                        {
                            try
                            {
                                if (ParseJson(ReadText(pkg)) is not JsonObject j) throw new JsonException("package.json is not an object");
                                if (!Truthy((j["scripts"] as JsonObject)?["verify"]))
                                {
                                    if (j["scripts"] is not JsonObject scripts) j["scripts"] = scripts = [];
                                    scripts["verify"] = "node scripts/dcc-verify.mjs";
                                    WriteText(pkg, StringifyJson(j, true) + "\n");
                                    files.Add("package.json");
                                }
                            }
                            catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException)
                            {
                                notes.Add("package.json could not be read; the verify script was not registered in it");
                            }
                        }
                        notes.AddRange(r.Notes);
                        break;
                    }
                    case "scaffold":
                    {
                        if (template == "agents-md")
                        {
                            var r = catalog.Render("agents-md", c.Params, facts);
                            var skeleton = r.Files.FirstOrDefault(f => f.Path == "AGENTS.md")?.Content ?? DefaultSkeleton;
                            var text = await FillAgentsAsync(c, skeleton, false);
                            if (Exists(agentsPath))
                            {
                                files.Add(AppendLines(dir, "AGENTS.md", text.Split('\n').Where(l => !l.StartsWith("# ", StringComparison.Ordinal)).ToList(), "\n<!-- DCC onboarding: merged from the diagnosis -->", appended));
                                notes.Add("AGENTS.md existed: the new sections were appended, nothing was overwritten");
                            }
                            else files.Add(WriteFile(dir, "AGENTS.md", text));
                            if (!Exists(claudePath)) files.Add(WriteFile(dir, "CLAUDE.md", "@AGENTS.md\n"));
                            else if (!ReadText(claudePath).Contains("@AGENTS.md", StringComparison.Ordinal))
                                files.Add(AppendLines(dir, "CLAUDE.md", ["@AGENTS.md"], "<!-- the shared instructions -->", appended));
                            agentsWritten = true;
                        }
                        else if (template is "per-package" or "per-area")
                        {
                            var r = catalog.Render(template, c.Params, facts);
                            foreach (var f in r.Files)
                            {
                                var content = f.Content;
                                var folder = Dirname(f.Path);
                                if (content.Contains("{{PACKAGE_COMMANDS}}", StringComparison.Ordinal))
                                {
                                    var pkg = Abs(dir, Path.Join(folder, "package.json"));
                                    var cmds = "(see the root)";
                                    if (Exists(pkg))
                                    {
                                        try
                                        {
                                            // A listed script that is not a string threw on .slice() there, leaving the fallback.
                                            if (ParseJson(ReadText(pkg)) is JsonObject pj && pj["scripts"] is JsonObject s
                                                && JsEntries(s).Where(kv => PackageScripts.Contains(kv.Key)).ToList() is var picked && picked.All(kv => AsString(kv.Value) is not null))
                                            {
                                                var listed = string.Join("\n", picked.Select(kv => $"- `npm run {kv.Key}` → `{Head(AsString(kv.Value)!, 80)}`"));
                                                if (listed.Length > 0) cmds = listed;
                                            }
                                        }
                                        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException) { /* keep the fallback */ }
                                    }
                                    content = ReplaceFirst(content, "{{PACKAGE_COMMANDS}}", cmds);
                                }
                                if (!Exists(Abs(dir, folder)))
                                {
                                    notes.Add($"{folder} does not exist — skipped");
                                    continue;
                                }
                                files.Add(WriteFile(dir, f.Path, Slot().Replace(content, "")));
                            }
                            notes.AddRange(r.Notes);
                        }
                        else if (template == "first-test")
                        {
                            var r = catalog.Render("first-test", c.Params, facts);
                            foreach (var f in r.Files) files.Add(WriteFile(dir, f.Path, f.Content));
                            notes.AddRange(r.Notes);
                            if (r.Files.Count == 0) status = ComponentStatuses.Deferred;
                        }
                        else
                        {
                            var r = catalog.Render(template, c.Params, facts);
                            foreach (var f in r.Files) files.Add(WriteFile(dir, f.Path, f.Content, f.Mode));
                            notes.AddRange(r.Notes);
                        }
                        break;
                    }
                    case "rule":
                    {
                        // Rule lines live in AGENTS.md; the scaffold writes them all at once, and without a scaffold they go into a section of their own.
                        if (!agentsWritten && !cards.Any(x => x.Kind == "scaffold" && IsString(x.Params["template"], "agents-md") && x.Status == ComponentStatuses.Approved))
                        {
                            if (!Exists(agentsPath))
                            {
                                var r = catalog.Render("agents-md", new JsonObject(), facts);
                                var skeleton = r.Files.FirstOrDefault(f => f.Path == "AGENTS.md")?.Content ?? DefaultSkeleton;
                                files.Add(WriteFile(dir, "AGENTS.md", await FillAgentsAsync(c, skeleton, true)));
                                if (!Exists(claudePath)) files.Add(WriteFile(dir, "CLAUDE.md", "@AGENTS.md\n"));
                            }
                            else files.Add(AppendLines(dir, "AGENTS.md", ruleLines.Select(l => $"- {l}").ToList(), AgentsHeader, appended));
                            agentsWritten = true;
                        }
                        else files.Add("AGENTS.md");
                        break;
                    }
                    case "doc":
                    {
                        if (template == "agents-md-delta")
                        {
                            var r = catalog.Render("agents-md-delta", c.Params, facts);
                            var section = await FillAgentsAsync(c, r.Files.FirstOrDefault()?.Content ?? DeltaSkeleton, true);
                            var target = Exists(agentsPath) ? "AGENTS.md" : Exists(claudePath) ? "CLAUDE.md" : "AGENTS.md";
                            files.Add(AppendLines(dir, target, section.Split('\n'), "<!-- DCC onboarding: facts from the diagnosis -->", appended));
                            notes.AddRange(r.Notes);
                        }
                        else
                        {
                            var r = catalog.Render(template.Length > 0 ? template : "docs-set", c.Params, facts);
                            foreach (var f in r.Files)
                            {
                                var body = await input.Author(new AuthorInput(c, $"The body of the Markdown document \"{f.Path}\" (no title line — it is already there): specific to this repository, every path and command checkable, at most 120 lines. Sections with ## headings."));
                                files.Add(WriteFile(dir, f.Path, Slot().Replace(ReplaceFirst(f.Content, "{{BODY}}", JsTrim(body)), "")));
                            }
                            notes.AddRange(r.Notes);
                        }
                        break;
                    }
                    case "skill":
                    {
                        var name = Slug(template == "process-skill" ? $"{Coalesce(c.Params, "processTitle", "process")}-{Coalesce(c.Params, "stepTitle", "step")}" : template.Length > 0 ? template : c.Key);
                        if (template is "process-skill" or "")
                        {
                            var process = input.Processes.FirstOrDefault(p => IsString(c.Params["process"], p.Key));
                            var text = await input.Author(new AuthorInput(c,
                                $"A Claude Code skill file (SKILL.md) with YAML frontmatter between --- lines: name: {name}; description: one paragraph saying what the skill does and WHEN to use it (Claude Code triggers on this sentence); allowed-tools: Read, Grep, Glob, Bash. Then a Markdown body: the steps of the procedure in order, each naming the exact files and commands as they are in this repository, what to check before saying it is done, and what NOT to do. At most 90 lines.",
                                process));
                            files.Add(WriteFile(dir, $".claude/skills/{name}/SKILL.md", StripFence(text)));
                        }
                        else
                        {
                            var r = catalog.Render(template, c.Params, facts);
                            foreach (var f in r.Files) files.Add(WriteFile(dir, f.Path, Slot().Replace(f.Content, ""), f.Mode));
                            notes.AddRange(r.Notes);
                        }
                        break;
                    }
                    case "agent":
                    {
                        if (template is "process-agent" or "")
                        {
                            var process = input.Processes.FirstOrDefault(p => IsString(c.Params["process"], p.Key));
                            var name = Slug(c.Params["stepTitle"] is { } stepTitle ? JsString(stepTitle) : c.Params["step"] is { } step ? JsString(step) : c.Key);
                            var evidence = c.Params["evidence"] is JsonArray ev ? string.Join("\n", ev.Select(x => x is null ? "" : JsString(x))) : null;
                            var text = await input.Author(new AuthorInput(c,
                                $"A Claude Code subagent definition (Markdown) with YAML frontmatter between --- lines: name: {name}; description: one paragraph that says what this agent checks or does and WHEN the main agent should call it — this sentence is the \"when to call me\" test; tools: Glob, Grep, Read, Bash (read-only — never Edit or Write); model: sonnet. Body: the role in two sentences; the scope (the folders and files, from the process); a checklist of 5 to 10 concrete checks, each with the evidence that justifies it (a review comment, a bug, a convention seen in the code) — no generic advice; and the output format: a JSON array of findings {{file, line, severity: block|warn|info, note}}. At most 90 lines.",
                                process, evidence));
                            files.Add(WriteFile(dir, $".claude/agents/{name}.md", StripFence(text)));
                        }
                        else
                        {
                            var parameters = c.Params.DeepClone().AsObject();
                            parameters["withReviewMd"] = true;
                            var r = catalog.Render(template, parameters, facts);
                            var checklist = await input.Author(new AuthorInput(c, "A Markdown checklist of 6 to 10 concrete review checks for this scope, one per line starting with '- [ ]', each naming the file or pattern it applies to and the evidence for it (history, conventions seen in the code). No generic advice. Nothing else."));
                            foreach (var f in r.Files) files.Add(WriteFile(dir, f.Path, Slot().Replace(ReplaceFirst(f.Content, "{{CHECKLIST}}", JsTrim(checklist)), ""), f.Mode));
                            notes.AddRange(r.Notes);
                        }
                        break;
                    }
                    case "mcp":
                    {
                        var name = c.Params["server"] is { } server ? JsString(server) : c.Params["name"] is { } serverName ? JsString(serverName) : Slug(c.TitleHe.Split(" (")[0]);
                        c.Params["server"] = name;
                        var url = AsString(c.Params["url"]);
                        var command = AsString(c.Params["command"]);
                        // A source page (a repository, a docs page) is not an endpoint: the connection needs the client's details from its README.
                        if (string.IsNullOrEmpty(command) && (string.IsNullOrEmpty(url) || SourcePage().IsMatch(url)))
                        {
                            status = ComponentStatuses.Deferred;
                            notes.Add($"not connected: {url ?? "no address"} is the server's page, not an endpoint — configure it from its README with the client's details, keeping only the tools the card names");
                            break;
                        }
                        var spec = new JsonObject { ["server"] = name };
                        if (url is not null) spec["url"] = url;
                        if (command is not null) spec["command"] = command;
                        if (c.Params["args"] is JsonArray args) spec["args"] = args.DeepClone();
                        var tools = c.Params["tools"] as JsonArray;
                        if (tools is not null) spec["tools"] = tools.DeepClone();
                        spec["readOnly"] = IsTrue(c.Params["readOnly"]);
                        if (c.Params.TryGetPropertyValue("env", out var env)) spec["env"] = env?.DeepClone();
                        var r = catalog.Render("mcp", spec, facts);
                        if (r.Mcp is not null) files.Add(MergeMcp(dir, r.Mcp));
                        var toolsLine = r.Notes.FirstOrDefault(n => UseOnly().IsMatch(n))
                            ?? (tools is not null ? $"MCP server `{name}`: use only these tools: {string.Join(", ", tools.Select(t => t is null ? "" : JsString(t)))}; the rest are not loaded." : null);
                        if (!string.IsNullOrEmpty(toolsLine) && Exists(agentsPath)) files.Add(AppendLines(dir, "AGENTS.md", [$"- {toolsLine}"], "## MCP", appended));
                        notes.AddRange(r.Notes.Where(n => n != toolsLine));
                        if (!string.IsNullOrEmpty(url) && HasPlaceholder(url)) notes.Add($"the address has a placeholder ({url}) — fill in the client's environment before the first session");
                        break;
                    }
                    case "plugin" or "lsp":
                    {
                        var url = Str(c.Params, "url");
                        var gh = GitHubRepo().Match(url);
                        var marketplace = gh.Success ? $"{gh.Groups[1].Value}/{GitSuffix().Replace(gh.Groups[2].Value, "", 1)}" : url;
                        var pluginName = c.Params["pluginName"] is { } named ? JsString(named) : c.Params["name"] is { } plainName ? JsString(plainName) : Slug(c.TitleHe.Split(' ')[0]);
                        var official = Official().IsMatch(url);
                        var key = official ? $"{pluginName}@claude-plugins-official" : $"{pluginName}@{Slug(marketplace)}";
                        var fragment = new JsonObject { ["enabledPlugins"] = new JsonObject { [key] = true } };
                        if (!official)
                            fragment["extraKnownMarketplaces"] = new JsonObject { [Slug(marketplace)] = new JsonObject { ["source"] = new JsonObject { ["source"] = "github", ["repo"] = marketplace } } };
                        files.Add(MergeSettings(dir, fragment));
                        notes.Add($"registered as {key}; Claude Code installs it at the first session");
                        break;
                    }
                    case "review" or "pr_template":
                    {
                        var r = catalog.Render(c.Kind == "review" ? "reviewer" : "pr-template", c.Params, facts);
                        foreach (var f in r.Files) files.Add(WriteFile(dir, f.Path, Slot().Replace(f.Content, ""), f.Mode));
                        break;
                    }
                    case "runner":
                        status = ComponentStatuses.Deferred;
                        notes.Add("a requirement from the client, not a file");
                        break;
                    case "report":
                        status = ComponentStatuses.Reported;
                        break;
                    case "settings" or "devcontainer":
                    {
                        var r = catalog.Render(template, c.Params, facts);
                        foreach (var f in r.Files) files.Add(WriteFile(dir, f.Path, f.Content, f.Mode));
                        if (r.Settings is not null) files.Add(MergeSettings(dir, r.Settings));
                        break;
                    }
                }
            }
            catch (Exception e)
            {
                log($"  ✗ {e.Message}");
                output.Add(new BuildOutcome(c.Key, ComponentStatuses.Failed, files, new ComponentValidation("בנייה", false, Head(e.Message, 300), IsoNow()), notes));
                continue;
            }
            var written = files.Distinct().ToList();
            var validation = status == ComponentStatuses.Installed ? TryValidate(WithFiles(c, written, status), dir, knownCommands, appended) : null;
            var finalStatus = status != ComponentStatuses.Installed ? status
                : validation?.Passed == false ? ComponentStatuses.Failed
                : validation?.Passed == true ? ComponentStatuses.Verified
                : ComponentStatuses.Installed;
            log($"  {Mark(finalStatus)} {(written.Count > 0 ? string.Join(", ", written) : "—")}{(validation is not null ? $" — {validation.How}: {validation.Detail}" : "")}");
            output.Add(new BuildOutcome(c.Key, finalStatus, written, validation, notes));
        }
        return output;
    }

    /// <summary>
    /// The repository's own copy of its dossier — the fixed <c>.dcc/</c> folder every onboarded repository carries: the
    /// profile the run diagnosed, every card with its decision and validation, the trial outcomes. The next run and any
    /// other tool can read them; nothing in them is a secret value (the profile records locations only).
    /// </summary>
    public static List<string> WriteDossier(string dir, DossierInput input)
    {
        var at = IsoNow();
        static JsonNode? Node<T>(T value) => JsonSerializer.SerializeToNode(value);
        var components = new JsonArray();
        foreach (var c in input.Cards)
            components.Add(new JsonObject
            {
                ["key"] = c.Key, ["kind"] = c.Kind, ["family"] = c.Family, ["title"] = c.TitleHe, ["why"] = c.WhyHe, ["what"] = c.WhatHe,
                ["source"] = c.Source, ["sourceRef"] = c.SourceRef, ["group"] = c.Group, ["risk"] = c.Risk, ["status"] = c.Status,
                ["files"] = Node(c.Files), ["validation"] = Node(c.Validation), ["declineReason"] = c.DeclineReason,
            });
        (string Rel, JsonObject Body)[] files =
        [
            (".dcc/profile.json", new JsonObject { ["writtenAt"] = at, ["runId"] = input.RunId, ["baselineSha"] = input.BaselineSha, ["corrections"] = Node(input.Corrections), ["profile"] = input.Profile.DeepClone() }),
            (".dcc/components.json", new JsonObject { ["writtenAt"] = at, ["runId"] = input.RunId, ["components"] = components }),
            (".dcc/processes.json", new JsonObject { ["writtenAt"] = at, ["runId"] = input.RunId, ["processes"] = Node(input.Processes) }),
            (".dcc/trials.json", new JsonObject { ["writtenAt"] = at, ["runId"] = input.RunId, ["trials"] = Node(input.Trials) }),
        ];
        return files.Select(f => WriteFile(dir, f.Rel, StringifyJson(f.Body, true) + "\n")).ToList();
    }

    [GeneratedRegex(@"^```[a-z]*\r?\n([\s\S]*?)\r?\n```\z")] private static partial Regex Fence();

    /// <summary>A model asked for "only the file" sometimes wraps it in a code fence anyway.</summary>
    public static string StripFence(string text)
    {
        var t = JsTrim(text);
        var m = Fence().Match(t);
        return (m.Success ? m.Groups[1].Value : t) + "\n";
    }
}
