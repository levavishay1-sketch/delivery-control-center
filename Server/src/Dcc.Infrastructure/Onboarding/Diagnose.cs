using System.Globalization;
using System.IO.Enumeration;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Infrastructure.Repos;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// The deterministic diagnosis of a repository — the "diagnose" step of an onboarding run (repo-onboarding/diagnose.ts):
/// what is in the repository, read from its files and its git history, with no model. It is a port of the research
/// script (<c>docs/research/sources/onboarding-v2/repos/diagnose.py</c>) that produced the eleven stored diagnoses, kept
/// detector for detector — the same tables, the same regular expressions, the same thresholds and cut-offs, the same
/// ordering of every list and of every key — so those diagnoses stay valid fixtures for the rules, which read the
/// profile by path.
///
/// What is deliberately different from the script (and was already so in the old server):
///  - symbolic links (any reparse point, on Windows) are neither followed nor listed;
///  - a <c>packages/</c> directory is skipped only when it is a NuGet package cache;
///  - <c>size.bytes_on_disk_excl_git</c> is the sum of the walked files' sizes;
///  - the git log is read up to 3000 commits, so a long history stays quick;
///  - the read limits are in bytes where the script counted characters;
///  - <c>docs.pr_template</c> and <c>docs.codeowners</c> are new.
///
/// The patterns run with ECMAScript semantics (ASCII <c>\b</c>, <c>\w</c>, <c>\d</c>, as the old server's JavaScript had
/// them). Where JavaScript's <c>\s</c>, <c>.</c> or a multi-line <c>^</c>/<c>$</c> differ from .NET's, they are written out
/// (<see cref="S"/>, <see cref="Dot"/>, <see cref="LineStart"/>, <see cref="LineEnd"/>), on file contents; a path holds no
/// line break, so path patterns keep the plain forms.
/// </summary>
public static partial class RepositoryDiagnosis
{
    /* ── the tables ─────────────────────────────────────────────────── */

    /// <summary>Never walked: dependency caches, build output and IDE state say nothing about the code.</summary>
    private static readonly HashSet<string> SkipDirs = new(StringComparer.Ordinal)
    {
        ".git", "node_modules", "dist", "build", "target", "bin", "obj", ".pgdata",
        "vendor", ".venv", "venv", "__pycache__", ".next", ".turbo", "out", ".gradle",
        ".idea", ".vs", "coverage", "site-packages",
    };

