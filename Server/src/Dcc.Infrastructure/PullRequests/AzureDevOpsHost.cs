using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dcc.Application.Common;
using Dcc.Domain.Git;
using Dcc.Domain.PullRequests;
using Dcc.Infrastructure.Ado;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.PullRequests;

/// <summary>Where a repository lives on Azure DevOps: the collection or organisation, the project, the repository.</summary>
public sealed record AdoRepoAddress(string OrgUrl, string Project, string Repo)
{
    /// <summary>Project-scoped REST routes: {collection}/{project}/_apis/git/…</summary>
    public string Base => $"{OrgUrl}/{Uri.EscapeDataString(Project)}";
    public string ApiRepo => $"git/repositories/{Uri.EscapeDataString(Repo)}";
    public string Web => $"{OrgUrl}/{Uri.EscapeDataString(Project)}/_git/{Uri.EscapeDataString(Repo)}";

    /// <summary>
    /// https://dev.azure.com/org/project/_git/repo, https://org.visualstudio.com/project/_git/repo, an on-prem
    /// https://server/tfs/Collection/Project/_git/Repo, or git@ssh.dev.azure.com:v3/org/project/repo.
    /// </summary>
    public static AdoRepoAddress? Parse(string? remote)
    {
        if (string.IsNullOrWhiteSpace(remote)) return null;
        var ssh = Regex.Match(remote.Trim(), @"^git@ssh\.dev\.azure\.com:v3/([^/]+)/([^/]+)/(.+?)(\.git)?$");
        if (ssh.Success) return new($"https://dev.azure.com/{ssh.Groups[1].Value}", Uri.UnescapeDataString(ssh.Groups[2].Value), Uri.UnescapeDataString(ssh.Groups[3].Value));
        if (!Uri.TryCreate(remote.Trim(), UriKind.Absolute, out var u) || (u.Scheme != "http" && u.Scheme != "https")) return null;
        var path = u.AbsolutePath;
        var at = path.IndexOf("/_git/", StringComparison.OrdinalIgnoreCase);
        if (at < 0) return null;
        var repo = Uri.UnescapeDataString(path[(at + "/_git/".Length)..].Trim('/'));
        if (repo.EndsWith(".git", StringComparison.OrdinalIgnoreCase)) repo = repo[..^4];
        // The credentials a pasted clone address may carry are never part of where it is.
        var (orgUrl, project) = AdoUrl.Split($"{u.Scheme}://{u.Authority}{path[..at]}");
        return project.Length == 0 || repo.Length == 0 ? null : new(orgUrl, project, repo);
    }
}

/// <summary>
/// Azure DevOps (Repos) through the owning client's service connection — the same pull-request centre, from a
/// different host. What Azure DevOps does not have is said, never invented: it keeps no line counts per file and no
/// unified diff, so those are left empty and the reading of a change says so. A vote is the review: approve is 10,
/// "waiting for the author" (-5) is a request for changes, and the words go in as a comment thread.
/// </summary>
public sealed class AzureDevOpsHost(AdoClient ado, DccDbContext db, ITenantScope tenant) : IPullRequestHost
{
    public string Id => "ado";

    public bool Handles(PrRepoRow repo) => AdoRepoAddress.Parse(repo.AdoRepoRef) is not null;

    private static AdoRepoAddress Address(PrRepoRow repo) => AdoRepoAddress.Parse(repo.AdoRepoRef) ?? throw AppException.Conflict("no_host_address", "אין כתובת Azure DevOps לריפו הזה");

    // The list asks every repository at once; the database context is one per request and takes one query at a time.
    private readonly SemaphoreSlim _db = new(1, 1);
    private readonly Dictionary<Guid, AdoConn?> _connections = [];

    /// <summary>The PAT: the owning client's connection, or — for a shared repository — a linked client's.</summary>
    private async Task<AdoConn?> ConnectionAsync(PrRepoRow repo, CancellationToken ct)
    {
        await _db.WaitAsync(ct);
        try
        {
            if (_connections.TryGetValue(repo.Id, out var known)) return known;
            var clients = new List<Guid>();
            if (repo.ClientId is { } owner) clients.Add(owner);
            clients.AddRange((await SqlJson.QueryAsync(db, "select client_id from client_repo where repo_id = @r order by added_at", new { r = repo.Id }, ct))
                .Select(x => Guid.Parse(x["client_id"]!.GetValue<string>())).Where(c => !clients.Contains(c)));
            AdoConn? found = null;
            foreach (var c in clients)
                if ((found = await AdoConnections.ActiveAsync(tenant, c, ct)) is not null) break;
            return _connections[repo.Id] = found;
        }
        finally { _db.Release(); }
    }

