using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Domain.Onboarding;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// What turns the scan's answer into cards. <c>Dir</c> is the isolated copy: every path the text names is checked
/// there. <c>Ours</c> are our cards, for "replaces" — a key that is not a card is dropped. <c>InBaseline</c> says
/// whether a path existed at the run's start — a file of the draft is taken only when it is new.
/// </summary>
public sealed record ScanSeedsInput(InitScan Scan, string Dir, IReadOnlyList<string> KnownCommands, IReadOnlyList<Component> Ours, Func<string, bool> InBaseline);

/// <summary>The cards the scan takes, and what it took that DCC cannot, with the reason.</summary>
public sealed record ScanSeeds(List<ComponentSeed> Seeds, List<ScanRefusal> Refused);

/// <summary>
/// The second half of the scan of the <c>/init</c> draft (repo-onboarding/init-scan.ts, seedsFromScan): what the
/// editor takes becomes cards. It lives in Infrastructure only because every card's text is checked against the
/// isolated copy (<see cref="ComponentVerifier.CheckClaims"/>) — a text that names paths the code does not have is
/// put under "not recommended" with the paths named.
/// </summary>
public static partial class InitScanSeeds
{
    /// <summary>JavaScript's <c>\s</c>, not .NET's (the BOM in, U+0085 out).</summary>
    private const string JsSpace = @"[\t\n\v\f\r    -     　﻿]";

    private static readonly Dictionary<string, int> MaxText = new() { ["line"] = 400, ["section"] = 8000, ["file"] = 14000 };

    private static readonly Dictionary<string, string> BuildCheckHe = new()
    {
        ["skill"] = "frontmatter וגוף ה-skill, וכל נתיב שהוא מזכיר — מול הקוד.",
        ["agent"] = "frontmatter, קריאה בלבד, ורשימת בדיקה — כמו כל סוכן.",
    };

    [GeneratedRegex("^" + JsSpace + "*[-*]" + JsSpace + "+")] private static partial Regex Bullet();
    [GeneratedRegex(JsSpace + "+")] private static partial Regex Spaces();
    [GeneratedRegex("^#+" + JsSpace + "*")] private static partial Regex HeadingHashes();

    /// <summary>The first ten hex digits of the SHA-1 of the text's UTF-8 — Node's createHash("sha1").update(x).</summary>
    private static string Hash(string x) => Convert.ToHexStringLower(SHA1.HashData(Encoding.UTF8.GetBytes(x)))[..10];

    /// <summary>12,345 — toLocaleString("en-US") of a count.</summary>
    private static string Count(int n) => n.ToString("N0", CultureInfo.InvariantCulture);

