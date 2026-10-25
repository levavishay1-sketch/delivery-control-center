using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Audit;
using Dcc.Domain.PullRequests;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Repos;
using Dcc.Infrastructure.Tasks;

namespace Dcc.Infrastructure.PullRequests;

public sealed record ConflictFileContent
{
    public required string Path { get; init; }
    /// <summary>The file as the merge left it — the text a person edits, markers and all.</summary>
    public required string Content { get; init; }
    public required IReadOnlyList<Segment> Segments { get; init; }
    /// <summary>How many places have to be decided in this file.</summary>
    public int Conflicts { get; init; }
    /// <summary>false when git left no markers to choose between — then only the command line will do.</summary>
    public bool Resolvable { get; init; }
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] public string? Why { get; init; }
    /// <summary>The whole file on the request's branch, and on the target, so a conflict is seen inside its file.</summary>
    public required string OursFile { get; init; }
    public required string TheirsFile { get; init; }
}

/// <summary><c>Head</c> is the request's own branch — "ours" everywhere; <c>Base</c> the branch it is going into.</summary>
public sealed record ConflictContent(string Head, string Base, string HeadSha, string BaseSha, IReadOnlyList<ConflictFileContent> Files, bool NeedsCommandLine);

public sealed record ResolvedFile(string Path, string Content);

/// <summary>The decisions, and the two commits they were made on — so a branch that moved meanwhile is refused, not merged blind.</summary>
public sealed record ConflictDecision(IReadOnlyList<ResolvedFile> Files, string? HeadSha, string? BaseSha);

/// <summary>
/// Resolving a conflict from inside DCC (pull-request-conflict.ts) — the decision GitHub's web editor makes, plus the
/// per-side choice it does not offer. Three rules hold it: nothing touches a working copy (the merge is built with
/// plumbing into an index of its own — merge-tree, hash-object, commit-tree; no checkout, no branch switch); the
/// result is an ordinary merge commit on the request's branch, branch first and target second, pushed as the person
/// and never forced; and a file is only offered when git left markers in it.
/// </summary>
public sealed class ConflictService(PullRequestService prs, PullRequestCache cache, RepoCheckouts checkouts, TaskStore store, ITenantScope tenant, IAuditLog audit)
{
    private static AppException Refused(string message) => AppException.Conflict("conflict_refused", message);
    private static string Cut(string s, int n) => s.Length > n ? s[..n] : s;

    private async Task<(PullRequestRow Pr, PrRepoRow Repo, string Dir)> OpenRequestAsync(Guid repoId, int number, CancellationToken ct)
    {
        var pr = (await prs.ListAllAsync(false, ct)).Rows.FirstOrDefault(r => r.Repo.Id == repoId && r.Number == number)
            ?? throw Refused("הבקשה כבר לא פתוחה, ולכן אין בה קונפליקט לפתור.");
        // The repository's copy: the developer's own folder when one is set — nothing here touches its working tree.
        if (!pr.Conflicts) throw Refused("אין קונפליקט בבקשה הזו כרגע. רעננו את המסך.");
        var r = await prs.RepoAsync(repoId, ct);
        var dir = await checkouts.EnsureAsync(r.Ref) ?? throw Refused($"אין עותק של {r.Name} שאפשר לעבוד בו. פתרו מהטרמינל, או חברו את המאגר מחדש.");
        return (pr, r, dir);
    }

    /// <summary>The merge, computed but not kept: the tree git would produce, and the files it could not settle.</summary>
    private static async Task<(string HeadSha, string BaseSha, string Tree, List<string> Paths)> MergeStateAsync(string dir, string @base, string head)
    {
        var fetched = await Git.FetchBranchesAsync(dir, 300_000, @base, head);
        if (!fetched.Ok) throw Refused($"לא הצלחנו להביא את הענפים מהגיט־האוסט: {Cut(fetched.Out, 200)}");
        async Task<string> Sha(string rev) { var r = await Git.RunAsync(["rev-parse", "--verify", "--quiet", rev], dir); return r.Ok ? Git.ShaOf(r.Out) : ""; }
        var headSha = await Sha($"origin/{head}");
        var baseSha = await Sha($"origin/{@base}");
        if (headSha.Length == 0 || baseSha.Length == 0) throw Refused("אחד הענפים לא נמצא בגיט־האוסט. רעננו את המסך.");
        // The request's branch first, so "ours" is the person's own work — the side GitHub shows first, since it merges the target INTO the branch.
        var m = await Git.RunAsync(["merge-tree", "--write-tree", "--name-only", "--no-messages", $"origin/{head}", $"origin/{@base}"], dir, 120_000);
        if (m.Code == 0) throw Refused("הענפים מתמזגים בלי קונפליקט. רעננו את המסך — ייתכן שמישהו כבר פתר אותו.");
        if (m.Code != 1) throw Refused($"חישוב המיזוג נכשל: {Cut(m.Out, 200)}");
        var (tree, paths) = PullRequestRules.ReadMergeTree(m.Out);
        return (headSha, baseSha, tree, paths);
    }