    private async Task<(AdoRepoAddress A, string Pat)> OpenAsync(PrRepoRow repo, CancellationToken ct) =>
        (Address(repo), (await ConnectionAsync(repo, ct))?.Pat ?? throw AppException.Conflict("no_connection", "ללקוח של הריפו אין חיבור Azure DevOps פעיל, ולכן אי אפשר לקרוא את בקשות המיזוג שלו."));

    public async Task<string?> UnavailableAsync(PrRepoRow repo, CancellationToken ct) =>
        await ConnectionAsync(repo, ct) is null ? "ללקוח של הריפו אין חיבור Azure DevOps — חברו אותו בהגדרות הלקוח" : null;

    private static string S(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
    private static int I(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : 0;
    private static JsonElement P(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) ? v : default;
    private static IEnumerable<JsonElement> Values(JsonElement? body, string name = "value") =>
        body is { ValueKind: JsonValueKind.Object } b && b.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array ? v.EnumerateArray() : [];
    private static string Branch(string refName) => refName.StartsWith("refs/heads/", StringComparison.Ordinal) ? refName["refs/heads/".Length..] : refName;
    private static string Short(string sha) => sha.Length > 7 ? sha[..7] : sha;
    private static string Subject(string message) => message.Split('\n')[0].Trim();

    private async Task<JsonElement?> GetAsync(AdoRepoAddress a, string pat, string path, CancellationToken ct)
    {
        var r = await ado.GetAsync(a.Base, path, pat, ct);
        return r.Ok ? r.Body : null;
    }

    private PullRequestRow Row(JsonElement p, PrRepoRow r, AdoRepoAddress a, string checks)
    {
        var id = I(p, "pullRequestId");
        var status = S(p, "status");
        var votes = P(p, "reviewers").ValueKind == JsonValueKind.Array ? P(p, "reviewers").EnumerateArray().Select(x => I(x, "vote")).ToList() : [];
        var merge = S(p, "mergeStatus");
        var closed = S(p, "closedDate");
        return new PullRequestRow
        {
            Id = $"ado:{r.Id}:{id}", Provider = "ado", Number = id, Title = S(p, "title"), Url = $"{a.Web}/pullrequest/{id}",
            State = status switch { "completed" => "merged", "abandoned" => "closed", _ => "open" },
            Draft = P(p, "isDraft").ValueKind == JsonValueKind.True,
            Author = S(P(p, "createdBy"), "displayName") is { Length: > 0 } n ? n : S(P(p, "createdBy"), "uniqueName") is { Length: > 0 } u ? u : "—",
            HeadBranch = Branch(S(p, "sourceRefName")), BaseBranch = Branch(S(p, "targetRefName")),
            // Azure DevOps keeps no "last updated" on a request; the newest of opened and closed stands in for it.
            CreatedAt = S(p, "creationDate"), UpdatedAt = closed.Length > 0 ? closed : S(p, "creationDate"), ClosedAt = closed.Length > 0 ? closed : null,
            Mergeable = merge == "succeeded" ? true : merge == "conflicts" ? false : null, Conflicts = merge == "conflicts",
            Review = votes.Any(v => v < 0) ? "changes_requested" : votes.Any(v => v > 0) ? "approved" : "none",
            Checks = checks, Repo = new PrRepo(r.Id, r.Name), Client = new PrClient(r.ClientId, r.ClientName),
        };
    }

    /// <summary>The statuses posted on a request (builds, policies), in the words <see cref="PullRequestRules.ChecksOf"/> reads.</summary>
    private async Task<string> ChecksAsync(AdoRepoAddress a, string pat, int id, CancellationToken ct)
    {
        var body = await GetAsync(a, pat, $"{a.ApiRepo}/pullRequests/{id}/statuses", ct);
        return PullRequestRules.ChecksOf(Values(body).Select(s => S(s, "state") switch
        {
            "failed" or "error" => "FAILURE",
            "pending" => "PENDING",
            "succeeded" => "SUCCESS",
            _ => "",
        }).Where(x => x.Length > 0));
    }

    public async Task<(IReadOnlyList<PullRequestRow> Open, IReadOnlyList<PullRequestRow> Done)> ListAsync(PrRepoRow repo, CancellationToken ct)
    {
        var a = Address(repo);
        var pat = (await ConnectionAsync(repo, ct))?.Pat ?? throw new InvalidOperationException("ללקוח של הריפו אין חיבור Azure DevOps פעיל");
        var open = await ado.GetAsync(a.Base, $"{a.ApiRepo}/pullrequests?searchCriteria.status=active&$top=50", pat, ct);
        if (!open.Ok) throw new InvalidOperationException(open.Detail.Length > 0 ? open.Detail : "Azure DevOps לא החזיר את בקשות המיזוג");
        var all = await GetAsync(a, pat, $"{a.ApiRepo}/pullrequests?searchCriteria.status=all&$top=50", ct);
        var openRows = await Task.WhenAll(Values(open.Body).Select(async p => Row(p, repo, a, await ChecksAsync(a, pat, I(p, "pullRequestId"), ct))));
        var done = Values(all).Where(p => S(p, "status") is "completed" or "abandoned").Take(25).Select(p => Row(p, repo, a, "none")).ToList();
        return (openRows, done);
    }

    private static string StatusOf(string changeType) =>
        changeType.Contains("delete", StringComparison.OrdinalIgnoreCase) ? "removed"
        : changeType.Contains("add", StringComparison.OrdinalIgnoreCase) ? "added"
        : changeType.Contains("rename", StringComparison.OrdinalIgnoreCase) ? "renamed" : "modified";

    /// <summary>Azure DevOps names a change by its item; folders are not files, and it keeps no line counts.</summary>
    private static List<HostFile> Changes(IEnumerable<JsonElement> entries) =>
        entries.Where(c => P(P(c, "item"), "isFolder").ValueKind != JsonValueKind.True && S(P(c, "item"), "path").Length > 0)
            .Select(c => new HostFile(S(P(c, "item"), "path").TrimStart('/'), StatusOf(S(c, "changeType")), 0, 0,
                S(c, "originalPath") is { Length: > 0 } o ? o.TrimStart('/') : S(c, "sourceServerItem") is { Length: > 0 } src && src != S(P(c, "item"), "path") ? src.TrimStart('/') : null))
            .ToList();

    private static CodeMapCommit Commit(JsonElement c) =>
        new(Short(S(c, "commitId")), Subject(S(c, "comment")), S(P(c, "author"), "name"), S(P(c, "author"), "date"), [],
            string.Join('\n', S(c, "comment").Split('\n').Skip(1)).Trim() is { Length: > 0 } body ? body : null,
            P(c, "parents").ValueKind == JsonValueKind.Array && P(c, "parents").GetArrayLength() > 1,
            P(c, "parents").ValueKind == JsonValueKind.Array ? P(c, "parents").EnumerateArray().Select(x => Short(x.GetString() ?? "")).ToList() : null);

    public async Task<HostDetail> DetailAsync(PrRepoRow repo, PullRequestRow pr, CancellationToken ct)
    {
        var (a, pat) = await OpenAsync(repo, ct);
        var prPath = $"{a.ApiRepo}/pullRequests/{pr.Number}";
        var request = await GetAsync(a, pat, prPath, ct) ?? throw new AppException(404, "not_found", "בקשת המיזוג לא נמצאה ב-Azure DevOps");
        var iterations = Values(await GetAsync(a, pat, $"{prPath}/iterations", ct)).ToList();
        var files = iterations.Count > 0
            ? Changes(Values(await GetAsync(a, pat, $"{prPath}/iterations/{I(iterations[^1], "id")}/changes?$compareTo=0&$top=2000", ct), "changeEntries"))
            : [];
        var commits = Values(await GetAsync(a, pat, $"{prPath}/commits", ct)).Select(Commit).Reverse().ToList();

        var conversation = new List<PrTimelineItem>();
        foreach (var rv in P(request, "reviewers").ValueKind == JsonValueKind.Array ? P(request, "reviewers").EnumerateArray() : Enumerable.Empty<JsonElement>())
        {
            var vote = I(rv, "vote");
            if (vote == 0) continue;
            conversation.Add(new PrTimelineItem
            {
                At = pr.UpdatedAt, Kind = "review",
                Text = $"{(S(rv, "displayName") is { Length: > 0 } n ? n : "מישהו")} {(vote > 0 ? "אישר את השינוי" : vote == -5 ? "ביקש שינויים" : "דחה את השינוי")}",
                Tone = vote > 0 ? "healthy" : "warning",
            });
        }
        foreach (var t in Values(await GetAsync(a, pat, $"{prPath}/threads", ct)).Select(t => Values(t, "comments").FirstOrDefault()).Where(c => S(c, "commentType") == "text").TakeLast(5))
        {
            var line = Subject(S(t, "content"));
            conversation.Add(new PrTimelineItem { At = S(t, "publishedDate"), Kind = "comment", Text = $"{(S(P(t, "author"), "displayName") is { Length: > 0 } n ? n : "מישהו")} כתב הערה", Detail = line.Length > 120 ? line[..120] : line });
        }

        var detail = new HostDetail
        {
            Body = S(request, "description"), Files = files, OurCommits = commits.Select(c => c with { Files = files.Select(f => f.Filename).ToList() }).ToList(),
            HeadSha = S(P(request, "lastMergeSourceCommit"), "commitId") is { Length: > 0 } h ? h : null, Conversation = conversation,
        };
        if (pr.State != "open") return detail;

        // What the branch gained since it left the base, and what the base gained since — compared from their common commit.
        string Q(string b, string t) => $"{a.ApiRepo}/diffs/commits?baseVersionType=branch&baseVersion={Uri.EscapeDataString(b)}&targetVersionType=branch&targetVersion={Uri.EscapeDataString(t)}&$top=2000";
        var ours = await GetAsync(a, pat, Q(pr.BaseBranch, pr.HeadBranch), ct);
        var theirs = await GetAsync(a, pat, Q(pr.HeadBranch, pr.BaseBranch), ct);
        if (ours is null || theirs is null) return detail;
        var common = S(ours.Value, "commonCommit");
        var mergeBase = common.Length > 0 ? await GetAsync(a, pat, $"{a.ApiRepo}/commits/{common}", ct) : null;
        var theirCommits = await ado.SendAsync(a.Base, $"{a.ApiRepo}/commitsbatch?$top=12", HttpMethod.Post, new
        {
            itemVersion = new { versionType = "branch", version = pr.BaseBranch },
            compareVersion = new { versionType = "branch", version = pr.HeadBranch },
        }, pat, "application/json", ct);
        return detail with
        {
            OurFiles = Changes(Values(ours, "changes")), TheirFiles = Changes(Values(theirs, "changes")),
            TheirCommits = theirCommits.Ok ? Values(theirCommits.Body).Select(Commit).Reverse().ToList() : [],
            MergeBase = mergeBase is { } mb ? Commit(mb) : null, MergeBaseSha = common.Length > 0 ? common : null,
            Ahead = I(ours.Value, "aheadCount"), Behind = I(theirs.Value, "aheadCount"),
        };
    }

    public async Task<string?> ContentAsync(PrRepoRow repo, string path, string commit, CancellationToken ct)
    {
        var (a, pat) = await OpenAsync(repo, ct);
        var item = await GetAsync(a, pat, $"{a.ApiRepo}/items?path={Uri.EscapeDataString("/" + path)}&versionDescriptor.versionType=commit&versionDescriptor.version={commit}&includeContent=true", ct);
        if (item is not { } i) return null;
        // A binary file comes back encoded; the caller tells binary by a NUL, so it gets one.
        return P(P(i, "contentMetadata"), "isBinary").ValueKind == JsonValueKind.True ? "\0" : S(i, "content");
    }

    public string BlobUrl(PrRepoRow repo, string @ref, string path)
    {
        var a = Address(repo);
        var version = Regex.IsMatch(@ref, "^[0-9a-f]{40}$") ? $"GC{@ref}" : $"GB{Uri.EscapeDataString(@ref)}";
        return $"{a.Web}?path={Uri.EscapeDataString("/" + path)}&version={version}";
    }

    /// <summary>Azure DevOps has no unified diff of a request; the reading of a change says it was not available.</summary>
    public Task<string?> DiffAsync(PrRepoRow repo, PullRequestRow pr, CancellationToken ct) => Task.FromResult<string?>(null);

    public async Task ReviewAsync(PrRepoRow repo, PullRequestRow pr, string decision, string text, CancellationToken ct)
    {
        var (a, pat) = await OpenAsync(repo, ct);
        var prPath = $"{a.ApiRepo}/pullRequests/{pr.Number}";
        if (decision is "approve" or "request_changes")
        {
            var me = await ado.GetUnversionedAsync(a.OrgUrl, "connectionData", pat, ct);
            var reviewer = me.Body is { } b ? S(P(b, "authenticatedUser"), "id") : "";
            if (reviewer.Length == 0) throw AppException.Conflict("review_refused", "Azure DevOps לא אמר באיזה חשבון DCC עובד, ולכן אי אפשר להצביע. בדקו את חיבור השירות של הלקוח.");
            var voted = await ado.SendAsync(a.Base, $"{prPath}/reviewers/{reviewer}", HttpMethod.Put, new { vote = decision == "approve" ? 10 : -5 }, pat, "application/json", ct);
            if (!voted.Ok) throw AppException.Conflict("review_refused", $"Azure DevOps לא קיבל את ההצבעה: {Cut(voted.Detail)}");
        }
        if (text.Length == 0) return;
        var thread = await ado.SendAsync(a.Base, $"{prPath}/threads", HttpMethod.Post, new
        {
            comments = new[] { new { parentCommentId = 0, content = text, commentType = 1 } },
            status = 1,
        }, pat, "application/json", ct);
        if (!thread.Ok) throw AppException.Conflict("review_refused", $"Azure DevOps לא קיבל את ההערה: {Cut(thread.Detail)}");
    }

    public async Task MergeAsync(PrRepoRow repo, PullRequestRow pr, CancellationToken ct)
    {
        var (a, pat) = await OpenAsync(repo, ct);
        var prPath = $"{a.ApiRepo}/pullRequests/{pr.Number}";
        var request = await GetAsync(a, pat, prPath, ct) ?? throw AppException.Conflict("review_refused", "הבקשה לא נמצאה ב-Azure DevOps.");
        var head = S(P(request, "lastMergeSourceCommit"), "commitId");
        var res = await ado.SendAsync(a.Base, prPath, HttpMethod.Patch, new
        {
            status = "completed",
            lastMergeSourceCommit = new { commitId = head },
            completionOptions = new { mergeStrategy = "noFastForward", deleteSourceBranch = false },
        }, pat, "application/json", ct);
        if (res.Ok) return;
        if (Regex.IsMatch(res.Detail, "polic|required|reviewer", RegexOptions.IgnoreCase))
            throw AppException.Conflict("review_refused", "Azure DevOps לא מרשה למזג: מדיניות הענף דורשת אישור סקירה או בדיקות שעוד לא עברו. צריך לשנות את המדיניות של הענף ב-Azure DevOps (Branch policies), או שמשתמש אחר יאשר.");
        throw AppException.Conflict("review_refused", $"Azure DevOps לא מיזג את הבקשה: {Cut(res.Detail)}");
    }

    private static string Cut(string s) => s.Length > 160 ? s[..160] : s;

    public async Task<RepoBranches> BranchesAsync(PrRepoRow repo, CancellationToken ct)
    {
        var (a, pat) = await OpenAsync(repo, ct);
        var meta = await GetAsync(a, pat, a.ApiRepo, ct);
        var @base = meta is { } m && Branch(S(m, "defaultBranch")) is { Length: > 0 } d ? d : "main";
        var stats = await GetAsync(a, pat, $"{a.ApiRepo}/stats/branches?baseVersionDescriptor.versionType=branch&baseVersionDescriptor.version={Uri.EscapeDataString(@base)}", ct)
            ?? throw AppException.Conflict("host_unavailable", "Azure DevOps לא החזיר את רשימת הענפים. נסו לסנכרן שוב.");
        // The request that matters for a branch is the open one, else the newest.
        var requests = Values(await GetAsync(a, pat, $"{a.ApiRepo}/pullrequests?searchCriteria.status=all&$top=100", ct))
            .GroupBy(p => Branch(S(p, "sourceRefName")))
            .ToDictionary(g => g.Key, g => g.FirstOrDefault(p => S(p, "status") == "active") is { ValueKind: JsonValueKind.Object } o ? o : g.First());
        var rows = Values(stats).Select(s =>
        {
            var name = S(s, "name");
            var pr = requests.TryGetValue(name, out var p)
                ? new BranchPr(I(p, "pullRequestId"), S(p, "status") switch { "active" => "OPEN", "completed" => "MERGED", _ => "CLOSED" }, P(p, "isDraft").ValueKind == JsonValueKind.True)
                : null;
            var (unique, behind) = (I(s, "aheadCount"), I(s, "behindCount"));
            var (status, advice) = BranchRules.AdviceFor(unique, behind, pr, @base, name == @base);
            var commit = P(s, "commit");
            return new BranchHealth
            {
                Name = name, Status = status, Advice = advice, Unique = unique, Behind = behind, Pr = pr,
                LastAt = S(P(commit, "author"), "date") is { Length: > 0 } at ? at : null,
                LastBy = S(P(commit, "author"), "name") is { Length: > 0 } by ? by : null,
                LastMessage = S(commit, "comment") is { Length: > 0 } msg ? Subject(msg) : null,
                Origin = name == @base ? "הענף הראשי של הריפו." : BranchRules.OriginOf(name),
                Url = $"{a.Web}?version=GB{Uri.EscapeDataString(name)}",
            };
        });
        return new RepoBranches(@base, BranchRules.Sort(rows), PullRequestService.Now());
    }
}
