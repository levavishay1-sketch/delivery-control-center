using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Dcc.Domain.Onboarding;

/// <summary>A ready-made component the open search found. <c>Kind</c>: plugin, mcp, skill or lsp. <c>Official</c> is the model's claim — the code grades trust itself.</summary>
public sealed record FoundSource
{
    [JsonPropertyName("kind")] public required string Kind { get; init; }
    [JsonPropertyName("name")] public required string Name { get; init; }
    [JsonPropertyName("url")] public required string Url { get; init; }
    [JsonPropertyName("publisher")] public string? Publisher { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("tags")] public IReadOnlyList<string> Tags { get; init; } = [];
    [JsonPropertyName("official")] public bool Official { get; init; }
    [JsonPropertyName("why")] public string Why { get; init; } = "";
    [JsonPropertyName("toolCount")] public int? ToolCount { get; init; }
    [JsonPropertyName("readOnly")] public bool? ReadOnly { get; init; }
    [JsonPropertyName("license")] public string? License { get; init; }
    [JsonPropertyName("lastActivity")] public string? LastActivity { get; init; }
}

/// <summary>How far a source is trusted, graded by the code — never by the model.</summary>
public static class SourceTrust
{
    /// <summary>The vendor or maintainer of the very thing it connects to, or Anthropic's own marketplace.</summary>
    public const string Official = "official";
    /// <summary>A well-known organisation with activity and a licence.</summary>
    public const string KnownCommunity = "known_community";
    /// <summary>Everything else: shown with a warning and never installed by itself.</summary>
    public const string Unverified = "unverified";
}

/// <summary>What the trust grading looked at — stored as <c>marketplace_source.trust_checks</c>, so the names are the old server's.</summary>
public sealed record TrustChecks
{
    [JsonPropertyName("publisherVerified")] public bool PublisherVerified { get; init; }
    [JsonPropertyName("officialMarketplace")] public bool OfficialMarketplace { get; init; }
    [JsonPropertyName("vendorNamespace")] public bool VendorNamespace { get; init; }
    [JsonPropertyName("hasLicense")] public bool HasLicense { get; init; }
    [JsonPropertyName("activeLastYear")] public bool? ActiveLastYear { get; init; }
    [JsonPropertyName("readOnlyMode")] public bool? ReadOnlyMode { get; init; }
    [JsonPropertyName("toolCount")] public int? ToolCount { get; init; }
    /// <summary>Tool descriptions were scanned for injections when the page listed them.</summary>
    [JsonPropertyName("descriptionsScanned")] public bool DescriptionsScanned { get; init; }
    [JsonPropertyName("suspicious")] public IReadOnlyList<string> Suspicious { get; init; } = [];

    /// <summary>The JSON stored in <c>trust_checks</c> (the weekly recheck adds <c>pageHash</c> and <c>license</c> to it).</summary>
    public JsonObject ToJson() => JsonSerializer.SerializeToNode(this)!.AsObject();
}

