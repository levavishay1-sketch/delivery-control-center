using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Domain.Onboarding;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// Validation per kind of component, in the isolated copy (repo-onboarding/verify.ts): a hook is run against a
/// forbidden action and must block; a permission file must parse and every rule must have the syntax Claude Code
/// reads; a skill or an agent must carry the frontmatter Claude Code triggers on; a rule line or a doc must not name a
/// path that does not exist; a script is run. What cannot be verified here says so (<c>Passed</c> null) rather than
/// passing. Only the file system and <c>node</c>; no database, no model.
///
/// The regular expressions are JavaScript's, spelled out where .NET reads them differently: <c>\w</c> is ASCII there
/// (a Hebrew word is not a path), <c>.</c> stops at <c>\r</c> as well as <c>\n</c>, and <c>$</c> is the very end.
/// </summary>
public static partial class ComponentVerifier
{
    // ── JavaScript's semantics, for this module and the build ──────────

    /// <summary>
    /// JavaScript's <c>.</c>: anything but a line terminator — \r included, which .NET's <c>.</c> lets through. The
    /// four characters themselves are in the class (C# escapes, not regex ones); it is the same set.
    /// </summary>
    internal const string Dot = "[^\n\r\x2028\x2029]";

    /// <summary>JavaScript's <c>^</c> under the m flag: the start, or just after any line terminator.</summary>
    internal const string LineStart = "(?<![^\n\r\x2028\x2029])";

    /// <summary>What JavaScript's trim() takes off: its WhiteSpace and LineTerminator — the BOM in, U+0085 out.</summary>
    private static readonly char[] JsSpace =
    [
        '\t', '\n', '\v', '\f', '\r', ' ', (char)0x00a0, (char)0x1680, (char)0x2000, (char)0x2001, (char)0x2002, (char)0x2003, (char)0x2004,
        (char)0x2005, (char)0x2006, (char)0x2007, (char)0x2008, (char)0x2009, (char)0x200a, (char)0x2028, (char)0x2029, (char)0x202f, (char)0x205f,
        (char)0x3000, (char)0xfeff,
    ];

    internal static string JsTrim(string s) => s.Trim(JsSpace);

    /// <summary>JavaScript's <c>\s</c> inside a pattern — the same set as trim(): .NET's <c>\s</c> adds U+0085 and leaves out the BOM.</summary>
    internal const string JsWs = "[\\t\\n\\v\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]";

    /// <summary>JavaScript's <c>\S</c>.</summary>
    internal const string JsNonWs = "[^\\t\\n\\v\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]";

    private static readonly UTF8Encoding Utf8NoBom = new(false);

    // ── JSON as JavaScript reads and writes it ─────────────────────────

    /// <summary>
    /// JSON.parse: a key given twice keeps its first place and its last value (JsonNode refuses such a document the
    /// moment it is read — a hand-edited settings.json can have one), and every number is a double. A byte-order mark,
    /// a comment or a trailing comma is a <see cref="JsonException"/>, as it is a SyntaxError there.
    /// </summary>
    internal static JsonNode? ParseJson(string text)
    {
        using var doc = JsonDocument.Parse(text);
        try { return FromElement(doc.RootElement); }
        // A lone surrogate escape ("\ud800"), which JavaScript keeps and .NET cannot decode: the file reads as unreadable.
        catch (InvalidOperationException e) { throw new JsonException(e.Message, e); }
    }