    private static readonly HashSet<string> BinaryExt = new(StringComparer.Ordinal)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".jar", ".dll", ".exe",
        ".so", ".dylib", ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".mp3", ".webp", ".svg",
        ".nupkg", ".pdb", ".bin", ".class", ".pyc", ".wasm", ".lock", ".sum", ".snk", ".pfx",
        ".gz", ".tar", ".7z", ".rar", ".bmp", ".psd", ".xlsx", ".docx", ".pptx", ".msi", ".cab",
    };

    private static readonly Dictionary<string, string> LangExt = new(StringComparer.Ordinal)
    {
        [".ts"] = "TypeScript", [".tsx"] = "TypeScript", [".js"] = "JavaScript", [".jsx"] = "JavaScript", [".mjs"] = "JavaScript",
        [".cjs"] = "JavaScript", [".py"] = "Python", [".go"] = "Go", [".java"] = "Java", [".kt"] = "Kotlin", [".kts"] = "Kotlin",
        [".cs"] = "C#", [".vb"] = "VB.NET", [".php"] = "PHP", [".rb"] = "Ruby", [".rs"] = "Rust", [".tf"] = "HCL/Terraform",
        [".hcl"] = "HCL/Terraform", [".ipynb"] = "Jupyter", [".dart"] = "Dart", [".swift"] = "Swift", [".m"] = "Objective-C",
        [".sql"] = "SQL", [".sh"] = "Shell", [".ps1"] = "PowerShell", [".yaml"] = "YAML", [".yml"] = "YAML", [".json"] = "JSON",
        [".html"] = "HTML", [".css"] = "CSS", [".scss"] = "SCSS", [".xml"] = "XML", [".md"] = "Markdown", [".twig"] = "Twig",
        [".c"] = "C", [".cpp"] = "C++", [".h"] = "C/C++ header", [".proto"] = "Protobuf", [".tpl"] = "Helm template",
    };

    private static readonly HashSet<string> CodeLangs = new(StringComparer.Ordinal)
    {
        "TypeScript", "JavaScript", "Python", "Go", "Java", "Kotlin", "C#", "VB.NET", "PHP", "Ruby",
        "Rust", "HCL/Terraform", "Jupyter", "Dart", "Swift", "Objective-C", "C", "C++", "SQL", "Twig",
    };

    /// <summary>How much of a file is read, in bytes: a manifest or document, the secrets scan, the generated-code header, the external-systems scan.</summary>
    private const int ReadLimit = 200_000;
    private const int SecretsLimit = 400_000;
    private const int HeaderLimit = 1200;
    private const int ExternalLimit = 300_000;

    /// <summary>The git log is enough at 3000 commits to find hot files and change shapes; a full history of a large repository would take minutes.</summary>
    private const int LogMaxCommits = 3000;

    private const int GitTimeoutMs = 120_000;

    /// <summary>A diagnosis only reads: git must not take the index lock someone else's command may be waiting for.</summary>
    private static readonly Dictionary<string, string> GitEnv = new() { ["GIT_OPTIONAL_LOCKS"] = "0" };

    /// <summary>Every pattern ported from the old server runs with these: ASCII <c>\b</c>, <c>\w</c> and <c>\d</c>, as JavaScript had them.</summary>
    private const RegexOptions Js = RegexOptions.ECMAScript | RegexOptions.CultureInvariant;
    private const RegexOptions JsI = Js | RegexOptions.IgnoreCase;

    /// <summary>The members of JavaScript's <c>\s</c> — .NET's set is another (it leaves out U+FEFF and adds U+0085), so it is spelled out inside a class.</summary>
    private const string S = @"\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

    /// <summary>JavaScript's <c>.</c>: anything but a line terminator — .NET's stops only at <c>\n</c>, so it would run over a CR.</summary>
    private const string Dot = @"[^\n\r\u2028\u2029]";

    /// <summary>JavaScript's <c>^</c> and <c>$</c> under the <c>m</c> flag: next to any line terminator, not only <c>\n</c>.</summary>
    private const string LineStart = @"(?<![^\n\r\u2028\u2029])";
    private const string LineEnd = @"(?![^\n\r\u2028\u2029])";

    /// <summary>What JavaScript's <c>trim()</c> removes — not what .NET's <c>Trim()</c> does (U+FEFF in, U+0085 out).</summary>
    private static readonly char[] JsSpaces =
    [
        '\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005',
        '\u2006', '\u2007', '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff',
    ];

    /* ── small helpers ──────────────────────────────────────────────── */

    /// <summary>A counter that remembers the order its keys were first seen — a JavaScript <c>Map</c> of counts.</summary>
    private sealed class Counter
    {
        private readonly OrderedDictionary<string, long> _counts = new(StringComparer.Ordinal);

        public void Inc(string key, long by = 1) => _counts[key] = Get(key) + by;

        public long Get(string key) => _counts.TryGetValue(key, out var n) ? n : 0;

        public int Count => _counts.Count;

        public IEnumerable<string> Keys => _counts.Keys;

        public IEnumerable<KeyValuePair<string, long>> Entries => _counts;

        /// <summary>Python's <c>Counter.most_common(n)</c>: by count, descending; ties keep first-seen order (OrderBy is stable, as both sorts were).</summary>
        public List<KeyValuePair<string, long>> MostCommon(int n = int.MaxValue) => _counts.OrderByDescending(e => e.Value).Take(n).ToList();
    }

    /// <summary><c>dict.fromkeys(list)</c> — the list without repeats, first occurrence kept.</summary>
    private static List<string> Unique(IEnumerable<string> xs)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        return xs.Where(seen.Add).ToList();
    }

    private static void AddTo(Dictionary<string, HashSet<string>> m, string k, string v)
    {
        if (!m.TryGetValue(k, out var s)) m[k] = s = new HashSet<string>(StringComparer.Ordinal);
        s.Add(v);
    }

    /// <summary>The extension as Python's <c>os.path.splitext</c> gives it: the leading dots of a name are not an extension (<c>.env</c> → "", <c>..foo</c> → "", <c>foo.</c> → ".").</summary>
    private static string ExtOf(string p)
    {
        var sep = p.LastIndexOf('/');
        var dot = p.LastIndexOf('.');
        if (dot <= sep) return "";
        for (var i = sep + 1; i < dot; i++) if (p[i] != '.') return p[dot..];
        return "";
    }

    private static string DirOf(string p)
    {
        var i = p.LastIndexOf('/');
        return i == -1 ? "" : p[..i];
    }

    private static string BaseOf(string p) => p[(p.LastIndexOf('/') + 1)..];

    private static int Slashes(string f) => f.AsSpan().Count('/');

    /// <summary>Python's <c>len()</c> of a string counts code points, not UTF-16 units.</summary>
    private static int CodePoints(string s)
    {
        var n = s.Length;
        foreach (var c in s) if (c is >= '\uDC00' and <= '\uDFFF') n--;
        return n;
    }

    private static string JsTrim(string s) => s.Trim(JsSpaces);

    /// <summary>JavaScript's <c>s.slice(0, n)</c> — in UTF-16 units, as <c>Substring</c> counts.</summary>
    private static string Head(string s, int n) => s.Length > n ? s[..n] : s;

    /// <summary>JavaScript's <c>parseInt(s, 10) || 0</c>: the leading integer, 0 when there is none.</summary>
    private static long ParseIntLoose(string s)
    {
        var t = s.TrimStart(JsSpaces);
        var i = 0;
        var negative = false;
        if (i < t.Length && t[i] is '+' or '-') { negative = t[i] == '-'; i++; }
        var start = i;
        while (i < t.Length && char.IsAsciiDigit(t[i])) i++;
        return i > start && long.TryParse(t.AsSpan(start, i - start), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? (negative ? -n : n) : 0;
    }

    /// <summary>Bytes as text the way the script read files (<c>errors="ignore"</c>): what does not decode is dropped, not replaced. A BOM stays, as it did.</summary>
    private static string Decode(ReadOnlySpan<byte> bytes) => Encoding.UTF8.GetString(bytes).Replace("\ufffd", "", StringComparison.Ordinal);

    /// <summary>Shared for reading: a file someone else has open (an IDE, a running build) is still read.</summary>
    private static FileStream OpenRead(string abs) => new(abs, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, bufferSize: 0);

    /// <summary>The first <paramref name="limit"/> bytes of a file as text; "" when it cannot be read — a diagnosis never fails on one file.</summary>
    private static string ReadText(string abs, int limit = ReadLimit)
    {
        try
        {
            using var fs = OpenRead(abs);
            var buf = new byte[(int)Math.Min(limit, fs.Length)];
            return Decode(buf.AsSpan(0, fs.ReadAtLeast(buf, buf.Length, throwOnEndOfStream: false)));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or NotSupportedException) { return ""; }
    }

    /* ── JSON as the old server wrote it ────────────────────────────── */

    /// <summary>
    /// An object keyed the way <c>Object.fromEntries</c> keys one — what the old server stored: keys that are array indices
    /// ("0", "17") first and ascending, every other key where it was first set; a repeated key keeps its place and takes the last value.
    /// </summary>
    private static JsonObject JsObject(IEnumerable<KeyValuePair<string, JsonNode?>> entries)
    {
        var ordered = new OrderedDictionary<string, JsonNode?>(StringComparer.Ordinal);
        foreach (var (k, v) in entries) ordered[k] = v;
        var o = new JsonObject();
        foreach (var (k, v) in ordered.Where(e => IsArrayIndex(e.Key)).OrderBy(e => ulong.Parse(e.Key, CultureInfo.InvariantCulture))) o[k] = v;
        foreach (var (k, v) in ordered.Where(e => !IsArrayIndex(e.Key))) o[k] = v;
        return o;
    }

    private static JsonObject JsObject(IEnumerable<KeyValuePair<string, long>> counts) =>
        JsObject(counts.Select(e => new KeyValuePair<string, JsonNode?>(e.Key, e.Value)));

    /// <summary>A canonical integer below 2³²−1 — the keys JavaScript lists before all others.</summary>
    private static bool IsArrayIndex(string k) =>
        k.Length is > 0 and <= 10 && k.All(char.IsAsciiDigit) && (k == "0" || k[0] != '0')
        && ulong.Parse(k, CultureInfo.InvariantCulture) < uint.MaxValue;

    private static JsonArray Arr(IEnumerable<JsonNode?> xs) => new(xs.ToArray());

    private static JsonArray Strs(IEnumerable<string> xs) => Arr(xs.Select(x => (JsonNode?)JsonValue.Create(x)));

    private static readonly JsonElement EmptyObject = ParseObject("{}")!.Value;

    /// <summary><c>JSON.parse</c> of an object, or null. As there, a BOM in front makes the text unreadable, and a repeated key's last value wins (<see cref="Prop"/>).</summary>
    private static JsonElement? ParseObject(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 1024 });
            return doc.RootElement.ValueKind == JsonValueKind.Object ? doc.RootElement.Clone() : null;
        }
        catch (JsonException) { return null; }
    }

    /// <summary><c>o[key]</c> of a parsed object: the last value written under the key, or null when there is none.</summary>
    private static JsonElement? Prop(JsonElement o, string key)
    {
        JsonElement? found = null;
        foreach (var p in o.EnumerateObject()) if (p.NameEquals(key)) found = p.Value;
        return found;
    }

    private static JsonElement ObjectAt(JsonElement o, string key) => Prop(o, key) is { ValueKind: JsonValueKind.Object } v ? v : EmptyObject;

    private static bool HasKeys(JsonElement o) => o.EnumerateObject().Any();

    /// <summary><c>{**dependencies, **devDependencies}</c> — only membership is ever asked.</summary>
    private static HashSet<string> DepNames(JsonElement pkg) =>
        new(ObjectAt(pkg, "dependencies").EnumerateObject().Concat(ObjectAt(pkg, "devDependencies").EnumerateObject()).Select(p => p.Name), StringComparer.Ordinal);

    /// <summary>JavaScript's truthiness of a parsed value: null, false, 0 and "" are false; every object and array is true.</summary>
    private static bool Truthy(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.False or JsonValueKind.Undefined => false,
        JsonValueKind.Number => DoubleOf(v) is not 0 and not double.NaN,
        JsonValueKind.String => StringOf(v).Length > 0,
        _ => true,
    };

    /// <summary>A JSON string's text; a lone surrogate escape (which JSON.parse took) falls back to the raw text.</summary>
    private static string StringOf(JsonElement v)
    {
        try { return v.GetString() ?? ""; }
        catch (InvalidOperationException) { return v.GetRawText().Trim('"'); }
    }

    /// <summary>JavaScript's <c>String(value)</c> of a parsed value — a script is a string, but nothing makes it one.</summary>
    private static string JsString(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => StringOf(v),
        JsonValueKind.Number => JsNumber(DoubleOf(v)),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "null",
        JsonValueKind.Array => string.Join(",", v.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.Null ? "" : JsString(x))),
        _ => "[object Object]",
    };

    /// <summary>A JSON number as JSON.parse read it: one too large for a double is an infinity, not an error.</summary>
    private static double DoubleOf(JsonElement v) =>
        v.TryGetDouble(out var d) ? d : v.GetRawText().StartsWith('-') ? double.NegativeInfinity : double.PositiveInfinity;

    private static string JsNumber(double d)
    {
        if (double.IsPositiveInfinity(d)) return "Infinity";
        if (double.IsNegativeInfinity(d)) return "-Infinity";
        if (d == Math.Floor(d) && Math.Abs(d) < 1e21) return d == 0 ? "0" : d.ToString("F0", CultureInfo.InvariantCulture);
        return Exponent().Replace(d.ToString("R", CultureInfo.InvariantCulture), "e$1$2");
    }

    [GeneratedRegex("E([+-])0*([0-9])")] private static partial Regex Exponent();

    /// <summary>A parsed value as a node, keyed as JavaScript would have re-serialised it.</summary>
    private static JsonNode? ToNode(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => JsonValue.Create(StringOf(v)),
        // JSON.stringify writes an infinite number (1e400 parses to one) as null.
        JsonValueKind.Number => DoubleOf(v) is var d && double.IsFinite(d) ? JsonValue.Create(d) : null,
        JsonValueKind.True => JsonValue.Create(true),
        JsonValueKind.False => JsonValue.Create(false),
        JsonValueKind.Array => Arr(v.EnumerateArray().Select(ToNode)),
        JsonValueKind.Object => JsObject(v.EnumerateObject().Select(p => new KeyValuePair<string, JsonNode?>(p.Name, ToNode(p.Value)))),
        _ => null,
    };

    /* ── the walk ───────────────────────────────────────────────────── */

    private sealed record Tree(string Root, List<string> Files, HashSet<string> RelSet, Dictionary<string, long> Bytes);

    /// <summary>One directory entry. A reparse point (a symbolic link, a junction) is neither a file nor a directory — Node's <c>readdir</c> called it a link.</summary>
    private readonly record struct Entry(string Name, bool IsDir, bool IsFile, long Length);

    private static readonly EnumerationOptions OneLevel = new()
    {
        RecurseSubdirectories = false, IgnoreInaccessible = true, ReturnSpecialDirectories = false,
        // Hidden and system entries are walked: .env, .github and .claude are what the diagnosis looks for.
        AttributesToSkip = 0,
    };

    /// <summary>The entries of a directory, or null when it cannot be read.</summary>
    private static List<Entry>? ReadDir(string abs)
    {
        try
        {
            return
            [
                .. new FileSystemEnumerable<Entry>(abs, (ref FileSystemEntry e) =>
                {
                    var link = (e.Attributes & FileAttributes.ReparsePoint) != 0;
                    return new Entry(e.FileName.ToString(), !link && e.IsDirectory, !link && !e.IsDirectory, link || e.IsDirectory ? 0 : e.Length);
                }, OneLevel),
            ];
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException) { return null; }
    }

    [GeneratedRegex(@"\.[0-9]+(\.[0-9]+)+(-[0-9A-Za-z.-]+)?$", Js)] private static partial Regex VersionedFolder();

    /// <summary>A <c>packages/</c> directory that holds NuGet package caches: <c>*.nupkg</c> files, or <c>&lt;Id&gt;.&lt;version&gt;/</c> folders with a <c>lib/</c> or a <c>.nupkg</c> inside. An npm monorepo's <c>packages/</c> holds real code and is walked.</summary>
    private static bool IsNuGetPackageCache(string dir)
    {
        var entries = ReadDir(dir);
        if (entries is null) return false;
        static bool IsNupkg(string name) => name.ToLowerInvariant().EndsWith(".nupkg", StringComparison.Ordinal);
        foreach (var e in entries)
        {
            if (e.IsFile && IsNupkg(e.Name)) return true;
            if (!e.IsDir || !VersionedFolder().IsMatch(e.Name)) continue;
            var inner = ReadDir(Path.Combine(dir, e.Name));
            if (inner is null) continue;
            if (inner.Any(i => i.IsFile && IsNupkg(i.Name))) return true;
            if (inner.Any(i => i.IsDir && i.Name == "lib") && !inner.Any(i => i.Name == "package.json")) return true;
        }
        return false;
    }

    /// <summary>Every regular file under <paramref name="root"/>, as sorted relative paths with forward slashes, the way the script's <c>os.walk</c> + <c>files.sort()</c> listed them.</summary>
    private static Tree WalkTree(string root)
    {
        var files = new List<string>();
        var bytes = new Dictionary<string, long>(StringComparer.Ordinal);
        void Visit(string rel)
        {
            var abs = rel.Length > 0 ? Path.Combine(root, rel) : root;
            var entries = ReadDir(abs);
            if (entries is null) return;
            foreach (var e in entries)
            {
                var childRel = rel.Length > 0 ? $"{rel}/{e.Name}" : e.Name;
                if (e.IsDir)
                {
                    if (SkipDirs.Contains(e.Name)) continue;
                    if (e.Name == "packages" && IsNuGetPackageCache(Path.Combine(abs, e.Name))) continue;
                    Visit(childRel);
                }
                else if (e.IsFile)
                {
                    files.Add(childRel);
                    bytes[childRel] = e.Length;
                }
            }
        }
        Visit("");
        // JavaScript's sort() compares UTF-16 units — the ordinal order.
        var sorted = files.Order(StringComparer.Ordinal).ToList();
        return new Tree(root, sorted, new HashSet<string>(sorted, StringComparer.Ordinal), bytes);
    }

    private static List<string> Exists(Tree t, params string[] names) => names.Where(t.RelSet.Contains).ToList();

    private static List<string> AnyGlob(Tree t, Regex rx) => t.Files.Where(f => rx.IsMatch(f)).ToList();

    private static List<string> Ending(Tree t, params string[] suffixes) => t.Files.Where(f => suffixes.Any(s => f.EndsWith(s, StringComparison.Ordinal))).ToList();

    private static string Read(Tree t, string rel, int limit = ReadLimit) => ReadText(Path.Combine(t.Root, rel), limit);

    /* ── one read per file: lines, generated headers, secrets ───────── */

    /// <summary>
    /// The script read a code file three times — to count its lines, to look at its header, to scan it for secrets. One
    /// read serves all three: the head of the file is kept for the text checks, the rest is only counted.
    /// </summary>
    private sealed class ContentScan
    {
        public readonly Counter LangFiles = new();
        public readonly Counter LangLines = new();
        public long TotalLines;
        public readonly List<string> HeaderHits = [];
        public readonly Counter SecretsByKind = new();
        public readonly Counter SecretFiles = new();
        public long SecretsInTests;
    }

    /// <summary>Reads the head of a file into <paramref name="head"/> and, when asked, counts its lines to the end — a last line without a newline still counts, as iterating a Python file does.</summary>
    private static (int HeadLength, long Lines) ScanFile(string abs, int keep, bool wantLines, byte[] head, byte[] chunk)
    {
        try
        {
            using var fs = OpenRead(abs);
            var size = (int)Math.Min(keep, fs.Length);
            var n = fs.ReadAtLeast(head.AsSpan(0, size), size, throwOnEndOfStream: false);
            long lines = 0;
            if (wantLines)
            {
                lines = head.AsSpan(0, n).Count((byte)'\n');
                var last = n > 0 ? head[n - 1] : -1;
                if (n == size)
                {
                    for (var got = fs.Read(chunk); got > 0; got = fs.Read(chunk))
                    {
                        lines += chunk.AsSpan(0, got).Count((byte)'\n');
                        last = chunk[got - 1];
                    }
                }
                if (last != -1 && last != '\n') lines++;
            }
            return (n, lines);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or NotSupportedException) { return (0, 0); }
    }

    [GeneratedRegex("(auto-?generated|automatically generated|do not edit|generated by|<auto-generated|code generated " + Dot + "* do not edit|This file was generated|DO NOT MODIFY)", JsI)]
    private static partial Regex GeneratedHeader();

    private static readonly (string Kind, Regex Rx)[] SecretPatterns =
    [
        ("aws_access_key", new Regex(@"\bAKIA[0-9A-Z]{16}\b", Js | RegexOptions.Compiled)),
        ("private_key_block", new Regex("-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----", Js | RegexOptions.Compiled)),
        ("connection_string_with_password", new Regex("(Password|Pwd)=[^;" + S + "\"']{3,};", JsI | RegexOptions.Compiled)),
        ("connection_string_uri_with_creds", new Regex(@"\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp|mssql|sqlserver)://[^/" + S + ":]+:[^@" + S + "]{3,}@", JsI | RegexOptions.Compiled)),
        ("password_assignment", new Regex(@"\b(password|passwd|secret|client_secret|api[_-]?key|token)\b[" + S + "]*[:=][" + S + "]*[\"'][^\"'" + S + "${<]{8,}[\"']", JsI | RegexOptions.Compiled)),
        ("github_token", new Regex(@"\bgh[pousr]_[A-Za-z0-9]{30,}\b", Js | RegexOptions.Compiled)),
        ("slack_token", new Regex(@"\bxox[baprs]-[A-Za-z0-9-]{10,}\b", Js | RegexOptions.Compiled)),
        ("stripe_key", new Regex(@"\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b", Js | RegexOptions.Compiled)),
        ("openai_key", new Regex(@"\bsk-[A-Za-z0-9]{32,}\b", Js | RegexOptions.Compiled)),
        ("azure_sas_or_storage_key", new Regex("(AccountKey=[A-Za-z0-9+/=]{40,}|sig=[A-Za-z0-9%]{30,})", JsI | RegexOptions.Compiled)),
        ("jwt", new Regex(@"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b", Js | RegexOptions.Compiled)),
    ];

    /// <summary>A password-looking hit on a line that says it is a placeholder is not a secret. Only these three kinds are that ambiguous.</summary>
    private static readonly HashSet<string> PlaceholderKinds = new(StringComparer.Ordinal) { "password_assignment", "connection_string_with_password", "connection_string_uri_with_creds" };

    [GeneratedRegex(@"(changethis|example|placeholder|your[_-]?|xxx|dummy|<" + Dot + @"*>|\$\{|%s|password123|secret123|\*\*\*|redacted|fake|sample|test)", JsI)]
    private static partial Regex Placeholder();

    [GeneratedRegex(@"(^|/)(tests?|__tests__|spec|fixtures?|testdata|snapshots)(/|$)|[._-](test|spec|tests)\.[a-z]+$|_test\.(go|rs|py)$|Tests?\.(cs|java|kt|php)$|test_[^/]+\.py$", JsI)]
    private static partial Regex TestPathForSecrets();

    private static void ScanSecrets(string f, string text, ContentScan s)
    {
        var isTest = TestPathForSecrets().IsMatch(f);
        foreach (var (kind, rx) in SecretPatterns)
        {
            foreach (Match m in rx.Matches(text))
            {
                if (PlaceholderKinds.Contains(kind))
                {
                    // The line around the hit: from the newline before it (kept, as the script's slice kept it) to the one after.
                    var start = m.Index == 0 ? 0 : Math.Max(0, text.LastIndexOf('\n', m.Index - 1));
                    var nl = text.IndexOf('\n', m.Index + m.Length);
                    if (Placeholder().IsMatch(text.AsSpan(start, (nl == -1 ? text.Length : nl) - start))) continue;
                }
                s.SecretsByKind.Inc(kind);
                s.SecretFiles.Inc(f);
                if (isTest) s.SecretsInTests++;
            }
        }
    }

    private static ContentScan ScanContents(Tree t, CancellationToken ct)
    {
        var s = new ContentScan();
        var head = new byte[SecretsLimit];
        var chunk = new byte[1 << 20];
        foreach (var f in t.Files)
        {
            ct.ThrowIfCancellationRequested();
            var ext = ExtOf(f).ToLowerInvariant();
            if (BinaryExt.Contains(ext)) continue;
            var lang = LangExt.GetValueOrDefault(ext);
            if (lang is not null) s.LangFiles.Inc(lang);
            var isCode = lang is not null && CodeLangs.Contains(lang);
            var forSecrets = !(f.EndsWith(".md", StringComparison.Ordinal) || f.EndsWith(".lock", StringComparison.Ordinal) || f.EndsWith(".sum", StringComparison.Ordinal));
            if (!isCode && !forSecrets) continue;
            var (n, lines) = ScanFile(Path.Combine(t.Root, f), forSecrets ? SecretsLimit : HeaderLimit, isCode, head, chunk);
            if (isCode)
            {
                s.LangLines.Inc(lang!, lines);
                s.TotalLines += lines;
            }
            if (n == 0) continue;
            var text = Decode(head.AsSpan(0, n));
            if (isCode && GeneratedHeader().IsMatch(Head(text, HeaderLimit))) s.HeaderHits.Add(f);
            if (forSecrets && text.Length > 0) ScanSecrets(f, text, s);
        }
        return s;
    }

    /* ── languages ──────────────────────────────────────────────────── */

    private static JsonArray Languages(ContentScan s) =>
        Arr(s.LangFiles.MostCommon(8).Select(e => (JsonNode?)new JsonObject { ["language"] = e.Key, ["files"] = e.Value, ["lines"] = s.LangLines.Get(e.Key) }));

    /* ── manifests: frameworks, package managers, build, tests, lint ── */

    private sealed class Stack
    {
        public readonly HashSet<string> Frameworks = new(StringComparer.Ordinal);
        public readonly HashSet<string> PackageManagers = new(StringComparer.Ordinal);
        public readonly List<string> BuildSystem = [];
        public readonly List<string> BuildCommands = [];
        public JsonObject? DotnetTargetFrameworks;
        public List<string> TestFrameworks = [];
        public int TestFiles;
        public List<KeyValuePair<string, long>> TestDirs = [];
        public readonly List<string> Lint = [];

        /// <summary>The root package.json: null when there is none, <c>{}</c> when it does not parse — the script told the two apart.</summary>
        public JsonElement? RootPkg;

        public List<string> Slns = [];
        public List<string> Csprojs = [];

        public void AddBuild(string system, string? cmd = null)
        {
            if (!BuildSystem.Contains(system)) BuildSystem.Add(system);
            if (!string.IsNullOrEmpty(cmd) && !BuildCommands.Contains(cmd)) BuildCommands.Add(cmd);
        }

        public JsonObject BuildJson()
        {
            var o = new JsonObject { ["system"] = Strs(BuildSystem), ["commands"] = Strs(BuildCommands) };
            if (DotnetTargetFrameworks is not null) o["dotnet_target_frameworks"] = DotnetTargetFrameworks;
            return o;
        }

        public JsonObject TestsJson() => new()
        {
            ["frameworks"] = Strs(TestFrameworks),
            ["test_files"] = TestFiles,
            ["test_dirs"] = Arr(TestDirs.Select(d => (JsonNode?)new JsonArray(d.Key, d.Value))),
        };
    }

    private static readonly string[] NodeFrameworks = ["react", "next", "vue", "@angular/core", "svelte", "express", "fastify", "electron", "vite", "esbuild", "webpack", "turbo", "nx", "vitest", "jest", "mocha", "playwright", "@playwright/test", "cypress", "eslint", "prettier", "biome", "@biomejs/biome", "typescript", "react-native", "expo", "tailwindcss", "storybook"];
    private static readonly string[] SubPackageFrameworks = ["react", "next", "vue", "@angular/core", "svelte", "express", "fastify", "electron", "vite", "vitest", "jest", "mocha", "@playwright/test", "cypress", "react-native", "expo", "tailwindcss", "@tauri-apps/api", "ink"];
    private static readonly string[] PyFrameworks = ["fastapi", "django", "flask", "sqlmodel", "sqlalchemy", "pydantic", "celery", "starlette", "torch", "tensorflow", "scikit-learn", "sklearn", "pandas", "numpy", "jupyter", "notebook", "streamlit"];
    private static readonly string[] DotnetPackages = ["Microsoft.AspNetCore", "Aspire", "xunit", "NUnit", "MSTest", "Microsoft.PowerPlatform.Dataverse.Client", "Microsoft.CrmSdk", "Microsoft.Xrm", "EntityFramework", "Microsoft.EntityFrameworkCore", "Dapper", "Moq", "FakeXrmEasy"];

    [GeneratedRegex("<package id=\"([^\"]+)\"", Js)] private static partial Regex PackageId();
    [GeneratedRegex("<TargetFrameworks?>([^<]+)<", Js)] private static partial Regex TargetFrameworks();
    [GeneratedRegex("PackageReference Include=\"([^\"]+)\"", Js)] private static partial Regex PackageReference();
    [GeneratedRegex("<TargetFrameworkVersion>([^<]+)<", Js)] private static partial Regex TargetFrameworkVersion();
    [GeneratedRegex(@"jquery[^/]*\.js$", Js)] private static partial Regex VendoredJquery();
    [GeneratedRegex(@"^examples/[^/]+/main\.tf$", Js)] private static partial Regex TerraformExample();

    private static Stack DetectStack(Tree t)
    {
        var st = new Stack();
        var frameworks = st.Frameworks;
        var packageManagers = st.PackageManagers;
        var tests = st.TestFrameworks;
        var lint = st.Lint;

        // Node
        st.RootPkg = t.RelSet.Contains("package.json") ? (ParseObject(Read(t, "package.json")) ?? EmptyObject) : null;
        if (st.RootPkg is { } rootPkg)
        {
            var deps = DepNames(rootPkg);
            var scripts = ObjectAt(rootPkg, "scripts");
            foreach (var k in NodeFrameworks) if (deps.Contains(k)) frameworks.Add(k);
            if (t.RelSet.Contains("pnpm-lock.yaml")) packageManagers.Add("pnpm");
            if (t.RelSet.Contains("yarn.lock")) packageManagers.Add("yarn");
            if (t.RelSet.Contains("package-lock.json")) packageManagers.Add("npm");
            if (t.RelSet.Contains("bun.lockb") || t.RelSet.Contains("bun.lock")) packageManagers.Add("bun");
            var pm = packageManagers.Contains("pnpm") ? "pnpm" : packageManagers.Contains("yarn") ? "yarn" : packageManagers.Contains("bun") ? "bun" : "npm";
            st.AddBuild("package.json scripts");
            foreach (var s in new[] { "build", "compile", "package" })
            {
                if (Prop(scripts, s) is not { } script) continue;
                st.AddBuild("package.json scripts", $"{pm} run {s}   # -> {Head(JsString(script), 80)}");
                break;
            }
            foreach (var s in new[] { "test", "test:unit", "test:ci" })
            {
                if (Prop(scripts, s) is not { } script) continue;
                tests.Add($"package.json:{s} -> {Head(JsString(script), 80)}");
                break;
            }
            foreach (var k in new[] { "vitest", "jest", "mocha", "@playwright/test", "playwright", "cypress" }) if (deps.Contains(k) && !tests.Contains(k)) tests.Add(k);
            foreach (var k in new[] { "eslint", "prettier", "biome", "@biomejs/biome" }) if (deps.Contains(k)) lint.Add(k);
        }
        var subPkgDeps = new HashSet<string>(StringComparer.Ordinal);
        foreach (var pj in t.Files.Where(f => f.EndsWith("package.json", StringComparison.Ordinal) && Slashes(f) is >= 1 and <= 3))
        {
            if (ParseObject(Read(t, pj)) is { } d) subPkgDeps.UnionWith(DepNames(d));
        }
        foreach (var k in SubPackageFrameworks) if (subPkgDeps.Contains(k)) frameworks.Add($"{k} (sub-package)");
        if (Exists(t, "turbo.json").Count > 0) { frameworks.Add("turborepo"); st.AddBuild("turborepo"); }
        if (Exists(t, "nx.json").Count > 0) frameworks.Add("nx");
        if (Exists(t, "lerna.json").Count > 0) frameworks.Add("lerna");

        // Python
        var pyManifests = Exists(t, "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "environment.yml");
        var subPy = t.Files.Where(f => f.EndsWith("pyproject.toml", StringComparison.Ordinal) && Slashes(f) == 1).ToList();
        foreach (var m in pyManifests.Concat(subPy))
        {
            var txt = Read(t, m).ToLowerInvariant();
            foreach (var k in PyFrameworks) if (txt.Contains(k, StringComparison.Ordinal)) frameworks.Add(k);
            if (txt.Contains("pytest", StringComparison.Ordinal) && !tests.Contains("pytest")) tests.Add("pytest");
            if (txt.Contains("unittest", StringComparison.Ordinal) && !tests.Contains("unittest")) tests.Add("unittest");
            foreach (var k in new[] { "ruff", "black", "flake8", "mypy", "isort", "pylint" }) if (txt.Contains(k, StringComparison.Ordinal) && !lint.Contains(k)) lint.Add(k);
            if (txt.Contains("[tool.uv]", StringComparison.Ordinal) || t.RelSet.Contains("uv.lock")) packageManagers.Add("uv");
            if (txt.Contains("[tool.poetry]", StringComparison.Ordinal) || t.RelSet.Contains("poetry.lock")) packageManagers.Add("poetry");
            if (m.EndsWith("requirements.txt", StringComparison.Ordinal) || m.EndsWith("setup.py", StringComparison.Ordinal)) packageManagers.Add("pip");
            if (m.EndsWith("environment.yml", StringComparison.Ordinal)) packageManagers.Add("conda");
            if (txt.Contains("hatchling", StringComparison.Ordinal)) st.AddBuild("hatch");
            if (txt.Contains("setuptools", StringComparison.Ordinal)) st.AddBuild("setuptools");
        }
        if (pyManifests.Count > 0 || subPy.Count > 0) st.AddBuild("python packaging");
        if (t.RelSet.Contains("uv.lock")) packageManagers.Add("uv");

        // Go
        if (Exists(t, "go.mod").Count > 0)
        {
            packageManagers.Add("go modules");
            st.AddBuild("go", "go build ./...");
            tests.Add("go test");
            var gm = Read(t, "go.mod");
            foreach (var k in new[] { "github.com/spf13/cobra", "github.com/gin-gonic/gin", "net/http", "github.com/labstack/echo", "google.golang.org/grpc" }) if (gm.Contains(k, StringComparison.Ordinal)) frameworks.Add(BaseOf(k));
            if (Exists(t, "Makefile").Count > 0) st.AddBuild("make");
            if (Exists(t, ".golangci.yml", ".golangci.yaml", ".golangci.toml").Count > 0) lint.Add("golangci-lint");
        }

        // Java / Kotlin
        if (Exists(t, "pom.xml").Count > 0)
        {
            packageManagers.Add("maven");
            st.AddBuild("maven", Exists(t, "mvnw").Count > 0 ? "./mvnw package" : "mvn package");
            var pom = Read(t, "pom.xml");
            if (pom.Contains("spring-boot", StringComparison.Ordinal)) frameworks.Add("spring-boot");
            if (pom.Contains("junit", StringComparison.Ordinal)) tests.Add("junit");
            foreach (var k in new[] { "checkstyle", "spotless", "spring-javaformat" }) if (pom.Contains(k, StringComparison.Ordinal)) lint.Add(k);
        }
        if (Exists(t, "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts").Count > 0)
        {
            packageManagers.Add("gradle");
            st.AddBuild("gradle", Exists(t, "gradlew").Count > 0 ? "./gradlew build" : "gradle build");
            var g = string.Join(" ", Exists(t, "build.gradle", "build.gradle.kts", "settings.gradle.kts", "gradle/libs.versions.toml").Select(x => Read(t, x)));
            var gl = g.ToLowerInvariant();
            if (g.Contains("com.android", StringComparison.Ordinal) || gl.Contains("android", StringComparison.Ordinal)) frameworks.Add("android");
            if (gl.Contains("androidx.compose", StringComparison.Ordinal)) frameworks.Add("jetpack-compose");
            if (gl.Contains("hilt", StringComparison.Ordinal)) frameworks.Add("hilt");
            if (gl.Contains("junit", StringComparison.Ordinal)) tests.Add("junit");
            if (gl.Contains("spotless", StringComparison.Ordinal)) lint.Add("spotless");
            if (gl.Contains("detekt", StringComparison.Ordinal)) lint.Add("detekt");
            if (gl.Contains("ktlint", StringComparison.Ordinal)) lint.Add("ktlint");
            if (gl.Contains("roborazzi", StringComparison.Ordinal)) tests.Add("roborazzi-screenshot");
        }

        // .NET
        st.Slns = Ending(t, ".sln", ".slnx", ".slnf");
        st.Csprojs = Ending(t, ".csproj", ".vbproj", ".fsproj");
        if (st.Slns.Count > 0 || st.Csprojs.Count > 0)
        {
            packageManagers.Add("nuget");
            frameworks.Add(".NET");
            var tfms = new Counter();
            var pkgs = new HashSet<string>(StringComparer.Ordinal);
            foreach (var c in st.Csprojs.Take(400).Concat(Ending(t, "packages.config").Take(400)))
            {
                var x = Read(t, c);
                foreach (Match m in PackageId().Matches(x)) pkgs.Add(m.Groups[1].Value);
                foreach (Match m in TargetFrameworks().Matches(x)) tfms.Inc(JsTrim(m.Groups[1].Value));
                foreach (Match m in PackageReference().Matches(x)) pkgs.Add(m.Groups[1].Value);
                if (x.Contains("ToolsVersion", StringComparison.Ordinal) && x.Contains("<TargetFrameworkVersion>", StringComparison.Ordinal))
                {
                    foreach (Match m in TargetFrameworkVersion().Matches(x)) tfms.Inc($"netframework {m.Groups[1].Value}");
                }
            }
            st.DotnetTargetFrameworks = JsObject(tfms.MostCommon(10));
            var legacy = tfms.Keys.Any(k => k.StartsWith("netframework", StringComparison.Ordinal) || k.StartsWith("v4", StringComparison.Ordinal));
            if (legacy)
            {
                frameworks.Add(".NET Framework (legacy, msbuild)");
                st.AddBuild("msbuild", $"{string.Join(" ", new[] { "msbuild", st.Slns.FirstOrDefault(), "/t:Build" }.Where(p => !string.IsNullOrEmpty(p)))}   # requires Windows / Visual Studio build tools");
            }
            else
            {
                st.AddBuild("dotnet", JsTrim($"dotnet build {st.Slns.FirstOrDefault() ?? ""}"));
            }
            foreach (var k in DotnetPackages) if (pkgs.Any(p => p.ToLowerInvariant().Contains(k.ToLowerInvariant(), StringComparison.Ordinal))) frameworks.Add(k);
            foreach (var k in new[] { "xunit", "NUnit", "MSTest" }) if (frameworks.Contains(k)) tests.Add(k);
            if (Exists(t, ".editorconfig").Count > 0) lint.Add("editorconfig");
            if (Exists(t, "Directory.Build.props").Count > 0) st.AddBuild("Directory.Build.props");
        }

        // PHP
        if (Exists(t, "composer.json").Count > 0)
        {
            packageManagers.Add("composer");
            st.AddBuild("composer", "composer install");
            var cj = Read(t, "composer.json");
            if (cj.Contains("phpunit", StringComparison.Ordinal)) tests.Add("phpunit");
            foreach (var k in new[] { "phpstan", "psalm", "squizlabs/php_codesniffer", "php-cs-fixer" }) if (cj.Contains(k, StringComparison.Ordinal)) lint.Add(k);
            foreach (var k in new[] { "twig/twig", "symfony", "laravel", "slim" }) if (cj.Contains(k, StringComparison.Ordinal)) frameworks.Add(k);
        }
        if (AnyGlob(t, VendoredJquery()).Count > 0) frameworks.Add("jQuery (vendored)");
        if (st.RootPkg is { } rp && HasKeys(rp) && DepNames(rp).Contains("jquery")) frameworks.Add("jquery");

        // Rust
        if (Exists(t, "Cargo.toml").Count > 0)
        {
            packageManagers.Add("cargo");
            st.AddBuild("cargo", "cargo build");
            tests.Add("cargo test");
            if (Exists(t, "codex-rs/Cargo.toml").Count > 0) st.AddBuild("cargo", "cargo build (in codex-rs/)");
        }
        var subCargo = t.Files.Where(f => f.EndsWith("Cargo.toml", StringComparison.Ordinal) && Slashes(f) == 1).ToList();
        if (subCargo.Count > 0 && !packageManagers.Contains("cargo"))
        {
            packageManagers.Add("cargo");
            st.AddBuild("cargo", $"cargo build   # in {DirOf(subCargo[0])}/");
            tests.Add("cargo test");
            if (Exists(t, "rust-toolchain.toml").Count > 0 || t.Files.Any(f => f.Contains("rust-toolchain", StringComparison.Ordinal))) lint.Add("rustfmt/clippy (toolchain pinned)");
        }

        // Terraform / Helm
        if (Ending(t, ".tf").Count > 0)
        {
            frameworks.Add("terraform");
            st.AddBuild("terraform", "terraform init && terraform validate   # no compile; plan needs cloud creds");
            if (Exists(t, ".pre-commit-config.yaml").Count > 0) lint.Add("pre-commit");
            var pc = Read(t, ".pre-commit-config.yaml");
            foreach (var k in new[] { "terraform_fmt", "terraform_validate", "terraform_docs", "tflint", "terraform_tfsec", "trivy", "checkov" }) if (pc.Contains(k, StringComparison.Ordinal)) lint.Add(k);
            if (Ending(t, ".tftest.hcl").Count > 0) tests.Add("terraform test");
            var ex = AnyGlob(t, TerraformExample());
            if (ex.Count > 0) tests.Add($"examples/ as integration checks ({ex.Count})");
        }
        if (t.Files.Any(f => f == "Chart.yaml" || f.EndsWith("/Chart.yaml", StringComparison.Ordinal))) frameworks.Add("helm");

        // Flutter / React Native / mobile
        if (Exists(t, "pubspec.yaml").Count > 0) { frameworks.Add("flutter/dart"); packageManagers.Add("pub"); }
        if (t.Files.Any(f => f.StartsWith("android/", StringComparison.Ordinal) || f.StartsWith("ios/", StringComparison.Ordinal)) && st.RootPkg is not null) frameworks.Add("react-native-shell");
        if (Ending(t, "AndroidManifest.xml").Count > 0) frameworks.Add("android-manifest");
        if (t.Files.Any(f => f.Contains(".xcodeproj/", StringComparison.Ordinal))) frameworks.Add("xcode");

        // Dynamics / PCF
        if (Ending(t, "ControlManifest.Input.xml").Count > 0) frameworks.Add("PowerApps PCF control");

        // Jupyter
        var nbs = Ending(t, ".ipynb");
        if (nbs.Count > 0) frameworks.Add($"jupyter notebooks ({nbs.Count})");

        return st;
    }

    /* ── tests count ────────────────────────────────────────────────── */

    [GeneratedRegex(@"(^|/)(tests?|__tests__|spec|specs|e2e|src/test|Test|Tests)(/|$)|[._-](test|spec|tests)\.[a-z]+$|_test\.go$|Tests?\.(cs|java|kt|php)$|test_[^/]+\.py$", Js)]
    private static partial Regex TestPath();

    private static void CountTests(Tree t, Stack st)
    {
        static bool IsCodeFile(string f) => LangExt.TryGetValue(ExtOf(f).ToLowerInvariant(), out var lang) && CodeLangs.Contains(lang);
        var testFiles = t.Files.Where(f => TestPath().IsMatch(f) && IsCodeFile(f)).ToList();
        st.TestFiles = testFiles.Count;
        var dirs = new Counter();
        foreach (var f in testFiles) dirs.Inc(f.Contains('/') ? f.Split('/')[0] : ".");
        st.TestDirs = dirs.MostCommon(6).OrderBy(d => d.Key, StringComparer.Ordinal).ToList();
        st.TestFrameworks = Unique(st.TestFrameworks);
    }

    /* ── lint / format config files ─────────────────────────────────── */

    private static readonly string[] LintConfigs =
    [
        ".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs", "eslint.config.ts",
        ".prettierrc", ".prettierrc.json", "prettier.config.js", "biome.json", "biome.jsonc", ".editorconfig", "ruff.toml", ".flake8",
        "mypy.ini", ".pre-commit-config.yaml", "phpstan.neon", "phpstan.neon.dist", "psalm.xml", "phpcs.xml", "phpcs.xml.dist",
        ".php-cs-fixer.dist.php", ".golangci.yml", "rustfmt.toml", ".rustfmt.toml", "clippy.toml", "detekt.yml", "checkstyle.xml",
        ".stylelintrc", ".stylelintrc.json", "stylelint.config.js",
    ];

    private static List<string> LintFormat(Tree t, List<string> lint) => Unique(lint.Concat(LintConfigs.Where(t.RelSet.Contains)));

    /* ── CI ─────────────────────────────────────────────────────────── */

    [GeneratedRegex(@"\b(test|build|lint|check|vet|verify|mvnw|gradlew|dotnet|pytest|npm|pnpm|yarn|cargo|go |make|composer|phpunit|terraform|pre-commit|ruff|mypy|tsc|vitest|jest|playwright)\b", Js)]
    private static partial Regex CiCommand();

    [GeneratedRegex(LineStart + "name:[" + S + "]*(" + Dot + "+)" + LineEnd, Js)] private static partial Regex WorkflowName();

    [GeneratedRegex(LineStart + "[" + S + "]*(?:-[" + S + "]*)?run:[" + S + @"]*\|?[" + S + "]*(" + Dot + "+)" + LineEnd, Js)]
    private static partial Regex WorkflowRun();

    [GeneratedRegex(@"azure-pipelines.*\.ya?ml$|(^|/)\.azure(-pipelines|devops)/", Js)] private static partial Regex AzurePipelinesFile();

    private static readonly (string File, string System)[] CiFiles =
    [
        (".gitlab-ci.yml", "gitlab-ci"), ("azure-pipelines.yml", "azure-pipelines"), ("Jenkinsfile", "jenkins"),
        (".circleci/config.yml", "circleci"), (".travis.yml", "travis"), ("bitbucket-pipelines.yml", "bitbucket"),
    ];

    private static JsonObject DetectCi(Tree t)
    {
        var present = false;
        var systems = new List<string>();
        var workflows = new List<JsonNode?>();
        var commands = new List<string>();
        int? workflowCount = null;
        var wf = t.Files.Where(f => f.StartsWith(".github/workflows/", StringComparison.Ordinal) && (f.EndsWith(".yml", StringComparison.Ordinal) || f.EndsWith(".yaml", StringComparison.Ordinal))).ToList();
        if (wf.Count > 0)
        {
            present = true;
            systems.Add("github-actions");
            var cmds = new Counter();
            foreach (var w in wf)
            {
                var x = Read(t, w);
                var name = WorkflowName().Match(x);
                workflows.Add(new JsonObject { ["file"] = w, ["name"] = name.Success ? JsTrim(name.Groups[1].Value).TrimStart('"', '\'').TrimEnd('"', '\'') : BaseOf(w) });
                foreach (Match m in WorkflowRun().Matches(x))
                {
                    var cmd = JsTrim(m.Groups[1].Value);
                    if (CiCommand().IsMatch(cmd)) cmds.Inc(Head(cmd, 100));
                }
            }
            commands = cmds.MostCommon(15).Select(c => c.Key).ToList();
            workflowCount = wf.Count;
        }
        foreach (var (file, system) in CiFiles)
        {
            if (!t.RelSet.Contains(file)) continue;
            present = true;
            systems.Add(system);
        }
        var azp = AnyGlob(t, AzurePipelinesFile());
        if (azp.Count > 0 && !systems.Contains("azure-pipelines"))
        {
            present = true;
            systems.Add("azure-pipelines");
            workflows.AddRange(azp.Take(5).Select(file => (JsonNode?)new JsonObject { ["file"] = file }));
        }
        var ci = new JsonObject { ["present"] = present, ["systems"] = Strs(systems), ["workflows"] = Arr(workflows), ["commands"] = Strs(commands) };
        if (workflowCount is { } n) ci["workflow_count"] = n;
        return ci;
    }

    /* ── monorepo ───────────────────────────────────────────────────── */

    private static readonly string[] PackageManifests = ["package.json", "Cargo.toml", "pyproject.toml", "build.gradle.kts", ".csproj", "go.mod"];

    private static JsonObject DetectMonorepo(Tree t, Stack st)
    {
        var isMonorepo = false;
        var workspaces = new List<JsonNode?>();
        var ws = st.RootPkg is { } rootPkg && HasKeys(rootPkg) ? Prop(rootPkg, "workspaces") : null;
        if (ws is { } w && Truthy(w))
        {
            IEnumerable<JsonElement> list = w.ValueKind == JsonValueKind.Array ? w.EnumerateArray()
                : w.ValueKind == JsonValueKind.Object && Prop(w, "packages") is { ValueKind: JsonValueKind.Array } packages ? packages.EnumerateArray()
                : [w];
            isMonorepo = true;
            workspaces.AddRange(list.Select(ToNode));
        }
        if (t.RelSet.Contains("pnpm-workspace.yaml")) { isMonorepo = true; workspaces.Add("pnpm-workspace.yaml"); }
        if (Exists(t, "turbo.json", "nx.json", "lerna.json").Count > 0) isMonorepo = true;
        var cargoWs = t.Files.Where(f => f.EndsWith("Cargo.toml", StringComparison.Ordinal) && Read(t, f).Contains("[workspace]", StringComparison.Ordinal)).ToList();
        if (cargoWs.Count > 0) { isMonorepo = true; workspaces.Add($"cargo workspace: {cargoWs[0]}"); }
        if (st.Slns.Count > 1 || st.Csprojs.Count > 8)
        {
            isMonorepo = true;
            workspaces.Add($"{st.Csprojs.Count} .NET projects in {st.Slns.Count} solution(s)");
        }
        var gradleSubs = t.Files.Where(f => (f.EndsWith("build.gradle.kts", StringComparison.Ordinal) || f.EndsWith("build.gradle", StringComparison.Ordinal)) && Slashes(f) >= 1).ToList();
        if (gradleSubs.Count > 5) { isMonorepo = true; workspaces.Add($"{gradleSubs.Count} gradle modules"); }
        var packagesList = new List<string>();
        int? packageCount = null;
        if (isMonorepo)
        {
            var pkgs = new Counter();
            foreach (var f in t.Files)
            {
                if (PackageManifests.Any(m => f.EndsWith(m, StringComparison.Ordinal)) && Slashes(f) is >= 1 and <= 3) pkgs.Inc(DirOf(f));
            }
            packagesList = pkgs.Keys.Order(StringComparer.Ordinal).Take(60).ToList();
            packageCount = pkgs.Count;
        }
        var mono = new JsonObject { ["is_monorepo"] = isMonorepo, ["workspaces"] = Arr(workspaces), ["packages"] = Strs(packagesList) };
        if (packageCount is { } n) mono["package_count"] = n;
        return mono;
    }

    /* ── generated code ─────────────────────────────────────────────── */

    [GeneratedRegex(@"(__generated__|\.g\.cs$|\.pb\.go$|\.pb\.cc$|_pb2\.py$|\.generated\.|\.designer\.cs$|\.Designer\.cs$|/generated/|/gen/|\.min\.js$|\.min\.css$|_generated\.|\.d\.ts$|/dist/|\.snap$|Reference\.cs$|/migrations?/.*\.cs$|\.tf\.json$|\.xrm\.cs$|/Model/.*Entities\.cs$)", Js)]
    private static partial Regex GeneratedPath();

    private static JsonArray DirCounts(Counter c, int n) => Arr(c.MostCommon(n).Select(e => (JsonNode?)new JsonObject { ["dir"] = e.Key, ["files"] = e.Value }));

    private static JsonObject GeneratedCode(Tree t, ContentScan s)
    {
        var dirs = new Counter();
        foreach (var f in t.Files) if (GeneratedPath().IsMatch(f)) dirs.Inc(DirOf(f) is { Length: > 0 } d ? d : ".");
        var headerDirs = new Counter();
        foreach (var f in s.HeaderHits) headerDirs.Inc(DirOf(f) is { Length: > 0 } d ? d : ".");
        return new JsonObject
        {
            ["paths"] = DirCounts(dirs, 15),
            ["header_marked_files"] = s.HeaderHits.Count,
            ["header_sample"] = Strs(s.HeaderHits.Take(10)),
            ["header_dirs"] = DirCounts(headerDirs, 10),
        };
    }

    /* ── secrets (where, never what) ────────────────────────────────── */

    [GeneratedRegex(@"(^|/)(\.env(\.[a-z]+)?|.*\.pfx|.*\.snk|.*\.pem|.*\.p12|.*\.key|.*\.keystore|.*\.jks|secrets?\.(json|ya?ml)|appsettings\.(Production|Staging|Development)\.json|web\.config|app\.config|credentials|\.npmrc|\.pypirc)$", JsI)]
    private static partial Regex SensitiveFile();

    private static JsonObject Secrets(Tree t, ContentScan s)
    {
        var total = s.SecretsByKind.Entries.Sum(e => e.Value);
        return new JsonObject
        {
            ["total"] = total,
            ["by_kind"] = JsObject(s.SecretsByKind.Entries),
            ["files"] = Arr(s.SecretFiles.MostCommon(25).Select(e => (JsonNode?)new JsonObject { ["path"] = e.Key, ["hits"] = e.Value })),
            ["sensitive_files"] = Strs(t.Files.Where(f => SensitiveFile().IsMatch(f)).Take(40)),
            ["in_test_files"] = s.SecretsInTests,
            ["outside_tests"] = total - s.SecretsInTests,
            ["dotenv_examples"] = Strs(Ending(t, ".env.example", ".env.sample", ".env.template")),
        };
    }

    /* ── external systems ───────────────────────────────────────────── */

    private static Regex Ext(string pattern, bool ignoreCase = true) => new(pattern, (ignoreCase ? JsI : Js) | RegexOptions.Compiled);

    private static readonly (string Name, Regex Rx)[] ExternalSystemPatterns =
    [
        ("PostgreSQL", Ext(@"\b(postgres(ql)?|psycopg|pg_|npgsql|asyncpg)\b")),
        ("MySQL/MariaDB", Ext(@"\b(mysqli?|mariadb)\b")),
        ("SQL Server", Ext(@"(System\.Data\.SqlClient|Microsoft\.Data\.SqlClient|SqlConnection|Data Source=|Initial Catalog=)")),
        ("MongoDB", Ext(@"\bmongo(db|ose)?\b")),
        ("Redis", Ext(@"\bredis\b")),
        ("RabbitMQ/AMQP", Ext(@"\b(rabbitmq|amqp)\b")),
        ("Kafka", Ext(@"\bkafka\b")),
        ("AWS SDK", Ext(@"(boto3|aws-sdk|github\.com/aws/aws-sdk-go|AWSSDK\.|software\.amazon\.awssdk|hashicorp/aws)", ignoreCase: false)),
        ("Azure SDK", Ext(@"(azure-identity|@azure/|Azure\.Identity|Microsoft\.Azure\.|azure-sdk-for-go|Azure\.Messaging)", ignoreCase: false)),
        ("GCP SDK", Ext(@"(google-cloud-|@google-cloud/|cloud\.google\.com/go)", ignoreCase: false)),
        ("Dataverse/Dynamics 365", Ext(@"(Microsoft\.Xrm\.Sdk|Microsoft\.Crm\.Sdk|Dataverse|IOrganizationService|Microsoft\.PowerPlatform|CrmSvcUtil|xrm\.|Xrm\.WebApi)", ignoreCase: false)),
        ("Azure DevOps", Ext(@"(dev\.azure\.com|visualstudio\.com|azure-devops|vsts|azure-pipelines)")),
        ("Jira", Ext(@"\b(atlassian\.net|jira)\b")),
        ("Stripe", Ext(@"\bstripe\b")),
        ("SMTP/email", Ext(@"\b(smtp|sendgrid|mailgun|ses\b)")),
        ("OpenAI API", Ext(@"(api\.openai\.com|openai\b)")),
        ("Anthropic API", Ext(@"(anthropic|api\.anthropic\.com)")),
        ("Sentry", Ext(@"\bsentry\b")),
        ("Docker", Ext(LineStart + "(FROM |docker-compose|services:)")),
        ("Kubernetes/Helm", Ext("(apiVersion: apps/v1|kind: Deployment|helm)")),
        ("OAuth/OIDC/Identity", Ext(@"(oauth2?|openid|oidc|keycloak|identityserver|Auth0|azure ?ad\b|entra)")),
        ("Elasticsearch/OpenSearch", Ext(@"\b(elasticsearch|opensearch)\b")),
        ("GraphQL", Ext(@"\bgraphql\b")),
        ("gRPC/Protobuf", Ext(@"\b(grpc|protobuf)\b")),
        ("SharePoint/Office365", Ext(@"(sharepoint|Microsoft\.Graph|office365)")),
        ("SOAP/WCF web services", Ext(@"(System\.ServiceModel|\.svc\b|wsdl|SoapClient)")),
        ("SAP", Ext(@"\bsap\b(?!i)")),
    ];

    [GeneratedRegex(@"(package\.json|pyproject\.toml|requirements.*\.txt|go\.mod|pom\.xml|build\.gradle(\.kts)?|\.csproj|packages\.config|composer\.json|Cargo\.toml|docker-compose.*\.ya?ml|Dockerfile|\.tf|appsettings.*\.json|web\.config|app\.config|\.env\.example|libs\.versions\.toml)$", Js)]
    private static partial Regex ManifestLike();

    private sealed class Hit
    {
        public long Count;
        public readonly Counter Files = new();
    }

    /// <summary>Manifests only — a dependency named is a system used; code mentioning one may be a comment. Ordered by count, most first.</summary>
    private static JsonObject ExternalSystems(Tree t, CancellationToken ct)
    {
        var hits = new OrderedDictionary<string, Hit>(StringComparer.Ordinal);
        foreach (var f in t.Files.Where(x => ManifestLike().IsMatch(x)).Take(600))
        {
            ct.ThrowIfCancellationRequested();
            var x = Read(t, f, ExternalLimit);
            foreach (var (name, rx) in ExternalSystemPatterns)
            {
                var n = rx.Count(x);
                if (n == 0) continue;
                if (!hits.TryGetValue(name, out var h)) hits[name] = h = new Hit();
                h.Count += n;
                h.Files.Inc(f, n);
            }
        }
        return JsObject(hits.OrderByDescending(e => e.Value.Count).Select(e => new KeyValuePair<string, JsonNode?>(e.Key,
            new JsonObject { ["count"] = e.Value.Count, ["sample_files"] = Strs(e.Value.Files.MostCommon(4).Select(p => p.Key)) })));
    }

    /* ── AI configuration already there ─────────────────────────────── */

    [GeneratedRegex(@"(^|/)(CLAUDE\.md|AGENTS\.md|GEMINI\.md|\.cursorrules|\.cursor/rules(/|$)|\.github/copilot-instructions\.md|\.github/instructions/|\.mcp\.json|\.claude/|\.clinerules|\.kiro/|\.windsurf|\.windsurfrules|\.aider|\.agents/|\.codex/|copilot-instructions\.md|llms\.txt)", JsI)]
    private static partial Regex AiFile();

    private static string AiKind(string f)
    {
        var lower = f.ToLowerInvariant();
        if (f.Contains("CLAUDE.md", StringComparison.Ordinal)) return "CLAUDE.md";
        if (f.Contains("AGENTS.md", StringComparison.Ordinal)) return "AGENTS.md";
        if (lower.Contains("cursor", StringComparison.Ordinal)) return "cursor";
        if (lower.Contains("copilot", StringComparison.Ordinal)) return "copilot";
        if (f.Contains("clinerules", StringComparison.Ordinal)) return "clinerules";
        if ($"/{f}".Contains("/.claude/", StringComparison.Ordinal)) return ".claude/";
        if (f.Contains(".agents/", StringComparison.Ordinal)) return ".agents/";
        if (f.Contains("mcp.json", StringComparison.Ordinal)) return "mcp.json";
        if (f.Contains(".kiro", StringComparison.Ordinal)) return "kiro";
        if (lower.Contains("windsurf", StringComparison.Ordinal)) return "windsurf";
        return "other";
    }

    private static JsonObject AiConfig(Tree t)
    {
        var files = AnyGlob(t, AiFile());
        return new JsonObject
        {
            ["present"] = files.Count > 0,
            ["files"] = Strs(files.Take(60)),
            ["count"] = files.Count,
            ["kinds"] = Strs(files.Select(AiKind).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal)),
            ["sizes"] = JsObject(files.Where(f => f.EndsWith(".md", StringComparison.Ordinal)).Select(f => new KeyValuePair<string, JsonNode?>(f, CodePoints(Read(t, f))))),
        };
    }

    /* ── documentation ──────────────────────────────────────────────── */

    [GeneratedRegex(@"^README(\.md|\.rst|\.txt)?$", JsI)] private static partial Regex Readme();
    [GeneratedRegex("(^|/)(adr|adrs|decisions|architecture-decisions)/", JsI)] private static partial Regex Adr();
    [GeneratedRegex("architecture|design[-_]?doc|ARCHITECTURE", JsI)] private static partial Regex ArchitectureDoc();
    [GeneratedRegex(@"^(\.github/|docs/)?PULL_REQUEST_TEMPLATE(\.md|/[^/]+\.md)$", JsI)] private static partial Regex PrTemplate();
    [GeneratedRegex(@"^(\.github/|docs/)?CODEOWNERS$", Js)] private static partial Regex CodeOwners();

    private static JsonObject Docs(Tree t)
    {
        static bool InDocs(string f) => f.StartsWith("docs/", StringComparison.Ordinal) || f.StartsWith("doc/", StringComparison.Ordinal) || f.StartsWith("documentation/", StringComparison.Ordinal);
        var readme = t.Files.FirstOrDefault(f => Readme().IsMatch(f));
        var license = Exists(t, "LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE.rst", "COPYING", "LICENCE");
        var licenseKind = "none";
        if (license.Count > 0)
        {
            var lt = Read(t, license[0], 3000);
            licenseKind = lt.Contains("MIT License", StringComparison.Ordinal) || lt.Contains("Permission is hereby granted, free of charge", StringComparison.Ordinal) ? "MIT"
                : lt.Contains("Apache License", StringComparison.Ordinal) ? "Apache-2.0"
                : lt.Contains("GNU GENERAL PUBLIC", StringComparison.Ordinal) ? "GPL"
                : lt.Contains("Redistribution and use in source and binary", StringComparison.Ordinal) ? "BSD"
                : lt.Contains("Mozilla Public", StringComparison.Ordinal) ? "MPL" : "unknown";
        }
        return new JsonObject
        {
            ["readme"] = readme,
            ["readme_bytes"] = readme is not null ? CodePoints(Read(t, readme)) : 0,
            ["docs_dir"] = t.Files.Any(InDocs),
            ["docs_files"] = t.Files.Count(InDocs),
            ["adrs"] = Strs(t.Files.Where(f => Adr().IsMatch(f)).Take(10)),
            ["contributing"] = Strs(Exists(t, "CONTRIBUTING.md", ".github/CONTRIBUTING.md", "CONTRIBUTING.rst", "docs/CONTRIBUTING.md")),
            ["architecture_docs"] = Strs(t.Files.Where(f => ArchitectureDoc().IsMatch(f) && (f.EndsWith(".md", StringComparison.Ordinal) || f.EndsWith(".rst", StringComparison.Ordinal) || f.EndsWith(".txt", StringComparison.Ordinal))).Take(10)),
            ["license"] = Strs(license),
            ["changelog"] = Strs(Exists(t, "CHANGELOG.md", "CHANGELOG", "CHANGES.md", "ChangeLog.md")),
            ["license_kind"] = licenseKind,
            // Where GitHub looks for them: the root, .github/ or docs/ (a template may also be a folder of several).
            ["pr_template"] = Strs(t.Files.Where(f => PrTemplate().IsMatch(f))),
            ["codeowners"] = Strs(t.Files.Where(f => CodeOwners().IsMatch(f))),
        };
    }

    /* ── Windows-only build, environment, size ──────────────────────── */

    private static JsonObject WindowsBuild(Tree t, Stack st)
    {
        int Count(params string[] suffixes) => Ending(t, suffixes).Count;
        var sln = st.Slns.Count;
        var packagesConfig = Count("packages.config");
        var legacy = st.Frameworks.Contains(".NET Framework (legacy, msbuild)");
        return new JsonObject
        {
            ["sln"] = sln,
            ["csproj"] = st.Csprojs.Count,
            ["snk"] = Count(".snk"),
            ["vbproj"] = Count(".vbproj"),
            ["packages_config"] = packagesConfig,
            ["ps1"] = Count(".ps1"),
            ["bat_cmd"] = Count(".bat", ".cmd"),
            ["legacy_netframework"] = legacy,
            ["dll_checked_in"] = Count(".dll"),
            ["exe_checked_in"] = Count(".exe"),
            ["windows_only_build"] = legacy || (sln > 0 && packagesConfig > 0 && st.Frameworks.Contains(".NET") && !st.BuildSystem.Contains("dotnet")),
        };
    }

    [GeneratedRegex("(^|/)Dockerfile[^/]*$", Js)] private static partial Regex Dockerfile();
    [GeneratedRegex(@"(^|/)(docker-)?compose[^/]*\.ya?ml$", Js)] private static partial Regex Compose();

    private static JsonObject DevEnvironment(Tree t) => new()
    {
        ["devcontainer"] = Exists(t, ".devcontainer/devcontainer.json", ".devcontainer.json").Count > 0 || t.Files.Any(f => f.StartsWith(".devcontainer/", StringComparison.Ordinal)),
        ["dockerfile"] = Strs(t.Files.Where(f => Dockerfile().IsMatch(f)).Take(10)),
        ["docker_compose"] = Strs(t.Files.Where(f => Compose().IsMatch(f)).Take(10)),
        ["makefile"] = Exists(t, "Makefile", "makefile", "justfile", "Taskfile.yml").Count > 0,
        ["nix_flake"] = Exists(t, "flake.nix").Count > 0,
        ["editorconfig"] = Exists(t, ".editorconfig").Count > 0,
        ["tool_versions"] = Strs(Exists(t, ".tool-versions", ".nvmrc", ".node-version", ".python-version", "rust-toolchain.toml", ".java-version", "global.json")),
    };

    private static JsonObject Size(Tree t, ContentScan s)
    {
        // The script sorted (size, path) tuples in reverse: the larger size first, and for one size the later path first.
        var largest = t.Files.Select(f => (Path: f, Bytes: t.Bytes.GetValueOrDefault(f)))
            .OrderByDescending(x => x.Bytes).ThenByDescending(x => x.Path, StringComparer.Ordinal).Take(8);
        return new JsonObject
        {
            ["files"] = t.Files.Count,
            ["code_lines"] = s.TotalLines,
            ["bytes_on_disk_excl_git"] = t.Bytes.Values.Sum(),
            ["largest_files"] = Arr(largest.Select(x => (JsonNode?)new JsonObject { ["path"] = x.Path, ["bytes"] = x.Bytes })),
            ["top_level_dirs"] = Strs(t.Files.Where(f => f.Contains('/')).Select(f => f.Split('/')[0]).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).Take(40)),
        };
    }

    /* ── git history ────────────────────────────────────────────────── */

    /// <summary>The old server's <c>maxBuffer</c>: a command that printed more than this read as nothing.</summary>
    private const int MaxGitOutputBytes = 64 * 1024 * 1024;

    /// <summary>
    /// What a git command printed, read as the old server read it: stdout only. <c>Git.RunAsync</c> hands back stdout and then stderr as one text, so a warning git adds to a successful run (a config file it cannot
    /// read, the rename limit on a large commit) would land at the end of the data — one more "file" in the log, one more
    /// tracked file. Those trailing diagnostic lines are dropped. When git died (its exit code 128), what it printed before
    /// its first diagnostic line is still its stdout, as the old server read it: <c>rev-parse HEAD</c> in a repository with
    /// no commits printed "HEAD". Exit code 1 is how RunAsync reports a timeout or a git that did not start, which the old
    /// server read as nothing, as it did output over its 64 MiB buffer.
    /// </summary>
    private static string StdoutOf(Git.Result r)
    {
        if (r.Code == 1) return "";
        var lines = r.Out.Split('\n');
        var end = lines.Length;
        if (r.Ok)
        {
            while (end > 0 && GitDiagnostic().IsMatch(lines[end - 1])) end--;
        }
        else
        {
            var first = Array.FindIndex(lines, l => GitDiagnostic().IsMatch(l));
            if (first != -1) end = first;
        }
        var stdout = string.Join('\n', lines, 0, end);
        return Encoding.UTF8.GetByteCount(stdout) > MaxGitOutputBytes ? "" : stdout.Trim();
    }

    [GeneratedRegex("^(warning|hint|error|fatal): ", Js)] private static partial Regex GitDiagnostic();

    [GeneratedRegex(@"\.(dll|exe|pdb|nupkg)$", JsI)] private static partial Regex TrackedBinary();
    [GeneratedRegex(@"(^|/)(\.vs|\.idea|obj)/|\.(suo|user)$", Js)] private static partial Regex TrackedIdeJunk();
    [GeneratedRegex("^(node_modules|vendor)/", Js)] private static partial Regex TrackedCache();

    /// <summary>
    /// <c>packages/</c> counts as a cache only when it is one (NuGet's <c>&lt;Id&gt;.&lt;version&gt;/</c> layout or <c>.nupkg</c>
    /// files); an npm monorepo's <c>packages/</c> is the code itself, and counting it would deny the agent the repository it works on.
    /// </summary>
    [GeneratedRegex(@"^packages/([^/]+\.[0-9]+(\.[0-9]+)*[^/]*/|[^/]+\.nupkg$)", JsI)] private static partial Regex TrackedNuGet();

    private sealed class Shape(List<string> files)
    {
        public List<string> Files { get; } = files;
        public long Times = 1;
    }

    private sealed class Pair(string a, string b)
    {
        public string A { get; } = a;
        public string B { get; } = b;
        public long Times = 1;
    }

    private static async Task<JsonObject> GitFactsAsync(string root, CancellationToken ct)
    {
        async Task<string> Run(params string[] args)
        {
            var r = await Git.RunAsync(args, root, GitTimeoutMs, GitEnv, ct);
            ct.ThrowIfCancellationRequested();
            return StdoutOf(r);
        }

        var g = new JsonObject { ["available"] = true };
        g["head"] = await Run("rev-parse", "HEAD");
        var tracked = (await Run("ls-files")).Split('\n').Where(x => x.Length > 0).ToList();
        g["tracked_files"] = tracked.Count;
        g["tracked_binaries_dll_exe_pdb"] = tracked.Count(x => TrackedBinary().IsMatch(x));
        g["tracked_ide_junk"] = tracked.Count(x => TrackedIdeJunk().IsMatch(x));
        g["tracked_package_dirs"] = tracked.Count(x => TrackedCache().IsMatch(x) || TrackedNuGet().IsMatch(x));
        g["commits_in_clone"] = ParseIntLoose(await Run("rev-list", "--count", "HEAD"));
        // A worktree's .git is a file, so the shallow marker is asked of git instead of looked for on disk.
        var dotGit = Path.Combine(root, ".git");
        var shallowMarker = Path.Combine(dotGit, "shallow");
        g["shallow"] = Directory.Exists(dotGit)
            ? File.Exists(shallowMarker) || Directory.Exists(shallowMarker)
            : await Run("rev-parse", "--is-shallow-repository") == "true";
        g["last_commit_date"] = await Run("log", "-1", "--format=%cs");
        g["first_commit_date_in_clone"] = (await Run("log", "--reverse", "--format=%cs")).Split('\n')[0];
        g["authors_in_clone"] = (await Run("shortlog", "-sn", "--no-merges", "HEAD")).Split('\n').Count(a => JsTrim(a).Length > 0);

        var log = await Run("log", "--no-merges", "--name-only", "--format=__C__%h|%an|%cs", $"--max-count={LogMaxCommits}", "HEAD");
        var fileChanges = new Counter();
        var dirChanges = new Counter();
        var fileAuthors = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var dirAuthors = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var commitSets = new List<List<string>>();
        string? author = null;
        var cur = new List<string>();
        void Flush()
        {
            if (author is not null && cur.Count > 0) commitSets.Add([.. cur.Order(StringComparer.Ordinal)]);
        }
        foreach (var line in log.Split('\n'))
        {
            if (line.StartsWith("__C__", StringComparison.Ordinal))
            {
                Flush();
                var fields = line[5..].Split('|');
                author = fields.Length > 1 ? fields[1] : "";
                cur = [];
            }
            else if (JsTrim(line) is { Length: > 0 } f)
            {
                cur.Add(f);
                fileChanges.Inc(f);
                AddTo(fileAuthors, f, author ?? "");
                var parts = f.Split('/');
                var d = parts.Length > 1 ? parts[0] : ".";
                var d2 = parts.Length > 2 ? $"{parts[0]}/{parts[1]}" : d;
                dirChanges.Inc(d2);
                AddTo(dirAuthors, d2, author ?? "");
            }
        }
        Flush();
        g["hot_files"] = Arr(fileChanges.MostCommon(15).Select(e => (JsonNode?)new JsonObject
            { ["path"] = e.Key, ["changes"] = e.Value, ["authors"] = fileAuthors.TryGetValue(e.Key, out var a) ? a.Count : 0 }));
        g["hot_dirs"] = Arr(dirChanges.MostCommon(12).Select(e => (JsonNode?)new JsonObject
            { ["dir"] = e.Key, ["changes"] = e.Value, ["authors"] = dirAuthors.TryGetValue(e.Key, out var a) ? a.Count : 0 }));
        // Repeated change shapes: the same set of 3–12 files in two or more commits — a process the code does not state.
        var shapes = new OrderedDictionary<string, Shape>(StringComparer.Ordinal);
        foreach (var fs in commitSets)
        {
            if (fs.Count is < 3 or > 12) continue;
            var key = string.Join('\n', fs);
            if (shapes.TryGetValue(key, out var e)) e.Times++;
            else shapes[key] = new Shape(fs);
        }
        g["repeated_change_shapes"] = Arr(shapes.Values.OrderByDescending(x => x.Times).Take(8).Where(x => x.Times >= 2)
            .Select(x => (JsonNode?)new JsonObject { ["files"] = Strs(x.Files), ["times"] = x.Times }));
        // Co-change pairs (files changed together four times or more) as a softer signal.
        var pairs = new OrderedDictionary<string, Pair>(StringComparer.Ordinal);
        foreach (var fs in commitSets)
        {
            if (fs.Count > 12) continue;
            for (var i = 0; i < fs.Count; i++)
            {
                for (var j = i + 1; j < fs.Count; j++)
                {
                    var key = $"{fs[i]}\n{fs[j]}";
                    if (pairs.TryGetValue(key, out var e)) e.Times++;
                    else pairs[key] = new Pair(fs[i], fs[j]);
                }
            }
        }
        g["cochange_pairs"] = Arr(pairs.Values.OrderByDescending(x => x.Times).Take(8).Where(x => x.Times >= 4)
            .Select(x => (JsonNode?)new JsonObject { ["a"] = x.A, ["b"] = x.B, ["times"] = x.Times }));
        g["commits_analyzed"] = commitSets.Count;
        var byExt = new Counter();
        foreach (var (f, n) in fileChanges.Entries) byExt.Inc(ExtOf(f), n);
        g["churn_by_ext"] = JsObject(byExt.MostCommon(8));
        return g;
    }

    /* ── the diagnosis ──────────────────────────────────────────────── */

    /// <summary>
    /// Diagnoses the repository at <paramref name="root"/> and returns its profile — the old server's <c>RepoProfile</c>,
    /// key for key and in the same order. Nothing is written anywhere; git is read with plain commands and only when the
    /// repository has a <c>.git</c> (a directory, or a worktree's file) and <paramref name="git"/> is true. The file phases
    /// run on the thread pool, so a long diagnosis does not hold the caller's thread; <paramref name="log"/> hears one line
    /// per phase.
    /// </summary>
    public static async Task<JsonObject> DiagnoseAsync(string root, string name, bool git = true, Action<string>? log = null, CancellationToken ct = default)
    {
        var abs = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        log ??= _ => { };
        var t = await Task.Run(() => WalkTree(abs), ct);
        log($"walked {t.Files.Count} files under {abs}");
        var scan = await Task.Run(() => ScanContents(t, ct), ct);
        log($"read {scan.LangFiles.Count} languages, {scan.TotalLines} code lines, {scan.HeaderHits.Count} generated headers");
        var profile = await Task.Run(() =>
        {
            var st = DetectStack(t);
            CountTests(t, st);
            return new JsonObject
            {
                ["name"] = name,
                ["path"] = abs,
                ["languages"] = Languages(scan),
                ["frameworks"] = Strs(st.Frameworks.Order(StringComparer.Ordinal)),
                ["package_managers"] = Strs(st.PackageManagers.Order(StringComparer.Ordinal)),
                ["build"] = st.BuildJson(),
                ["tests"] = st.TestsJson(),
                ["lint_format"] = Strs(LintFormat(t, st.Lint)),
                ["ci"] = DetectCi(t),
                ["monorepo"] = DetectMonorepo(t, st),
                ["generated_code"] = GeneratedCode(t, scan),
                ["secrets"] = Secrets(t, scan),
                ["external_systems"] = ExternalSystems(t, ct),
                ["ai_config"] = AiConfig(t),
                ["docs"] = Docs(t),
                ["windows_build"] = WindowsBuild(t, st),
                ["environment"] = DevEnvironment(t),
                ["size"] = Size(t, scan),
                ["git"] = new JsonObject { ["available"] = false },
            };
        }, ct);
        var dotGit = Path.Combine(abs, ".git");
        if (git && (Directory.Exists(dotGit) || File.Exists(dotGit)))
        {
            var g = await GitFactsAsync(abs, ct);
            profile["git"] = g;
            log($"git: {g["commits_analyzed"]} commits analyzed, {g["tracked_files"]} tracked files");
        }
        return profile;
    }
}