/// <summary>
/// A remembered source — a row of <c>marketplace_source</c> (org-shared, no client). Nothing here reads or writes the
/// table; the run engine does. <c>TrustChecks</c> stays JSON: what was stored is a partial <see cref="Onboarding.TrustChecks"/>
/// plus whatever the recheck added.
/// </summary>
public sealed record RememberedSource
{
    [JsonPropertyName("id")] public string Id { get; init; } = "";
    /// <summary>plugin, mcp, skill, lsp or marketplace.</summary>
    [JsonPropertyName("kind")] public string Kind { get; init; } = "";
    [JsonPropertyName("name")] public string Name { get; init; } = "";
    [JsonPropertyName("url")] public string Url { get; init; } = "";
    [JsonPropertyName("publisher")] public string? Publisher { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    /// <summary>Stack tags the source serves (<c>dotnet</c>, <c>dataverse</c>, <c>terraform</c>, …).</summary>
    [JsonPropertyName("tags")] public IReadOnlyList<string> Tags { get; init; } = [];
    [JsonPropertyName("trust")] public string Trust { get; init; } = SourceTrust.Unverified;
    [JsonPropertyName("trustChecks")] public JsonObject TrustChecks { get; init; } = [];
    [JsonPropertyName("toolCount")] public int? ToolCount { get; init; }
    [JsonPropertyName("contextTokens")] public int? ContextTokens { get; init; }
    /// <summary>model — the open search; catalog — the operator's list; person.</summary>
    [JsonPropertyName("foundBy")] public string FoundBy { get; init; } = "model";
    [JsonPropertyName("usedInRepos")] public int UsedInRepos { get; init; }
    [JsonPropertyName("firstSeenAt")] public DateTimeOffset? FirstSeenAt { get; init; }
    [JsonPropertyName("lastCheckedAt")] public DateTimeOffset? LastCheckedAt { get; init; }
    /// <summary>Set when a re-check found the source changed — the coach's "new in the world".</summary>
    [JsonPropertyName("changedAt")] public DateTimeOffset? ChangedAt { get; init; }
}

/// <summary>
/// The database-free half of the marketplace (marketplace-sources.ts): reading what the model found, grading trust in
/// code, and turning a source into a card. Ready-made components for a stack come from the open search (a model with
/// web search, keyed by the tags the diagnosis derived — never a fixed list of marketplaces); a source found for one
/// repository is remembered and offered to the next repository with the same stack, and re-checked weekly.
///
/// The patterns test an ASCII-lowercased copy instead of using <see cref="RegexOptions.IgnoreCase"/>: .NET folds the
/// Kelvin sign into "k" where JavaScript's <c>/i</c> does not, and a trust grade must not be won with a look-alike
/// letter. <c>.</c> and <c>\s</c> are spelled out as JavaScript defines them.
/// </summary>
public static partial class MarketplaceSources
{
    // ── reading what the model found ─────────────────────────────────────

    private static readonly string[] Kinds = ["plugin", "mcp", "skill", "lsp"];

    [GeneratedRegex("^https?://")] private static partial Regex HttpUrl();

    /// <summary>
    /// The sources in the model's answer: the outermost <c>{…}</c>, its <c>sources</c> array, each with a known kind and a
    /// real http(s) address, once per address, at most twelve. Anything unreadable is no sources, never an error.
    /// </summary>
    public static List<FoundSource> ParseSources(string raw)
    {
        var start = raw.IndexOf('{');
        var end = raw.LastIndexOf('}');
        if (start < 0 || end <= start) return [];
        JsonDocument doc;
        // Parsed from UTF-8 bytes: a lone surrogate in the model's text becomes U+FFFD there, where parsing the
        // characters directly would throw ArgumentException instead of reading the answer as JSON.parse does.
        try { doc = JsonDocument.Parse(Encoding.UTF8.GetBytes(raw, start, end - start + 1)); }
        catch (JsonException) { return []; }
        using (doc)
        {
            // JsonElement's lookup takes the LAST of a repeated property, as JSON.parse does.
            if (doc.RootElement.ValueKind != JsonValueKind.Object || !doc.RootElement.TryGetProperty("sources", out var sources) || sources.ValueKind != JsonValueKind.Array) return [];
            var output = new List<FoundSource>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var s in sources.EnumerateArray())
            {
                if (s.ValueKind != JsonValueKind.Object) continue;
                FoundSource found;
                try
                {
                    var url = Str(s, "url", 500);
                    var kind = s.TryGetProperty("kind", out var k) && k.ValueKind == JsonValueKind.String ? Kinds.FirstOrDefault(x => x == k.GetString()) : null;
                    if (kind is null || !HttpUrl().IsMatch(AsciiLower(url)) || seen.Contains(url)) continue;
                    found = new FoundSource
                    {
                        Kind = kind, Url = url, Name = NullIfEmpty(Str(s, "name", 120)) ?? url, Publisher = NullIfEmpty(Str(s, "publisher", 120)), Description = NullIfEmpty(Str(s, "description", 400)),
                        Tags = s.TryGetProperty("tags", out var tags) && tags.ValueKind == JsonValueKind.Array
                            ? tags.EnumerateArray().Select(t => JsLower(Str(t, 40))).Where(t => t.Length > 0).Take(10).ToList()
                            : [],
                        Official = s.TryGetProperty("official", out var o) && o.ValueKind == JsonValueKind.True, Why = Str(s, "why", 400),
                        ToolCount = s.TryGetProperty("toolCount", out var tc) && tc.ValueKind == JsonValueKind.Number ? WholeNumber(tc.GetDouble()) : null,
                        ReadOnly = s.TryGetProperty("readOnly", out var ro) && ro.ValueKind is JsonValueKind.True or JsonValueKind.False ? ro.GetBoolean() : null,
                        License = NullIfEmpty(Str(s, "license", 60)), LastActivity = NullIfEmpty(Str(s, "lastActivity", 10)),
                    };
                }
                catch (InvalidOperationException) { continue; } // defensive: a string .NET cannot read is that one source skipped (an escaped lone surrogate reads as U+FFFD, where JSON.parse kept it)
                seen.Add(found.Url);
                output.Add(found);
            }
            return output.Take(12).ToList();
        }
    }

