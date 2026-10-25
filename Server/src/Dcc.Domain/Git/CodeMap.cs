using System.Globalization;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Dcc.Domain.Git;

/// <summary>
/// The code map: one picture of where a piece of work sits in git, drawn the same way everywhere in DCC
/// (code-map.ts). Screens never compute it and never draw their own version: they ask for a <see cref="CodeMap"/>
/// and hand it to the one component that knows the visual language. Every dot is a real commit carrying its
/// subject, author, time, file count and link, so pressing one can say what it actually was.
/// </summary>
public sealed record CodeMapNode
{
    /// <summary>other, ours, attention (touches the same files as ours), current, merge, branchPoint, pr, uncommitted or empty.</summary>
    public required string Kind { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Title { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Sha { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Subject { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Author { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? At { get; init; }
    /// <summary>Files this commit touched, or files still unsaved.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? Files { get; init; }
    /// <summary>What the commit's author wrote about it, after the first line.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Message { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Url { get; init; }
    /// <summary>The same pull request inside DCC (a <c>#/…</c> address).</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? DccPath { get; init; }
    /// <summary>For a merge: the commits it brought in, oldest first.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public IReadOnlyList<BroughtCommit>? Brought { get; init; }
    /// <summary>One line in Hebrew: what this dot is, for someone who does not read git.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Detail { get; init; }
    /// <summary>For work that exists only on this computer: the folder it sits in.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Folder { get; init; }
}

public sealed record BroughtCommit(string Sha, string Subject);

public sealed record LaneStart(string Lane, int At);

public sealed record CodeMapLane
{
    public required string Id { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Label { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Note { get; init; }
    /// <summary>cloud, local or both — where this code exists right now.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Place { get; init; }
    /// <summary>Oldest first; the drawing lays them out newest-to-the-left.</summary>
    public required List<CodeMapNode> Nodes { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public LaneStart? From { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Name { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Url { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Detail { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Folder { get; init; }
}

/// <summary>A transfer between lines: push, pull, a pull request, a merge. <c>State</c>: done or pending.</summary>
public sealed record CodeMapArrow(string From, string To, string Label, string State);

public sealed record CodeMapProblem
{
    public required string Text { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Folder { get; init; }
}

/// <summary><c>Problem</c>: the folder could not be read as a git repository — said in words instead of drawing something wrong.</summary>
public sealed record CodeMap
{
    public required IReadOnlyList<CodeMapLane> Lanes { get; init; }
    public required IReadOnlyList<CodeMapArrow> Arrows { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Caption { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public CodeMapProblem? Problem { get; init; }
}

/// <summary>A commit as git (or the host) tells it. <c>Parents</c> are short shas — how a merge is tied to what it brought in.</summary>
public sealed record CodeMapCommit(string Sha, string Subject, string Author, string At, IReadOnlyList<string> Files, string? Body = null, bool Merge = false, IReadOnlyList<string>? Parents = null);

public sealed record CodeMapFacts
{
    public string BaseBranch { get; init; } = "main";
    public string? Branch { get; init; }
    public string? BaselineSha { get; init; }
    /// <summary>The branch point itself.</summary>
    public CodeMapCommit? BaselineCommit { get; init; }
    /// <summary>A little of what came before the branch point.</summary>
    public IReadOnlyList<CodeMapCommit> BaseBefore { get; init; } = [];
    /// <summary>What the base gained since we branched, oldest first.</summary>
    public IReadOnlyList<CodeMapCommit> BaseAfter { get; init; } = [];
    /// <summary>Our commits since the baseline, oldest first.</summary>
    public IReadOnlyList<CodeMapCommit> OurCommits { get; init; } = [];
    public int UncommittedFiles { get; init; }
    public int Behind { get; init; }
    /// <summary>How many of the commits that came in after the branch opened touch a file of ours. Needs each commit's own files.</summary>
    public int BehindTouching { get; init; }
    /// <summary>When the commits' own files are unknown: how many files both sides changed. Says nothing about which commit.</summary>
    public int? SharedFiles { get; init; }
    public bool Pushed { get; init; }
    public bool Merged { get; init; }
    public string? PrUrl { get; init; }
    public int? PrNumber { get; init; }
    public string? FetchedAt { get; init; }
    /// <summary>The repository on the host, for linking a commit.</summary>
    public string? RepoUrl { get; init; }
    /// <summary>DCC's own id for that repository: what lets a merge link to its request inside DCC.</summary>
    public Guid? RepoId { get; init; }
    /// <summary>false when a commit's files are not that commit's own list (a host answer that only knows the whole branch's files).</summary>
    public bool PerCommitFiles { get; init; } = true;
    /// <summary>The working folder these facts were read from.</summary>
    public string? Dir { get; init; }
    /// <summary>Set when the folder could not be read; nothing else in the facts is meaningful then.</summary>
    public string? Unreadable { get; init; }
}

public static partial class CodeMaps
{
    // A record separator and a field separator: git writes them, a subject or a path never contains them.
    private const char Rs = '\x1e';
    private const char Fs = '\x1f';

    /// <summary>One <c>git log</c> gives each commit and the files it touched: a header, then its paths one per line.</summary>
    public const string LogFormat = "%x1e%h%x1f%an%x1f%aI%x1f%s%x1f%b%x1f%P%x1f";

    public static List<CodeMapCommit> ParseLog(string output)
    {
        var commits = new List<CodeMapCommit>();
        foreach (var record in output.Split(Rs).Skip(1))
        {
            var f = record.Split(Fs);
            if (f.Length < 7 || f[0].Trim().Length == 0) continue;
            var parents = f[5].Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
            commits.Add(new CodeMapCommit(
                f[0].Trim(), f[3].Trim(), f[1].Trim(), f[2].Trim(),
                f[6].Split('\n').Select(x => x.Trim()).Where(x => x.Length > 0).ToList(),
                f[4].Trim() is { Length: > 0 } body ? body : null,
                parents.Length > 1,
                parents.Select(p => p.Length > 7 ? p[..7] : p).ToList()));
        }
        return commits;
    }

    private static string He(int n, string one, string many) => n == 1 ? one : $"{n} {many}";
    /// <summary>"One shared file" / "3 shared files" — what the host can tell when it does not say which commit touched what.</summary>
    private static string SharedFilesPhrase(int n) => He(n, "קובץ אחד משותף", "קבצים משותפים");
    private static string FilesLine(int n) => n == 1 ? "קובץ אחד" : $"{n} קבצים";
    private static string Short(string sha) => sha.Length > 7 ? sha[..7] : sha;

    /// <summary><c>onHost</c>: the commit exists on the host, so it has a page there. <c>folder</c>: it also exists in a folder on this computer.</summary>
    private static CodeMapNode NodeFrom(CodeMapCommit c, string kind, string? repoUrl, string detail, bool onHost, string? folder)
    {
        var title = $"{c.Sha} {c.Subject}";
        return new CodeMapNode
        {
            Kind = kind, Sha = c.Sha, Subject = c.Subject, Author = c.Author, At = c.At,
            Files = c.Files.Count > 0 ? c.Files.Count : null, Message = c.Body is { } b ? (b.Length > 1500 ? b[..1500] : b) : null,
            Url = onHost && repoUrl is not null ? $"{repoUrl}/commit/{c.Sha}" : null, Folder = folder, Detail = detail,
            Title = title.Length > 90 ? title[..90] : title,
        };
    }

    [GeneratedRegex(@"^Merge pull request #(\d+)\b")] private static partial Regex MergeRequestNumber();
    [GeneratedRegex(@"\(#(\d+)\)\s*$")] private static partial Regex SquashRequestNumber();

    /// <summary>Facts → the drawing. The only place that decides what the map shows.</summary>
    public static CodeMap From(CodeMapFacts f, string? branchLabel = null)
    {
        if (f.Unreadable is not null) return new CodeMap { Lanes = [], Arrows = [], Caption = f.Unreadable, Problem = new CodeMapProblem { Text = f.Unreadable, Folder = f.Dir } };
        // The folder the facts were read from: everything the map shows that exists there can be opened from it.
        var here = f.Dir;
        var baseNodes = new List<CodeMapNode>();
        foreach (var c in f.BaseBefore)
            baseNodes.Add(NodeFrom(c, c.Merge ? "merge" : "other", f.RepoUrl, c.Merge ? $"מיזוג ב-{f.BaseBranch} מלפני שהענף שלנו נפתח." : $"שינוי ב-{f.BaseBranch} מלפני שהענף שלנו נפתח.", true, here));
        var branchAt = baseNodes.Count;
        var pointDetail = $"הנקודה שממנה הענף שלנו יצא. כל מה שהיה ב-{f.BaseBranch} עד כאן נמצא גם אצלנו.";
        // The request's number, from "Merge pull request #7 …" or a squash commit's "… (#7)".
        string? DccPathFor(string subject)
        {
            var m = MergeRequestNumber().Match(subject);
            var n = m.Success ? m.Groups[1].Value : SquashRequestNumber().Match(subject) is { Success: true } s ? s.Groups[1].Value : null;
            return n is not null && f.RepoId is { } id ? $"#/pull-requests/{id}/{n}" : null;
        }
        var pointKind = f.BaseAfter.Count > 0 ? "branchPoint" : "current";
        var point = f.BaselineCommit is { } bc
            ? NodeFrom(bc, pointKind, f.RepoUrl, pointDetail, true, here) with { DccPath = DccPathFor(bc.Subject) }
            : new CodeMapNode { Kind = pointKind, Detail = pointDetail, Sha = f.BaselineSha is { } s0 ? Short(s0) : null };
        baseNodes.Add(point);

        var ourFiles = f.OurCommits.SelectMany(c => c.Files).ToHashSet();
        // What a merge brought in: the commits reachable from its later parents that are not already reachable from its
        // first — the first parent is the base line itself, the others are the branches folded in.
        var inList = new Dictionary<string, CodeMapCommit>();
        foreach (var c in f.BaseAfter) inList.TryAdd(Short(c.Sha), c);
        HashSet<string> Reach(IEnumerable<string> starts)
        {
            var seen = new HashSet<string>();
            var stack = new Stack<string>(starts);
            while (stack.Count > 0)
            {
                var s = Short(stack.Pop());
                if (seen.Contains(s) || !inList.TryGetValue(s, out var c)) continue;
                seen.Add(s);
                foreach (var p in c.Parents ?? []) stack.Push(p);
            }
            return seen;
        }
        List<BroughtCommit> BroughtBy(CodeMapCommit c)
        {
            var parents = c.Parents ?? [];
            var onBaseLine = Reach(parents.Take(1));
            return Reach(parents.Skip(1)).Where(s => !onBaseLine.Contains(s)).Select(s => inList[s])
                .OrderBy(x => x.At, StringComparer.Ordinal).Select(x => new BroughtCommit(x.Sha, x.Subject)).ToList();
        }
        // The order the base line changed in: what entered it, one step after another. A merge is one step, and the
        // commits it brought in come right before it; the newest step is last — the dot the arrow lands on. Anything not
        // tied to that chain (a list cut short) goes first, by time, so the newest step stays last.
        var isParent = f.BaseAfter.SelectMany(c => (c.Parents ?? []).Select(Short)).ToHashSet();
        var tip = f.BaseAfter.Where(c => !isParent.Contains(Short(c.Sha))).OrderByDescending(c => c.At, StringComparer.Ordinal).FirstOrDefault();
        var chain = new List<CodeMapCommit>();
        for (var c = tip; c is not null && chain.Count < f.BaseAfter.Count; c = c.Parents is { Count: > 0 } ps ? inList.GetValueOrDefault(Short(ps[0])) : null) chain.Add(c);
        chain.Reverse();
        var entered = new List<CodeMapCommit>();
        var placed = new HashSet<string>();
        void Put(CodeMapCommit? c) { if (c is not null && placed.Add(Short(c.Sha))) entered.Add(c); }
        foreach (var c in chain)
        {
            if (c.Merge) foreach (var b in BroughtBy(c)) Put(inList.GetValueOrDefault(Short(b.Sha)));
            Put(c);
        }
        var loose = f.BaseAfter.Where(c => !placed.Contains(Short(c.Sha))).OrderBy(c => c.At, StringComparer.Ordinal);
        var inOrder = loose.Concat(entered).ToList();
        for (var i = 0; i < inOrder.Count; i++)
        {
            var c = inOrder[i];
            var touching = c.Files.Any(ourFiles.Contains);
            var newest = i == inOrder.Count - 1;
            var detail = c.Merge
                ? $"מיזוג: הוא הכניס ל-{f.BaseBranch} אחרי שהתחלנו עבודה שנעשתה בענף אחר."
                : touching ? $"נכנס ל-{f.BaseBranch} אחרי שהתחלנו, ונוגע בקבצים שגם אנחנו שינינו." : $"נכנס ל-{f.BaseBranch} אחרי שהתחלנו, ולא נוגע בקבצים שלנו.";
            // A merge is drawn black, like the newest dot, wherever it sits on the base line.
            var node = NodeFrom(c, touching ? "attention" : newest ? "current" : c.Merge ? "merge" : "other", f.RepoUrl, detail, true, here);
            if (c.Merge && BroughtBy(c) is { Count: > 0 } brought) node = node with { Brought = brought };
            if (DccPathFor(c.Subject) is { } dcc) node = node with { DccPath = dcc };
            baseNodes.Add(node);
        }

        string? baseNote = null;
        if (f.Behind > 0)
        {
            var came = He(f.Behind, "שינוי אחד נכנס", "שינויים נכנסו");
            baseNote = !f.PerCommitFiles
                ? f.SharedFiles is > 0 ? $"{came} מאז · {SharedFilesPhrase(f.SharedFiles.Value)}" : $"{came} מאז שהתחלנו"
                : f.BehindTouching > 0 ? $"{came} מאז · {He(f.BehindTouching, "אחד נוגע", "נוגעים")} באותם קבצים" : $"{came} מאז שהתחלנו";
        }
        else if (f.FetchedAt is { } fetched)
        {
            var at = DateTimeOffset.Parse(fetched, CultureInfo.InvariantCulture).ToLocalTime();
            baseNote = $"נמשך {at:d.M}, {at:HH:mm}";
        }
        var baseLane = new CodeMapLane
        {
            Id = "base", Label = f.BaseBranch, Place = "both", Nodes = baseNodes, Name = f.BaseBranch, Folder = here, Note = baseNote,
            Url = f.RepoUrl is not null ? $"{f.RepoUrl}/tree/{Uri.EscapeDataString(f.BaseBranch)}" : null,
            Detail = "הענף הראשי של הריפו — הגרסה הרשמית, שכולם עובדים ממנה. כל שינוי מתמזג אליו בסוף, ורק אז הצוות מקבל אותו.",
        };

        // A commit is where it exists: pushed → a page on the host and the folder; not pushed → the folder only.
        var ourNodes = f.OurCommits.Select(c => NodeFrom(c, "ours", f.RepoUrl, f.Pushed
            ? $"שינוי שנשמר בענף שלנו. הענף כבר הועלה ל-GitHub, אבל השינוי הזה עדיין לא נמצא ב-{f.BaseBranch}{(f.PrUrl is not null ? ": בקשת המיזוג מבקשת להכניס אותו." : ", ועוד אין בקשת מיזוג שמבקשת להכניס אותו.")}"
            : "שינוי שנשמר בענף שלנו, עדיין רק במחשב הזה. הוא יופיע ב-GitHub אחרי שהענף יועלה.", f.Pushed, here)).ToList();
        if (f.UncommittedFiles > 0)
            ourNodes.Add(new CodeMapNode
            {
                Kind = "uncommitted", Files = f.UncommittedFiles, Folder = here, Subject = $"{FilesLine(f.UncommittedFiles)} שעוד לא נשמרו",
                Detail = "שינויים שקיימים בתיקייה אבל עדיין לא נשמרו ב-git. הם ייכנסו ב-commit של המסירה, לפי מה שתאשרו בסקירה.",
            });
        if (f.PrUrl is not null)
            ourNodes.Add(new CodeMapNode
            {
                Kind = "pr", Url = f.PrUrl, Subject = f.PrNumber is { } n ? $"בקשת מיזוג #{n}" : "בקשת מיזוג",
                Detail = $"בקשת מיזוג היא בקשה, לא העלאה: הענף כבר נמצא ב-GitHub. הבקשה מציעה להכניס אותו ל-{f.BaseBranch}, והמיזוג עצמו נעשה בגיט־האוסט, בלחיצה של אדם.",
            });
        if (ourNodes.Count == 0) ourNodes.Add(new CodeMapNode { Kind = "empty", Subject = "עדיין אין commits", Detail = "הענף נפתח, ועדיין לא נשמר בו שום שינוי.", Folder = here });
        var commitsPhrase = He(f.OurCommits.Count, "commit אחד", "commits");
        var ours = new CodeMapLane
        {
            Id = "ours", Label = branchLabel ?? f.Branch ?? "הענף שלנו", Place = f.Pushed ? "both" : "local", From = new LaneStart("base", branchAt), Nodes = ourNodes,
            Name = f.Branch,
            // A branch that was never pushed has no page on the host to open.
            Url = f.Pushed && f.RepoUrl is not null && f.Branch is not null ? $"{f.RepoUrl}/tree/{Uri.EscapeDataString(f.Branch)}" : null,
            Folder = here,
            Detail = $"הענף שבו העבודה הזו נעשית. {(f.Pushed ? "הוא כבר הועלה ל-GitHub, ויש לו עותק גם במחשב הזה." : "הוא קיים רק במחשב הזה ועדיין לא הועלה ל-GitHub.")}"
                + (f.OurCommits.Count > 0 ? $" יש בו {commitsPhrase} שעוד לא נמצאים ב-{f.BaseBranch}: העלאה לא מכניסה אותם לשם, את זה עושה בקשת מיזוג." : " עדיין לא נשמר בו שום שינוי."),
            Note = f.OurCommits.Count > 0
                ? $"{commitsPhrase}{(f.UncommittedFiles > 0 ? $" · {FilesLine(f.UncommittedFiles)} שעוד לא נשמרו" : "")}"
                : f.UncommittedFiles > 0 ? $"{FilesLine(f.UncommittedFiles)} שעוד לא נשמרו" : "נפתח מהנקודה הזו",
        };

        var arrows = new List<CodeMapArrow>();
        var hasWork = f.OurCommits.Count > 0 || f.UncommittedFiles > 0;
        if (f.Merged) arrows.Add(new("ours", "base", $"נמזג ל-{f.BaseBranch}", "done"));
        else if (f.PrUrl is not null) arrows.Add(new("ours", "base", f.PrNumber is { } n ? $"בקשה #{n} · ממתינה למיזוג" : "ממתינה למיזוג", "pending"));
        else if (f.Pushed && hasWork) arrows.Add(new("ours", "base", "הועלה, עדיין בלי בקשת מיזוג", "pending"));
        else if (hasWork) arrows.Add(new("ours", "base", "טרם הועלה ל-GitHub", "pending"));

        var lanes = new List<CodeMapLane> { baseLane, ours };
        if (!f.PerCommitFiles)
            lanes = lanes.Select(l => l with { Nodes = l.Nodes.Select(n => n with { Files = null }).ToList() }).ToList();
        return new CodeMap { Lanes = lanes, Arrows = arrows, Caption = Caption(f) };
    }

    /// <summary>The one sentence under the drawing: what the picture means for the person.</summary>
    public static string Caption(CodeMapFacts f)
    {
        if (f.Merged) return $"העבודה נכנסה ל-{f.BaseBranch}.";
        if (f.Behind == 0 && !f.Pushed) return $"העבודה יושבת על הגרסה העדכנית של {f.BaseBranch}, ועדיין לא יצאה מהמחשב.";
        if (f.Behind == 0) return $"העבודה יושבת על הגרסה העדכנית של {f.BaseBranch}.";
        if (!f.PerCommitFiles && f.SharedFiles is > 0) return $"{f.BaseBranch} התקדם ב-{f.Behind} מאז שהתחלנו, ויש {SharedFilesPhrase(f.SharedFiles.Value)} שגם אנחנו שינינו — כדאי לעדכן את הענף לפני המיזוג.";
        if (f.PerCommitFiles && f.BehindTouching > 0) return $"{f.BaseBranch} התקדם ב-{f.Behind} מאז שהתחלנו, ו-{f.BehindTouching} מהם נוגעים באותם קבצים — כדאי לעדכן את הענף לפני המיזוג.";
        return $"{f.BaseBranch} התקדם ב-{f.Behind} מאז שהתחלנו, ואף אחד מהם לא נוגע בקבצים שלנו.";
    }
}
