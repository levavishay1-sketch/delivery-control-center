using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Dcc.Application.Common;
using Dcc.Domain.Audit;
using Dcc.Domain.Git;
using Dcc.Domain.PullRequests;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Repos;

namespace Dcc.Infrastructure.PullRequests;

public sealed record WatchedRepo
{
    public required Guid Id { get; init; }
    public required string Name { get; init; }
    public Guid? ClientId { get; init; }
    public string? ClientName { get; init; }
    /// <summary>github, ado, or null when the repository has no git address.</summary>
    public string? Provider { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Reason { get; init; }
}

public sealed record HostProblem(string Repo, string Reason);

/// <summary>The open requests, the recent merged and closed ones, which repositories were watched, and what could not be reached.</summary>
public sealed record PullRequestList(IReadOnlyList<PullRequestRow> Rows, IReadOnlyList<PullRequestRow> History, IReadOnlyList<WatchedRepo> Repos, string SyncedAt, IReadOnlyList<HostProblem> Problems);

public sealed record PullRequestQuick(PullRequestRow Pr, IReadOnlyList<PrBlocker> Blockers, PrNextStep NextStep);

/// <summary><c>SharedFiles</c>: files both the target and this request changed — the host does not say which commit touched which.</summary>
public sealed record PrFreshness(int Behind, int SharedFiles, int Ahead, string BaseBranch);

/// <summary>The two versions a file is compared between: where the branch left the base, and where it is now.</summary>
public sealed record PrRefs(string Base, string Head);

public sealed record PullRequestDetail(
    PullRequestRow Pr, IReadOnlyList<PrBlocker> Blockers, PrNextStep NextStep, CodeMap? CodeMap, string? CodeMapProblem, PrFreshness? Freshness,
    IReadOnlyList<PrFileGroup> Groups, PrConflictView? Conflict, IReadOnlyList<PrTopic> Topics, PrRefs? Refs, int FileCount, IReadOnlyList<PrTimelineItem> Timeline, string Body);

public sealed record RepoBranches(string DefaultBranch, IReadOnlyList<BranchHealth> Rows, string SyncedAt);

/// <summary>
/// What DCC remembers of the hosts' answers, briefly: the list for a minute, a request's detail for 45 seconds (its
/// file addresses for three minutes), a repository's branches for a minute. A write DCC makes forgets what it changed.
/// One per process — every person reads the same hosts.
/// </summary>
public sealed class PullRequestCache
{
    public static readonly TimeSpan ListTtl = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan DetailTtl = TimeSpan.FromSeconds(45);
    public static readonly TimeSpan FileTtl = TimeSpan.FromMinutes(3);
    public static readonly TimeSpan BranchesTtl = TimeSpan.FromSeconds(60);

    public (DateTimeOffset At, PullRequestList List)? List;
    public readonly ConcurrentDictionary<string, (DateTimeOffset At, PullRequestDetail Value)> Details = new();
    public readonly ConcurrentDictionary<string, (DateTimeOffset At, PullRequestDetail Value)> KeptForFiles = new();
    public readonly ConcurrentDictionary<Guid, (DateTimeOffset At, RepoBranches Value)> Branches = new();

    /// <summary>Everything remembered about one request, dropped — the write paths know it just became untrue.</summary>
    public void Forget(Guid repoId, int number)
    {
        Details.TryRemove($"{repoId}:{number}", out _);
        KeptForFiles.TryRemove($"{repoId}:{number}", out _);
        List = null;
    }
}

/// <summary>
/// Pull requests across every client, from the hosts DCC is connected to (pull-requests.ts, pull-request-detail.ts,
/// pull-request-review.ts, repo-branches.ts). The host stays the source of truth: this reads, links what DCC knows
/// (which client, which repository) and says what is waiting. Everything comes from the host, not from a local clone —
/// a person's machine may not have the branch at all; when the host cannot answer, the screen says so rather than
/// guessing. Every review, merge and conflict decision sent to a host is recorded in DCC's audit log under the person.
/// </summary>
public sealed class PullRequestService(DccDbContext db, IEnumerable<IPullRequestHost> hosts, PullRequestCache cache, RepoCheckouts checkouts, IAuditLog audit)
{
    public static string Now() => DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);