    private static string Str(JsonElement owner, string name, int max) => owner.TryGetProperty(name, out var v) ? Str(v, max) : "";

    /// <summary>A string, trimmed and cut to <paramref name="max"/> UTF-16 units; anything else is "".</summary>
    private static string Str(JsonElement v, int max) => v.ValueKind == JsonValueKind.String ? Slice(JsTrim(v.GetString()!), max) : "";

    /// <summary>A tool count is a whole number — the column is an integer; a fraction or a huge number is no count.</summary>
    private static int? WholeNumber(double n) => n == Math.Floor(n) && n >= int.MinValue && n <= int.MaxValue ? (int)n : null;

    // ── the trust checks the code runs ───────────────────────────────────

    /// <summary>Publishers whose own components are trusted for what they publish — the vendors of the stacks the rules know, and Anthropic. Matched against the lowercased address.</summary>
    private static readonly (Regex Pattern, string[] Names)[] Vendors =
    [
        (Vendor(@"github\.com/anthropics/"), ["anthropic", "anthropics"]),
        (Vendor(@"github\.com/microsoft/"), ["microsoft"]),
        (Vendor(@"github\.com/(azure|azure-samples)/"), ["microsoft", "azure"]),
        (Vendor(@"github\.com/dotnet/"), ["microsoft", ".net", "dotnet"]),
        (Vendor(@"github\.com/hashicorp/"), ["hashicorp"]),
        (Vendor(@"github\.com/github/"), ["github"]),
        (Vendor(@"github\.com/atlassian/"), ["atlassian"]),
        (Vendor(@"github\.com/getsentry/"), ["sentry"]),
        (Vendor(@"github\.com/grafana/"), ["grafana"]),
        (Vendor(@"github\.com/docker/"), ["docker"]),
        (Vendor(@"github\.com/modelcontextprotocol/"), ["anthropic", "modelcontextprotocol"]),
        (Vendor(@"github\.com/(vercel|vercel-labs)/"), ["vercel"]),
        (Vendor(@"github\.com/supabase/"), ["supabase"]),
        (Vendor(@"github\.com/prisma/"), ["prisma"]),
        (Vendor(@"github\.com/stripe/"), ["stripe"]),
        (Vendor(@"github\.com/salesforce(cli)?/"), ["salesforce"]),
        (Vendor(@"github\.com/sap/"), ["sap"]),
        (Vendor(@"learn\.microsoft\.com/"), ["microsoft"]),
        (Vendor(@"registry\.modelcontextprotocol\.io/"), ["anthropic", "modelcontextprotocol"]),
        (Vendor(@"hub\.docker\.com/mcp/"), ["docker"]),
    ];

    private static Regex Vendor(string pattern) => new(pattern, RegexOptions.CultureInvariant);

    [GeneratedRegex(@"github\.com/anthropics/claude-plugins-official")] private static partial Regex OfficialMarketplace();

    /// <summary>Case-sensitive, as the old server had it: an owner and a repository on github.com.</summary>
    [GeneratedRegex(@"github\.com/[^/]+/[^/]+")] private static partial Regex GitHubRepository();

