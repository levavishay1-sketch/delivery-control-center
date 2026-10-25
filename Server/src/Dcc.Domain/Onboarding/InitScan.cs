using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Dcc.Domain.Onboarding;

/// <summary>A file of the <c>/init</c> draft as the scan reads it: <c>Before</c> null = new, <c>After</c> null = deleted by the session.</summary>
public sealed record DraftFile(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("before")] string? Before,
    [property: JsonPropertyName("after")] string? After);

/// <summary>
/// One thing the editor takes from the draft. <c>Decision</c>: take — true and useful, goes in as written; check —
/// worth it, but a claim in it still needs the build's check; ask — only a person can decide (an authorisation, a
/// policy, the environment). <c>Form</c>: line, section or file. <c>Origin</c>: theirs or merged.
/// </summary>
public sealed record InitScanItem
{
    [JsonPropertyName("decision")] public required string Decision { get; init; }
    [JsonPropertyName("form")] public required string Form { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }
    [JsonPropertyName("target")] public string Target { get; init; } = "AGENTS.md";
    [JsonPropertyName("heading")] public string? Heading { get; init; }
    [JsonPropertyName("text")] public required string Text { get; init; }
    [JsonPropertyName("origin")] public string Origin { get; init; } = "theirs";
    /// <summary>The real problem it solves here.</summary>
    [JsonPropertyName("need")] public string Need { get; init; } = "";
    /// <summary>The file, path, command, finding or answer that makes it true.</summary>
    [JsonPropertyName("evidence")] public string Evidence { get; init; } = "";
    /// <summary>Whether it could be solved without a new component, and why this is still the better way.</summary>
    [JsonPropertyName("alternative")] public string Alternative { get; init; } = "";
    /// <summary>How we will know it helps.</summary>
    [JsonPropertyName("verify")] public string Verify { get; init; } = "";
    /// <summary>What it costs: tokens in every session, upkeep, permissions, complexity.</summary>
    [JsonPropertyName("cost")] public string Cost { get; init; } = "";
    /// <summary>For "ask": the question the person decides, with what is known and what is missing.</summary>
    [JsonPropertyName("question")] public string? Question { get; init; }
    [JsonPropertyName("replaces")] public IReadOnlyList<string> Replaces { get; init; } = [];
}

/// <summary>One topic set side by side. <c>Better</c>: ours, theirs, both or neither.</summary>
public sealed record InitScanComparison(
    [property: JsonPropertyName("topic")] string Topic,
    [property: JsonPropertyName("ours")] string Ours,
    [property: JsonPropertyName("theirs")] string Theirs,
    [property: JsonPropertyName("better")] string Better,
    [property: JsonPropertyName("why")] string Why);

/// <summary>A card of ours the editor says the draft makes redundant — a note on it; the person decides.</summary>
public sealed record InitScanDrop(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("why")] string Why);

/// <summary>Something of the draft the editor left out, and why.</summary>
public sealed record InitScanRejection(
    [property: JsonPropertyName("what")] string What,
    [property: JsonPropertyName("why")] string Why);

/// <summary>Something the editor took that DCC still cannot take (too long, a kind of file it does not build, a file the repository has), and why.</summary>
public sealed record ScanRefusal(
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("why")] string Why);

/// <summary>The editor's answer (the <c>onboarding.init_scan</c> prompt). <c>Verdict</c>: adopt, merge, partial or keep_ours.</summary>
public sealed record InitScan(
    [property: JsonPropertyName("verdict")] string Verdict,
    [property: JsonPropertyName("summary")] string Summary,
    [property: JsonPropertyName("compare")] IReadOnlyList<InitScanComparison> Compare,
    [property: JsonPropertyName("items")] IReadOnlyList<InitScanItem> Items,
    [property: JsonPropertyName("dropOurs")] IReadOnlyList<InitScanDrop> DropOurs,
    [property: JsonPropertyName("reject")] IReadOnlyList<InitScanRejection> Reject);