    private const string RepoColumns = """r.id, r.name, r.ado_repo_ref as "adoRepoRef", r.local_path as "localPath", r.client_id as "clientId", c.name as "clientName" """;

    private static PrRepoRow ToRepo(JsonObject r) => new(
        Guid.Parse(r["id"]!.GetValue<string>()), r["name"]!.GetValue<string>(), r["adoRepoRef"]?.GetValue<string>(), r["localPath"]?.GetValue<string>(),
        r["clientId"]?.GetValue<string>() is { } c ? Guid.Parse(c) : null, r["clientName"]?.GetValue<string>());

    public async Task<PrRepoRow> RepoAsync(Guid repoId, CancellationToken ct) =>
        await SqlJson.QuerySingleAsync(db, $"select {RepoColumns} from repo r left join client c on c.id = r.client_id where r.id = @id", new { id = repoId }, ct) is { } r
            ? ToRepo(r) : throw new AppException(404, "not_found", "המאגר לא נמצא");

    private IPullRequestHost? HostOf(PrRepoRow r) => hosts.FirstOrDefault(h => h.Handles(r));

    private IPullRequestHost RequireHost(PrRepoRow r) => HostOf(r) ?? throw AppException.Conflict("no_host_address", "אין לריפו הזה כתובת של GitHub או של Azure DevOps.");

    /// <summary>
    /// The repositories a person may see requests of: a client's own repository, or a shared one linked to a client,
    /// where they hold the permission; a shared repository linked to no client only with it globally. null = all.
    /// </summary>
    public async Task<HashSet<Guid>?> VisibleReposAsync(IReadOnlySet<Guid>? allowed, CancellationToken ct)
    {
        if (allowed is null) return null;
        var ids = await SqlJson.QueryAsync(db, """
            select r.id from repo r
            where r.client_id = any(@ids) or exists (select 1 from client_repo cr where cr.repo_id = r.id and cr.client_id = any(@ids))
            """, new { ids = allowed.ToArray() }, ct);
        return ids.Select(x => Guid.Parse(x["id"]!.GetValue<string>())).ToHashSet();
    }

    // ── the list ─────────────────────────────────────────────────────

    /// <summary>Every open request DCC can see, with what DCC knows about it added — and the recent merged and closed ones after it.</summary>
    public async Task<PullRequestList> ListAllAsync(bool refresh, CancellationToken ct)
    {
        if (!refresh && cache.List is { } hit && DateTimeOffset.UtcNow - hit.At < PullRequestCache.ListTtl) return hit.List;
        var repos = (await SqlJson.QueryAsync(db, $"select {RepoColumns} from repo r left join client c on c.id = r.client_id order by r.name", null, ct)).Select(ToRepo).ToList();
        var watched = new WatchedRepo[repos.Count];
        var problems = new ConcurrentBag<HostProblem>();
        var open = new ConcurrentBag<PullRequestRow>();
        var past = new ConcurrentBag<PullRequestRow>();
        // One repository's host call must not wait for another's.
        await Task.WhenAll(repos.Select(async (r, i) =>
        {
            var entry = new WatchedRepo { Id = r.Id, Name = r.Name, ClientId = r.ClientId, ClientName = r.ClientName };
            if (r.Url is null) { watched[i] = entry with { Reason = "אין כתובת git לריפו" }; return; }
            if (HostOf(r) is not { } host) { watched[i] = entry with { Reason = "המארח של הריפו הזה עדיין לא מחובר למסך הזה" }; return; }
            if (await host.UnavailableAsync(r, ct) is { } why) { watched[i] = entry with { Provider = host.Id, Reason = why }; return; }
            watched[i] = entry with { Provider = host.Id };
            try
            {
                var (o, d) = await host.ListAsync(r, ct);
                foreach (var p in o) open.Add(p);
                foreach (var p in d) past.Add(p);
            }
            catch (Exception e) when (e is InvalidOperationException or AppException)
            {
                problems.Add(new HostProblem(r.Name, e.Message.Length > 160 ? e.Message[..160] : e.Message));
            }
        }));

        // A stable order across refreshes: the hosts answer in parallel, the screen should not reshuffle because of it.
        var rows = PullRequestRules.Arrange(open.OrderBy(p => p.Repo.Name, StringComparer.Ordinal).ThenBy(p => p.Number).ToList(), DateTimeOffset.UtcNow);
        var history = past.OrderByDescending(p => p.ClosedAt ?? p.UpdatedAt, StringComparer.Ordinal).ToList();
        var list = new PullRequestList(rows, history, watched, Now(), problems.OrderBy(p => p.Repo, StringComparer.Ordinal).ToList());
        cache.List = (DateTimeOffset.UtcNow, list);
        return list;
    }

