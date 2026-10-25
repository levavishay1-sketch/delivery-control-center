using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Dcc.Domain.Chat;

public sealed record ParsedAction(string Key, JsonObject Params);

public sealed record ParsedBlocks(string Text, IReadOnlyList<ParsedAction> Actions, string? NeedsCode, (string Key, string Reason)? Goto);

/// <summary>
/// The blocks a model answer may carry, and the text without them (chat/blocks.ts). An answer may propose several
/// actions (a gaps conversation closes one per gap it settled); each becomes its own card and still runs only on a click.
/// </summary>
public static partial class ChatBlocks
{
    /// <summary>More than this in one answer is a model listing everything, not proposing.</summary>
    public const int MaxActions = 12;

    [GeneratedRegex(@"<action\s+key=""([^""]+)""\s*>([\s\S]*?)</action>", RegexOptions.IgnoreCase)] private static partial Regex Action();
    [GeneratedRegex(@"<needs_code\s*/?>([\s\S]*?)(?:</needs_code>|$)", RegexOptions.IgnoreCase)] private static partial Regex NeedsCode();
    [GeneratedRegex(@"<goto\s+key=""([^""]+)""\s*>([\s\S]*?)(?:</goto>|$)", RegexOptions.IgnoreCase)] private static partial Regex Goto();
    [GeneratedRegex(@"\n{3,}")] private static partial Regex Blank();

    public static ParsedBlocks Parse(string raw)
    {
        var text = raw;
        var actions = new List<ParsedAction>();
        foreach (Match a in Action().Matches(raw))
        {
            text = ReplaceFirst(text, a.Value);
            if (actions.Count >= MaxActions) continue;
            JsonObject p = [];
            try
            {
                var body = a.Groups[2].Value.Trim();
                if (JsonNode.Parse(body.Length > 0 ? body : "{}") is JsonObject o) p = o;
            }
            catch (System.Text.Json.JsonException) { }
            actions.Add(new ParsedAction(a.Groups[1].Value.Trim(), p));
        }
        string? needs = null;
        if (NeedsCode().Match(raw) is { Success: true } n)
        {
            needs = n.Groups[1].Value.Trim() is { Length: > 0 } s ? s : null;
            text = ReplaceFirst(text, n.Value);
        }
        (string, string)? go = null;
        if (Goto().Match(raw) is { Success: true } g)
        {
            go = (g.Groups[1].Value.Trim(), g.Groups[2].Value.Trim());
            text = ReplaceFirst(text, g.Value);
        }
        return new ParsedBlocks(Blank().Replace(text, "\n\n").Trim(), actions, needs, go);
    }

    private static string ReplaceFirst(string s, string what)
    {
        var i = s.IndexOf(what, StringComparison.Ordinal);
        return i < 0 ? s : s[..i] + s[(i + what.Length)..];
    }
}

/// <summary>A gap as the gaps conversation reads it.</summary>
public sealed record GapLike(string Id, string Description, string? Why, string? ImpactIfWrong, IReadOnlyList<string> Options, string WhoAnswers, bool Blocking, string State, string? Answer);

public sealed record GapsContextInput(string Title, string RequirementType, (string Name, bool Available)? Repo,
    IReadOnlyList<(string Source, string Body)> Notes, IReadOnlyList<(string Name, string? Text, string? Err)> Files, IReadOnlyList<GapLike> Gaps, string? Detail = null);

public sealed record TranscriptMessage(string Role, string Kind, string Text, JsonObject Payload);

/// <summary>
/// The conversation about a requirement's gaps — the facts and the transcript each (stateless) turn sends
/// (chat/gaps-prompt.ts). Its standing instructions are the <c>gaps.conversation</c> prompt. Pure.
/// </summary>
public static class GapsPrompt
{
    public static readonly string[] Suggestions =
    [
        "מה היית ממליץ להכריע בפערים שהם החלטה שלנו?",
        "איזה פער כדאי לסגור קודם, ולמה?",
        "נסח מכתב למבקש הדרישה עם השאלות שרק הוא יכול לענות",
    ];

    public static readonly string[] OpenStates = ["proposed", "verified"];
    public static bool IsOpen(string state) => OpenStates.Contains(state);

    /// <summary>The short reference a conversation uses for a gap: the first 8 characters of its id.</summary>
    public static string Ref(string id) => id.Length > 8 ? id[..8] : id;

    /// <summary>Beyond this the attached files crowd out the conversation itself.</summary>
    public const int MaxFilesChars = 40_000;

