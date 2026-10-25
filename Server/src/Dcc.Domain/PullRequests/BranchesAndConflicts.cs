using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Dcc.Domain.PullRequests;

public sealed record BranchPr(int Number, string State, bool Draft);

public sealed record BranchAdvice(string Title, string Detail, string Tone);

/// <summary>One branch and what to do about it. <c>Status</c>: default, merged, open_pr, work or stale.</summary>
public sealed record BranchHealth
{
    public required string Name { get; init; }
    public required string Status { get; init; }
    /// <summary>Commits it holds that the main branch does not.</summary>
    public int Unique { get; init; }
    /// <summary>Commits the main branch gained that it does not have.</summary>
    public int Behind { get; init; }
    public BranchPr? Pr { get; init; }
    public string? LastAt { get; init; }
    public string? LastBy { get; init; }
    public string? LastMessage { get; init; }
    /// <summary>How it came to exist, in plain words.</summary>
    public required string Origin { get; init; }
    public required BranchAdvice Advice { get; init; }
    public string? Url { get; init; }
}

/// <summary>
/// Every branch of a repository, with what to do about it (repo-branches.ts). It only reads and advises; deleting
/// stays a decision made on the host. A branch is not called forgotten because of its age — long work is legitimate.
/// </summary>
public static class BranchRules
{
    public static string OriginOf(string name) => name switch
    {
        _ when name.StartsWith("claude/", StringComparison.Ordinal) => "נוצר אוטומטית על ידי סשן של Claude Code בשולחן העבודה. כל סשן פותח ענף משלו, והוא לא נמחק לבד.",
        _ when name.StartsWith("ai/onboarding/", StringComparison.Ordinal) => "נוצר על ידי הרצת הטמעה של DCC, ענף אחד לכל הרצה.",
        _ when name.StartsWith("project/", StringComparison.Ordinal) => "ענף פרויקט, לפי שיטת העבודה שלנו: ענף אחד לפרויקט, וממנו יוצאים ענפי המשימות.",
        _ when Regex.IsMatch(name, "^(task|feature)/") => "ענף משימה, לפי שיטת העבודה שלנו.",
        _ when Regex.IsMatch(name, "^(fix|cleanup|perf|bug)/") => "ענף לשינוי קטן וממוקד, שנפתח ידנית.",
        _ => "לא ידוע מי פתח אותו. אפשר לראות את מי שכתב בו לאחרונה.",
    };

    public static (string Status, BranchAdvice Advice) AdviceFor(int unique, int behind, BranchPr? pr, string @base, bool isBase)
    {
        if (isBase) return ("default", new("הענף הראשי", "הגרסה הרשמית של הריפו. לא נוגעים בו ישירות ולא מוחקים אותו.", "neutral"));
        if (pr?.State == "OPEN")
            return ("open_pr", new($"ממתין בבקשת מיזוג #{pr.Number}", $"הבקשה פתוחה{(pr.Draft ? " (כטיוטה)" : "")}. אין מה למחוק עד שהיא תמוזג או תיסגר, ואז הענף נמחק.", "neutral"));
        if (unique == 0)
            return ("merged", new("אפשר למחוק", $"כל מה שהיה בענף הזה כבר נמצא ב-{@base}. המחיקה לא מאבדת שום דבר, וההיסטוריה נשארת.", "healthy"));
        if (pr is not null && pr.State != "OPEN" && pr.State != "MERGED")
            return ("stale", new("הבקשה שלו נסגרה בלי מיזוג",
                $"יש בו {unique} commits שלא נכנסו ל-{@base}, והבקשה שנפתחה עליהם נסגרה בלי מיזוג. אם העבודה כבר לא רלוונטית, אפשר למחוק. אם היא כן, כדאי לפתוח בקשת מיזוג. עדיף להסתכל בה קודם.", "warning"));
        var moved = behind > 0 ? $", ו-{@base} התקדם ב-{behind} מאז שנפתח, כך שלפני מיזוג צריך לעדכן אותו" : "";
        return ("work", new($"עבודה שעוד לא נכנסה ל-{@base}",
            $"יש בו {unique} commits שעוד אין להם בקשת מיזוג{moved}. אם זו עבודה שממשיכים בה, ממשיכים. כשהיא מוכנה, פותחים בקשת מיזוג. אם היא כבר לא נחוצה, אפשר למחוק, אבל קודם לראות מה יש בה.",
            behind > 10 ? "warning" : "neutral"));
    }

    private static readonly Dictionary<string, int> Order = new() { ["open_pr"] = 0, ["work"] = 1, ["stale"] = 2, ["merged"] = 3, ["default"] = 4 };

    public static List<BranchHealth> Sort(IEnumerable<BranchHealth> rows) =>
        rows.OrderBy(r => Order[r.Status]).ThenByDescending(r => r.LastAt ?? "", StringComparer.Ordinal).ToList();
}

/// <summary>A stretch of a merged file: plain text, or a place the two sides disagree.</summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(TextSegment), "text")]
[JsonDerivedType(typeof(ConflictSegment), "conflict")]
public abstract record Segment;

public sealed record TextSegment(string Text) : Segment;

public sealed record ConflictSegment(string Ours, string Theirs) : Segment;

/// <summary>
/// Conflict markers in a merged file (pull-request-conflict.ts). A file is only offered for a decision when git left
/// markers in it; an unterminated marker is a line of the file that happens to start with "&lt;&lt;&lt;&lt;&lt;&lt;&lt;".
/// </summary>
public static partial class ConflictText
{
    [GeneratedRegex(@"^<{7}(\s|$)")] private static partial Regex MarkOurs();
    [GeneratedRegex(@"^\|{7}(\s|$)")] private static partial Regex MarkBase();
    [GeneratedRegex(@"^={7}(\s|$)")] private static partial Regex MarkSplit();
    [GeneratedRegex(@"^>{7}(\s|$)")] private static partial Regex MarkTheirs();

    /// <summary>The merged text, split into what can be kept as it is and what has to be decided.</summary>
    public static List<Segment> Split(string content)
    {
        var lines = content.Split('\n');
        var output = new List<Segment>();
        var plain = new List<string>();
        void Flush() { if (plain.Count > 0) { output.Add(new TextSegment(string.Join('\n', plain))); plain.Clear(); } }
        for (var i = 0; i < lines.Length; i++)
        {
            if (!MarkOurs().IsMatch(lines[i])) { plain.Add(lines[i]); continue; }
            var ours = new List<string>();
            var theirs = new List<string>();
            var side = "ours";
            var closed = false;
            var j = i + 1;
            for (; j < lines.Length; j++)
            {
                var l = lines[j];
                if (MarkBase().IsMatch(l)) { side = "base"; continue; } // diff3 style: the common ancestor, shown to nobody
                if (MarkSplit().IsMatch(l)) { side = "theirs"; continue; }
                if (MarkTheirs().IsMatch(l)) { closed = true; break; }
                if (side == "ours") ours.Add(l);
                else if (side == "theirs") theirs.Add(l);
            }
            if (!closed) { plain.Add(lines[i]); continue; }
            Flush();
            output.Add(new ConflictSegment(string.Join('\n', ours), string.Join('\n', theirs)));
            i = j;
        }
        Flush();
        return output;
    }

    /// <summary>
    /// Is a conflict still open in this text? An opening or a closing marker says so. A lone line of seven "=" does
    /// not: it is a Markdown heading's underline as often as a marker, and a file holding one must stay savable.
    /// </summary>
    public static bool HasMarkers(string s) => s.Split('\n').Any(l => MarkOurs().IsMatch(l) || MarkTheirs().IsMatch(l));
}