    /// <summary>The list narrowed to the repositories a person may see.</summary>
    public async Task<PullRequestList> ListAsync(HashSet<Guid>? visible, bool refresh, CancellationToken ct)
    {
        var all = await ListAllAsync(refresh, ct);
        if (visible is null) return all;
        var names = all.Repos.Where(r => visible.Contains(r.Id)).Select(r => r.Name).ToHashSet();
        return all with
        {
            Rows = all.Rows.Where(r => visible.Contains(r.Repo.Id)).ToList(),
            History = all.History.Where(r => visible.Contains(r.Repo.Id)).ToList(),
            Repos = all.Repos.Where(r => visible.Contains(r.Id)).ToList(),
            Problems = all.Problems.Where(p => names.Contains(p.Repo)).ToList(),
        };
    }

    private static PullRequestRow? Find(PullRequestList list, Guid repoId, int number) =>
        list.Rows.FirstOrDefault(r => r.Repo.Id == repoId && r.Number == number) ?? list.History.FirstOrDefault(r => r.Repo.Id == repoId && r.Number == number);

    private static AppException NotFound() => new(404, "not_found", "בקשת המיזוג לא נמצאה");

    /// <summary>The open request, or a refusal in words.</summary>
    public async Task<PullRequestRow> OpenRequestAsync(Guid repoId, int number, string whenGone, CancellationToken ct) =>
        (await ListAllAsync(false, ct)).Rows.FirstOrDefault(r => r.Repo.Id == repoId && r.Number == number) ?? throw AppException.Conflict("review_refused", whenGone);

    /// <summary>What the screen can show at once: the header, what blocks the merge and the next step — from the list already held.</summary>
    public async Task<PullRequestQuick> QuickAsync(Guid repoId, int number, CancellationToken ct)
    {
        var pr = Find(await ListAllAsync(false, ct), repoId, number) ?? throw NotFound();
        var blockers = PullRequestRules.BlockersFor(pr, pr.ParentId is not null, pr.Checks != "none");
        return new PullRequestQuick(pr, blockers, PullRequestRules.NextStepFor(pr, blockers, 0, 0));
    }

    // ── one request ──────────────────────────────────────────────────

    /// <summary>
    /// The files that really clash, found by running the merge in the local copy — read-only: merge-tree writes
    /// objects and touches neither the working folder nor any branch, and fetch only moves remote-tracking refs. null
    /// when it cannot say, and the caller falls back to the files both sides changed.
    /// </summary>
    private async Task<List<string>?> ClashingFilesAsync(PrRepoRow r, string @base, string head)
    {
        var dir = checkouts.Existing(r.Ref);
        if (dir is null) return null;
        if (!(await Git.FetchBranchesAsync(dir, 120_000, @base, head)).Ok) return null;
        var m = await Git.RunAsync(["merge-tree", "--write-tree", "--name-only", "--no-messages", $"origin/{@base}", $"origin/{head}"], dir, 60_000);
        // 0 = merges cleanly, 1 = conflicts, anything else = the command itself failed.
        if (m.Code != 1) return m.Code == 0 ? [] : null;
        return PullRequestRules.ReadMergeTree(m.Out).Paths;
    }

