using System.Globalization;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Dcc.Domain.PullRequests;

/// <summary>
/// Pull requests as DCC reads them from a host (pull-requests.ts, pull-request-detail.ts). The host stays the source
/// of truth: these are its answers with what DCC knows added — which client, which repository, what is waiting —
/// and the decisions made from them, in words. No model is involved anywhere here.
/// </summary>
public sealed record PrFlag(string Key, string Text, string Tone);

public sealed record PrRepo(Guid Id, string Name);

public sealed record PrClient(Guid? Id, string? Name);

/// <summary>One request — the JSON the screen reads, field for field.</summary>
public sealed record PullRequestRow
{
    public required string Id { get; init; }
    public string Provider { get; init; } = "github";
    public required int Number { get; init; }
    public required string Title { get; init; }
    public required string Url { get; init; }
    /// <summary>open, merged or closed.</summary>
    public required string State { get; init; }
    public bool Draft { get; init; }
    public required string Author { get; init; }
    public required string HeadBranch { get; init; }
    public required string BaseBranch { get; init; }
    public required string CreatedAt { get; init; }
    public required string UpdatedAt { get; init; }
    public string? ClosedAt { get; init; }
    public int ChangedFiles { get; init; }
    public int Additions { get; init; }
    public int Deletions { get; init; }
    /// <summary>null while the host is still working it out.</summary>
    public bool? Mergeable { get; init; }
    public bool Conflicts { get; init; }
    /// <summary>approved, changes_requested or none.</summary>
    public string Review { get; init; } = "none";
    /// <summary>passing, failing, running or none.</summary>
    public string Checks { get; init; } = "none";
    public string? ParentId { get; init; }
    public required PrRepo Repo { get; init; }
    public required PrClient Client { get; init; }
    public IReadOnlyList<PrFlag> Flags { get; init; } = [];
    public double WaitingHours { get; init; }
}

/// <summary>What blocks a merge. <c>Ok</c>: true fine, false blocks, null nothing to check.</summary>
public sealed record PrBlocker(string Key, bool? Ok, string Title, string Detail);

/// <summary><c>Action</c>: update_branch, request_review, merge, open_host, wait or done.</summary>
public sealed record PrNextStep(string Title, string Detail, string Action);