    public async Task<ConflictContent> ContentAsync(Guid repoId, int number, CancellationToken ct)
    {
        var (pr, _, dir) = await OpenRequestAsync(repoId, number, ct);
        var m = await MergeStateAsync(dir, pr.BaseBranch, pr.HeadBranch);
        var files = new List<ConflictFileContent>();
        foreach (var p in m.Paths)
        {
            // Read whole and untrimmed: a decision saved from a trimmed file would quietly drop its final newline.
            var shown = await Git.ShowAsync(dir, m.Tree, p);
            var content = shown ?? "";
            var oursFile = await Git.ShowAsync(dir, $"origin/{pr.HeadBranch}", p) ?? "";
            var theirsFile = await Git.ShowAsync(dir, $"origin/{pr.BaseBranch}", p) ?? "";
            if (shown is null || !ConflictText.HasMarkers(content) || content.Contains('\0'))
            {
                files.Add(new ConflictFileContent
                {
                    Path = p, Content = "", Segments = [], Conflicts = 0, Resolvable = false, OursFile = oursFile, TheirsFile = theirsFile,
                    Why = content.Contains('\0') ? "קובץ בינארי — אי אפשר לבחור בין שתי גרסאות שלו כאן." : "הקונפליקט בקובץ הזה אינו על שורות שנכתבו אחרת (למשל קובץ שנמחק בצד אחד ושונה בשני), ולכן אין בין מה לבחור.",
                });
                continue;
            }
            var segments = ConflictText.Split(content);
            files.Add(new ConflictFileContent { Path = p, Content = content, Segments = segments, Conflicts = segments.Count(s => s is ConflictSegment), Resolvable = true, OursFile = oursFile, TheirsFile = theirsFile });
        }
        return new ConflictContent(pr.HeadBranch, pr.BaseBranch, m.HeadSha, m.BaseSha, files, files.Count > 0 && files.All(f => !f.Resolvable));
    }

    /// <summary>The merge commit the decisions produce — built and kept in the repository's object store, pushed by nobody.</summary>
    private async Task<(string Sha, List<string> Paths)> BuildMergeAsync(PullRequestRow pr, string dir, ConflictDecision decision, Guid userId, CancellationToken ct)
    {
        var m = await MergeStateAsync(dir, pr.BaseBranch, pr.HeadBranch);
        // Decided on other commits than the ones there now: a decision is about the text it was made on, so it is refused, not applied to the new tip.
        if ((decision.HeadSha is { Length: > 0 } h && !m.HeadSha.StartsWith(h, StringComparison.OrdinalIgnoreCase)) || (decision.BaseSha is { Length: > 0 } b && !m.BaseSha.StartsWith(b, StringComparison.OrdinalIgnoreCase)))
            throw Refused($"הענף {pr.HeadBranch} או היעד {pr.BaseBranch} השתנו מאז שפתחתם את המסך, ולכן ההכרעה לא נשמרה. רעננו והכריעו שוב על המצב החדש.");
        var given = new Dictionary<string, string>();
        foreach (var f in decision.Files) given[f.Path] = f.Content;
        var missing = m.Paths.Where(p => !given.ContainsKey(p)).ToList();
        if (missing.Count > 0) throw Refused($"עוד לא הוכרעו כל הקבצים: {string.Join(", ", missing.Take(3))}{(missing.Count > 3 ? " ועוד" : "")}.");
        foreach (var (p, content) in given)
        {
            if (!m.Paths.Contains(p)) throw Refused($"הקובץ {p} אינו בקונפליקט של הבקשה הזו.");
            if (ConflictText.HasMarkers(content)) throw Refused($"בקובץ {p} נשארו סימני קונפליקט (<<<<<<<). הכריעו בכל מקום לפני השמירה.");
        }

        var work = Directory.CreateTempSubdirectory("dcc-conflict-").FullName;
        var env = new Dictionary<string, string> { ["GIT_INDEX_FILE"] = Path.Combine(work, "index") };
        try
        {
            // The merged tree as git built it, then each decided file written over it, in an index of its own.
            var read = await Git.RunAsync(["read-tree", m.Tree], dir, env: env, ct: ct);
            if (!read.Ok) throw Refused($"הכנת המיזוג נכשלה: {Cut(read.Out, 200)}");
            foreach (var (p, content) in given)
            {
                var tmp = Path.Combine(work, "blob");
                await File.WriteAllTextAsync(tmp, content, new System.Text.UTF8Encoding(false), ct);
                var blob = await Git.RunAsync(["hash-object", "-w", "--path", p, tmp], dir, ct: ct);
                var blobSha = Git.ShaOf(blob.Out);
                if (!blob.Ok || blobSha.Length == 0) throw Refused($"שמירת {p} נכשלה: {Cut(blob.Out, 200)}");
                var listed = await Git.RunAsync(["ls-tree", m.Tree, "--", p], dir, ct: ct);
                var mode = listed.Out.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "100644";
                var upd = await Git.RunAsync(["update-index", "--add", "--cacheinfo", $"{mode},{blobSha},{p}"], dir, env: env, ct: ct);
                if (!upd.Ok) throw Refused($"שמירת {p} נכשלה: {Cut(upd.Out, 200)}");
            }
            var tree = await Git.RunAsync(["write-tree"], dir, env: env, ct: ct);
            var treeSha = Git.ShaOf(tree.Out);
            if (!tree.Ok || treeSha.Length == 0) throw Refused($"בניית המיזוג נכשלה: {Cut(tree.Out, 200)}");

            var (name, email) = await store.CommitIdentityAsync(userId, ct);
            var message = $"Merge {pr.BaseBranch} into {pr.HeadBranch}\n\nConflicts resolved in DCC by {name}:\n{string.Join('\n', m.Paths.Select(p => $"- {p}"))}\n";
            var commit = await Git.RunAsync(["-c", $"user.name={name}", "-c", $"user.email={email}", "commit-tree", treeSha, "-p", m.HeadSha, "-p", m.BaseSha, "-m", message], dir, ct: ct);
            var commitSha = Git.ShaOf(commit.Out);
            if (!commit.Ok || commitSha.Length == 0) throw Refused($"יצירת קומיט המיזוג נכשלה: {Cut(commit.Out, 200)}");
            return (commitSha, m.Paths);
        }
        finally
        {
            try { Directory.Delete(work, recursive: true); } catch (IOException) { }
        }
    }