    public async Task<PullRequestDetail> DetailAsync(Guid repoId, int number, bool refresh, CancellationToken ct)
    {
        var key = $"{repoId}:{number}";
        if (!refresh && cache.Details.TryGetValue(key, out var hit) && DateTimeOffset.UtcNow - hit.At < PullRequestCache.DetailTtl) return hit.Value;
        var pr = Find(await ListAllAsync(refresh, ct), repoId, number) ?? throw NotFound();
        var r = await RepoAsync(repoId, ct);
        var h = HostOf(r) is { } host ? await host.DetailAsync(r, pr, ct) : new HostDetail();

        // A comparison names each file and says what happened to it; without one, the request's own list stands in.
        var files = (h.OurFiles is { Count: > 0 } of ? of : h.Files).ToList();
        var groups = PullRequestRules.GroupFiles(files);
        var ourPaths = (h.OurFiles ?? []).Select(f => f.Filename).ToHashSet();
        // Which of the base's new files this request also changes.
        var overlap = (h.TheirFiles ?? []).Select(f => f.Filename).Distinct().Where(ourPaths.Contains).ToList();
        var compared = h.OurFiles is not null && h.TheirFiles is not null;

        // When the host says the request conflicts, say WHERE: the exact files from a real merge in the local copy, or
        // the files both sides changed, marked as suspects.
        PrConflictView? conflict = null;
        if (pr.State == "open" && pr.Conflicts)
        {
            static PrLineCount? Size(IReadOnlyList<HostFile>? list, string p) => list?.FirstOrDefault(f => f.Filename == p) is { } f ? new PrLineCount(f.Additions, f.Deletions) : null;
            var exact = await ClashingFilesAsync(r, pr.BaseBranch, pr.HeadBranch);
            var paths = exact is { Count: > 0 } ? exact : overlap;
            conflict = new PrConflictView(exact is { Count: > 0 }, paths.Select(p => new PrConflictFile(p, Size(h.OurFiles, p), Size(h.TheirFiles, p))).ToList());
        }

        CodeMap? codeMap = null;
        string? codeMapProblem = null;
        if (pr.State != "open")
            codeMapProblem = pr.State == "merged" ? "הבקשה כבר מוזגה, ולכן אין מפה חיה של מיקום הענף. רשימת הקבצים והיומן מציגים מה נכנס." : "הבקשה נסגרה, ולכן אין מפה חיה של מיקום הענף.";
        else if (!compared)
            codeMapProblem = "אין כרגע מידע מהגיט־האוסט על הענף הזה, ולכן אי אפשר לצייר את מיקומו. נסו לרענן.";
        else
            codeMap = CodeMaps.From(new CodeMapFacts
            {
                BaseBranch = pr.BaseBranch, RepoId = repoId, Branch = pr.HeadBranch, BaselineSha = h.MergeBaseSha is { } mbs ? mbs[..Math.Min(7, mbs.Length)] : null,
                BaselineCommit = h.MergeBase,
                // The host lists only the files both sides changed, not which commit changed what — so no commit is drawn as "touching".
                BaseAfter = h.TheirCommits.Select(c => c with { Files = [] }).ToList(), OurCommits = h.OurCommits,
                Behind = h.Behind, SharedFiles = overlap.Count, PerCommitFiles = false, Pushed = true, PrUrl = pr.Url, PrNumber = pr.Number, RepoUrl = r.Url,
            }, pr.HeadBranch);

        var blockers = PullRequestRules.BlockersFor(pr, pr.ParentId is not null, pr.Checks != "none");
        var nextStep = PullRequestRules.NextStepFor(pr, blockers, h.Behind, overlap.Count);

        var timeline = new List<PrTimelineItem>();
        if (pr.State != "open" && pr.ClosedAt is { } closedAt)
            timeline.Add(new PrTimelineItem { At = closedAt, Kind = "merged", Text = pr.State == "merged" ? $"הבקשה מוזגה ל-{pr.BaseBranch}" : "הבקשה נסגרה בלי מיזוג", Tone = pr.State == "merged" ? "healthy" : "warning" });
        timeline.Add(new PrTimelineItem { At = pr.CreatedAt, Kind = "opened", Text = $"הבקשה נפתחה על ידי {pr.Author}", Tone = "neutral" });
        foreach (var c in h.OurCommits.TakeLast(8)) timeline.Add(new PrTimelineItem { At = c.At, Kind = "commit", Text = c.Subject, Detail = $"{c.Sha} · {c.Author}" });
        foreach (var c in h.TheirCommits.TakeLast(5))
            timeline.Add(new PrTimelineItem { At = c.At, Kind = "base", Text = $"{pr.BaseBranch} התקדם: {c.Subject}", Detail = $"{c.Sha} · {c.Author}", Tag = overlap.Count > 0 ? "נוגע באותם קבצים" : null, Tone = overlap.Count > 0 ? "warning" : null });
        timeline.AddRange(h.Conversation);
        timeline = timeline.OrderByDescending(t => DateTimeOffset.TryParse(t.At, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? d : DateTimeOffset.MinValue).ToList();

        var value = new PullRequestDetail(pr, blockers, nextStep, codeMap, codeMapProblem,
            compared ? new PrFreshness(h.Behind, overlap.Count, h.Ahead, pr.BaseBranch) : null,
            groups, conflict, PullRequestRules.TopicsOf(files), h.MergeBaseSha is { } b && h.HeadSha is { } head && h.OurCommits.Count > 0 ? new PrRefs(b, head) : null,
            files.Count, timeline, h.Body);
        cache.Details[key] = (DateTimeOffset.UtcNow, value);
        cache.KeptForFiles[key] = (DateTimeOffset.UtcNow, value);
        return value;
    }

    // ── one file, before and after ───────────────────────────────────

    /// <summary>Past this, a file is shown as "too big to compare here" and linked, not loaded.</summary>
    private const int MaxFileBytes = 400_000;

    public async Task<JsonObject> FileAsync(Guid repoId, int number, string filePath, CancellationToken ct)
    {
        if (filePath.Length == 0 || filePath.Contains("..", StringComparison.Ordinal) || filePath.StartsWith('/')) throw AppException.BadRequest("bad_path", "נתיב לא חוקי");
        // Opening a file needs only the two versions' addresses, which the detail already worked out — kept longer than the detail itself.
        var d = cache.KeptForFiles.TryGetValue($"{repoId}:{number}", out var kept) && DateTimeOffset.UtcNow - kept.At < PullRequestCache.FileTtl
            ? kept.Value : await DetailAsync(repoId, number, false, ct);
        var file = d.Groups.SelectMany(g => g.Files).FirstOrDefault(f => f.Path == filePath) ?? throw new AppException(404, "not_found", "הקובץ הזה לא נמצא בבקשה");
        if (d.Pr.State != "open") throw AppException.Conflict("pr_closed", "השוואת קובץ לפני ואחרי זמינה רק בבקשות פתוחות.");
        if (d.Refs is null) throw AppException.Conflict("host_unavailable", "אין כרגע מידע מהגיט־האוסט על הגרסאות. נסו לרענן.");
        var r = await RepoAsync(repoId, ct);
        var host = RequireHost(r);

        var oldPath = file.From ?? file.Path;
        var isNew = file.Status == "A";
        var isGone = file.Status == "D";
        var beforeTask = isNew ? Task.FromResult<string?>(null) : host.ContentAsync(r, oldPath, d.Refs.Base, ct);
        var afterTask = isGone ? Task.FromResult<string?>(null) : host.ContentAsync(r, file.Path, d.Refs.Head, ct);
        var (before, after) = (await beforeTask, await afterTask);
        var values = new[] { before, after }.Where(v => v is not null).Select(v => v!).ToList();
        var binary = values.Any(v => v.Contains('\0'));
        var tooLarge = values.Any(v => Encoding.UTF8.GetByteCount(v) > MaxFileBytes);
        return new JsonObject
        {
            ["path"] = file.Path, ["before"] = binary || tooLarge ? null : before, ["after"] = binary || tooLarge ? null : after,
            ["binary"] = binary, ["tooLarge"] = tooLarge,
            ["beforeUrl"] = isNew ? null : host.BlobUrl(r, d.Refs.Base, oldPath),
            ["afterUrl"] = isGone ? null : host.BlobUrl(r, d.Pr.HeadBranch, file.Path),
        };
    }

    // ── the change, written out so the chat can read it ──────────────

    /// <summary>What one approved reading of a request may fetch. A person pays for every token, so the ceiling is here and not in a prompt.</summary>
    private const int CodeMaxFiles = 25;
    private const int CodeMaxTotalBytes = 400_000;
    private const int CodeMaxFileBytes = 60_000;
    private const int CodeMaxDiffBytes = 300_000;

    /// <summary>A path from the host is never trusted to stay inside the folder it is written into.</summary>
    private static bool SafeRelative(string p) => p.Length > 0 && !p.StartsWith('/') && !p.Contains("..", StringComparison.Ordinal) && !(p.Length > 1 && p[1] == ':');

    /// <summary>
    /// The change itself, written into a folder: what the request is, its unified diff, and each changed file as it
    /// stands after the change — the same thing a reviewer looks at, never a local clone. Capped; the note it returns
    /// says what was left out, so an answer drawn from part of the change can say so.
    /// </summary>
    public async Task<string> WriteCodeAsync(Guid repoId, int number, string dir, CancellationToken ct)
    {
        var d = await DetailAsync(repoId, number, false, ct);
        var r = await RepoAsync(repoId, ct);
        var host = RequireHost(r);
        if (Directory.Exists(dir)) RepoCheckouts.ForceDelete(dir);
        Directory.CreateDirectory(Path.Combine(dir, "files"));

        var all = d.Groups.SelectMany(g => g.Files.Select(f => (File: f, Group: g.Title))).ToList();
        var left = new List<string>();
        var raw = await host.DiffAsync(r, d.Pr, ct);
        var diff = raw ?? "";
        if (raw is null) left.Add("את ה-diff המלא לא הצלחנו להביא מהגיט־האוסט");
        else if (Encoding.UTF8.GetByteCount(diff) > CodeMaxDiffBytes)
        {
            diff = $"{diff[..Math.Min(diff.Length, CodeMaxDiffBytes)]}\n\n… ה-diff נחתך כאן. ההמשך לא נקרא.\n";
            left.Add("ה-diff ארוך מדי ונחתך");
        }
        await File.WriteAllTextAsync(Path.Combine(dir, "changes.diff"), diff, ct);

        // Each changed file as it is now, for the lines the diff does not show.
        var budget = CodeMaxTotalBytes;
        var written = 0;
        var wanted = all.Where(x => x.File.Status != "D" && SafeRelative(x.File.Path)).ToList();
        foreach (var (f, _) in wanted)
        {
            if (written >= CodeMaxFiles || budget <= 0) { left.Add($"מתוך {wanted.Count} הקבצים, רק {written} נקראו במלואם — השאר רק ב-diff"); break; }
            var text = d.Refs is not null ? await host.ContentAsync(r, f.Path, d.Refs.Head, ct) : null;
            if (text is null || text.Contains('\0')) continue;
            var bytes = Encoding.UTF8.GetByteCount(text);
            if (bytes > CodeMaxFileBytes) { left.Add($"`{f.Path}` ארוך מדי ולא נקרא במלואו"); continue; }
            var target = Path.Combine(dir, "files", f.Path.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            await File.WriteAllTextAsync(target, text, ct);
            budget -= bytes;
            written++;
        }

        var head = new List<string>
        {
            $"# בקשת מיזוג #{d.Pr.Number} · {d.Pr.Repo.Name}", "",
            $"כותרת: {d.Pr.Title}",
            $"מענף `{d.Pr.HeadBranch}` אל `{d.Pr.BaseBranch}` · פתח {d.Pr.Author} · מצב: {d.Pr.State}",
            $"{d.FileCount} קבצים שונו.", "",
            "## מה יש בתיקייה הזו",
            "- `changes.diff` — כל השינוי, בפורמט diff. זה מה שסוקר קורא.",
            "- `files/…` — הקבצים ששונו, כפי שהם אחרי השינוי (לא לפניו), עד התקרה שלמעלה.",
            left.Count > 0 ? $"\n**מה לא נכנס:** {string.Join("; ", left)}." : "", "",
            "## הקבצים ששונו",
        };
        head.AddRange(all.Select(x => $"- `{x.File.Path}` — {x.File.Status} · +{x.File.Additions} −{x.File.Deletions} · {x.Group}"));
        if (d.Body.Length > 0) head.Add($"\n## תיאור הבקשה\n\n{(d.Body.Length > 4000 ? d.Body[..4000] : d.Body)}");
        await File.WriteAllTextAsync(Path.Combine(dir, "pull-request.md"), string.Join('\n', head.Where(x => x.Length > 0)), ct);

        return left.Count > 0
            ? $"בתיקייה: ה-diff המלא של הבקשה, ו-{written} מהקבצים כפי שהם אחרי השינוי. מה שלא נכנס: {string.Join("; ", left)}. אמרו את זה בתשובה אם זה משנה אותה."
            : $"בתיקייה: ה-diff המלא של הבקשה, וכל {written} הקבצים ששונו כפי שהם אחרי השינוי.";
    }

    // ── a review written in DCC, and the host's own merge ────────────

    /// <summary>
    /// A review written in DCC and sent to the host — the host stays where the decision lives; nothing is kept only in
    /// DCC. Recorded in the audit log under the person, since the host sees only the account DCC acts as.
    /// </summary>
    public async Task<JsonObject> ReviewAsync(Guid repoId, int number, string decision, string text, Guid userId, CancellationToken ct)
    {
        text = text.Trim();
        if (text.Length > 4000) text = text[..4000];
        var pr = await OpenRequestAsync(repoId, number, "הבקשה כבר לא פתוחה, ולכן אי אפשר לסקור אותה.", ct);
        if (decision is "comment" or "request_changes" && text.Length == 0)
            throw AppException.Conflict("review_refused", decision == "comment" ? "כתבו את ההערה." : "כשמבקשים שינויים חייבים לכתוב מה לשנות.");
        var r = await RepoAsync(repoId, ct);
        await RequireHost(r).ReviewAsync(r, pr, decision, text, ct);
        // The request now reads differently on the host; what DCC cached a moment ago would show the old state back.
        cache.Forget(repoId, number);
        await audit.WriteAsync(new AuditEntry(userId, "pull_request.reviewed", "pull_request", $"{repoId}/{number}",
            After: new { repo = r.Name, number, provider = pr.Provider, decision, text }), ct);
        return new JsonObject { ["posted"] = true };
    }

    /// <summary>
    /// The host's own merge, without an approval — the way through while every request is written by the one account
    /// DCC acts as. If the branch requires an approval there, the host refuses and that is said in words.
    /// </summary>
    public async Task<JsonObject> MergeAsync(Guid repoId, int number, Guid userId, CancellationToken ct)
    {
        var pr = await OpenRequestAsync(repoId, number, "הבקשה כבר לא פתוחה, ולכן אין מה למזג.", ct);
        var r = await RepoAsync(repoId, ct);
        await RequireHost(r).MergeAsync(r, pr, ct);
        cache.Forget(repoId, number);
        await audit.WriteAsync(new AuditEntry(userId, "pull_request.merged", "pull_request", $"{repoId}/{number}",
            After: new { repo = r.Name, number, provider = pr.Provider, head = pr.HeadBranch, @base = pr.BaseBranch }), ct);
        return new JsonObject { ["merged"] = true };
    }

    // ── a repository's branches ──────────────────────────────────────

    /// <summary>Every branch of a repository, with what to do about it. It only reads and advises; deleting stays a decision made on the host.</summary>
    public async Task<RepoBranches> BranchesAsync(Guid repoId, bool refresh, CancellationToken ct)
    {
        if (!refresh && cache.Branches.TryGetValue(repoId, out var hit) && DateTimeOffset.UtcNow - hit.At < PullRequestCache.BranchesTtl) return hit.Value;
        var r = await RepoAsync(repoId, ct);
        var value = await RequireHost(r).BranchesAsync(r, ct);
        cache.Branches[repoId] = (DateTimeOffset.UtcNow, value);
        return value;
    }
}