/// <summary>
/// The scan of the <c>/init</c> draft (repo-onboarding/init-scan.ts): what the interactive session wrote in the
/// isolated copy is set against what DCC's own cards would write, and an editor (the <c>onboarding.init_scan</c>
/// prompt) decides topic by topic — take theirs, merge, keep ours, drop some of ours, or leave a decision that is not
/// technical (an authorisation, a policy) to a person. Whatever it takes becomes a card like every other: its exact
/// text and reasoning on the card, checked against the code, approved by a person, built and verified. Nothing of the
/// draft reaches the pull request any other way — the build sets the draft aside before it writes.
///
/// This half is pure: which files are the draft, how the scan reads them, the editor's answer read defensively, and
/// which paths and kinds of file can be taken at all. Turning what it takes into cards checks the text's claims
/// against the copy, so it is Infrastructure's (<c>InitScanSeeds</c>); the model call and the storage are the run
/// engine's.
///
/// The regular expressions are JavaScript's, spelled out where .NET reads them differently: <c>\w</c> and <c>\s</c>
/// are JavaScript's sets, <c>.</c> stops at every line terminator, and <c>$</c> is the very end.
/// </summary>
public static partial class InitScans
{
    /// <summary>JavaScript's <c>\s</c>: its WhiteSpace and LineTerminator (the BOM in, U+0085 out, unlike .NET's).</summary>
    private const string JsSpace = @"[\t\n\v\f\r    -     　﻿]";

    public static readonly IReadOnlyList<string> Verdicts = ["adopt", "merge", "partial", "keep_ours"];
    public static readonly IReadOnlyList<string> Betters = ["ours", "theirs", "both", "neither"];

    /// <summary>What a card of ours carries before the scan's note on it — see <see cref="WithScanNote"/>.</summary>
    public const string InitNote = "סריקת /init:";

    // ── the draft ──────────────────────────────────────────────────────

    /// <summary>Where an assistant's instructions live — the files a draft of <c>/init</c> lands in, whether or not the transcript shows the write.</summary>
    [GeneratedRegex(@"^(?:[^\n\r  ]*/)?(?:AGENTS\.md|CLAUDE\.md|CLAUDE\.local\.md|GEMINI\.md|\.cursorrules|\.windsurfrules)\z|^\.claude/|^\.cursor/|^\.github/(?:copilot-instructions\.md|instructions/)|^\.mcp\.json\z")]
    private static partial Regex AiConfig();

    public static bool IsAiConfig(string path) => AiConfig().IsMatch(path);