    /// <summary>
    /// The person's decision, written to the request's branch: one merge commit carrying their resolved files, pushed in
    /// their name. Never forced — a branch that moved since they opened the screen refuses the push, and they are told
    /// to look again rather than have their work overwrite somebody's.
    /// </summary>
    public async Task<JsonObject> ResolveAsync(Guid repoId, int number, Guid userId, ConflictDecision decision, CancellationToken ct)
    {
        var (pr, r, dir) = await OpenRequestAsync(repoId, number, ct);
        var built = await BuildMergeAsync(pr, dir, decision, userId, ct);
        var push = await Git.RunAsync(["push", "origin", $"{built.Sha}:refs/heads/{pr.HeadBranch}"], dir, 180_000);
        if (!push.Ok)
        {
            var moved = System.Text.RegularExpressions.Regex.IsMatch(push.Out, "non-fast-forward|fetch first|rejected", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            throw Refused(moved
                ? $"הענף {pr.HeadBranch} השתנה בגיט־האוסט מאז שפתחתם את המסך, ולכן לא דחפנו כלום. רעננו והכריעו שוב על המצב החדש."
                : $"הדחיפה נכשלה: {Cut(push.Out, 300)}");
        }
        // The request changed on the host a moment ago; what DCC cached about it is now wrong for everyone, not only this screen.
        cache.Forget(repoId, number);
        await audit.WriteAsync(new AuditEntry(userId, "pull_request.conflict_resolved", "pull_request", $"{repoId}/{number}",
            After: new { repo = r.Name, number, branch = pr.HeadBranch, @base = pr.BaseBranch, commit = built.Sha, files = built.Paths }), ct);
        if (r.ClientId is { } clientId)
        {
            // The merge is pushed; the record is best effort.
            try
            {
                await tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d, """
                    insert into repo_ai_event (client_id, repo_id, type, payload, actor_user_id) values (@c, @r, 'pull_request.conflict_resolved', @p::jsonb, @u)
                    """, new { c = clientId, r = repoId, u = userId, p = new JsonObject
                    {
                        ["number"] = pr.Number, ["branch"] = pr.HeadBranch, ["base"] = pr.BaseBranch, ["commit"] = built.Sha,
                        ["files"] = new JsonArray(built.Paths.Select(x => (JsonNode?)x).ToArray()),
                    }.ToJsonString() }, ct), ct);
            }
            catch (Npgsql.NpgsqlException) { }
        }
        return new JsonObject { ["commitSha"] = built.Sha[..Math.Min(7, built.Sha.Length)], ["branch"] = pr.HeadBranch, ["base"] = pr.BaseBranch, ["files"] = built.Paths.Count };
    }

    /// <summary>What the decisions produce, checked before anything leaves the machine — built, then the repository's own checks run against it. Nothing is pushed.</summary>
    public async Task<VerifyResult> VerifyAsync(Guid repoId, int number, Guid userId, ConflictDecision decision, CancellationToken ct)
    {
        var (pr, _, dir) = await OpenRequestAsync(repoId, number, ct);
        var built = await BuildMergeAsync(pr, dir, decision, userId, ct);
        return await MergeVerifier.VerifyCommitAsync(checkouts.VerifyRoot, dir, built.Sha, $"{repoId.ToString()[..8]}-{number}");
    }

}