    /// <summary>
    /// Words in a tool description that read as an instruction to the agent rather than a description — the shape of a
    /// prompt injection. Tested on the ASCII-lowercased line; <c>.</c> stops at JavaScript's line terminators and
    /// <c>\s</c> is JavaScript's whitespace.
    /// </summary>
    [GeneratedRegex(@"(ignore (all|any|previous|prior) instructions|do not tell the user|before (using|calling) (this|any) tool,? (read|send|post)|exfiltrat|send [^\n\r\u2028\u2029]* to http|curl [^\n\r\u2028\u2029]* \| (sh|bash)|<[\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*system[\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*>|you must always|secretly)")]
    private static partial Regex Injection();

    /// <summary>
    /// Trust from the address, the publisher, the licence and the activity — and the page, when it was fetched: a tool
    /// description that reads as an instruction makes the source unverified whoever published it. <paramref name="now"/>
    /// is the clock ("active last year" is by the local calendar year); tests pass one.
    /// </summary>
    public static (string Trust, TrustChecks Checks) CheckTrust(FoundSource s, string? page, DateTimeOffset? now = null)
    {
        var url = AsciiLower(s.Url);
        var vendor = Vendors.FirstOrDefault(v => v.Pattern.IsMatch(url));
        var vendorNamespace = vendor.Pattern is not null;
        var publisher = JsLower(s.Publisher ?? "");
        var publisherVerified = vendorNamespace && (vendor.Names.Any(n => publisher.Contains(n, StringComparison.Ordinal)) || string.IsNullOrEmpty(s.Publisher));
        var officialMarketplace = OfficialMarketplace().IsMatch(url);
        var license = AsciiLower(s.License ?? "");
        var hasLicense = !string.IsNullOrEmpty(s.License) && !(license.Contains("none", StringComparison.Ordinal) || license.Contains("unknown", StringComparison.Ordinal) || license.Contains("proprietary", StringComparison.Ordinal));
        var year = !string.IsNullOrEmpty(s.LastActivity) ? JsNumber(Slice(s.LastActivity, 4)) : double.NaN;
        bool? activeLastYear = double.IsFinite(year) ? (now ?? DateTimeOffset.Now).Year - year <= 1 : null;
        var suspicious = new List<string>();
        if (!string.IsNullOrEmpty(page))
            foreach (var line in page.Split('\n'))
                if (Injection().IsMatch(AsciiLower(line))) suspicious.Add(Slice(JsTrim(line), 160));
        var checks = new TrustChecks
        {
            PublisherVerified = publisherVerified, OfficialMarketplace = officialMarketplace, VendorNamespace = vendorNamespace, HasLicense = hasLicense, ActiveLastYear = activeLastYear,
            ReadOnlyMode = s.ReadOnly, ToolCount = s.ToolCount, DescriptionsScanned = page is not null, Suspicious = suspicious.Take(5).ToList(),
        };
        var trust = SourceTrust.Unverified;
        if (suspicious.Count > 0) trust = SourceTrust.Unverified;
        else if (officialMarketplace || (vendorNamespace && publisherVerified)) trust = SourceTrust.Official;
        else if (vendorNamespace || (hasLicense && activeLastYear == true && GitHubRepository().IsMatch(s.Url))) trust = SourceTrust.KnownCommunity;
        return (trust, checks);
    }