    private static JsonNode? FromElement(JsonElement e)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.Object:
                var o = new JsonObject();
                foreach (var p in e.EnumerateObject()) o[p.Name] = FromElement(p.Value);
                return o;
            case JsonValueKind.Array:
                var a = new JsonArray();
                foreach (var x in e.EnumerateArray()) a.Add(FromElement(x));
                return a;
            case JsonValueKind.String: return JsonValue.Create(e.GetString());
            case JsonValueKind.Number: return JsonValue.Create(double.Parse(e.GetRawText(), NumberStyles.Float, CultureInfo.InvariantCulture));
            case JsonValueKind.True: return JsonValue.Create(true);
            case JsonValueKind.False: return JsonValue.Create(false);
            default: return null;
        }
    }

    /// <summary>
    /// JSON.stringify(x, null, 2) (<paramref name="indent"/>) or JSON.stringify(x): two-space indents and "\n"; only
    /// quotes, backslashes, control characters and lone surrogates escaped (lowercase hex) — System.Text.Json also
    /// escapes emoji, U+2028, private-use characters and DEL; numbers as JavaScript prints them (1.0 → 1, 0.0000123
    /// stays plain); and an object's integer keys first, in ascending order, as a JavaScript object holds them.
    /// </summary>
    internal static string StringifyJson(JsonNode? node, bool indent)
    {
        var sb = new StringBuilder();
        WriteJson(sb, node, indent ? "" : null);
        return sb.ToString();
    }

    /// <param name="indent">The current indentation, or null for the compact form.</param>
    private static void WriteJson(StringBuilder sb, JsonNode? node, string? indent)
    {
        var inner = indent is null ? null : indent + "  ";
        switch (node)
        {
            case JsonObject o:
                var entries = JsEntries(o).ToList();
                if (entries.Count == 0) { sb.Append("{}"); break; }
                sb.Append('{');
                for (var i = 0; i < entries.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    if (inner is not null) sb.Append('\n').Append(inner);
                    QuoteJson(sb, entries[i].Key);
                    sb.Append(inner is null ? ":" : ": ");
                    WriteJson(sb, entries[i].Value, inner);
                }
                if (indent is not null) sb.Append('\n').Append(indent);
                sb.Append('}');
                break;
            case JsonArray a:
                if (a.Count == 0) { sb.Append("[]"); break; }
                sb.Append('[');
                for (var i = 0; i < a.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    if (inner is not null) sb.Append('\n').Append(inner);
                    WriteJson(sb, a[i], inner);
                }
                if (indent is not null) sb.Append('\n').Append(indent);
                sb.Append(']');
                break;
            case JsonValue v:
                switch (v.GetValueKind())
                {
                    case JsonValueKind.String: QuoteJson(sb, v.GetValue<string>()); break;
                    case JsonValueKind.Number: var d = NumberOf(v); sb.Append(double.IsFinite(d) ? JsNumber(d) : "null"); break;
                    case JsonValueKind.True: sb.Append("true"); break;
                    case JsonValueKind.False: sb.Append("false"); break;
                    default: sb.Append("null"); break;
                }
                break;
            default:
                sb.Append("null");
                break;
        }
    }

    private static void QuoteJson(StringBuilder sb, string s)
    {
        sb.Append('"');
        for (var i = 0; i < s.Length; i++)
        {
            var ch = s[i];
            switch (ch)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (char.IsHighSurrogate(ch) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) sb.Append(ch).Append(s[++i]);
                    else if (ch < ' ' || char.IsSurrogate(ch)) sb.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                    else sb.Append(ch);
                    break;
            }
        }
        sb.Append('"');
    }

    /// <summary>
    /// An object's entries in the order JavaScript keeps them (Object.entries, a spread, JSON.stringify): the keys that
    /// are array indices first, ascending, then the rest as they were added.
    /// </summary>
    internal static IEnumerable<KeyValuePair<string, JsonNode?>> JsEntries(JsonObject o) =>
        o.Where(kv => IsArrayIndex(kv.Key)).OrderBy(kv => ulong.Parse(kv.Key, CultureInfo.InvariantCulture)).Concat(o.Where(kv => !IsArrayIndex(kv.Key)));

    private static bool IsArrayIndex(string k) =>
        k.Length is > 0 and <= 10 && (k.Length == 1 || k[0] != '0') && k.All(char.IsAsciiDigit) && ulong.Parse(k, CultureInfo.InvariantCulture) < 4294967295UL;

    /// <summary>A file as Node's readFileSync(f, "utf8") gives it: a BOM is kept as U+FEFF, so writing the text back keeps it too.</summary>
    internal static string ReadText(string file) => Encoding.UTF8.GetString(File.ReadAllBytes(file));

    internal static void WriteText(string file, string text) => File.WriteAllText(file, text, Utf8NoBom);

    /// <summary>
    /// <c>path.join(dir, rel)</c>, normalised: a <paramref name="rel"/> that starts with a slash stays under
    /// <paramref name="dir"/> (Path.Combine would jump to the root), and the separators become the platform's.
    /// </summary>
    internal static string Abs(string dir, string rel) => Path.GetFullPath(Path.Join(dir, rel));

    /// <summary>existsSync: a file or a folder.</summary>
    internal static bool Exists(string path) => File.Exists(path) || Directory.Exists(path);

    internal static string Head(string s, int n) => s.Length <= n ? s : s[..n];

    internal static string IsoNow() => DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary>JavaScript's String(x) for a JSON value (null → "null"; an array joins its items with commas).</summary>
    internal static string JsString(JsonNode? n) => n switch
    {
        null => "null",
        JsonArray a => string.Join(",", a.Select(x => x is null ? "" : JsString(x))),
        JsonObject => "[object Object]",
        JsonValue v => v.GetValueKind() switch
        {
            JsonValueKind.String => v.GetValue<string>(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Number => JsNumber(NumberOf(v)),
            _ => v.ToJsonString(),
        },
        _ => n.ToJsonString(),
    };

    /// <summary>A JSON number as JavaScript holds it: a double (ToJsonString would refuse an infinite one).</summary>
    private static double NumberOf(JsonValue v) =>
        v.TryGetValue<double>(out var d) ? d : double.Parse(v.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture);

    /// <summary>String(o[key]): a missing key is "undefined", as a template literal would write it.</summary>
    internal static string JsString(JsonObject o, string key) => o.TryGetPropertyValue(key, out var v) ? JsString(v) : "undefined";

    /// <summary>String(o[key] ?? fallback).</summary>
    internal static string Str(JsonObject o, string key, string fallback = "") => o[key] is { } v ? JsString(v) : fallback;

    /// <summary>
    /// JavaScript's <c>Number.prototype.toString()</c>: the shortest digits that round-trip, plain notation from 1e-6
    /// up to 1e21 and exponent notation ("1e+21", "1.5e-7") outside it; -0 is "0".
    /// </summary>
    internal static string JsNumber(double d)
    {
        if (double.IsNaN(d)) return "NaN";
        if (double.IsInfinity(d)) return d > 0 ? "Infinity" : "-Infinity";
        if (d == 0) return "0";
        // .NET's "R" gives the same shortest digits, in its own notation ("1.23E-05"): take the digits and the exponent.
        var r = Math.Abs(d).ToString("R", CultureInfo.InvariantCulture);
        var e = r.IndexOf('E');
        var mantissa = e < 0 ? r : r[..e];
        var exponent = e < 0 ? 0 : int.Parse(r[(e + 1)..], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
        var dot = mantissa.IndexOf('.');
        var all = dot < 0 ? mantissa : mantissa.Remove(dot, 1);
        var lead = all.Length - all.TrimStart('0').Length;
        var s = all.Trim('0');
        // The value is 0.s × 10^n, with k digits in s (ECMA-262 Number::toString).
        var n = (dot < 0 ? mantissa.Length : dot) + exponent - lead;
        var k = s.Length;
        var text = k <= n && n <= 21 ? s + new string('0', n - k)
            : 0 < n && n <= 21 ? $"{s[..n]}.{s[n..]}"
            : -6 < n && n <= 0 ? $"0.{new string('0', -n)}{s}"
            : $"{s[0]}{(k > 1 ? "." + s[1..] : "")}e{(n - 1 >= 0 ? "+" : "-")}{Math.Abs(n - 1)}";
        return d < 0 ? "-" + text : text;
    }

    /// <summary>JavaScript truthiness of a JSON value.</summary>
    internal static bool Truthy(JsonNode? n) => n switch
    {
        null => false,
        JsonValue v => v.GetValueKind() switch
        {
            JsonValueKind.String => v.GetValue<string>().Length > 0,
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => NumberOf(v) is var d && d != 0 && !double.IsNaN(d),
            _ => false,
        },
        _ => true,
    };

    /// <summary><c>x === true</c>.</summary>
    internal static bool IsTrue(JsonNode? n) => n is JsonValue v && v.GetValueKind() == JsonValueKind.True;

    /// <summary><c>x === "text"</c>, for a value that must be that very string.</summary>
    internal static bool IsString(JsonNode? n, string text) => n is JsonValue v && v.GetValueKind() == JsonValueKind.String && v.GetValue<string>() == text;

    /// <summary>The value as a string when it is one (<c>typeof x === "string"</c>), else null.</summary>
    internal static string? AsString(JsonNode? n) => n is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;

    /// <summary><c>Array.isArray(x) ? x : []</c>, each item as JavaScript would print it.</summary>
    internal static List<string> Strings(JsonNode? n) => n is JsonArray a ? a.Select(JsString).ToList() : [];

    // ── the checks ──────────────────────────────────────────────────────

    private static ComponentValidation Result(string how, bool? passed, string detail) => new(how, passed, detail, IsoNow());

    /// <summary>What a run of node gave back. <c>Code</c> null: it could not start, or was killed at the time limit (spawnSync's status).</summary>
    private sealed record Ran(int? Code, string Out, string Err);

    /// <summary>
    /// A hook or a script, run with the <c>node</c> on PATH — no shell, the one argument the file. The time limit kills
    /// the whole tree; what was printed before it is kept — also when a process the script left behind (a build
    /// server) still holds the output open after node has exited, where only the next 10 seconds are waited for.
    /// </summary>
    private static Ran RunNode(string file, string cwd, string? stdin, int timeoutMs, IReadOnlyDictionary<string, string> env)
    {
        var psi = new ProcessStartInfo("node")
        {
            WorkingDirectory = cwd, RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
            UseShellExecute = false, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
            // No BOM on stdin: the hook JSON.parses what it reads.
            StandardInputEncoding = Utf8NoBom,
        };
        psi.ArgumentList.Add(file);
        foreach (var (k, v) in env) psi.Environment[k] = v;
        Process p;
        try { p = Process.Start(psi)!; }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException or IOException) { return new Ran(null, "", ""); }
        using (p)
        {
            var stdout = new StringBuilder();
            var stderr = new StringBuilder();
            Task[] pumps = [Pump(p.StandardOutput, stdout), Pump(p.StandardError, stderr)];
            // A hook may exit without reading its input; the pipe closing under the write is not a failure of the check.
            try
            {
                if (stdin is not null) p.StandardInput.Write(stdin);
                p.StandardInput.Close();
            }
            catch (IOException) { }
            int? code;
            if (p.WaitForExit(timeoutMs))
            {
                p.WaitForExit();
                code = p.ExitCode;
            }
            else
            {
                // spawnSync's kill never threw; a child that already went, or one Windows will not let go of, is not the check's failure.
                try { p.Kill(entireProcessTree: true); }
                catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception or AggregateException) { }
                code = null;
            }
            try { Task.WaitAll(pumps, 10_000); }
            catch (AggregateException) { }
            return new Ran(code, Taken(stdout), Taken(stderr));
        }

        static async Task Pump(StreamReader reader, StringBuilder into)
        {
            var buffer = new char[8192];
            int n;
            while ((n = await reader.ReadAsync(buffer.AsMemory())) > 0)
                lock (into) into.Append(buffer, 0, n);
        }

        static string Taken(StringBuilder sb)
        {
            lock (sb) return sb.ToString();
        }
    }

    private static (int Code, string Stderr, string Stdout) RunHook(string file, JsonObject hookEvent, string cwd)
    {
        var input = new JsonObject { ["cwd"] = cwd, ["session_id"] = "dcc-verify" };
        foreach (var (k, v) in hookEvent) input[k] = v?.DeepClone();
        var r = RunNode(file, cwd, StringifyJson(input, false), 60_000, new Dictionary<string, string> { ["CLAUDE_PROJECT_DIR"] = cwd });
        return (r.Code ?? -1, r.Err, r.Out);
    }

    private static JsonObject Edit(string filePath) => new() { ["tool_name"] = "Edit", ["tool_input"] = new JsonObject { ["file_path"] = filePath } };

    [GeneratedRegex(@"\*\*?/?")] private static partial Regex GlobStars();
    [GeneratedRegex(@"\.[a-z0-9]+\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex Extension();

    /// <summary>A path the hook must refuse and one it must allow, from the component's own parameters.</summary>
    private static (string Forbidden, string Allowed) ForbiddenAndAllowed(JsonObject parameters)
    {
        var first = parameters["paths"] is JsonArray { Count: > 0 } paths && paths[0] is { } p0 ? JsString(p0) : "generated";
        var forbidden = first.Contains('*') ? GlobStars().Replace(first, "x/")
            : first.EndsWith('/') ? $"{first}file.txt"
            : Extension().IsMatch(first) ? first
            : $"{first}/file.txt";
        return (forbidden, "README-dcc-verify-allowed.md");
    }

    public static ComponentValidation ValidateHook(Component c, string dir)
    {
        var file = c.Files.FirstOrDefault(f => f.EndsWith(".mjs", StringComparison.Ordinal));
        if (file is null) return Result("הרצת ה-hook", false, "לא נכתב קובץ hook");
        var abs = Abs(dir, file);
        var template = Str(c.Params, "template");
        const string secret = "Password=Sup3rS3cretDccVerify1;";
        if (template == "block-paths")
        {
            var (forbidden, allowed) = ForbiddenAndAllowed(c.Params);
            var deny = RunHook(abs, Edit(Abs(dir, forbidden)), dir);
            var allow = RunHook(abs, Edit(Abs(dir, allowed)), dir);
            if (deny.Code != 2) return Result($"ניסיון עריכה של {forbidden}", false, $"ה-hook לא חסם (קוד {deny.Code})");
            if (allow.Code != 0) return Result($"ניסיון עריכה של {forbidden}", false, $"ה-hook חסם גם קובץ מותר ({allowed}, קוד {allow.Code})");
            return Result($"ניסיון עריכה של {forbidden}", true, "נחסם; קובץ מותר עבר");
        }
        if (template == "block-commands")
        {
            var bad = c.Params["patterns"] is JsonArray { Count: > 0 } patterns && patterns[0] is { } p0 ? JsString(p0) : "forbidden";
            JsonObject Bash(string command) => new() { ["tool_name"] = "Bash", ["tool_input"] = new JsonObject { ["command"] = command } };
            var deny = RunHook(abs, Bash($"{bad} -auto-approve"), dir);
            var allow = RunHook(abs, Bash("ls"), dir);
            return deny.Code == 2 && allow.Code == 0
                ? Result($"הפקודה \"{bad}\"", true, "נחסמה; ls עבר")
                : Result($"הפקודה \"{bad}\"", false, $"חסימה: קוד {deny.Code}; ls: קוד {allow.Code}");
        }
        if (template == "secret-scan")
        {
            JsonObject Write(string rel, string content) => new() { ["tool_name"] = "Write", ["tool_input"] = new JsonObject { ["file_path"] = Abs(dir, rel), ["content"] = content } };
            var deny = RunHook(abs, Write("src/dcc-verify.ts", $"const c = \"{secret}\";"), dir);
            var clean = RunHook(abs, Write("src/dcc-verify.ts", "const c = 1;"), dir);
            if (deny.Code != 2) return Result("כתיבת מחרוזת חיבור מזויפת", false, $"ה-hook לא חסם (קוד {deny.Code})");
            if ((deny.Stderr + deny.Stdout).Contains("Sup3rS3cretDccVerify1", StringComparison.Ordinal)) return Result("כתיבת מחרוזת חיבור מזויפת", false, "ה-hook הדפיס את הסוד עצמו");
            if (clean.Code != 0) return Result("כתיבת מחרוזת חיבור מזויפת", false, $"ה-hook חסם גם תוכן נקי (קוד {clean.Code})");
            if (IsTrue(c.Params["allowTests"]))
            {
                var test = RunHook(abs, Write("tests/dcc-verify.test.ts", $"const c = \"{secret}\";"), dir);
                if (test.Code != 0) return Result("כתיבת מחרוזת חיבור מזויפת", false, "ה-hook חסם קובץ בדיקה למרות ה-allowlist");
            }
            return Result("כתיבת מחרוזת חיבור מזויפת", true, "נחסמה בלי להדפיס את הערך; תוכן נקי עבר");
        }
        if (template == "build-gate")
        {
            var again = RunHook(abs, new JsonObject { ["hook_event_name"] = "Stop", ["stop_hook_active"] = true }, dir);
            return again.Code == 0
                ? Result("Stop hook שכבר המשיך תור", true, "לא נכנס ללולאה; ה-build עצמו נבדק בסקריפט האימות")
                : Result("Stop hook שכבר המשיך תור", false, $"קוד {again.Code}");
        }
        if (template is "post-format" or "post-validate")
        {
            var tmp = Abs(dir, "dcc-verify-format.txt");
            WriteText(tmp, "x\n");
            try
            {
                var r = RunHook(abs, Edit(tmp), dir);
                return Result("הרצה על קובץ שנערך", r.Code is 0 or 2,
                    r.Code == 0 ? "רץ" : r.Code == 2 ? "רץ והחזיר שגיאה (כצפוי לקובץ לא תקין)" : $"קוד {r.Code}: {Head(r.Stderr, 200)}");
            }
            finally
            {
                File.Delete(tmp);
            }
        }
        var generic = RunHook(abs, Edit(Abs(dir, "README.md")), dir);
        return Result("הרצה עם אירוע לדוגמה", generic.Code is 0 or 2, $"קוד {generic.Code}");
    }

    private const string RuleTools = "Read|Edit|Write|MultiEdit|Bash|Glob|Grep|WebFetch|WebSearch|NotebookEdit|Task|mcp__[A-Za-z0-9_-]+";
    [GeneratedRegex(@"^(" + RuleTools + @")(\(" + Dot + @"*\))?\z")] private static partial Regex RuleSyntax();
    [GeneratedRegex(@"^[A-Za-z0-9_]+\(|\)\z")] private static partial Regex ToolWrapper();

    /// <summary>The JSON object in a file, or why it is not one. A top level that is not an object reads as an empty one.</summary>
    private static (JsonObject? Json, string? Error) ParseObject(string file)
    {
        try { return (ParseJson(ReadText(file)) as JsonObject ?? [], null); }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException) { return (null, e.Message); }
    }

    public static ComponentValidation ValidateSettings(string dir, Component c)
    {
        var file = Path.Join(dir, ".claude", "settings.json");
        if (!Exists(file)) return Result("פענוח .claude/settings.json", false, "הקובץ לא נכתב");
        var (json, error) = ParseObject(file);
        if (json is null) return Result("פענוח .claude/settings.json", false, $"JSON לא תקין: {Head(error ?? "", 120)}");
        if (c.Kind == "permission")
        {
            var deny = Strings((json["permissions"] as JsonObject)?["deny"]);
            var mine = Strings(c.Params["deny"]);
            var bad = deny.Where(d => !RuleSyntax().IsMatch(d)).ToList();
            if (bad.Count > 0) return Result("פענוח .claude/settings.json", false, $"כללים בתחביר לא מוכר: {string.Join(", ", bad.Take(3))}");
            var missing = mine.Where(m => !deny.Any(d => d.Contains(ToolWrapper().Replace(m, ""), StringComparison.Ordinal))).ToList();
            return missing.Count > 0
                ? Result("פענוח .claude/settings.json", false, $"חסרים בקובץ: {string.Join(", ", missing.Take(3))}")
                : Result("פענוח .claude/settings.json", true, $"{deny.Count} כללי deny, כולם בתחביר של Claude Code");
        }
        return Result("פענוח .claude/settings.json", true, "תקין");
    }

    [GeneratedRegex("`([^`\n]{2,160})`")] private static partial Regex Backticked();
    [GeneratedRegex(@"^(npm|npx|pnpm|yarn|bun|dotnet|msbuild|go|cargo|mvn|\./mvnw|\./gradlew|gradle|make|composer|terraform|pytest|python|pip|uv|node|git|pac|az|aws|gcloud|docker|kubectl|helm|ruff|black|eslint|prettier|tsc|vitest|jest|@)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex CommandClaim();
    [GeneratedRegex(@"^(fix|task|project|feature|release|ai|claude|hotfix)/[A-Za-z0-9_<>.-]*\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex BranchName();
    [GeneratedRegex(@"^[A-Za-z0-9_./@-]+/[A-Za-z0-9_./@*-]*\z|^[A-Za-z0-9_-]+\.[a-z0-9]{1,6}\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex PathClaim();

    /// <summary>Every path a text names in backticks must exist; a command must be one the repository knows.</summary>
    public static (int Checked, List<string> Missing) CheckClaims(string text, string dir, IReadOnlyList<string> knownCommands)
    {
        var missing = new List<string>();
        var count = 0;
        foreach (Match m in Backticked().Matches(text))
        {
            var claim = JsTrim(m.Groups[1].Value);
            if (CommandClaim().IsMatch(claim))
            {
                // A command the profile did not list (knownCommands) is not necessarily wrong — noted, not failed.
                count++;
                continue;
            }
            // A branch name or a pattern (`fix/`, `task/WI-12-x`, `ai/onboarding/<run>`) is not a path claim.
            if (claim.IndexOfAny(['<', '>']) >= 0 || BranchName().IsMatch(claim)) continue;
            if (PathClaim().IsMatch(claim) && !claim.Contains('*') && !claim.StartsWith("http", StringComparison.Ordinal))
            {
                count++;
                if (!Exists(Abs(dir, claim.StartsWith("./", StringComparison.Ordinal) ? claim[2..] : claim))) missing.Add(claim);
            }
        }
        return (count, missing.Distinct().ToList());
    }

    public static ComponentValidation ValidateText(Component c, string dir, IReadOnlyList<string> knownCommands, IReadOnlyDictionary<string, string>? appended = null)
    {
        var files = c.Files.Where(f => Exists(Abs(dir, f))).ToList();
        if (files.Count == 0) return Result("בדיקת טענות מול הקוד", false, "לא נכתב קובץ");
        var count = 0;
        var missing = new List<string>();
        foreach (var f in files)
        {
            // A file that existed before is judged on what this build added to it, not on what was already there.
            var r = CheckClaims(appended is not null && appended.TryGetValue(f, out var added) ? added : ReadText(Abs(dir, f)), dir, knownCommands);
            count += r.Checked;
            missing.AddRange(r.Missing);
        }
        var uniq = missing.Distinct().ToList();
        if (uniq.Count > 0)
            return Result("בדיקת טענות מול הקוד", !(uniq.Count > Math.Max(1, count * 0.2)), $"{count} טענות נבדקו; נתיבים שלא קיימים: {string.Join(", ", uniq.Take(5))}");
        return Result("בדיקת טענות מול הקוד", true, count > 0 ? $"{count} נתיבים ופקודות נבדקו, כולם קיימים" : "אין טענות שניתן לבדוק");
    }

    [GeneratedRegex(@"^---\r?\n([\s\S]*?)\r?\n---")] private static partial Regex FrontmatterBlock();
    // A line that ends in \r (a CRLF file) does not match, as in JavaScript — only the block's last line loses its \r.
    [GeneratedRegex(@"^([A-Za-z0-9_-]+):" + JsWs + "*(" + Dot + @"*)\z")] private static partial Regex FrontmatterLine();

    private static Dictionary<string, string>? Frontmatter(string text)
    {
        var m = FrontmatterBlock().Match(text);
        if (!m.Success) return null;
        var output = new Dictionary<string, string>();
        foreach (var line in m.Groups[1].Value.Split('\n'))
            if (FrontmatterLine().Match(line) is { Success: true } kv) output[kv.Groups[1].Value] = JsTrim(kv.Groups[2].Value);
        return output;
    }

    public static ComponentValidation ValidateSkill(Component c, string dir)
    {
        var file = c.Files.FirstOrDefault(f => f.EndsWith("SKILL.md", StringComparison.Ordinal));
        if (file is null || !Exists(Abs(dir, file))) return Result("frontmatter של ה-skill", false, "לא נכתב SKILL.md");
        var text = ReadText(Abs(dir, file));
        var fm = Frontmatter(text);
        if (fm is null || string.IsNullOrEmpty(fm.GetValueOrDefault("name")) || string.IsNullOrEmpty(fm.GetValueOrDefault("description")))
            return Result("frontmatter של ה-skill", false, "חסר name או description — Claude Code לא יטען אותו");
        if (fm["description"].Length < 40) return Result("frontmatter של ה-skill", false, "description קצר מדי כדי ש-Claude Code ידע מתי להפעיל אותו");
        var body = JsTrim(text[(text.IndexOf("---", 3, StringComparison.Ordinal) + 3)..]);
        if (body.Length < 200) return Result("frontmatter של ה-skill", false, "הגוף קצר מדי (פחות מ-200 תווים)");
        var claims = CheckClaims(body, dir, []);
        return Result("frontmatter וגוף ה-skill, נתיבים מול הקוד", claims.Missing.Count > 0 ? null : true,
            claims.Missing.Count > 0 ? $"נתיבים שלא קיימים: {string.Join(", ", claims.Missing.Take(4))}" : $"name, description ו-{body.Length} תווים; {claims.Checked} נתיבים נבדקו");
    }

    [GeneratedRegex(@"\.claude/agents/" + Dot + @"+\.md\z")] private static partial Regex AgentFile();
    [GeneratedRegex(LineStart + JsWs + "*[-*]" + JsWs + @"+\[ \]|" + LineStart + JsWs + "*[-*]" + JsWs + "+")] private static partial Regex ChecklistItem();

    public static ComponentValidation ValidateAgent(Component c, string dir)
    {
        var file = c.Files.FirstOrDefault(f => AgentFile().IsMatch(f));
        if (file is null || !Exists(Abs(dir, file))) return Result("frontmatter של הסוכן", false, "לא נכתב קובץ סוכן");
        var text = ReadText(Abs(dir, file));
        var fm = Frontmatter(text);
        if (fm is null || string.IsNullOrEmpty(fm.GetValueOrDefault("name")) || string.IsNullOrEmpty(fm.GetValueOrDefault("description")))
            return Result("frontmatter של הסוכן", false, "חסר name או description");
        var tools = (fm.GetValueOrDefault("tools") ?? "").Split(',').Select(JsTrim).Where(t => t.Length > 0).ToList();
        var writes = tools.Where(t => t is "Edit" or "Write" or "MultiEdit").ToList();
        var checklist = ChecklistItem().Count(text);
        if (writes.Count > 0) return Result("frontmatter, כלים ורשימת בדיקה", false, $"סוכן בודק עם כלי כתיבה ({string.Join(", ", writes)}) — צריך להיות קריאה בלבד");
        if (checklist < 3) return Result("frontmatter, כלים ורשימת בדיקה", false, $"רשימת הבדיקה קצרה מדי ({checklist} פריטים)");
        var toolsText = string.Join(", ", tools);
        return Result("frontmatter, כלים ורשימת בדיקה", true, $"קריאה בלבד ({(toolsText.Length > 0 ? toolsText : "ברירת המחדל")}), {checklist} פריטי בדיקה");
    }

    [GeneratedRegex(@"\{[a-z]+\}")] private static partial Regex Placeholder();

    /// <summary>Also the build's test for an address still to be filled in (<c>https://{org}.example</c>).</summary>
    internal static bool HasPlaceholder(string url) => Placeholder().IsMatch(url);

    public static ComponentValidation ValidateMcp(Component c, string dir)
    {
        var file = Path.Join(dir, ".mcp.json");
        if (!Exists(file)) return Result("פענוח .mcp.json", false, "הקובץ לא נכתב");
        var (json, error) = ParseObject(file);
        if (json is null) return Result("פענוח .mcp.json", false, $"JSON לא תקין: {Head(error ?? "", 120)}");
        var name = c.Params["server"] is { } server ? JsString(server) : Str(c.Params, "name");
        if (name.Length == 0) return Result("פענוח .mcp.json", false, "לרכיב אין שם שרת");
        var entry = json["mcpServers"] is JsonObject servers ? servers[name] : null;
        if (!Truthy(entry)) return Result("פענוח .mcp.json", false, $"השרת \"{name}\" לא נמצא בקובץ");
        var url = entry is JsonObject e ? e["url"] : null;
        if (Truthy(url) && HasPlaceholder(JsString(url)))
            return Result("פענוח .mcp.json", null, $"נכתב עם מקום להשלמה ({JsString(url)}) — דורש את פרטי הסביבה של הלקוח לפני חיבור; לא חובר כאן");
        return Result("פענוח .mcp.json", null, "הקובץ תקין; החיבור עצמו וספירת הטוקנים נעשים בסשן הראשון עם הרשאות הלקוח");
    }

    public static ComponentValidation ValidateFileLines(Component c, string dir, string file)
    {
        var abs = Abs(dir, file);
        if (!Exists(abs)) return Result($"הקובץ {file}", false, "לא נכתב");
        var text = ReadText(abs);
        var wanted = c.Params["entries"] is JsonArray ? Strings(c.Params["entries"]) : Strings(c.Params["paths"]);
        var missing = wanted.Where(w => !text.Contains(w, StringComparison.Ordinal)).ToList();
        return missing.Count > 0
            ? Result($"הקובץ {file}", false, $"חסרות שורות: {string.Join(", ", missing.Take(3))}")
            : Result($"הקובץ {file}", true, $"{(wanted.Count > 0 ? wanted.Count.ToString(CultureInfo.InvariantCulture) : "כל")} השורות נמצאות");
    }

    /// <summary>The local gate is run for real — that is the verification loop. A build that cannot run here says so (exit 3), and that is recorded, not hidden.</summary>
    public static ComponentValidation ValidateScript(Component c, string dir)
    {
        var file = c.Files.FirstOrDefault(f => f.EndsWith(".mjs", StringComparison.Ordinal) || f.EndsWith(".sh", StringComparison.Ordinal));
        if (file is null) return Result("הרצת הסקריפט", false, "לא נכתב");
        var r = RunNode(Abs(dir, file), dir, null, 15 * 60_000, new Dictionary<string, string> { ["CI"] = "1" });
        var output = r.Out + r.Err;
        var verdict = output.Split('\n').Reverse().FirstOrDefault(l => l.StartsWith("VERIFY:", StringComparison.Ordinal)) ?? "";
        if (r.Code == 0) return Result("הרצת סקריפט האימות", true, verdict.Length > 0 ? verdict : "עבר");
        if (r.Code == 3) return Result("הרצת סקריפט האימות", null, verdict.Length > 0 ? verdict : "אי אפשר להריץ כאן");
        var code = r.Code?.ToString(CultureInfo.InvariantCulture) ?? "null";
        var tail = Head(string.Join(" | ", JsTrim(output).Split('\n').TakeLast(3)), 300);
        return Result("הרצת סקריפט האימות", false, $"{(verdict.Length > 0 ? verdict : $"קוד {code}")}: {tail}");
    }

    /// <summary>A plugin whose settings parse is registered; only the first session installs it and shows what it costs.</summary>
    private static ComponentValidation Registered(ComponentValidation settings) => settings.Passed == true
        ? Result("פענוח .claude/settings.json", null, "רשום ב-enabledPlugins; Claude Code מתקין אותו בסשן הראשון, ואז נמדדת עלות ההקשר")
        : settings;

    /// <summary>One component, checked its own way. A kind outside the vocabulary has no check — the caller says what that means.</summary>
    internal static ComponentValidation? TryValidate(Component c, string dir, IReadOnlyList<string> knownCommands, IReadOnlyDictionary<string, string>? appended) => c.Kind switch
    {
        "hook" => ValidateHook(c, dir),
        "permission" or "settings" => ValidateSettings(dir, c),
        "plugin" or "lsp" => Registered(ValidateSettings(dir, c)),
        "gitignore" => ValidateFileLines(c, dir, ".gitignore"),
        "gitattributes" => ValidateFileLines(c, dir, ".gitattributes"),
        "script" => ValidateScript(c, dir),
        "skill" => ValidateSkill(c, dir),
        "agent" => ValidateAgent(c, dir),
        "mcp" => ValidateMcp(c, dir),
        "rule" or "doc" or "scaffold" or "review" or "pr_template" => ValidateText(c, dir, knownCommands, appended),
        "runner" => Result("—", null, "לא רכיב שמותקן: דרישה מהלקוח (ראו כרטיס הכנות)"),
        "report" => Result("—", null, "דיווח, לא התקנה"),
        "devcontainer" => ValidateText(c, dir, knownCommands, appended),
        _ => null,
    };

    /// <summary>
    /// validateComponent. A kind outside the vocabulary throws — the old server had no answer for it either (its build
    /// then failed that card, or left it installed and unchecked where it read the answer with <c>?.</c>).
    /// </summary>
    public static ComponentValidation Validate(Component c, string dir, IReadOnlyList<string> knownCommands, IReadOnlyDictionary<string, string>? appended = null) =>
        TryValidate(c, dir, knownCommands, appended) ?? throw new ArgumentException($"no check for a component of kind \"{c.Kind}\"", nameof(c));

    // ── the joint check over the whole set ─────────────────────────────

    private static readonly string[] AlwaysLoaded = ["CLAUDE.md", "AGENTS.md"];

    /// <summary>Shared files (settings, AGENTS.md, .gitignore) are merged on purpose; a duplicate is two components owning one file of their own.</summary>
    private static readonly HashSet<string> SharedFiles = [".claude/settings.json", ".mcp.json", "AGENTS.md", "CLAUDE.md", ".gitignore", ".gitattributes"];

    [GeneratedRegex(@"^Read\(|\)\z")] private static partial Regex ReadWrapper();
    [GeneratedRegex(@"/\*\*\z")] private static partial Regex TrailingGlob();

    private static long SizeOf(string path) => File.Exists(path) ? new FileInfo(path).Length : 0;

    public static JointCheck Joint(IReadOnlyList<Component> cards, string dir)
    {
        var writers = new OrderedDictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var c in cards)
            foreach (var f in c.Files)
            {
                if (!writers.TryGetValue(f, out var keys)) writers.Add(f, keys = []);
                keys.Add(c.Key);
            }
        var duplicates = writers.Where(w => w.Value.Count > 1 && !SharedFiles.Contains(w.Key)).Select(w => $"{w.Key}: {string.Join(", ", w.Value)}").ToList();
        var contradictions = new List<string>();
        var denied = cards.Where(c => c.Kind == "permission").SelectMany(c => Strings(c.Params["deny"])).ToList();
        foreach (var c in cards)
        {
            if (c.Kind is not ("skill" or "agent" or "doc")) continue;
            foreach (var f in c.Files)
                if (denied.Any(d => d.Contains("Read(", StringComparison.Ordinal) && f.StartsWith(TrailingGlob().Replace(ReadWrapper().Replace(d, ""), "", 1), StringComparison.Ordinal)))
                    contradictions.Add($"{c.Key}: הקובץ {f} נמצא תחת איסור קריאה ({c.Kind} שאי אפשר לקרוא)");
        }
        long chars = 0;
        foreach (var f in AlwaysLoaded)
        {
            var p = Abs(dir, f);
            if (Exists(p)) chars += SizeOf(p);
        }
        var rulesDir = Path.Join(dir, ".claude", "rules");
        if (Directory.Exists(rulesDir))
            foreach (var entry in Directory.EnumerateFileSystemEntries(rulesDir))
                if (Path.GetFileName(entry).EndsWith(".md", StringComparison.Ordinal)) chars += SizeOf(entry);
        var mcpTokens = cards.Where(c => c.Kind == "mcp" && c.Status is ComponentStatuses.Installed or ComponentStatuses.Verified).Sum(c => c.ContextTokens ?? 0);
        return new JointCheck(duplicates, contradictions, (int)Math.Round(chars / 4.0, MidpointRounding.AwayFromZero) + mcpTokens);
    }

    /// <summary>A scratch copy for tests of the validators, so nothing touches a real worktree.</summary>
    public static string ScratchDir() => Directory.CreateTempSubdirectory("dcc-verify-").FullName;
}
