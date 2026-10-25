using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Dcc.Infrastructure.Glossary;

public sealed record GlossaryMatch(JsonObject Entry, JsonObject Screen, string Certainty);

/// <summary>
/// Step zero of the chat: answering from the screen's glossary with no model (glossary/index.ts). A question that is
/// essentially just a term of the screen is "certain" and answered here; a term that only brushes past a longer,
/// substantive question is "likely" and goes to the model with the screen's real facts.
/// </summary>
public static partial class GlossaryMatching
{
    [GeneratedRegex(@"[?!.,""'״׳()\[\]:;]")] private static partial Regex Punct();
    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();
    [GeneratedRegex(@"^(ו|ה|ב|ל|מ|ש|כש|וה|וב|ול|שה|בה)(?=.{2,})")] private static partial Regex Prefix();
    [GeneratedRegex(@"מה (ה)?מסך|מה רואים|מה יש (כאן|פה)|איפה אני|מה זה (המסך|הדף)")] private static partial Regex AboutScreen();

    private static readonly string[] QuestionWordList = ["מה", "מהו", "מהי", "למה", "איך", "כמה", "האם", "הסבר", "תסביר", "מי", "איפה", "מתי"];
    private static readonly Regex QuestionWords = new($"(^|\\s)({string.Join("|", QuestionWordList)})(\\s|$)|\\?");
    private static readonly HashSet<string> Filler = [.. QuestionWordList.Select(Stem), "זה", "זו", "זאת", "אלה", "אלו", "הוא", "היא"];

    public static string Norm(string s) => Spaces().Replace(Punct().Replace(s.ToLowerInvariant(), " "), " ").Trim();
    private static string Stem(string w) => Prefix().Replace(w, "");
    private static List<string> Words(string s) => Norm(s).Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(Stem).ToList();

    private static double MatchRatio(List<string> qw, List<string> matchedWords)
    {
        var content = qw.Where(w => !Filler.Contains(w)).ToList();
        if (content.Count == 0) return 1;
        var matched = matchedWords.Where(w => !Filler.Contains(w)).ToList();
        return (double)(matched.Count > 0 ? matched.Count : matchedWords.Count) / content.Count;
    }

    public static GlossaryMatch? Match(this GlossaryService glossary, string? screen, string question)
    {
        var g = glossary.For(screen);
        if (g is null) return null;
        var q = Norm(question);
        var qw = Words(question);
        if (qw.Count == 0) return null;
        (JsonObject Entry, int Len, List<string> Words)? best = null;
        foreach (var entry in g["entries"]!.AsArray().OfType<JsonObject>())
        {
            var names = new List<string> { entry["title"]!.GetValue<string>() };
            names.AddRange((entry["aliases"] as JsonArray)?.Select(a => a!.GetValue<string>()) ?? []);
            foreach (var name in names)
            {
                var n = Norm(name);
                var nw = Words(name);
                var hit = q.Contains(n, StringComparison.Ordinal) || nw.All(qw.Contains);
                if (hit && (best is null || n.Length > best.Value.Len)) best = (entry, n.Length, nw);
            }
        }
        if (best is null) return null;
        var certain = QuestionWords.IsMatch(question) && qw.Count <= 12 && MatchRatio(qw, best.Value.Words) >= 0.5;
        return new GlossaryMatch(best.Value.Entry, g, certain ? "certain" : "likely");
    }

    /// <summary>"מה המסך הזה מציג?" and the like.</summary>
    public static bool AsksAboutScreen(string question) => AboutScreen().IsMatch(Norm(question));

    /// <summary>The answer for a matched entry, in the words the "i" uses too.</summary>
    public static string Answer(GlossaryMatch m)
    {
        var e = m.Entry;
        var title = e["title"]!.GetValue<string>();
        var head = e["kind"]?.GetValue<string>() switch
        {
            "button" => $"\"{title}\" — כפתור.",
            "field" => $"\"{title}\" — שדה במסך.",
            "section" => $"\"{title}\" — אזור במסך.",
            _ => $"\"{title}\":",
        };
        var press = e["press"]?.GetValue<string>();
        return string.Join("\n", new[] { head, e["explain"]!.GetValue<string>(), press is { Length: > 0 } ? $"מה יקרה אם תלחצו: {press}" : "" }.Where(x => x.Length > 0));
    }
}