    public static string Context(GapsContextInput c)
    {
        var o = new List<string> { "העובדות:", $"הדרישה: {c.Title} ({(c.RequirementType == "development" ? "פיתוח" : c.RequirementType == "research" ? "תחקור" : "בדיקות")})" };
        o.Add(c.Repo is { } r
            ? r.Available ? $"המאגר: {r.Name} — יש לך קריאה בלבד בו, ותיקיית העבודה היא המאגר." : $"המאגר: {r.Name} — העותק המקומי לא זמין כרגע, אין גישה לקוד בתשובה הזו."
            : "המאגר: אין מאגר מקושר לדרישה — אין קוד לקרוא.");
        if (c.Detail is { Length: > 0 } detail)
        {
            o.Add("");
            o.Add("פירוט הדרישה:");
            o.Add(detail.Trim());
        }
        if (c.Notes.Count > 0)
        {
            o.Add("");
            o.Add("הדרישה הגולמית וההערות עליה, לפי הסדר:");
            o.AddRange(c.Notes.Select(n => $"[{n.Source}] {n.Body.Trim()}"));
        }
        if (c.Files.Count > 0)
        {
            o.Add("");
            o.Add("קבצים מצורפים לדרישה — הם חלק ממנה:");
            var budget = MaxFilesChars;
            foreach (var f in c.Files)
            {
                if (f.Text is null) { o.Add($"--- {f.Name} — לא ניתן לקרוא כטקסט ({f.Err ?? "לא ידוע"}) ---"); continue; }
                var text = f.Text.Length > budget ? $"{f.Text[..Math.Max(0, budget)]}\n[נקטע כאן]" : f.Text;
                budget -= text.Length;
                o.Add($"--- {f.Name} ---");
                o.Add(text);
            }
        }
        var open = c.Gaps.Where(g => IsOpen(g.State)).ToList();
        var done = c.Gaps.Where(g => g.State is "resolved" or "dismissed").ToList();
        o.Add("");
        o.Add($"פערים פתוחים ({open.Count}):");
        if (open.Count == 0) o.Add("(אין — כל הפערים הוכרעו)");
        foreach (var g in open)
        {
            o.Add($"- [{Ref(g.Id)}] {g.Description}");
            if (g.Why is { Length: > 0 }) o.Add($"  למה זה חשוב: {g.Why}");
            if (g.ImpactIfWrong is { Length: > 0 }) o.Add($"  אם ננחש לא נכון: {g.ImpactIfWrong}");
            if (g.Options.Count > 0) o.Add($"  אפשרויות שהוצעו: {string.Join(" | ", g.Options)}");
            o.Add($"  מי מכריע: {(g.WhoAnswers == "client" ? "מבקש הדרישה" : "הצוות")}{(g.Blocking ? " · דחוף" : "")}");
        }
        if (done.Count > 0)
        {
            o.Add("");
            o.Add($"פערים שכבר הוכרעו ({done.Count}):");
            o.AddRange(done.Select(g => $"- {g.Description} → {(g.State == "dismissed" ? "לא פער" : "הוכרע")}{(g.Answer is { Length: > 0 } a ? $": {a}" : "")}"));
        }
        return string.Join("\n", o);
    }

    private static readonly Dictionary<string, string> StatusHe = new() { ["proposed"] = "ממתין לאישור", ["running"] = "רץ", ["done"] = "אושר ובוצע", ["cancelled"] = "בוטל", ["failed"] = "נכשל" };

    /// <summary>How far back a stateless turn remembers.</summary>
    public const int MaxTranscript = 30;

    private static string Clip(string s, int n = 1500) => s.Length > n ? $"{s[..n]}…" : s;

    public static string Transcript(IReadOnlyList<TranscriptMessage> messages)
    {
        var lines = new List<string>();
        foreach (var m in messages.Skip(Math.Max(0, messages.Count - MaxTranscript)))
        {
            if (m.Role == "system") continue;
            if (m.Role == "user") lines.Add($"האדם: {Clip(m.Text)}");
            else if (m.Kind == "proposal")
            {
                var describe = m.Payload["describe"] is JsonValue v && v.TryGetValue<string>(out var d) ? d.Split('\n')[0] : m.Text;
                var status = m.Payload["status"]?.ToString() ?? "";
                lines.Add($"(כרטיס: {m.Text} — {Clip(describe, 300)} — {StatusHe.GetValueOrDefault(status, status)})");
            }
            else if (m.Kind == "refusal") lines.Add($"(כרטיס שנדחה: {Clip(m.Text, 300)})");
            else if (m.Kind == "answer") lines.Add($"קלוד: {Clip(m.Text)}");
        }
        return lines.Count > 0 ? $"השיחה עד עכשיו:\n{string.Join("\n", lines)}" : "השיחה עד עכשיו: (זו ההודעה הראשונה)";
    }
}
