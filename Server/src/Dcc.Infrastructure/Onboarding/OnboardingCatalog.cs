using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Domain.Onboarding;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// The operator catalog (repo-onboarding/catalog/index.ts; openspec/changes/repository-coach, plan → build): DCC's
/// reusable, parameterised templates for the components a rule puts on a card — hooks, permissions, skills, agents,
/// documents, scaffolds. The builder calls <see cref="Render"/> with the card's <c>params.template</c> (or, for a card
/// without one, its kind: <c>deny</c>, <c>gitignore</c>, <c>gitattributes</c>, <c>mcp</c>, <c>pr-template</c>,
/// <c>reviewer</c>) and writes what comes back into the isolated copy of the client's repository.
///
/// No database, no model, no network: the template files (Server/onboarding/catalog/templates, handed to the
/// constructor) and the parameters are the whole input, so a rendering is reproducible and the unit test executes every
/// hook it produces. It lives in Infrastructure only because it reads those files.
///
/// Everything rendered lands in the CLIENT's repository: hooks and scripts are plain Node (<c>.mjs</c>, zero
/// dependencies), the rest is Markdown in the exact shapes Claude Code reads. Two slot conventions in a template file:
/// <c>{{lowercase}}</c> is DCC's and is filled here; <c>{{UPPERCASE}}</c> is the builder's (repository-specific prose it
/// writes from the diagnosis) and is left as it is. A hook declares <c>const CONFIG = {}</c> with the <c>@dcc:config</c>
/// marker comment before the braces (<see cref="ConfigMark"/>); rendering replaces that with the baked parameters — so
/// the template file is itself valid, lint-clean JavaScript that runs (with an empty config).
///
/// The parameters are the rules table's loose JSON, so they are read the way the old server read them — JavaScript's
/// <c>String(x).trim()</c> and <c>Number(x) || 0</c> — and a baked config is written exactly as
/// <c>JSON.stringify(config, null, 2)</c> wrote it.
/// </summary>
public sealed partial class OnboardingCatalog(string templatesDir)
{
    public const int Version = 1;

    public string TemplatesDir => templatesDir;

    /// <summary>Renders one template; throws on a name the catalog does not have.</summary>
    /// <exception cref="ArgumentException">The name is not in the catalog; the message lists the ones that are.</exception>
    public Rendered Render(string template, JsonObject parameters, RepoFacts repo)
    {
        if (!Table.TryGetValue(template, out var t))
            throw new ArgumentException($"unknown catalog template \"{template}\" (known: {string.Join(", ", Table.Keys)})");
        return t.Render(this, parameters ?? new JsonObject(), repo);
    }

    /// <summary>Every template, in the catalog's order: its name, its kind and what it produces.</summary>
    public IReadOnlyList<(string Name, string Kind, IReadOnlyList<string> Produces)> List() =>
        Table.Select(x => (Name: x.Key, x.Value.Kind, Produces: (IReadOnlyList<string>)x.Value.Produces.ToArray())).ToList();

    private sealed record Template(string Kind, string[] Produces, Func<OnboardingCatalog, JsonObject, RepoFacts, Rendered> Render);