public sealed record PrFile
{
    public required string Path { get; init; }
    public required string Status { get; init; }
    public int Additions { get; init; }
    public int Deletions { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Note { get; init; }
    /// <summary>The name it had before, when it was renamed.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? From { get; init; }
}

public sealed record PrFileGroup
{
    public required string Key { get; init; }
    public required string Title { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Note { get; init; }
    public required IReadOnlyList<PrFile> Files { get; init; }
    public int Additions { get; init; }
    public int Deletions { get; init; }
}

public sealed record PrTopic(string Title, string Detail);

public sealed record PrTimelineItem
{
    public required string At { get; init; }
    /// <summary>commit, review, comment, base, opened, pushed, merged or dcc.</summary>
    public required string Kind { get; init; }
    public required string Text { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Detail { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Tag { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Tone { get; init; }
}

public sealed record PrLineCount(int Additions, int Deletions);

public sealed record PrConflictFile(string Path, PrLineCount? Ours, PrLineCount? Theirs);

/// <summary><c>Exact</c>: the files that really clash (a merge was computed); otherwise only the files both sides changed.</summary>
public sealed record PrConflictView(bool Exact, IReadOnlyList<PrConflictFile> Files);

/// <summary>A file as the host lists it in a comparison.</summary>
public sealed record HostFile(string Filename, string? Status, int Additions, int Deletions, string? PreviousFilename = null);

public static partial class PullRequestRules
{
    /// <summary>A request bigger than this is hard to review in one sitting (a well-known threshold).</summary>
    public const int BigPrFiles = 40;

    /// <summary>A first answer within a working day is the usual agreement.</summary>
    public const int WaitingHours = 24;

    /// <summary>The host's check rollup in one word.</summary>
    public static string ChecksOf(IEnumerable<string> states)
    {
        var norm = states.Select(s => s.ToUpperInvariant()).ToList();
        if (norm.Count == 0) return "none";
        if (norm.Any(s => s is "FAILURE" or "ERROR" or "TIMED_OUT")) return "failing";
        if (norm.Any(s => s is "IN_PROGRESS" or "PENDING" or "QUEUED")) return "running";
        return "passing";
    }

    /// <summary>Why a request needs a person, in the order that matters.</summary>
    public static List<PrFlag> FlagsFor(PullRequestRow pr, double waitingHours, bool parentOpen)
    {
        var f = new List<PrFlag>();
        if (pr.Conflicts) f.Add(new("conflict", "קונפליקט מול היעד", "critical"));
        if (pr.Checks == "failing") f.Add(new("checks", "בדיקות נכשלו", "critical"));
        if (parentOpen) f.Add(new("parent", "ממתין ל-PR אחר שעוד לא מוזג", "warning"));
        if (pr.Draft) f.Add(new("draft", "טיוטה", "neutral"));
        else if (pr.Review == "approved") f.Add(new("approved", "אושר", "healthy"));
        else if (waitingHours > WaitingHours) f.Add(new("waiting", $"ממתין {Math.Round(waitingHours / 24, MidpointRounding.AwayFromZero)} ימים", "warning"));
        if (pr.Review == "changes_requested") f.Add(new("changes", "התבקשו שינויים", "warning"));
        if (pr.ChangedFiles > BigPrFiles) f.Add(new("big", $"{pr.ChangedFiles} קבצים — שקלו לפצל", "warning"));
        if (pr.Checks == "passing") f.Add(new("green", "בדיקות עברו", "healthy"));
        return f;
    }

    /// <summary>
    /// The open requests in the order a person deals with them: a request whose base is another open request's branch
    /// hangs under it, then critical before warning before the rest, the longest-waiting first.
    /// </summary>
    public static List<PullRequestRow> Arrange(IReadOnlyList<PullRequestRow> raw, DateTimeOffset now)
    {
        var byHead = new Dictionary<string, PullRequestRow>();
        foreach (var p in raw) byHead.TryAdd($"{p.Repo.Id}|{p.HeadBranch}", p);
        var rows = raw.Select(p =>
        {
            var parent = byHead.GetValueOrDefault($"{p.Repo.Id}|{p.BaseBranch}");
            var waiting = (now - DateTimeOffset.Parse(p.UpdatedAt, CultureInfo.InvariantCulture)).TotalHours;
            return p with { ParentId = parent is not null && parent.Id != p.Id ? parent.Id : null, WaitingHours = waiting, Flags = FlagsFor(p, waiting, parent is not null) };
        }).ToList();
        static int Rank(PullRequestRow r) => r.Flags.Any(f => f.Tone == "critical") ? 0 : r.Flags.Any(f => f.Tone == "warning") ? 1 : 2;
        return rows.OrderBy(Rank).ThenByDescending(r => r.WaitingHours).ToList();
    }

    public static List<PrBlocker> BlockersFor(PullRequestRow pr, bool parentOpen, bool checksKnown)
    {
        // Nothing blocks a request that has already been merged or closed.
        if (pr.State != "open") return [];
        var b = new List<PrBlocker>
        {
            pr.Conflicts
                ? new("conflict", false, "קונפליקט מול היעד", "הענף והיעד נוגעים באותן שורות. צריך לעדכן את הענף ולהכריע איזו גרסה נשארת.")
                : new("conflict", pr.Mergeable is null ? null : true, pr.Mergeable is null ? "מצב המיזוג עדיין נבדק" : "אין קונפליקט",
                    pr.Mergeable is null ? "הגיט־האוסט עדיין בודק אם אפשר למזג. כדאי לרענן בעוד רגע." : "הגיט־האוסט מצא שאפשר למזג בלי הכרעה ידנית."),
            pr.Review switch
            {
                "approved" => new("review", true, "אושר בסקירה", "לפחות אדם אחד עבר על השינוי ואישר."),
                "changes_requested" => new("review", false, "התבקשו שינויים", "סוקר ביקש תיקון לפני המיזוג. הפרטים בגיט־האוסט."),
                _ => new("review", false, "אין אישור סקירה", "אף אחד עדיין לא אישר את השינוי. אפשר לעבור עליו ולאשר בכרטיס הסקירה שלך."),
            },
            !checksKnown
                ? new("checks", null, "אין בדיקות אוטומטיות", "לריפו הזה לא מוגדרות בדיקות. זה לא חוסם, אבל גם לא מגן.")
                : pr.Checks == "failing"
                    ? new("checks", false, "בדיקות אוטומטיות נכשלו", "הריפו מריץ בדיקות, והן לא עברו על הגרסה הזו.")
                    : pr.Checks == "running"
                        ? new("checks", null, "בדיקות רצות", "הבדיקות עדיין באמצע. כדאי לחכות לתוצאה.")
                        : new("checks", true, "הבדיקות עברו", "כל הבדיקות שהריפו מריץ הסתיימו בהצלחה."),
            parentOpen
                ? new("parent", false, "ממתין לבקשה אחרת", "היעד של הבקשה הזו הוא ענף של בקשה שעוד לא מוזגה. צריך למזג אותה קודם.")
                : new("parent", true, "אין בקשה שצריך למזג לפני", "הבקשה מכוונת ישירות לענף היעד."),
        };
        if (pr.Draft) b.Insert(0, new("draft", false, "הבקשה היא טיוטה", "טיוטה לא ניתנת למיזוג. כשהיא מוכנה, מסמנים אותה כמוכנה לסקירה בגיט־האוסט."));
        return b;
    }

    public static PrNextStep NextStepFor(PullRequestRow pr, IReadOnlyList<PrBlocker> blockers, int behind, int sharedFiles)
    {
        if (pr.State == "merged")
        {
            var when = pr.ClosedAt is { } c ? $" ב-{DateTimeOffset.Parse(c, CultureInfo.InvariantCulture).ToLocalTime():d.M.yyyy}" : "";
            return new("הבקשה כבר מוזגה", $"השינוי נכנס ל-{pr.BaseBranch}{when}. אין מה לעשות בה, והענף שלה אפשר למחוק אם לא נמחק.", "done");
        }
        if (pr.State == "closed") return new("הבקשה נסגרה בלי מיזוג", "השינוי לא נכנס. אם העבודה עדיין נחוצה, אפשר לפתוח בקשה חדשה מאותו ענף.", "done");
        if (sharedFiles > 0 || pr.Conflicts)
        {
            var thenReview = blockers.Any(b => b.Key == "review" && b.Ok == false) ? ", ואז בקשו סקירה" : "";
            var shared = sharedFiles > 0 ? $", ויש {(sharedFiles == 1 ? "קובץ אחד" : $"{sharedFiles} קבצים")} שגם הבקשה הזו משנה" : "";
            return new("עדכנו את הענף מהיעד" + thenReview, $"{pr.BaseBranch} התקדם ב-{behind} מאז שהענף נפתח{shared}. לכן מה שנבדק כאן אינו מה שיתקבל אחרי המיזוג.", "update_branch");
        }
        if (pr.Draft) return new("סמנו את הבקשה כמוכנה לסקירה", "כל עוד היא טיוטה, אף אחד לא מתבקש לעבור עליה והיא לא ניתנת למיזוג.", "open_host");
        var review = blockers.FirstOrDefault(b => b.Key == "review");
        if (review?.Ok == false && pr.Review == "changes_requested") return new("טפלו בשינויים שהתבקשו", "סוקר ביקש תיקון. אחרי שהוא ייכנס, בקשו סקירה חוזרת.", "open_host");
        if (review?.Ok == false) return new("בקשו סקירה", "הכול ירוק חוץ מאישור. עברו על השינוי וכתבו את החלטתכם בכרטיס הסקירה שלך.", "request_review");
        if (blockers.Any(b => b.Ok == false)) return new("יש חסימה שצריך לטפל בה", "ראו את הרשימה למעלה. המיזוג ייפתח כשכל השורות ירוקות.", "open_host");
        if (blockers.Any(b => b.Ok is null && b.Key == "checks")) return new("המתינו לסיום הבדיקות", "הבדיקות עדיין רצות. כשיסתיימו, אפשר למזג.", "wait");
        return new("אפשר למזג", $"כל התנאים מתקיימים. המיזוג יכניס את השינוי ל-{pr.BaseBranch}, ומשם הצוות יקבל אותו ב-pull הבא.", "merge");
    }

    // ── files, grouped the way a person reads them ───────────────────

    private sealed record GroupDef(string Key, string Title, string? Note, Func<string, bool> Match);

    [GeneratedRegex(@"(^|/)(bin|obj|dist|build|node_modules)/", RegexOptions.IgnoreCase)] private static partial Regex BuildDir();
    [GeneratedRegex(@"\.(dll|exe|pdb|map)$", RegexOptions.IgnoreCase)] private static partial Regex BuildFile();
    [GeneratedRegex(@"^CLAUDE\.md$|^AGENTS\.md$|^\.claude/", RegexOptions.IgnoreCase)] private static partial Regex Instructions();
    [GeneratedRegex(@"\.(md|mdx|txt|adoc)$", RegexOptions.IgnoreCase)] private static partial Regex DocFile();
    [GeneratedRegex(@"^docs/", RegexOptions.IgnoreCase)] private static partial Regex DocDir();
    [GeneratedRegex(@"\.(json|ya?ml|toml|ini|config|csproj|sln|editorconfig|gitignore|gitattributes)$", RegexOptions.IgnoreCase)] private static partial Regex ConfigFile();
    [GeneratedRegex(@"\.(ts|tsx|js|jsx|mjs|cjs|cs|py|go|rb|java|sql|css|html)$", RegexOptions.IgnoreCase)] private static partial Regex CodeFile();
    [GeneratedRegex(@"Entities\.cs$|OptionSets\.cs$|\.designer\.cs$|\.g\.ts$|packages/", RegexOptions.IgnoreCase)] private static partial Regex Generated();

    private static readonly GroupDef[] Groups =
    [
        new("build", "קבצי בנייה", "נוצרים מחדש בכל מחשב — בדרך כלל לא אמורים להיכנס", p => BuildDir().IsMatch(p) || BuildFile().IsMatch(p)),
        new("instructions", "הוראות ל-Claude", "משפיעות על כל מי שעובד בריפו", p => Instructions().IsMatch(p)),
        new("docs", "תיעוד", null, p => DocFile().IsMatch(p) || DocDir().IsMatch(p)),
        new("config", "הגדרות", null, p => ConfigFile().IsMatch(p) || p.StartsWith('.')),
        new("code", "קוד", null, p => CodeFile().IsMatch(p)),
    ];

    /// <summary>The host says "removed" and "renamed"; both would shorten to R, so the letters are named.</summary>
    private static readonly Dictionary<string, string> StatusLetter = new() { ["added"] = "A", ["modified"] = "M", ["removed"] = "D", ["renamed"] = "R", ["copied"] = "A", ["changed"] = "M" };

    public static List<PrFileGroup> GroupFiles(IEnumerable<HostFile> files)
    {
        var groups = new Dictionary<string, (GroupDef Def, List<PrFile> Files)>();
        foreach (var f in files)
        {
            var g = Groups.FirstOrDefault(x => x.Match(f.Filename)) ?? new GroupDef("other", "אחר", null, _ => true);
            if (!groups.TryGetValue(g.Key, out var cur)) groups[g.Key] = cur = (g, []);
            cur.Files.Add(new PrFile
            {
                Path = f.Filename, Status = StatusLetter.GetValueOrDefault(f.Status ?? "modified", "M"), Additions = f.Additions, Deletions = f.Deletions,
                Note = Generated().IsMatch(f.Filename) ? "נוצר אוטומטית — לא לערוך ידנית" : null, From = f.PreviousFilename,
            });
        }
        string[] order = ["code", "instructions", "config", "docs", "other", "build"];
        return order.Where(groups.ContainsKey).Select(k =>
        {
            var (def, list) = groups[k];
            return new PrFileGroup { Key = k, Title = def.Title, Note = def.Note, Files = list, Additions = list.Sum(x => x.Additions), Deletions = list.Sum(x => x.Deletions) };
        }).ToList();
    }

    // ── what the branch is about ─────────────────────────────────────

    [GeneratedRegex(@"^openspec/changes/([^/]+)/")] private static partial Regex OpenSpecChange();
    [GeneratedRegex(@"^(apps|packages)$")] private static partial Regex WorkspaceRoot();

    private static string Humanize(string slug) { var t = slug.Replace('-', ' '); return t.Length == 0 ? t : char.ToUpperInvariant(t[0]) + t[1..]; }
    private static string FilesLine(int n) => n == 1 ? "1 file" : $"{n} files";

    /// <summary>
    /// The subjects a branch touches, worked out from where its files are — no model involved. Each OpenSpec change
    /// it touches is a subject (its folder name is the subject's name); what is left is grouped by the part of the
    /// repository it lives in.
    /// </summary>
    public static List<PrTopic> TopicsOf(IEnumerable<HostFile> files)
    {
        var changes = new Dictionary<string, (int N, int Removed)>();
        var changeOrder = new List<string>();
        var areas = new Dictionary<string, int>();
        var areaOrder = new List<string>();
        foreach (var f in files)
        {
            var m = OpenSpecChange().Match(f.Filename);
            if (m.Success && m.Groups[1].Value != "archive")
            {
                var name = m.Groups[1].Value;
                if (!changes.TryGetValue(name, out var cur)) { cur = (0, 0); changeOrder.Add(name); }
                changes[name] = (cur.N + 1, cur.Removed + (f.Status == "removed" ? 1 : 0));
                continue;
            }
            var parts = f.Filename.Split('/');
            var area = parts.Length > 2 && WorkspaceRoot().IsMatch(parts[0]) ? $"{parts[0]}/{parts[1]}" : parts.Length > 1 ? parts[0] : "repository root";
            if (!areas.ContainsKey(area)) areaOrder.Add(area);
            areas[area] = areas.GetValueOrDefault(area) + 1;
        }
        // The OpenSpec changes are the branch's real subjects and come first; the parts of the repository follow.
        var outList = new List<PrTopic>();
        var live = changeOrder.Where(n => changes[n].Removed != changes[n].N).OrderByDescending(n => changes[n].N).ToList();
        // A change that was deleted outright is not a subject of this branch, only something it cleared away.
        var retired = changes.Count - live.Count;
        var minor = 0;
        for (var i = 0; i < live.Count; i++)
        {
            var n = changes[live[i]].N;
            // Past the first three, a change touched by a line or two is housekeeping, not a subject.
            if (i >= 3 && n < 2) { minor++; continue; }
            outList.Add(new(Humanize(live[i]), $"OpenSpec change · {FilesLine(n)}"));
        }
        if (minor > 0) outList.Add(new("Other OpenSpec changes touched", $"{minor} {(minor == 1 ? "change" : "changes")}, a line or two each"));
        foreach (var area in areaOrder.OrderByDescending(a => areas[a]).Take(3))
            outList.Add(new(area == "repository root" ? "Files in the repository root" : $"Code in {area}", FilesLine(areas[area])));
        if (retired > 0) outList.Add(new("Old OpenSpec changes removed", $"{retired} {(retired == 1 ? "change" : "changes")}"));
        return outList.Take(9).ToList();
    }

    /// <summary>
    /// <c>git merge-tree --write-tree --name-only</c>'s answer: the resulting tree on the first line, the conflicted
    /// paths after it up to the first blank line.
    /// </summary>
    public static (string Tree, List<string> Paths) ReadMergeTree(string output)
    {
        var lines = output.Split('\n').Select(l => l.Trim()).ToList();
        var end = lines.IndexOf("", 1);
        var paths = (end == -1 ? lines.Skip(1) : lines.Skip(1).Take(end - 1)).Where(l => l.Length > 0).ToList();
        return (lines.FirstOrDefault() ?? "", paths);
    }

    /// <summary>"owner/name" out of a host address.</summary>
    public static string? SlugOf(string? httpsUrl) =>
        httpsUrl is null ? null : Regex.Replace(Regex.Replace(httpsUrl, @"^https?://[^/]+/", ""), @"\.git$", "");

    /// <summary>A path written into a URL, each segment escaped.</summary>
    public static string EncodePath(string p) => string.Join('/', p.Split('/').Select(Uri.EscapeDataString));
}