    /// <summary>
    /// What the scan takes becomes cards: the same key for the same text, so a second scan keeps the person's
    /// decision. Every card carries the scan's reasoning — the need, the evidence, the alternative, the cost — and
    /// waits for a person whatever the automation level (the caller puts it in the approval group). A question only a
    /// person can answer becomes a card whose approval IS the answer. What cannot be taken is said, with the reason.
    /// </summary>
    public static ScanSeeds SeedsFromScan(ScanSeedsInput i)
    {
        var seeds = new List<ComponentSeed>();
        var refused = new List<ScanRefusal>();
        var ourTitle = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var c in i.Ours) ourTitle[c.Key] = c.TitleHe;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var t in i.Scan.Items)
        {
            var replaces = t.Replaces.Where(ourTitle.ContainsKey).ToList();
            var text = t.Form == "line" ? ComponentVerifier.JsTrim(Spaces().Replace(Bullet().Replace(t.Text, "", 1), " ")) : t.Text;
            if (MaxText.TryGetValue(t.Form, out var max) && text.Length > max)
            {
                refused.Add(new(t.Title, $"ארוך מדי ({Count(text.Length)} תווים) — {(t.Form == "line" ? "שורה" : t.Form == "section" ? "סעיף" : "קובץ")} עד {Count(max)}"));
                continue;
            }
            string kind;
            var target = "AGENTS.md";
            if (t.Form == "line") kind = "rule";
            else if (t.Form == "section") kind = "doc";
            else
            {
                target = t.Target.StartsWith("./", StringComparison.Ordinal) ? t.Target[2..] : t.Target;
                var k = InitScans.FileKind(target);
                if (k is null)
                {
                    refused.Add(new(t.Title, $"DCC לא מאמץ את {target} כקובץ שלם — להגדרות, ל-.mcp.json ול-hooks יש כרטיסים משלהם שנבנים ונבדקים"));
                    continue;
                }
                if (i.InBaseline(target))
                {
                    refused.Add(new(t.Title, $"{target} כבר קיים בריפו — DCC לא דורס קובץ של הריפו; סעיף או שורה כן"));
                    continue;
                }
                kind = k;
            }
            var (checkedCount, missing) = ComponentVerifier.CheckClaims(text, i.Dir, i.KnownCommands);
            var tooMany = missing.Count > Math.Max(1, checkedCount * 0.2);
            var origin = t.Origin == "merged" ? "שילוב של שלנו ושל /init" : "מטיוטת /init";
            var heading = t.Form == "section" ? HeadingHashes().Replace(t.Heading ?? t.Title, "", 1) : null;
            var lines = text.Split('\n').Length;
            var key = $"init_{t.Form}_{Hash($"{target}\n{heading ?? ""}\n{text}")}";
            if (!seen.Add(key)) continue; // the same text twice in one answer is one card
            var reasoning = string.Join(" ", new[]
            {
                t.Decision == "ask" && !string.IsNullOrEmpty(t.Question) ? $"צריך החלטה שלך: {t.Question} (אישור = כן, דחייה = לא)." : null,
                t.Decision == "check" ? "לבדוק לפני שמאשרים — יש בו טענה שהסריקה לא הצליחה לאמת." : null,
                t.Need.Length > 0 ? $"הצורך: {t.Need}" : null,
                t.Evidence.Length > 0 ? $"ראיה: {t.Evidence}" : null,
                t.Alternative.Length > 0 ? $"בלי רכיב חדש? {t.Alternative}" : null,
                t.Cost.Length > 0 ? $"עלות: {t.Cost}" : null,
                replaces.Count > 0 ? $"מחליף את: {string.Join(", ", replaces.Select(k => ourTitle[k]))} — אם מאשרים את זה, לדחות אותו." : null,
                missing.Count > 0 && !tooMany ? $"שים לב: {string.Join(", ", missing.Take(3).Select(m => $"`{m}`"))} לא נמצא בקוד." : null,
            }.Where(s => !string.IsNullOrEmpty(s)));

            // The params, key for key as the old server wrote them: an undefined key is left out, a null one kept.
            var parameters = new JsonObject();
            if (t.Form != "line") parameters["template"] = t.Form == "section" ? "init-section" : "init-file";
            parameters["text"] = text;
            parameters["heading"] = heading;
            if (t.Form == "file") parameters["file"] = target;
            parameters["decision"] = t.Decision;
            parameters["origin"] = t.Origin;
            parameters["replaces"] = new JsonArray([.. replaces.Select(r => (JsonNode?)r)]);
            parameters["question"] = t.Question;
            parameters["claims"] = new JsonObject { ["checked"] = checkedCount, ["missing"] = new JsonArray([.. missing.Select(m => (JsonNode?)m)]) };

            seeds.Add(new ComponentSeed
            {
                Key = key, Kind = kind, Family = Components.FamilyOf(kind),
                Risk = kind is "rule" or "doc" ? "reversible" : "significant", Source = "init", SourceRef = target,
                TitleHe = t.Title,
                WhyHe = tooMany
                    ? $"נבדק מול הקוד ונמצאו {missing.Count} נתיבים שלא קיימים ({string.Join(", ", missing.Take(4))}) — לא מומלץ. {origin}. {reasoning}"
                    : $"{origin}. {reasoning}",
                WhatHe = t.Form == "line" ? "שורה בכללי AGENTS.md, כלשונה בכרטיס."
                    : t.Form == "section" ? $"סעיף \"{heading}\" שנוסף לסוף AGENTS.md, בנוסח שבכרטיס ({lines} שורות)."
                    : $"הקובץ {target}, כלשונו בכרטיס ({lines} שורות).",
                VerifyHowHe = string.Join(" ", new[]
                {
                    t.Verify, BuildCheckHe.GetValueOrDefault(kind, "כל נתיב ופקודה בנוסח נבדקים מול הקוד בבנייה; טענה שלא נמצאה מכשילה את הכרטיס."),
                }.Where(s => s.Length > 0)),
                Params = parameters,
                NotRecommended = tooMany,
            });
        }
        return new ScanSeeds(seeds, refused);
    }
}