    /// <summary>
    /// The draft: every file the session wrote (from its transcript) and every changed file where instructions live,
    /// sorted by UTF-16 code unit as JavaScript's sort() does. DCC's own <c>.dcc/</c> is never part of it.
    /// </summary>
    public static List<string> DraftPaths(IEnumerable<string> written, IEnumerable<string> changed)
    {
        var all = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in written) if (seen.Add(p)) all.Add(p);
        foreach (var p in changed) if (IsAiConfig(p) && seen.Add(p)) all.Add(p);
        return all.Where(p => p.Length > 0 && !p.StartsWith(".dcc/", StringComparison.Ordinal) && !p.StartsWith("../", StringComparison.Ordinal) && !p.StartsWith('/'))
            .Order(StringComparer.Ordinal).ToList();
    }

    public static List<string> DraftPaths(IEnumerable<string> written, IEnumerable<ChangedFile> changed) => DraftPaths(written, changed.Select(c => c.Path));

    private static string ClipDraft(string s, int n) =>
        s.Length > n ? $"{s[..n]}\n[… {(s.Length - n).ToString(CultureInfo.InvariantCulture)} more characters not shown]" : s;

    /// <summary>The draft as the scan reads it: a new file whole, a changed one before and after, a deleted one named.</summary>
    public static string RenderDraft(IReadOnlyList<DraftFile> files, int maxPerFile = 16_000, int maxTotal = 60_000)
    {
        if (files.Count == 0) return "(the session wrote nothing)";
        var parts = new List<string>();
        var used = 0;
        foreach (var f in files)
        {
            if (used >= maxTotal)
            {
                parts.Add($"### {f.Path} — not shown (the draft is longer than this prompt can carry)");
                continue;
            }
            var room = Math.Max(1000, Math.Min(maxPerFile, maxTotal - used));
            string block;
            if (f.After is null) block = $"### FILE: {f.Path} (DELETED by the session — it existed in the repository)";
            else if (f.Before is null) block = $"### FILE: {f.Path} (NEW — the repository had no such file)\n{ClipDraft(f.After, room)}";
            else block = $"### FILE: {f.Path} (CHANGED — the repository's own version first, then the draft)\n--- in the repository:\n{ClipDraft(f.Before, room / 2)}\n--- in the draft:\n{ClipDraft(f.After, room / 2)}";
            used += block.Length;
            parts.Add(block);
        }
        return string.Join("\n\n", parts);
    }

    // ── the editor's answer ────────────────────────────────────────────

    [GeneratedRegex("```(?:json)?" + JsSpace + @"*\n([\s\S]*?)\n```")] private static partial Regex Fence();

    /// <summary>JSON.parse has no nesting limit; System.Text.Json's default of 64 would refuse an answer JavaScript read.</summary>
    private static readonly JsonDocumentOptions AnswerOptions = new() { MaxDepth = 4096 };

    /// <summary>
    /// The JSON the prompt asks for, read defensively: anything missing becomes empty, anything malformed is dropped,
    /// nothing is invented. Read with <see cref="JsonDocument"/>, so a key the model wrote twice counts once, the last
    /// one, as in JSON.parse.
    /// </summary>
    /// <exception cref="FormatException">The answer holds no JSON object.</exception>
    /// <exception cref="JsonException">What looks like the object is not valid JSON.</exception>
    public static InitScan ParseInitScan(string raw)
    {
        var fenced = Fence().Match(raw);
        var body = fenced.Success ? fenced.Groups[1].Value : raw;
        var start = body.IndexOf('{', StringComparison.Ordinal);
        var end = body.LastIndexOf('}');
        if (start < 0 || end <= start) throw new FormatException("הסריקה לא החזירה JSON");
        using var doc = JsonDocument.Parse(body[start..(end + 1)], AnswerOptions);
        var o = doc.RootElement;

        var items = Objects(Prop(o, "items")).Select(ItemOf).OfType<InitScanItem>().Take(12).ToList();
        var verdict = Prop(o, "verdict") is { ValueKind: JsonValueKind.String } v && Verdicts.Contains(Text(v)) ? Text(v) : items.Count > 0 ? "partial" : "keep_ours";
        return new InitScan(
            verdict,
            S(o, "summary", 1200),
            Objects(Prop(o, "compare"))
                .Select(c => new InitScanComparison(S(c, "topic", 120), S(c, "ours", 300), S(c, "theirs", 300),
                    Prop(c, "better") is { ValueKind: JsonValueKind.String } b && Betters.Contains(Text(b)) ? Text(b) : "neither", S(c, "why", 500)))
                .Where(c => c.Topic.Length > 0).Take(20).ToList(),
            items,
            Objects(Prop(o, "drop_ours")).Select(d => new InitScanDrop(S(d, "key", 80), S(d, "why", 500))).Where(d => d.Key.Length > 0).Take(20).ToList(),
            Objects(Prop(o, "reject")).Select(r => new InitScanRejection(S(r, "what", 300), S(r, "why", 500))).Where(r => r.What.Length > 0).Take(20).ToList());
    }

    private static InitScanItem? ItemOf(JsonElement t)
    {
        var form = StringIn(Prop(t, "form"), "line", "section", "file");
        var decision = StringIn(Prop(t, "decision"), "take", "check", "ask");
        var text = JsTrim(Or(Prop(t, "text")).Replace("\r\n", "\n", StringComparison.Ordinal));
        if (form is null || decision is null || text.Length == 0) return null;
        var title = S(t, "title", 120);
        var target = S(t, "target", 200);
        var heading = S(t, "heading", 120);
        var question = S(t, "question", 500);
        return new InitScanItem
        {
            Decision = decision, Form = form, Title = title.Length > 0 ? title : Slice(text.Split('\n')[0], 80), Target = target.Length > 0 ? target : "AGENTS.md",
            Heading = heading.Length > 0 ? heading : null, Text = text, Origin = Prop(t, "origin") is { ValueKind: JsonValueKind.String } og && Text(og) == "merged" ? "merged" : "theirs",
            Need = S(t, "need", 400), Evidence = S(t, "evidence", 500), Alternative = S(t, "alternative", 400), Verify = S(t, "verify", 400), Cost = S(t, "cost", 300),
            Question = decision == "ask" && question.Length > 0 ? question : null,
            Replaces = Prop(t, "replaces") is { ValueKind: JsonValueKind.Array } rs ? rs.EnumerateArray().Select(k => Slice(JsTrim(Or(k)), 80)).Where(k => k.Length > 0).Take(8).ToList() : [],
        };
    }

    // ── from what it takes to cards ────────────────────────────────────

    /// <summary>A path a model wrote stays inside the copy: relative, forward slashes, no <c>.</c>/<c>..</c> segment, no drive.</summary>
    public static bool InsideCopy(string p) =>
        p.Length > 0 && !p.StartsWith('/') && !p.Contains('\\') && !(p.Length >= 2 && char.IsAsciiLetter(p[0]) && p[1] == ':')
        && p.Split('/').All(seg => seg is not ("" or "." or ".."));

    [GeneratedRegex(@"^\.claude/skills/[A-Za-z0-9_.-]+/SKILL\.md\z")] private static partial Regex SkillFile();
    [GeneratedRegex(@"^\.claude/agents/[A-Za-z0-9_.-]+\.md\z")] private static partial Regex AgentFile();
    [GeneratedRegex(@"^\.claude/(?:commands|rules)/[A-Za-z0-9_./-]+\.md\z")] private static partial Regex CommandOrRuleFile();
    [GeneratedRegex(@"^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*/(?:CLAUDE|AGENTS)\.md\z")] private static partial Regex NestedInstructions();
    [GeneratedRegex(@"^docs/[A-Za-z0-9_./-]+\.md\z")] private static partial Regex DocsFile();

    /// <summary>
    /// A whole file of the draft is taken only where DCC can build and verify it as that kind (skill, agent or doc);
    /// settings, <c>.mcp.json</c> and hooks have cards of their own that are tested. null = not taken as a file.
    /// </summary>
    public static string? FileKind(string target)
    {
        if (!InsideCopy(target)) return null;
        if (SkillFile().IsMatch(target)) return "skill";
        if (AgentFile().IsMatch(target)) return "agent";
        if (CommandOrRuleFile().IsMatch(target)) return "doc";
        if (NestedInstructions().IsMatch(target)) return "doc";
        if (DocsFile().IsMatch(target)) return "doc";
        return null;
    }

    /// <summary>
    /// A card of ours the scan says should not be kept: the note that goes on it — the person decides, nothing is
    /// declined by itself. A second scan replaces the first one's note; no note takes it off.
    /// </summary>
    public static string WithScanNote(string why, string? note)
    {
        var sep = $" {InitNote} ";
        var cut = why.IndexOf(sep, StringComparison.Ordinal);
        var @base = cut < 0 ? why : why[..cut];
        return string.IsNullOrEmpty(note) ? @base : $"{@base} {InitNote} {note}";
    }

    // ── JavaScript's reading of loose JSON ─────────────────────────────

    private static readonly char[] JsSpaceChars =
    [
        '\t', '\n', '\v', '\f', '\r', ' ', (char)0x00A0, (char)0x1680, (char)0x2000, (char)0x2001, (char)0x2002, (char)0x2003, (char)0x2004, (char)0x2005,
        (char)0x2006, (char)0x2007, (char)0x2008, (char)0x2009, (char)0x200A, (char)0x2028, (char)0x2029, (char)0x202F, (char)0x205F, (char)0x3000, (char)0xFEFF,
    ];

    private static string JsTrim(string s) => s.Trim(JsSpaceChars);

    /// <summary>A prefix by UTF-16 code units, as JavaScript's <c>slice(0, n)</c>.</summary>
    private static string Slice(string s, int n) => s.Length > n ? s[..n] : s;

    private static JsonElement? Prop(JsonElement? e, string name) =>
        e is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) ? v : null;

    /// <summary><c>Array.isArray(v) ? v.filter((x) =&gt; x &amp;&amp; typeof x === "object") : []</c> — an array that passes has none of the fields asked for, so only objects are kept.</summary>
    private static IEnumerable<JsonElement> Objects(JsonElement? v) =>
        v is { ValueKind: JsonValueKind.Array } a ? a.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.Object) : [];

    private static string? StringIn(JsonElement? v, params string[] allowed) =>
        v is { ValueKind: JsonValueKind.String } s && allowed.Contains(Text(s)) ? Text(s) : null;

    /// <summary><c>String(v ?? "")</c>.</summary>
    private static string Or(JsonElement? v) => v is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) } x ? JsString(x) : "";

    /// <summary><c>String(o[key] ?? "").trim().slice(0, n)</c>.</summary>
    private static string S(JsonElement o, string key, int n) => Slice(JsTrim(Or(Prop(o, key))), n);

    /// <summary>JavaScript's <c>String(x)</c> for a JSON value (null → "null"; an array joins its items with commas, a null item as "").</summary>
    private static string JsString(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => Text(v),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "null",
        JsonValueKind.Number => JsNumber(double.Parse(v.GetRawText(), NumberStyles.Float, CultureInfo.InvariantCulture)),
        JsonValueKind.Array => string.Join(",", v.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.Null ? "" : JsString(x))),
        JsonValueKind.Object => "[object Object]",
        _ => "",
    };

    /// <summary>
    /// JavaScript's <c>Number.prototype.toString()</c>: the shortest digits that round-trip, plain notation from 1e-6 up
    /// to 1e21 and exponent notation ("1e+21", "1.5e-7") outside it; -0 is "0", and 2**60 is "1152921504606847000",
    /// not the exact digits .NET's "F0" writes.
    /// </summary>
    private static string JsNumber(double d)
    {
        if (double.IsNaN(d)) return "NaN";
        if (double.IsInfinity(d)) return d > 0 ? "Infinity" : "-Infinity";
        if (d == 0) return "0";
        var r = Math.Abs(d).ToString("R", CultureInfo.InvariantCulture);
        var e = r.IndexOf('E');
        var mantissa = e < 0 ? r : r[..e];
        var exponent = e < 0 ? 0 : int.Parse(r[(e + 1)..], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
        var dot = mantissa.IndexOf('.');
        var all = dot < 0 ? mantissa : mantissa.Remove(dot, 1);
        var lead = all.Length - all.TrimStart('0').Length;
        var s = all.Trim('0');
        var n = (dot < 0 ? mantissa.Length : dot) + exponent - lead;
        var k = s.Length;
        var text = k <= n && n <= 21 ? s + new string('0', n - k)
            : 0 < n && n <= 21 ? $"{s[..n]}.{s[n..]}"
            : -6 < n && n <= 0 ? $"0.{new string('0', -n)}{s}"
            : $"{s[0]}{(k > 1 ? "." + s[1..] : "")}e{(n - 1 >= 0 ? "+" : "-")}{Math.Abs(n - 1)}";
        return d < 0 ? "-" + text : text;
    }

    /// <summary>
    /// A JSON string's text. JavaScript keeps a lone surrogate (<c>"\ud83d"</c>, a cut emoji); .NET refuses to read
    /// one, so such a string is unescaped here by hand — the same text JSON.parse gives.
    /// </summary>
    private static string Text(JsonElement v)
    {
        try { return v.GetString()!; }
        catch (InvalidOperationException) { return Unescape(v.GetRawText()); }
    }

    private static string Unescape(string quoted)
    {
        var sb = new StringBuilder(quoted.Length);
        for (var i = 1; i < quoted.Length - 1; i++)
        {
            var c = quoted[i];
            if (c != '\\') { sb.Append(c); continue; }
            c = quoted[++i];
            sb.Append(c switch
            {
                'b' => '\b', 'f' => '\f', 'n' => '\n', 'r' => '\r', 't' => '\t',
                'u' => (char)int.Parse(quoted.AsSpan(i + 1, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture),
                _ => c,
            });
            if (c == 'u') i += 4;
        }
        return sb.ToString();
    }
}