    /// <summary>The tags the memory does not cover well enough yet (fewer than two sources) — the search is asked only about those, so a new tag costs a search once.</summary>
    public static List<string> TagsToSearch(IEnumerable<string> tags, IEnumerable<RememberedSource> remembered)
    {
        var covered = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var r in remembered) foreach (var t in r.Tags) covered[t] = covered.GetValueOrDefault(t) + 1;
        return tags.Where(t => covered.GetValueOrDefault(t) < 2).ToList();
    }

    // ── from a source to a card ──────────────────────────────────────────

    [GeneratedRegex("[^a-z0-9]+")] private static partial Regex NotKeyChars();
    [GeneratedRegex(@"^_|_\z")] private static partial Regex EdgeUnderscore();

    /// <summary>A remembered source becomes a card in the connections family; an MCP server is always an external risk, an unverified source a significant one.</summary>
    public static ComponentSeed SeedFromSource(RememberedSource r, string why, IReadOnlyList<string> matchedTags)
    {
        var kind = r.Kind;
        var checks = r.TrustChecks;
        var trustHe = r.Trust == SourceTrust.Official ? "רשמי" : r.Trust == SourceTrust.KnownCommunity ? "קהילה מוכרת" : "לא מאומת";
        var risk = kind == "mcp" ? "external" : r.Trust == SourceTrust.Unverified ? "significant" : "reversible";
        var contextTokens = kind == "mcp" && r.ToolCount is { } count ? Math.Min(count, 5) * 700 : kind == "plugin" ? 400 : 0;
        var suspicious = checks["suspicious"] switch
        {
            JsonArray a => a.Count,
            JsonValue v when v.TryGetValue<string>(out var text) => text.Length,
            _ => 0,
        };
        var key = EdgeUnderscore().Replace(NotKeyChars().Replace(JsLower(r.Name), "_"), "");
        var trustLine = r.Trust == SourceTrust.Unverified ? "אזהרה: המקור לא אומת (לא יצרן, בלי רישיון או פעילות) — לא מותקן לבד."
            : r.Trust == SourceTrust.Official ? "מקור רשמי של היצרן או של Anthropic."
            : "מקור קהילתי מוכר (רישיון, פעילות בשנה האחרונה).";
        return new ComponentSeed
        {
            Key = Slice($"{kind}_{key}", 60),
            Kind = kind, Family = "connections", Risk = risk, Source = "marketplace", SourceRef = r.Id, ContextTokens = contextTokens,
            TitleHe = $"{r.Name} ({(kind == "mcp" ? "MCP" : kind == "lsp" ? "LSP" : kind)}) — {trustHe}{(string.IsNullOrEmpty(r.Publisher) ? "" : $", {r.Publisher}")}",
            WhyHe = JsTrim(string.Create(CultureInfo.InvariantCulture,
                $"{(string.IsNullOrEmpty(why) ? r.Description ?? "" : why)} מתאים לסטאק: {string.Join(", ", matchedTags.Take(4))}. {trustLine}{(suspicious > 0 ? $" נמצאו תיאורי כלים חשודים: {suspicious}." : "")}")),
            WhatHe = kind == "mcp"
                ? string.Create(CultureInfo.InvariantCulture, $"חיבור לשרת MCP{(r.ToolCount is { } tools ? $" ({tools} כלים; מותקן עם דגל צמצום — עד 5 כלים נטענים, השאר דרך חיפוש כלים)" : "")}{(Truthy(checks["readOnlyMode"]) ? "; במצב קריאה בלבד" : "")}. כתובת: {r.Url}")
                : kind == "plugin" ? $"התקנת plugin ל-Claude Code מ-{r.Url}, בגרסה נעוצה."
                : kind == "lsp" ? $"plugin של שרת שפה: ניווט מדויק בקוד (\"מי קורא לזה\"), שגיאות טיפוס בסשן. {r.Url}"
                : $"ספריית skills: {r.Url}",
            VerifyHowHe = kind == "mcp" ? "חיבור וספירת הטוקנים שהכלים מוסיפים; תיאורי הכלים נסרקים שוב בכל עדכון." : kind == "plugin" ? "claude plugin validate, ואז eval עם ובלי על משימות הניסיון." : "התקנה; בדיקה שהסשן טוען אותו.",
            Params = new JsonObject
            {
                ["url"] = r.Url, ["kind"] = r.Kind, ["trust"] = r.Trust, ["toolCount"] = r.ToolCount, ["publisher"] = r.Publisher, ["sourceId"] = r.Id,
                ["tags"] = new JsonArray(r.Tags.Select(t => (JsonNode?)JsonValue.Create(t)).ToArray()),
            },
        };
    }

    // ── JavaScript's semantics, where the old server's output depends on them ──

    private static string? NullIfEmpty(string s) => s.Length > 0 ? s : null;

    /// <summary><c>s.slice(0, n)</c>: UTF-16 units, like JavaScript.</summary>
    private static string Slice(string s, int n) => s.Length > n ? s[..n] : s;

    /// <summary>Only A–Z folded: what JavaScript's <c>/i</c> does for patterns spelled in ASCII.</summary>
    private static string AsciiLower(string s)
    {
        if (!s.Any(c => c is >= 'A' and <= 'Z')) return s;
        return string.Create(s.Length, s, (span, source) => { for (var i = 0; i < source.Length; i++) span[i] = source[i] is >= 'A' and <= 'Z' ? (char)(source[i] + 32) : source[i]; });
    }

    /// <summary>
    /// <c>toLowerCase()</c>: .NET's invariant lowering, plus the one unconditional full mapping it lacks — "\u0130" becomes
    /// "i" and a combining dot, as in JavaScript. (A final sigma is still lowered to σ, where JavaScript writes ς.)
    /// </summary>
    private static string JsLower(string s)
    {
        var lower = s.ToLowerInvariant();
        return lower.Contains('\u0130') ? lower.Replace("\u0130", "i\u0307", StringComparison.Ordinal) : lower;
    }

    /// <summary><c>String.prototype.trim</c>: JavaScript's whitespace set (U+FEFF yes, U+0085 no), not .NET's.</summary>
    private static string JsTrim(string s)
    {
        int start = 0, end = s.Length;
        while (start < end && IsJsSpace(s[start])) start++;
        while (end > start && IsJsSpace(s[end - 1])) end--;
        return s[start..end];
    }

    private static bool IsJsSpace(char c) =>
        c is '\t' or '\n' or '\v' or '\f' or '\r' or ' ' or '\u00A0' or '\u1680' or '\u2028' or '\u2029' or '\u202F' or '\u205F' or '\u3000' or '\uFEFF' or (>= '\u2000' and <= '\u200A');

    /// <summary>ASCII digits only: .NET's <c>\d</c> also matches "٢٠٢٥", which <c>Number</c> reads as NaN and <see cref="double.Parse(string, NumberStyles, IFormatProvider)"/> throws on.</summary>
    [GeneratedRegex(@"^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?\z", RegexOptions.CultureInvariant)] private static partial Regex DecimalLiteral();

    /// <summary>
    /// <c>Number(s)</c> for the year of <c>lastActivity</c>: trimmed; empty is 0; 0x/0o/0b literals; a decimal literal;
    /// anything else NaN — so "2025" is 2025 and "20-1" is not a year.
    /// </summary>
    private static double JsNumber(string s)
    {
        var t = JsTrim(s);
        if (t.Length == 0) return 0;
        if (t.Length > 2 && t[0] == '0' && t[1] is 'x' or 'X' or 'o' or 'O' or 'b' or 'B')
        {
            var radix = t[1] is 'x' or 'X' ? 16 : t[1] is 'o' or 'O' ? 8 : 2;
            double value = 0;
            foreach (var c in t[2..])
            {
                var digit = c is >= '0' and <= '9' ? c - '0' : c is >= 'a' and <= 'f' ? c - 'a' + 10 : c is >= 'A' and <= 'F' ? c - 'A' + 10 : 99;
                if (digit >= radix) return double.NaN;
                value = value * radix + digit;
            }
            return value;
        }
        if (t is "Infinity" or "+Infinity") return double.PositiveInfinity;
        if (t == "-Infinity") return double.NegativeInfinity;
        return DecimalLiteral().IsMatch(t) ? double.Parse(t, NumberStyles.Float, CultureInfo.InvariantCulture) : double.NaN;
    }

    /// <summary>JavaScript truthiness of a stored JSON value.</summary>
    private static bool Truthy(JsonNode? node) => node switch
    {
        null => false,
        JsonValue v when v.GetValueKind() == JsonValueKind.True => true,
        JsonValue v when v.GetValueKind() == JsonValueKind.False => false,
        JsonValue v when v.TryGetValue<string>(out var s) => s.Length > 0,
        JsonValue v when v.TryGetValue<double>(out var n) => n != 0 && !double.IsNaN(n),
        _ => true,
    };
}