    /* ── the template files ─────────────────────────────────────────── */

    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);
    private readonly ConcurrentDictionary<string, string> _loaded = new(StringComparer.Ordinal);

    /// <summary>A template file as it is on disk, read once — decoded without dropping a byte-order mark, as Node's readFileSync did.</summary>
    private string Text(string rel) => _loaded.GetOrAdd(rel, r => Utf8.GetString(File.ReadAllBytes(Path.Combine(templatesDir, r))));

    /// <summary><c>{{key}}</c> → its value for the lowercase keys given; an unknown one stays visible, never silently blank. Uppercase slots are the builder's.</summary>
    private static string Fill(string text, Dictionary<string, string> values) =>
        Slot().Replace(text, m => values.TryGetValue(m.Groups[1].Value, out var v) ? v : m.Value);

    private const string ConfigMark = "/* @dcc:config */ {}";

    /// <summary>
    /// A hook or a script with its parameters baked in as a const, copied exactly. (The old server used
    /// <c>text.replace(CONFIG_MARK, json)</c>, which read a <c>$$</c>, <c>$&amp;</c>, <c>$`</c> or <c>$'</c> inside a command as
    /// a replacement pattern and wrote a broken hook — a bug, not carried over.)
    /// </summary>
    private string Bake(string rel, JsonObject config)
    {
        var text = Text(rel);
        var at = text.IndexOf(ConfigMark, StringComparison.Ordinal);
        if (at < 0) throw new InvalidOperationException($"catalog template {rel} has no config marker");
        return string.Concat(text.AsSpan(0, at), Stringify(config), text.AsSpan(at + ConfigMark.Length));
    }

    /* ── reading parameters, as JavaScript read them ───────────────── */

    /// <summary>JavaScript's whitespace (<c>trim()</c> and <c>\s</c>): .NET's adds U+0085 and leaves out U+FEFF.</summary>
    private const string Ws = @"[\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]";
    private static readonly char[] WsChars = "\t\n\v\f\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF".ToCharArray();

    private static string Trim(string s) => s.Trim(WsChars);

    /// <summary>
    /// JavaScript's <c>toLowerCase()</c>: the invariant mapping, except that U+0130 (I with a dot) becomes "i" and a
    /// combining dot, where .NET leaves it as it is — so "İstanbul" slugs to "i-stanbul" as it did.
    /// </summary>
    private static string JsLower(string s) => s.Replace(DottedCapitalI, DottedSmallI, StringComparison.Ordinal).ToLowerInvariant();

    private static readonly string DottedCapitalI = ((char)0x0130).ToString();
    private static readonly string DottedSmallI = "i" + (char)0x0307;

    private static string Or(string a, string b) => a.Length > 0 ? a : b;

    private static bool IsNull(JsonNode? n) => n is null || n.GetValueKind() == JsonValueKind.Null;

    private static bool IsTrue(JsonNode? n) => n is JsonValue v && v.GetValueKind() == JsonValueKind.True;

    private static string Str(JsonObject p, string k) => IsNull(p[k]) ? "" : Trim(JsString(p[k]));

    private static List<string> Strs(JsonObject p, string k) => p[k] switch
    {
        JsonArray a => a.Select(x => IsNull(x) ? "" : Trim(JsString(x))).Where(x => x.Length > 0).ToList(),
        JsonValue v when v.GetValueKind() == JsonValueKind.String && Trim(JsString(v)) is { Length: > 0 } s => [s],
        _ => [],
    };

    /// <summary>The objects of an array parameter; anything else in it is skipped.</summary>
    private static IEnumerable<JsonObject> Objects(JsonObject p, string k) => p[k] is JsonArray a ? a.OfType<JsonObject>() : [];

    /// <summary>JavaScript's <c>String(x)</c>: an array joins its items with commas (a null item is empty), an object is "[object Object]".</summary>
    private static string JsString(JsonNode? n) => n switch
    {
        null => "null",
        JsonArray a => string.Join(",", a.Select(x => IsNull(x) ? "" : JsString(x))),
        JsonObject => "[object Object]",
        JsonValue v => v.GetValueKind() switch
        {
            JsonValueKind.String => v.TryGetValue<string>(out var s) ? s : v.ToString(),
            JsonValueKind.Number => JsNumber(double.Parse(v.ToJsonString(), CultureInfo.InvariantCulture)),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => "null",
        },
        _ => "",
    };

    /// <summary>JavaScript's <c>Number(x) || 0</c>: whatever is not a number, and NaN, is 0.</summary>
    private static double NumberOrZero(JsonNode? n)
    {
        var d = n switch
        {
            JsonArray a => StringToNumber(JsString(a)),
            JsonValue v => v.GetValueKind() switch
            {
                JsonValueKind.Number => double.Parse(v.ToJsonString(), CultureInfo.InvariantCulture),
                JsonValueKind.String => StringToNumber(JsString(v)),
                JsonValueKind.True => 1,
                _ => 0,
            },
            _ => double.NaN,
        };
        return double.IsNaN(d) ? 0 : d;
    }

    /// <summary>JavaScript's <c>Number(string)</c>: blank is 0, decimal and 0x/0o/0b literals and Infinity are numbers, the rest NaN.</summary>
    private static double StringToNumber(string s)
    {
        var t = Trim(s);
        if (t.Length == 0) return 0;
        if (JsDecimal().IsMatch(t)) return double.Parse(t, NumberStyles.Float, CultureInfo.InvariantCulture);
        if (t is "Infinity" or "+Infinity") return double.PositiveInfinity;
        if (t == "-Infinity") return double.NegativeInfinity;
        if (JsRadix().Match(t) is not { Success: true } m) return double.NaN;
        var radix = char.ToLowerInvariant(m.Groups[1].Value[0]) switch { 'x' => 16, 'o' => 8, _ => 2 };
        return m.Groups[1].Value[1..].Aggregate(0d, (acc, ch) => acc * radix + Convert.ToInt32(ch.ToString(), 16));
    }

    /// <summary>
    /// JavaScript's <c>Number.prototype.toString()</c>: the shortest digits that round-trip, plain notation from 1e-6 up
    /// to 1e21 and exponent notation ("1e+21", "1.5e-7") outside it.
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

    /// <summary>The rules table writes "-" for a command it could not infer: that is "none", not a command.</summary>
    private static string Command(string? s) => s is null || Trim(s) == "-" ? "" : Trim(s);

    private static string Slug(string s) => Or(EdgeDashes().Replace(NotSlug().Replace(JsLower(s), "-"), ""), "root");

    private static string Code(string s) => $"`{s.Replace('`', '\'')}`";

    private static string Bullets(IEnumerable<string> xs) => string.Join("\n", xs.Select(x => $"- {Code(x)}"));

    /// <summary>A value that goes into a YAML frontmatter line: no line breaks, no <c>": "</c>, no <c>" #"</c>.</summary>
    private static string YamlSafe(string s) => Trim(YamlHash().Replace(YamlColon().Replace(YamlBreak().Replace(s, " "), " - "), " "));

    private static JsonArray Arr(IEnumerable<string> xs) => new([.. xs.Select(x => (JsonNode?)JsonValue.Create(x))]);

    /* ── hooks ──────────────────────────────────────────────────────── */

    private const string HookDir = ".claude/hooks";
    private const string FileTools = "Edit|Write|MultiEdit";
    /// <summary>0o755 — a hook and a script are executables in the client's repository.</summary>
    private const int ExecutableMode = 0b111_101_101;

    private static string HookCommand(string name) => $"node \"$CLAUDE_PROJECT_DIR/{HookDir}/{name}.mjs\"";

    /// <summary>One entry of <c>settings.hooks.&lt;Event&gt;</c>; the timeout is in seconds (Claude Code kills a hook after 60 s by default).</summary>
    private static JsonObject HookEntry(string name, string? matcher, int? timeoutSeconds = null)
    {
        var hook = new JsonObject { ["type"] = "command", ["command"] = HookCommand(name) };
        if (timeoutSeconds is { } t && t != 0) hook["timeout"] = t;
        var entry = new JsonObject();
        if (!string.IsNullOrEmpty(matcher)) entry["matcher"] = matcher;
        entry["hooks"] = new JsonArray(hook);
        return entry;
    }

    /// <summary>The <c>.claude/settings.json</c> fragment that wires hooks to one event.</summary>
    private static JsonObject Hooks(string @event, params JsonObject[] entries) =>
        new() { ["hooks"] = new JsonObject { [@event] = new JsonArray([.. entries]) } };

    private CatalogFile HookFile(string name, JsonObject config) => new($"{HookDir}/{name}.mjs", Bake($"hooks/{name}.mjs", config), ExecutableMode);

    private static string VerifyHook(string name, string @event, string exit) => $"verify: echo '{@event}' | node {HookDir}/{name}.mjs — {exit}";

    private sealed record Formatter(string[] Command, string[] Extensions);

    private static readonly string[] JsExt = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
    private static readonly Formatter Biome = new(["npx", "@biomejs/biome", "format", "--write"], [.. JsExt, ".json", ".jsonc", ".css"]);
    private static readonly Formatter Gofmt = new(["gofmt", "-w"], [".go"]);

    /// <summary>Formatter name (as the diagnosis writes it) → the per-file command. <c>null</c>: known, but it has no per-file command.</summary>
    private static readonly Dictionary<string, Formatter?> Formatters = new(StringComparer.Ordinal)
    {
        ["prettier"] = new(["npx", "prettier", "--write"], [.. JsExt, ".json", ".css", ".scss", ".less", ".md", ".mdx", ".yaml", ".yml", ".html", ".vue", ".graphql"]),
        ["eslint"] = new(["npx", "eslint", "--fix"], JsExt),
        ["biome"] = Biome,
        ["@biomejs/biome"] = Biome,
        ["ruff"] = new(["ruff", "format"], [".py", ".pyi"]),
        ["black"] = new(["black"], [".py", ".pyi"]),
        ["gofmt"] = Gofmt,
        ["golangci-lint"] = Gofmt,
        ["rustfmt"] = new(["rustfmt"], [".rs"]),
        ["spotless"] = null,
        ["ktlint"] = new(["ktlint", "-F"], [".kt", ".kts"]),
        ["php-cs-fixer"] = new(["php-cs-fixer", "fix"], [".php"]),
        ["terraform_fmt"] = new(["terraform", "fmt"], [".tf", ".tfvars"]),
    };

    /// <summary>"rustfmt/clippy (toolchain pinned)" → rustfmt; "Prettier" → prettier; unknown → not known. A known one with a null spec has no per-file command.</summary>
    private static (bool Known, Formatter? Spec) FormatterFor(string name)
    {
        var full = Trim(JsLower(name));
        if (Formatters.TryGetValue(full, out var spec)) return (true, spec);
        var shortName = Trim(FormatterTail().Replace(full, "", 1).Split('/')[0]);
        return Formatters.TryGetValue(shortName, out spec) ? (true, spec) : (false, null);
    }

    /// <summary>
    /// Whether Node takes the pattern as <c>new RegExp(pattern)</c> — the hook compiles it the same way when it loads, so
    /// a pattern Node refuses makes the hook fail on every edit. .NET's parser cannot answer this: it accepts
    /// <c>(?i)</c>, <c>^*</c> and <c>(?&gt;…)</c>, which Node refuses, and refuses <c>\k</c>, <c>\x</c>, <c>[]</c> and
    /// <c>\pL</c>, which Node takes.
    /// </summary>
    private static bool IsRegex(string pattern) => JsPattern.IsValid(pattern);

    /// <summary>
    /// The syntax of a JavaScript regular expression without flags, as Node 24 (V8 13) checks it: the standard grammar with
    /// the web-compatibility rules (a lone <c>{</c>, <c>}</c> or <c>]</c>, a malformed <c>\x</c>, <c>\u</c> or <c>\c</c>
    /// and an unknown escape are plain characters; a lookahead may take a quantifier), named groups (<c>\k</c> is strict
    /// once the pattern has one), lookbehind and modifiers <c>(?i-m:…)</c>. Only validity is decided; nothing is compiled.
    /// </summary>
    private sealed class JsPattern
    {
        private sealed class Invalid : Exception
        {
        }

        private const int End = -1;
        private readonly string _s;
        private readonly bool _named;
        private readonly Dictionary<string, List<int>> _names = new(StringComparer.Ordinal);
        private readonly List<string> _references = [];
        private int _i;
        private int _captures;

        private JsPattern(string s)
        {
            _s = s;
            _named = HasNamedGroup(s);
        }

        public static bool IsValid(string pattern)
        {
            var p = new JsPattern(pattern);
            try
            {
                p.Disjunction(0, (0, 0), topLevel: true);
                return p._references.All(p._names.ContainsKey);
            }
            catch (Invalid)
            {
                return false;
            }
        }

        private int Peek(int k = 0) => _i + k < _s.Length ? _s[_i + k] : End;

        /// <summary>
        /// Alternatives up to <c>)</c> (or the end, at the top). A repeated group name is judged V8's way, not the
        /// standard's: each group carries the span of capture numbers taken as "another alternative" — at its first
        /// <c>|</c> the span runs from its own capture number (or, for a group that captures nothing, the captures
        /// opened before it) to the captures opened so far, and each further <c>|</c> stretches its end. A group
        /// inherits its parent's span when it opens, and a name may repeat only when every earlier group of that name
        /// lies inside the span of the new one when it closes. So <c>(?&lt;a&gt;x)(?:|(?&lt;a&gt;y))</c> passes and
        /// <c>(?&lt;a&gt;x)(|(?&lt;a&gt;y))</c> does not. Returns the span at the close.
        /// </summary>
        private (int First, int Last) Disjunction(int captureIndex, (int First, int Last) span, bool topLevel = false)
        {
            while (true)
            {
                while (Peek() is not (End or '|' or ')')) Term(span);
                if (Peek() != '|') break;
                _i++;
                span = span.Last != 0 ? (span.First, _captures) : (captureIndex, _captures);
            }
            if (topLevel != (Peek() == End)) throw new Invalid(); // an unmatched ")", or a group never closed
            if (!topLevel) _i++;
            return span;
        }

        private void Term((int First, int Last) span)
        {
            switch (Peek())
            {
                case '^' or '$':
                    _i++;
                    return; // an assertion takes no quantifier: one after it has nothing to repeat
                case '\\' when Peek(1) is 'b' or 'B':
                    _i += 2;
                    return;
                case '\\':
                    Escape();
                    break;
                case '(':
                    if (!Group(span)) return;
                    break;
                case '[':
                    Class();
                    break;
                case '*' or '+' or '?':
                    throw new Invalid();
                case '{':
                    if (Interval(out _)) throw new Invalid();
                    _i++; // not a quantifier: a plain "{"
                    break;
                default:
                    _i++;
                    break;
            }
            Quantifier();
        }

        private void Quantifier()
        {
            switch (Peek())
            {
                case '*' or '+' or '?':
                    _i++;
                    break;
                case '{':
                    if (!Interval(out var end)) return;
                    _i = end;
                    break;
                default:
                    return;
            }
            if (Peek() == '?') _i++;
        }

        /// <summary>
        /// <c>{n}</c>, <c>{n,}</c> or <c>{n,m}</c> at the cursor (anything else is not a quantifier); a count past
        /// int.MaxValue counts as int.MaxValue, and m below n is an error. <paramref name="end"/> is just past the "}".
        /// </summary>
        private bool Interval(out int end)
        {
            end = _i + 1;
            var min = Digits(ref end);
            if (min < 0) return false;
            var max = min;
            if (end < _s.Length && _s[end] == ',')
            {
                end++;
                max = end < _s.Length && _s[end] == '}' ? int.MaxValue : Digits(ref end);
                if (max < 0) return false;
            }
            if (end >= _s.Length || _s[end] != '}') return false;
            end++;
            if (max < min) throw new Invalid();
            return true;
        }

        private int Digits(ref int at)
        {
            var start = at;
            long n = 0;
            while (at < _s.Length && char.IsAsciiDigit(_s[at])) n = Math.Min(n * 10 + (_s[at++] - '0'), int.MaxValue);
            return at == start ? -1 : (int)n;
        }

        /// <summary>An escape outside a class. Without the u flag any escape is a character; only <c>\k</c> can be wrong.</summary>
        private void Escape()
        {
            _i++;
            switch (Peek())
            {
                case End:
                    throw new Invalid();
                case 'c' when !char.IsAsciiLetter((char)Math.Max(Peek(1), 0)):
                    return; // the backslash itself; the "c" is read next
                case 'k' when _named:
                    _i++;
                    _references.Add(GroupName());
                    return;
                default:
                    _i++; // what follows a one-letter escape (hex digits, octal digits) reads as plain characters, as valid
                    return;
            }
        }

        /// <summary>Returns whether the group takes a quantifier: everything but a lookbehind.</summary>
        private bool Group((int First, int Last) span)
        {
            if (Peek(1) != '?')
            {
                _i++;
                Disjunction(++_captures, span);
                return true;
            }
            switch (Peek(2))
            {
                case ':' or '=' or '!':
                    _i += 3;
                    Disjunction(_captures, span);
                    return true;
                case '<' when Peek(3) is '=' or '!':
                    _i += 4;
                    Disjunction(_captures, span);
                    return false;
                case '<':
                    _i += 2;
                    var name = GroupName();
                    var index = ++_captures;
                    var (first, last) = Disjunction(index, span);
                    if (!_names.TryGetValue(name, out var earlier)) _names[name] = [index];
                    else if (earlier.All(e => e >= first && e <= last)) earlier.Add(index);
                    else throw new Invalid();
                    return true;
                default:
                    Modifiers();
                    Disjunction(_captures, span);
                    return true;
            }
        }

        /// <summary><c>(?ims-ims:</c>: each flag once at most, and not <c>(?-:</c>.</summary>
        private void Modifiers()
        {
            var at = _i + 2;
            var seen = new HashSet<char>();
            var count = 0;
            var dash = false;
            for (; at < _s.Length && _s[at] != ':'; at++)
            {
                if (_s[at] == '-' && !dash) dash = true;
                else if (_s[at] is 'i' or 'm' or 's' && seen.Add(_s[at])) count++;
                else throw new Invalid();
            }
            if (at >= _s.Length || count == 0) throw new Invalid();
            _i = at + 1;
        }

        /// <summary><c>&lt;name&gt;</c>: an identifier, where <c>\u</c> escapes (and <c>\u{…}</c>) count as their character.</summary>
        private string GroupName()
        {
            if (Peek() != '<') throw new Invalid();
            _i++;
            var sb = new StringBuilder();
            while (Peek() != '>')
            {
                int cp;
                if (Peek() == End) throw new Invalid();
                if (Peek() == '\\')
                {
                    if (Peek(1) != 'u') throw new Invalid();
                    _i += 2;
                    cp = UnicodeEscape();
                }
                else if (char.IsSurrogatePair(_s, _i))
                {
                    cp = char.ConvertToUtf32(_s, _i);
                    _i += 2;
                }
                else cp = _s[_i++];
                if (!(sb.Length == 0 ? IsIdStart(cp) : IsIdPart(cp))) throw new Invalid();
                sb.Append(char.ConvertFromUtf32(cp));
            }
            _i++;
            if (sb.Length == 0) throw new Invalid();
            return sb.ToString();
        }

        /// <summary>After <c>\u</c> in a name: <c>{hex}</c> up to 10FFFF, or four hex digits — a lead surrogate joined with a <c>\u</c> trail.</summary>
        private int UnicodeEscape()
        {
            if (Peek() == '{')
            {
                var close = _s.IndexOf('}', _i);
                if (close <= _i + 1 || !int.TryParse(_s.AsSpan(_i + 1, close - _i - 1), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var v) || v > 0x10FFFF)
                    throw new Invalid();
                _i = close + 1;
                return v;
            }
            var unit = Hex4(_i);
            if (unit < 0) throw new Invalid();
            _i += 4;
            if (char.IsHighSurrogate((char)unit) && Peek() == '\\' && Peek(1) == 'u' && Hex4(_i + 2) is var low && low >= 0 && char.IsLowSurrogate((char)low))
            {
                _i += 6;
                return char.ConvertToUtf32((char)unit, (char)low);
            }
            return unit;
        }

        private int Hex4(int at)
        {
            if (at + 4 > _s.Length) return -1;
            var v = 0;
            for (var k = at; k < at + 4; k++)
            {
                if (!char.IsAsciiHexDigit(_s[k])) return -1;
                v = v * 16 + Convert.ToInt32(_s[k].ToString(), 16);
            }
            return v;
        }

        /// <summary>A class: a range is checked by its ends' code units, unless either end is <c>\d</c>-like (then both ends and the dash are members).</summary>
        private void Class()
        {
            _i++;
            if (Peek() == '^') _i++;
            while (true)
            {
                if (Peek() == End) throw new Invalid();
                if (Peek() == ']')
                {
                    _i++;
                    return;
                }
                var from = ClassAtom();
                if (Peek() != '-') continue;
                if (Peek(1) == End) throw new Invalid();
                if (Peek(1) == ']')
                {
                    _i++;
                    continue;
                }
                _i++;
                var to = ClassAtom();
                if (from >= 0 && to >= 0 && from > to) throw new Invalid();
            }
        }

        /// <summary>One member of a class: its code unit, or -1 for a <c>\d \D \s \S \w \W</c>.</summary>
        private int ClassAtom()
        {
            if (Peek() != '\\') return _s[_i++];
            _i++;
            var c = Peek();
            switch (c)
            {
                case End:
                    throw new Invalid();
                case 'd' or 'D' or 's' or 'S' or 'w' or 'W':
                    _i++;
                    return -1;
                case 'b': _i++; return 8;
                case 't': _i++; return 9;
                case 'n': _i++; return 10;
                case 'v': _i++; return 11;
                case 'f': _i++; return 12;
                case 'r': _i++; return 13;
                case 'c':
                    var letter = Peek(1);
                    if (letter is (>= 'a' and <= 'z') or (>= 'A' and <= 'Z') or (>= '0' and <= '9') or '_')
                    {
                        _i += 2;
                        return letter % 32;
                    }
                    return '\\'; // the backslash itself; the "c" is the next member
                case 'x' when Peek(1) >= 0 && Peek(2) >= 0 && char.IsAsciiHexDigit((char)Peek(1)) && char.IsAsciiHexDigit((char)Peek(2)):
                    _i += 3;
                    return Convert.ToInt32(_s.Substring(_i - 2, 2), 16);
                case 'u' when Hex4(_i + 1) is var unit && unit >= 0:
                    _i += 5;
                    return unit;
                case >= '0' and <= '7':
                    // a legacy octal escape: up to three digits, at most \377
                    var v = c - '0';
                    _i++;
                    if (Peek() is >= '0' and <= '7')
                    {
                        v = v * 8 + (_s[_i++] - '0');
                        if (v < 32 && Peek() is >= '0' and <= '7') v = v * 8 + (_s[_i++] - '0');
                    }
                    return v;
                case 'k' when _named:
                    throw new Invalid();
                default:
                    _i++;
                    return c; // an identity escape: the character itself
            }
        }

        /// <summary>
        /// Whether the pattern has a named group, found the way V8 scans for one: escapes and classes skipped, then a
        /// <c>(?&lt;</c> that is not a lookbehind. It makes <c>\k</c> a back-reference that must name a group.
        /// </summary>
        private static bool HasNamedGroup(string s)
        {
            for (var i = 0; i < s.Length; i++)
            {
                switch (s[i])
                {
                    case '\\':
                        i++;
                        break;
                    case '[':
                        for (i++; i < s.Length && s[i] != ']'; i++)
                            if (s[i] == '\\') i++;
                        break;
                    case '(' when i + 2 < s.Length && s[i + 1] == '?' && s[i + 2] == '<' && (i + 3 == s.Length || s[i + 3] is not ('=' or '!')):
                        return true;
                }
            }
            return false;
        }

        private static bool IsIdStart(int cp) =>
            cp is '$' or '_' or 0x1885 or 0x1886 or 0x2118 or 0x212E or 0x309B or 0x309C
            || (cp is < 0xD800 or > 0xDFFF && CharUnicodeInfo.GetUnicodeCategory(cp) is UnicodeCategory.UppercaseLetter or UnicodeCategory.LowercaseLetter
                or UnicodeCategory.TitlecaseLetter or UnicodeCategory.ModifierLetter or UnicodeCategory.OtherLetter or UnicodeCategory.LetterNumber);

        private static bool IsIdPart(int cp) =>
            IsIdStart(cp)
            || cp is 0x200C or 0x200D or 0x00B7 or 0x0387 or (>= 0x1369 and <= 0x1371) or 0x19DA or 0x30FB or 0xFF65
            || (cp is < 0xD800 or > 0xDFFF && CharUnicodeInfo.GetUnicodeCategory(cp) is UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark
                or UnicodeCategory.DecimalDigitNumber or UnicodeCategory.ConnectorPunctuation);
    }

    /* ── permissions, files ─────────────────────────────────────────── */

    /// <summary>
    /// Claude Code's permission-rule syntax: <c>Tool(pattern)</c>. An entry that already is one stays; a bare path becomes
    /// both <c>Read(path)</c> and <c>Edit(path)</c>. A directory is one that ends in <c>/</c> — it gets <c>/**</c> so
    /// everything under it is covered; a path without the slash is taken as a file (<c>id_rsa</c>, <c>.env</c>), because
    /// guessing "directory" from a missing extension would turn the most important entries into rules that match nothing.
    /// </summary>
    private static List<string> DenyRules(IEnumerable<string> entries)
    {
        List<string> rules = [];
        void Add(string r)
        {
            if (!rules.Contains(r)) rules.Add(r);
        }
        foreach (var raw in entries)
        {
            var e = Trim(raw);
            if (e.Length == 0) continue;
            if (PermissionRule().IsMatch(e))
            {
                Add(e);
                continue;
            }
            var p = LeadingDotSlash().Replace(e.Replace('\\', '/'), "");
            if (p.EndsWith('/'))
            {
                p = TrailingSlashes().Replace(p, "");
                if (!GlobChars().IsMatch(p)) p = $"{p}/**";
            }
            if (p.Length == 0) continue;
            Add($"Read({p})");
            Add($"Edit({p})");
        }
        return rules;
    }

    /// <summary><c>.gitattributes</c>: a directory (trailing slash, or a last segment without an extension) gets <c>/**</c>; a file is named as it is.</summary>
    private static string GitattributesLine(string raw)
    {
        var p = TrailingSlashes().Replace(LeadingDotSlash().Replace(raw.Replace('\\', '/'), ""), "");
        var last = p.Split('/')[^1];
        var dir = raw.EndsWith('/') || !FileExtension().IsMatch(last);
        return $"{p}{(dir ? "/**" : "")} linguist-generated=true -diff";
    }

    /// <summary>The "Build, test, lint" facts: fenced blocks for AGENTS.md, bullet lines for a section appended to an existing file.</summary>
    private static string CommandsSection(RepoFacts repo, bool fenced)
    {
        (string Label, string Cmd)[] rows = [("Build", Command(repo.BuildCommand)), ("Test", Command(repo.TestCommand)), ("Lint", Command(repo.LintCommand))];
        var parts = rows.Select(r => r.Cmd.Length == 0
            ? (fenced ? $"{r.Label}: not available here." : $"- {r.Label}: not available here")
            : (fenced ? $"{r.Label}:\n\n```sh\n{r.Cmd}\n```" : $"- {r.Label}: {Code(r.Cmd)}")).ToList();
        if (repo.WindowsOnly)
        {
            parts.Add(fenced
                ? "The build runs only on a Windows runner (msbuild, Visual Studio build tools). From anywhere else, say so — never claim a build or a test run."
                : "- The build runs only on a Windows runner (msbuild); from anywhere else say so — never claim a build or a test run");
        }
        return string.Join(fenced ? "\n\n" : "\n", parts);
    }

    private sealed record FirstTest(Regex Match, string File, string Template, string Note);

    private static readonly FirstTest[] FirstTests =
    [
        new(FirstTestNode(), "tests/smoke.test.mjs", "tests/smoke.test.mjs", "run: node --test tests/ — Node's built-in runner, no dependency; move the test into the repository's own runner (vitest, jest) once there is one"),
        new(FirstTestPython(), "tests/test_smoke.py", "tests/test_smoke.py", "run: python -m pytest tests/ — a plain assert, so any runner can take it"),
        new(FirstTestGo(), "smoke_test.go", "tests/smoke_test.go", "package name unknown (go.mod was not read): the file says `package main` — rename it to the package of the folder it lands in"),
        new(FirstTestCSharp(), "Tests/Smoke/SmokeTests.cs", "tests/SmokeTests.cs", "needs a test project: `dotnet new mstest -o Tests/Smoke`, put the file in it and add the project to the solution"),
        new(FirstTestJava(), "src/test/java/SmokeTest.java", "tests/SmokeTest.java", "JUnit 5: junit-jupiter must be on the test classpath (test scope in pom.xml, or testImplementation + useJUnitPlatform() in Gradle)"),
    ];

    private static readonly OrderedDictionary<string, string> DocTitles = new(StringComparer.Ordinal)
    {
        ["architecture"] = "Architecture",
        ["integrations"] = "Integrations and external systems",
        ["build-and-run"] = "Build and run",
        ["glossary"] = "Glossary",
    };

    private const int PerPackageCap = 12;

    /* ── skills, agents ─────────────────────────────────────────────── */

    private CatalogFile SkillFile(string name, Dictionary<string, string> values) =>
        new($".claude/skills/{name}/SKILL.md", Fill(Text($"skills/{name}.md"), values));

    private CatalogFile AgentFile(string name, string templateName, Dictionary<string, string> values) =>
        new($".claude/agents/{name}.md", Fill(Text($"agents/{templateName}.md"), values));

    private CatalogFile ReviewMd(string agent) => new("REVIEW.md", Fill(Text("docs/REVIEW.md"), new() { ["agent"] = agent }));

    private const string ChecklistNote = "fill {{CHECKLIST}} from the history: what broke there before, what every change must keep — one line each";

    /// <summary>How to run one test file with the framework the diagnosis named.</summary>
    private static string NarrowHint(string cmd, IEnumerable<string> frameworks)
    {
        var f = JsLower(string.Join(" ", frameworks));
        bool Has(params string[] words) => words.Any(w => f.Contains(w, StringComparison.Ordinal));
        if (Has("vitest", "jest", "mocha", "node:test", "ava")) return $"pass the test file's path: {Code($"{cmd} <path/to/file.test.*>")}";
        if (Has("pytest")) return "`pytest <path/to/test_file.py>` (or `-k <name>`)";
        if (GoWord().IsMatch(f)) return "`go test ./<package>/...`";
        if (Has("xunit", "nunit", "mstest", "dotnet")) return "`dotnet test --filter \"FullyQualifiedName~<TestClass>\"`";
        if (Has("phpunit")) return "`phpunit --filter <TestClass>`";
        if (Has("junit", "gradle", "maven")) return "`./gradlew test --tests <Class>` or `./mvnw -Dtest=<Class> test`";
        if (Has("cargo", "rust")) return "`cargo test <name>`";
        if (Has("playwright", "cypress")) return "pass the spec file's path to the runner";
        return "pass the test file's path to the command when the runner accepts one; otherwise run the whole suite";
    }

    private static readonly Dictionary<string, string> LanguageNotes = new(StringComparer.Ordinal)
    {
        ["php"] = "**PHP** — `$_GET` / `$_POST` / `$_REQUEST` echoed, or concatenated into a query (`mysqli_query`, `->query`, `exec`); `include` / `require` with a variable path; `unserialize` on input; `htmlspecialchars` missing in a template; `move_uploaded_file` to a path from input.",
        ["javascript"] = "**JavaScript** — `innerHTML`, `document.write`, `dangerouslySetInnerHTML`, `eval` / `new Function`; `child_process.exec` with a string built from input; `path.join` on a request value without `path.resolve` and a prefix check; a redirect to a URL from input; prototype pollution through deep merges of request bodies.",
        ["typescript"] = "**TypeScript** — as JavaScript: `innerHTML`, `dangerouslySetInnerHTML`, `eval`; `child_process.exec` with input; `path.join` on a request value without a prefix check; a redirect to a URL from input; `as any` around request data that skips validation.",
        ["python"] = "**Python** — `subprocess` with `shell=True` and input; f-strings or `%` in SQL; `pickle.loads`, `yaml.load` without `SafeLoader`; `open()` on a path from input; Jinja `|safe` / `Markup` on data; `eval` / `exec`.",
        ["c#"] = "**C#** — `SqlCommand` text built by concatenation or interpolation; `Html.Raw` on data; `BinaryFormatter` / `TypeNameHandling.All`; `Path.Combine` with a request value; `[ValidateAntiForgeryToken]` missing on a POST action; `Process.Start` with input.",
        ["java"] = "**Java** — `Statement` with concatenated SQL instead of `PreparedStatement`; `Runtime.exec` / `ProcessBuilder` with input; an XML parser without external entities disabled (XXE); `ObjectInputStream` on data; `th:utext` or a JSP scriptlet on data; `new File(base, input)` without a canonical-path check.",
        ["kotlin"] = "**Kotlin** — as Java (`PreparedStatement`, `ProcessBuilder`, XXE, deserialisation); on Android, `WebView.loadUrl` / `addJavascriptInterface` with data and exported components that trust an intent's extras.",
        ["go"] = "**Go** — `fmt.Sprintf` into `db.Query` instead of placeholders; `exec.Command(\"sh\", \"-c\", ...)` with input; `text/template` where `html/template` is needed; `filepath.Join` on input without `filepath.Clean` and a prefix check; `http.Get` on a URL from input.",
        ["rust"] = "**Rust** — `Command::new(\"sh\").arg(\"-c\")` with input; `format!` into SQL; `unsafe` blocks that trust an input length; path joins without canonicalisation.",
        ["ruby"] = "**Ruby** — string interpolation in `where` / `find_by_sql`; `system` / backticks with input; `Marshal.load` / `YAML.load` on data; `raw` / `html_safe` on data; `send` with a method name from input.",
    };

    /* ── the catalog ────────────────────────────────────────────────── */

    private static readonly OrderedDictionary<string, Template> Table = new(StringComparer.Ordinal)
    {
        /* hooks */
        ["block-paths"] = new("hook", [$"{HookDir}/block-paths.mjs", "settings.hooks.PreToolUse"], (c, p, _) =>
        {
            var paths = Strs(p, "paths");
            var reason = Or(Str(p, "reason"), "this path must not be edited by hand");
            var first = paths.Count > 0 ? paths[0] : "<path>";
            List<string> notes = [VerifyHook("block-paths", $$"""{"tool_name":"Edit","tool_input":{"file_path":"<a file under {{first}}>"},"cwd":"<repo>"}""", "exit 2 with the reason; a file elsewhere exits 0")];
            if (paths.Count == 0) notes.Add("no paths given: the hook blocks nothing");
            return new([c.HookFile("block-paths", new() { ["paths"] = Arr(paths), ["reason"] = reason })], Hooks("PreToolUse", HookEntry("block-paths", FileTools)), null, notes);
        }),
        ["block-commands"] = new("hook", [$"{HookDir}/block-commands.mjs", "settings.hooks.PreToolUse"], (c, p, _) =>
        {
            var patterns = Strs(p, "patterns");
            var reason = Or(Str(p, "reason"), "this command is a person's decision");
            var first = patterns.Count > 0 ? patterns[0] : "<pattern>";
            List<string> notes = [VerifyHook("block-commands", $$$"""{"tool_name":"Bash","tool_input":{"command":"{{{first}}}"}}""", "exit 2 with the reason; another command exits 0")];
            if (patterns.Count == 0) notes.Add("no patterns given: the hook blocks nothing");
            return new([c.HookFile("block-commands", new() { ["patterns"] = Arr(patterns), ["reason"] = reason })], Hooks("PreToolUse", HookEntry("block-commands", "Bash")), null, notes);
        }),
        ["secret-scan"] = new("hook", [$"{HookDir}/secret-scan.mjs", "settings.hooks.PreToolUse"], (c, p, _) =>
        {
            var allowTests = IsTrue(p["allowTests"]);
            return new(
                [c.HookFile("secret-scan", new() { ["allowTests"] = allowTests })],
                Hooks("PreToolUse", HookEntry("secret-scan", FileTools), HookEntry("secret-scan", "Bash")),
                null,
                [
                    VerifyHook("secret-scan", """{"tool_name":"Write","tool_input":{"file_path":"config.ts","content":"Password=Sup3rSecret123;"}}""", "exit 2, the value masked as ***"),
                    allowTests
                        ? "test files (tests/, __tests__/, spec/, fixtures/, testdata/, *.test.*, *.spec.*) are not scanned: their credentials are fixtures"
                        : "test files are scanned too; use allowTests when fixtures hold fake credentials on purpose",
                    "on `git commit` the staged diff is scanned (and the working tree for `commit -a`)",
                ]);
        }),
        ["build-gate"] = new("hook", [$"{HookDir}/build-gate.mjs", "settings.hooks.Stop"], (c, p, repo) =>
        {
            var cmd = Or(Command(Str(p, "command")), Command(repo.BuildCommand));
            List<string> notes = [VerifyHook("build-gate", """{"cwd":"<repo>"}""", "exit 2 with the build's last lines when it fails, 0 when it passes; with stop_hook_active:true always 0")];
            if (cmd.Length == 0) notes.Add("no build command known: the hook exits 0 and prints nothing — fill CONFIG.command when one is known");
            if (repo.WindowsOnly) notes.Add("Windows-only build: the hook only helps on a Windows machine; elsewhere the command fails and Claude is told so on every turn — consider not installing it");
            return new([c.HookFile("build-gate", new() { ["command"] = cmd })], Hooks("Stop", HookEntry("build-gate", null, 660)), null, notes);
        }),
        ["post-format"] = new("hook", [$"{HookDir}/post-format.mjs", "settings.hooks.PostToolUse"], (c, p, _) =>
        {
            var formatter = Str(p, "formatter");
            var (known, spec) = FormatterFor(formatter);
            if (known && spec is null) return new([], null, null, [$"skipped: {formatter} has no per-file command (it runs through the build, e.g. ./gradlew spotlessApply) — no hook written"]);
            List<string> notes =
            [
                spec is null
                    ? $"no command known for {Or(formatter, "(no formatter named)")} — the hook does nothing (exits 0); put the formatter's command into CONFIG.command by hand, or drop the hook"
                    : $"verify: edit a {(spec.Extensions.Length > 0 ? spec.Extensions[0] : "")} file through Claude and see {string.Join(" ", spec.Command)} run on it; the hook never blocks",
            ];
            var config = spec is null
                ? new JsonObject { ["formatter"] = formatter, ["command"] = null, ["extensions"] = new JsonArray() }
                : new JsonObject { ["formatter"] = formatter, ["command"] = Arr(spec.Command), ["extensions"] = Arr(spec.Extensions) };
            return new([c.HookFile("post-format", config)], Hooks("PostToolUse", HookEntry("post-format", FileTools, 90)), null, notes);
        }),
        ["post-validate"] = new("hook", [$"{HookDir}/post-validate.mjs", "settings.hooks.PostToolUse"], (c, p, _) =>
        {
            var match = Str(p, "match");
            var cmd = Command(Str(p, "command"));
            List<string> notes = [VerifyHook("post-validate", """{"tool_name":"Write","tool_input":{"file_path":"<a matching file>"},"cwd":"<repo>"}""", "exit 2 with the validator's output when it fails, 0 otherwise")];
            if (match.Length == 0 || cmd.Length == 0) notes.Add("match or command missing: the hook does nothing");
            if (!IsRegex(match)) notes.Add($"match is not a valid regular expression: {match}");
            return new([c.HookFile("post-validate", new() { ["match"] = match, ["command"] = cmd })], Hooks("PostToolUse", HookEntry("post-validate", FileTools, 150)), null, notes);
        }),

        /* permissions, files */
        ["deny"] = new("permission", ["settings.permissions.deny"], (_, p, _) =>
        {
            var deny = DenyRules(Strs(p, "deny"));
            return new([], new JsonObject { ["permissions"] = new JsonObject { ["deny"] = Arr(deny) } }, null,
                deny.Count > 0 ? ["verify: `claude` in the repository, then /permissions shows the rules under Deny"] : ["no entries given: nothing to deny"]);
        }),
        ["gitignore"] = new("gitignore", [".gitignore (fragment)"], (_, p, _) =>
        {
            var entries = Strs(p, "entries");
            List<string> notes = ["merge: append the lines .gitignore does not already have, under the header — never replace the file"];
            if (entries.Count == 0) notes.Add("no entries given");
            return new([new(".gitignore", $"# added by DCC onboarding\n{string.Join("\n", entries)}\n")], null, null, notes);
        }),
        ["gitattributes"] = new("gitattributes", [".gitattributes (fragment)"], (_, p, _) =>
        {
            var paths = Strs(p, "paths");
            List<string> notes = ["merge: append the lines .gitattributes does not already have — never replace the file"];
            if (paths.Count == 0) notes.Add("no paths given");
            return new([new(".gitattributes", $"# added by DCC onboarding: generated code, folded in diffs and reviews\n{string.Join("\n", paths.Select(GitattributesLine))}\n")], null, null, notes);
        }),
        ["local-gate"] = new("script", ["scripts/dcc-verify.mjs"], (c, p, repo) =>
        {
            var build = Or(Command(Str(p, "build")), Command(repo.BuildCommand));
            var test = Or(Command(Str(p, "test")), Command(repo.TestCommand));
            List<string> notes =
            [
                "add \"verify\": \"node scripts/dcc-verify.mjs\" to package.json scripts when the repository has a package.json",
                "verify: node scripts/dcc-verify.mjs — the last line is the verdict (VERIFY: ok | failed <step> | nothing to run | cannot run here)",
            ];
            if (build.Length == 0 && test.Length == 0) notes.Add("no build or test command known: the script prints VERIFY: nothing to run — fill CONFIG in the script when one is known");
            if (repo.WindowsOnly) notes.Add("Windows-only build: off Windows the script prints VERIFY: cannot run here (Windows-only build) and exits 3");
            var script = c.Bake("scripts/dcc-verify.mjs", new() { ["build"] = build, ["test"] = test, ["windowsOnly"] = repo.WindowsOnly });
            return new([new("scripts/dcc-verify.mjs", script, ExecutableMode)], null, null, notes);
        }),
        ["first-test"] = new("scaffold", [.. FirstTests.Select(t => t.File)], (c, p, repo) =>
        {
            var given = Strs(p, "languages");
            IReadOnlyList<string> languages = given.Count > 0 ? given : repo.Languages;
            foreach (var language in languages)
            {
                var t = FirstTests.FirstOrDefault(x => x.Match.IsMatch(language));
                if (t is not null) return new([new(t.File, c.Text(t.Template))], null, null, [$"{language}: {t.Note}", "verify: run it in the isolated copy when a runner exists; a test that cannot run is text"]);
            }
            var rest = languages.Skip(1).ToList();
            return new([], null, null, [$"no first-test template for {(languages.Count > 0 ? languages[0] : "(no language)")}{(rest.Count > 0 ? $" (nor for {string.Join(", ", rest)})" : "")}"]);
        }),
        ["agents-md"] = new("scaffold", ["AGENTS.md", "CLAUDE.md"], (c, p, repo) =>
        {
            var mergeFrom = Strs(p, "mergeFrom");
            string[] factLines =
            [
                repo.Languages.Count > 0 ? $"Languages: {string.Join(", ", repo.Languages)}." : "",
                !string.IsNullOrEmpty(repo.PackageManager) ? $"Package manager: {repo.PackageManager}." : "",
                !string.IsNullOrEmpty(repo.DefaultBranch) ? $"Default branch: {Code(repo.DefaultBranch)}." : "",
            ];
            var facts = string.Join(" ", factLines.Where(x => x.Length > 0));
            var merged = mergeFrom.Count > 0
                ? $"\n## Merged from\n\nThe files below were merged into this one; where they repeat or contradict the sections above, the sections above win.\n\n{Bullets(mergeFrom)}\n"
                : "";
            var content = Fill(c.Text("docs/AGENTS.md"), new() { ["name"] = repo.Name, ["facts"] = facts.Length > 0 ? $"\n_{facts}_\n" : "", ["commands"] = CommandsSection(repo, true), ["merged"] = merged });
            List<string> notes =
            [
                "fill {{PURPOSE}}, {{LAYOUT}}, {{EXTERNAL}}, {{VERIFICATION}} from the diagnosis, and {{RULES}} with one bullet per approved rule line; keep the whole file under 150 lines",
                "CLAUDE.md (the one line @AGENTS.md) is for a repository that has no CLAUDE.md — never overwrite an existing one",
            ];
            if (mergeFrom.Count > 0) notes.Add($"merge the content of {string.Join(", ", mergeFrom)} into the matching sections and keep the list under ## Merged from");
            return new([new("AGENTS.md", content), new("CLAUDE.md", "@AGENTS.md\n")], null, null, notes);
        }),
        ["agents-md-delta"] = new("doc", ["AGENTS.md (a section to append)"], (c, p, repo) =>
        {
            var existing = Strs(p, "existing");
            var date = Or(Str(p, "date"), DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            var content = Fill(c.Text("docs/AGENTS-delta.md"), new() { ["date"] = date, ["commands"] = CommandsSection(repo, false) });
            var target = existing.Count > 0 ? string.Join(" / ", existing) : "the existing AGENTS.md or CLAUDE.md";
            return new([new("AGENTS.md", content)], null, null, [$"append: add this section to the end of {target} — never replace the file", "fill {{RULES}}: one bullet per approved rule line"]);
        }),
        ["per-package"] = new("scaffold", ["<package>/CLAUDE.md"], (c, p, _) =>
        {
            var packages = Strs(p, "packages");
            List<CatalogFile> files = [.. packages.Take(PerPackageCap).Select(dir => new CatalogFile($"{TrailingSlashes().Replace(dir, "")}/CLAUDE.md", Fill(c.Text("docs/package-CLAUDE.md"), new() { ["dir"] = dir })))];
            List<string> notes = ["fill {{PACKAGE_COMMANDS}} in each file with the package's own build and test commands, read from its manifest"];
            if (packages.Count > PerPackageCap) notes.Add($"capped: {PerPackageCap} of {packages.Count} packages got a file; left out: {string.Join(", ", packages.Skip(PerPackageCap))}");
            if (packages.Count == 0) notes.Add("no packages given — nothing written");
            return new(files, null, null, notes);
        }),
        ["per-area"] = new("scaffold", ["<area>/CLAUDE.md"], (c, p, _) =>
        {
            List<CatalogFile> files = [];
            foreach (var a in Objects(p, "areas"))
            {
                var dir = TrailingSlashes().Replace(Str(a, "dir"), "");
                if (dir.Length == 0) continue;
                var values = new Dictionary<string, string> { ["dir"] = dir, ["toolchain"] = Or(Str(a, "toolchain"), "its own"), ["command"] = Or(Str(a, "command"), "<the build command>") };
                files.Add(new($"{dir}/CLAUDE.md", Fill(c.Text("docs/area-CLAUDE.md"), values)));
            }
            return new(files, null, null, files.Count > 0 ? ["verify: each command runs from its own folder"] : ["no areas given — nothing written"]);
        }),
        ["docs-set"] = new("doc", [.. DocTitles.Keys.Select(d => $"docs/{d}.md")], (c, p, _) =>
        {
            List<CatalogFile> files = [];
            List<string> notes = [];
            foreach (var d in Strs(p, "docs"))
            {
                if (!DocTitles.TryGetValue(d, out var title))
                {
                    notes.Add($"unknown doc \"{d}\" — skipped (known: {string.Join(", ", DocTitles.Keys)})");
                    continue;
                }
                files.Add(new($"docs/{d}.md", Fill(c.Text("docs/doc-skeleton.md"), new() { ["title"] = title })));
            }
            notes.Add(files.Count > 0 ? "fill {{BODY}} of each from the diagnosis; cite files that exist" : "no known doc names given — nothing written");
            return new(files, null, null, notes);
        }),
        ["hot-dir-doc"] = new("doc", ["docs/architecture-<dir>.md"], (c, p, _) =>
        {
            var dir = Or(Str(p, "dir"), ".");
            var content = Fill(c.Text("docs/hot-dir.md"), new() { ["dir"] = dir, ["changes"] = Or(Str(p, "changes"), "many"), ["authors"] = Or(Str(p, "authors"), "several") });
            return new([new($"docs/architecture-{Slug(dir)}.md", content)], null, null,
                ["fill {{BODY}}: what is in the directory, what depends on what, what broke here before (from the history); cite files that exist"]);
        }),

        /* skills */
        ["run-affected-tests"] = new("skill", [".claude/skills/run-affected-tests/SKILL.md"], (c, p, repo) =>
        {
            var cmd = Or(Or(Command(Str(p, "command")), Command(repo.TestCommand)), "<the test command>");
            var dirs = Strs(p, "dirs");
            var frameworks = Strs(p, "frameworks");
            var values = new Dictionary<string, string>
            {
                ["command"] = cmd,
                ["dirs"] = dirs.Count > 0 ? string.Join(", ", dirs.Select(Code)) : "next to the code they test",
                ["frameworks"] = Or(YamlSafe(string.Join(", ", frameworks)), "the framework the manifest names"),
                ["narrow"] = NarrowHint(cmd, frameworks),
            };
            return new([c.SkillFile("run-affected-tests", values)], null, null,
                cmd.StartsWith('<') ? ["no test command known: replace <the test command> in the skill"] : ["verify: ask Claude to run the tests and see it use the command"]);
        }),
        ["verify-like-ci"] = new("skill", [".claude/skills/verify-like-ci/SKILL.md"], (c, p, _) =>
        {
            var commands = Strs(p, "commands");
            var systems = Strs(p, "systems");
            var block = commands.Count > 0
                ? string.Join("\n", commands.Select((x, i) => $"# {i + 1}\n{x}"))
                : "# the workflow files name no commands DCC could read — open them and list the steps here";
            return new([c.SkillFile("verify-like-ci", new() { ["systems"] = Or(YamlSafe(string.Join(", ", systems)), "CI"), ["commands"] = block })], null, null,
                commands.Count > 0 ? ["verify: the commands are the workflow files' own, in their order"] : ["no CI commands given: the skill asks to list them from the workflow files"]);
        }),
        ["which-package"] = new("skill", [".claude/skills/which-package/SKILL.md"], (c, p, _) =>
        {
            var packages = Strs(p, "packages");
            var workspaces = Or(YamlSafe(Str(p, "workspaces")), "workspace");
            var list = packages.Count > 0 ? Bullets(packages) : "- (the package list was empty — list the packages here)";
            return new([c.SkillFile("which-package", new() { ["workspaces"] = workspaces, ["packages"] = list })], null, null,
                ["verify: ask 'where do I add X' and see the skill name a package before any search"]);
        }),
        ["change-recipe"] = new("skill", [".claude/skills/change-recipe/SKILL.md"], (c, p, _) =>
        {
            var shapes = Objects(p, "shapes").Select(s => (Files: Strs(s, "files"), Times: NumberOrZero(s["times"]))).Where(s => s.Files.Count > 0).ToList();
            var recipes = shapes.Count > 0
                ? string.Join("\n\n", shapes.Select((s, i) =>
                    $"## Recipe {i + 1} — these {s.Files.Count} files changed together {JsNumber(s.Times)} times\n\n{string.Join("\n", s.Files.Select((f, j) => $"{j + 1}. {Code(f)}"))}"))
                : "No recipe: the history showed no set of files that changes together often enough.";
            return new([c.SkillFile("change-recipe", new() { ["recipes"] = recipes })], null, null,
                shapes.Count > 0 ? [$"{shapes.Count} recipe(s) from the history"] : ["no shapes given: the skill says so and applies to nothing"]);
        }),
        ["build-on-runner"] = new("skill", [".claude/skills/build-on-runner/SKILL.md"], (c, p, _) =>
            new([c.SkillFile("build-on-runner", new() { ["solution"] = Or(YamlSafe(Str(p, "solution")), "the solution") })], null, null,
                ["fill {{RUNNER}} with how the team reaches its Windows runner (a command, a pipeline, a URL), or the words 'none configured' — the skill then stops and says so instead of claiming a build"])),
        ["terraform-docs"] = new("skill", [".claude/skills/terraform-docs/SKILL.md"], (c, _, _) =>
            new([c.SkillFile("terraform-docs", [])], null, null, ["verify: change a variable description and see the README table regenerated, not hand-edited"])),
        ["docs-sync"] = new("skill", [".claude/skills/docs-sync/SKILL.md"], (c, p, _) =>
            new([c.SkillFile("docs-sync", new() { ["pointer"] = Or(YamlSafe(Str(p, "pointer")), "README.md") })], null, null,
                ["verify: a change in a documented area ends with the document updated or 'docs: nothing to change'"])),
        ["emulator-free-verify"] = new("skill", [".claude/skills/emulator-free-verify/SKILL.md"], (c, p, _) =>
        {
            var raw = Str(p, "screenshot");
            var screenshot = raw.Length == 0 || raw.StartsWith("none", StringComparison.OrdinalIgnoreCase) ? "" : YamlSafe(raw);
            var values = new Dictionary<string, string>
            {
                ["screenshot"] = Or(screenshot, "none found"),
                ["screenshot_steps"] = screenshot.Length > 0
                    ? $"run the {screenshot} verify task for the changed screens; a new screen needs a recorded baseline, which a person captures on a device."
                    : "none were found in the repository, so there is no baseline to compare against — say so, and list the screens a person must look at on a device.",
            };
            return new([c.SkillFile("emulator-free-verify", values)], null, null, ["verify: a UI change ends with the three lists (verified / not verifiable here / assumptions)"]);
        }),
        ["contribution-style"] = new("skill", [".claude/skills/contribution-style/SKILL.md"], (c, p, _) =>
        {
            var contributing = Strs(p, "contributing");
            List<string> list = contributing.Count > 0 ? contributing : ["CONTRIBUTING.md"];
            var values = new Dictionary<string, string> { ["contributing"] = YamlSafe(string.Join(", ", list)), ["contributing_list"] = string.Join(", ", list.Select(Code)) };
            return new([c.SkillFile("contribution-style", values)], null, null, ["verify: a pull request ends with the list of rules followed and departures"]);
        }),

        /* agents */
        ["scoped-reviewer"] = new("agent", [".claude/agents/reviewer-<dir>.md", "REVIEW.md (withReviewMd)"], (c, p, repo) =>
        {
            var dir = Or(Str(p, "dir"), ".");
            var name = $"reviewer-{Slug(dir)}";
            var values = new Dictionary<string, string>
            {
                ["slug"] = Slug(dir),
                ["dir"] = YamlSafe(dir),
                ["changes"] = Or(Str(p, "changes"), "many"),
                ["authors"] = Or(Str(p, "authors"), "several"),
                ["name"] = YamlSafe(repo.Name),
            };
            List<CatalogFile> files = [c.AgentFile(name, "scoped-reviewer", values)];
            if (IsTrue(p["withReviewMd"])) files.Add(c.ReviewMd(name));
            return new(files, null, null, [ChecklistNote, "verify: run the reviewer on a change that plants a known bug under the directory and see it in the findings"]);
        }),
        ["security-reviewer"] = new("agent", [".claude/agents/security-reviewer.md"], (c, p, repo) =>
        {
            var given = Strs(p, "languages");
            IReadOnlyList<string> languages = given.Count > 0 ? given : repo.Languages;
            var languageNotes = languages
                .Select(l => LanguageNotes.TryGetValue(JsLower(l), out var note) ? note : $"**{l}** — the checklist above applies; the catalog has no language-specific notes for it yet.")
                .ToList();
            var values = new Dictionary<string, string>
            {
                ["name"] = YamlSafe(repo.Name),
                ["languages"] = Or(YamlSafe(string.Join(", ", languages)), "this stack"),
                ["language_notes"] = languageNotes.Count > 0 ? string.Join("\n", languageNotes.Select(n => $"- {n}")) : "- The checklist above applies.",
            };
            return new([c.AgentFile("security-reviewer", "security-reviewer", values)], null, null, ["verify: run it on a change with a string-built query and see the finding"]);
        }),
        ["reviewer"] = new("agent", [".claude/agents/reviewer.md", "REVIEW.md"], (c, _, repo) =>
            new([c.AgentFile("reviewer", "reviewer", new() { ["name"] = YamlSafe(repo.Name) }), c.ReviewMd("reviewer")], null, null,
                [ChecklistNote, "verify: run the reviewer on a change that plants a known bug and see it in the findings"])),

        /* other */
        ["pr-template"] = new("pr_template", [".github/pull_request_template.md"], (c, _, _) =>
            new([new(".github/pull_request_template.md", c.Text("docs/pull_request_template.md"))], null, null,
                ["skip when the repository already has a pull request template (.github/pull_request_template.md or .github/PULL_REQUEST_TEMPLATE/)"])),
        ["mcp"] = new("mcp", [".mcp.json (an mcpServers entry)", "notes: the ## MCP rule line"], (_, p, _) =>
        {
            var server = Or(Str(p, "server"), "server");
            var url = Str(p, "url");
            var cmd = Str(p, "command");
            var args = Strs(p, "args");
            var tools = Strs(p, "tools");
            var readOnly = IsTrue(p["readOnly"]);
            var spec = url.Length > 0
                ? new JsonObject { ["type"] = "http", ["url"] = url }
                : new JsonObject { ["command"] = Or(cmd, "<command>"), ["args"] = Arr(args) };
            if (url.Length == 0 && p["env"] is JsonObject env)
                spec["env"] = new JsonObject(env.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)JsonValue.Create(IsNull(kv.Value) ? "" : JsString(kv.Value)))));
            var rule = $"MCP {Code(server)}: use only these tools: {(tools.Count > 0 ? string.Join(", ", tools) : "(list the tools)")}{(readOnly ? "; it is read-only — never write through it" : "")}.";
            List<string> notes =
            [
                $"rule: {rule}",
                $"keep only these tools: {(tools.Count > 0 ? string.Join(", ", tools) : "(none listed)")} — Claude Code does not filter tools in .mcp.json; the rule line above, under ## MCP in AGENTS.md, is what limits them",
            ];
            if (url.Length == 0 && cmd.Length == 0) notes.Add("no url and no command given — fill `command` in .mcp.json before use");
            if (Placeholder().IsMatch(url)) notes.Add($"the url has a placeholder to fill from the client: {url}");
            var needs = Strs(p, "needs");
            if (needs.Count > 0) notes.Add($"needs from the client: {string.Join(", ", needs)}");
            var onlyIf = Str(p, "onlyIf");
            if (onlyIf.Length > 0) notes.Add($"only if: {onlyIf}");
            var kinds = Str(p, "kinds");
            if (kinds.Length > 0) notes.Add($"for: {kinds}");
            if (readOnly) notes.Add("read-only: run the server with a read-only credential; the rule line says so as well");
            return new([], null, new JsonObject { ["mcpServers"] = new JsonObject { [server] = spec } }, notes);
        }),
    };

    /* ── JSON.stringify(value, null, 2) ─────────────────────────────── */

    /// <summary>
    /// The baked config exactly as <c>JSON.stringify(value, null, 2)</c> wrote it: two-space indents, "\n", and only
    /// quotes, backslashes, control characters and lone surrogates escaped (lowercase hex) — System.Text.Json escapes
    /// more and indents with the platform's newline.
    /// </summary>
    private static string Stringify(JsonNode? node)
    {
        var sb = new StringBuilder();
        Write(sb, node, "");
        return sb.ToString();

        static void Write(StringBuilder sb, JsonNode? node, string indent)
        {
            var inner = indent + "  ";
            switch (node)
            {
                case JsonObject o when o.Count > 0:
                    sb.Append('{');
                    var firstKey = true;
                    foreach (var (k, v) in o)
                    {
                        sb.Append(firstKey ? "\n" : ",\n").Append(inner);
                        firstKey = false;
                        Quote(sb, k);
                        sb.Append(": ");
                        Write(sb, v, inner);
                    }
                    sb.Append('\n').Append(indent).Append('}');
                    break;
                case JsonObject:
                    sb.Append("{}");
                    break;
                case JsonArray a when a.Count > 0:
                    sb.Append('[');
                    for (var i = 0; i < a.Count; i++)
                    {
                        sb.Append(i == 0 ? "\n" : ",\n").Append(inner);
                        Write(sb, a[i], inner);
                    }
                    sb.Append('\n').Append(indent).Append(']');
                    break;
                case JsonArray:
                    sb.Append("[]");
                    break;
                case JsonValue v when v.GetValueKind() == JsonValueKind.String:
                    Quote(sb, JsString(v));
                    break;
                case JsonValue v when v.GetValueKind() == JsonValueKind.Number:
                    var d = double.Parse(v.ToJsonString(), CultureInfo.InvariantCulture);
                    sb.Append(double.IsFinite(d) ? JsNumber(d) : "null");
                    break;
                case JsonValue v when v.GetValueKind() is JsonValueKind.True or JsonValueKind.False:
                    sb.Append(v.GetValueKind() == JsonValueKind.True ? "true" : "false");
                    break;
                default:
                    sb.Append("null");
                    break;
            }
        }

        static void Quote(StringBuilder sb, string s)
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
    }

    /* ── patterns (JavaScript's: ASCII classes, "$" only at the very end, "." never across a line break) ── */

    [GeneratedRegex(@"\{\{([a-z][a-z0-9_]*)\}\}")]
    private static partial Regex Slot();

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NotSlug();

    [GeneratedRegex(@"^-+|-+\z")]
    private static partial Regex EdgeDashes();

    [GeneratedRegex(Ws + @"*[\r\n]+" + Ws + "*")]
    private static partial Regex YamlBreak();

    [GeneratedRegex(":" + Ws)]
    private static partial Regex YamlColon();

    [GeneratedRegex(Ws + "#")]
    private static partial Regex YamlHash();

    [GeneratedRegex(Ws + @"*\([^\n\r\u2028\u2029]*\z")]
    private static partial Regex FormatterTail();

    [GeneratedRegex(@"^[A-Z][A-Za-z]*\([^\n\r\u2028\u2029]*\)\z")]
    private static partial Regex PermissionRule();

    [GeneratedRegex(@"^(\./)+")]
    private static partial Regex LeadingDotSlash();

    [GeneratedRegex(@"/+\z")]
    private static partial Regex TrailingSlashes();

    [GeneratedRegex(@"[*?[\]]")]
    private static partial Regex GlobChars();

    [GeneratedRegex(@"\.[A-Za-z0-9]+\z")]
    private static partial Regex FileExtension();

    [GeneratedRegex(@"(?<![A-Za-z0-9_])go(?![A-Za-z0-9_])|testing")]
    private static partial Regex GoWord();

    [GeneratedRegex(@"\{[A-Za-z_]+\}")]
    private static partial Regex Placeholder();

    [GeneratedRegex(@"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\z")]
    private static partial Regex JsDecimal();

    [GeneratedRegex(@"^0([xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)\z")]
    private static partial Regex JsRadix();

    [GeneratedRegex(@"^(typescript|javascript|tsx|jsx|node(\.js)?)\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex FirstTestNode();

    [GeneratedRegex(@"^python\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex FirstTestPython();

    [GeneratedRegex(@"^(go|golang)\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex FirstTestGo();

    [GeneratedRegex(@"^(c#|csharp)\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex FirstTestCSharp();

    [GeneratedRegex(@"^java\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex FirstTestJava();
}
