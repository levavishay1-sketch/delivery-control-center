using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Application.Common;
using Dcc.Domain.Git;
using Dcc.Domain.PullRequests;

namespace Dcc.Infrastructure.PullRequests;

/// <summary>
/// GitHub through the operator's own <c>gh</c> login (pull-requests.ts, pull-request-detail.ts, pull-request-review.ts,
/// repo-branches.ts). DCC cannot make the host accept what it refuses: a request's own author cannot approve it or ask
/// for changes on it there, so the account DCC acts as can only comment on a request it opened — said in words.
/// </summary>
public sealed class GitHubHost(GitHubCli gh) : IPullRequestHost
{
    private const string Fields = "number,title,url,state,isDraft,author,headRefName,baseRefName,createdAt,updatedAt,closedAt,changedFiles,additions,deletions,mergeable,reviewDecision,statusCheckRollup";

    public string Id => "github";

    public bool Handles(PrRepoRow repo) => repo.Url?.Contains("github.com", StringComparison.OrdinalIgnoreCase) == true;

    private static string Slug(PrRepoRow repo) => PullRequestRules.SlugOf(repo.Url) ?? throw AppException.Conflict("no_host_address", "אין כתובת GitHub לריפו הזה");

    private static string Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
    private static int Int(JsonNode? n) => n is JsonValue v && v.TryGetValue<int>(out var i) ? i : 0;
    private static string Short(string sha) => sha.Length > 7 ? sha[..7] : sha;
    private static string Subject(string message) => message.Split('\n')[0].Trim();

    public async Task<string?> UnavailableAsync(PrRepoRow repo, CancellationToken ct) =>
        await gh.AvailableAsync(ct) ? null : "GitHub CLI לא מותקן — התקינו gh והתחברו";

    private static PullRequestRow FromGh(JsonNode p, PrRepoRow r)
    {
        var mergeable = Str(p["mergeable"]);
        var decision = Str(p["reviewDecision"]);
        var checks = (p["statusCheckRollup"] as JsonArray ?? []).Select(c => Str(c?["conclusion"]) is { Length: > 0 } a ? a : Str(c?["state"]) is { Length: > 0 } b ? b : Str(c?["status"]));
        var number = Int(p["number"]);
        return new PullRequestRow
        {
            Id = $"github:{r.Id}:{number}", Provider = "github", Number = number, Title = Str(p["title"]), Url = Str(p["url"]),
            State = Str(p["state"]).ToLowerInvariant() switch { "merged" => "merged", "closed" => "closed", _ => "open" },
            Draft = p["isDraft"]?.GetValue<bool>() ?? false, Author = Str(p["author"]?["login"]) is { Length: > 0 } login ? login : "—",
            HeadBranch = Str(p["headRefName"]), BaseBranch = Str(p["baseRefName"]), CreatedAt = Str(p["createdAt"]), UpdatedAt = Str(p["updatedAt"]),
            ClosedAt = Str(p["closedAt"]) is { Length: > 0 } closed ? closed : null,
            ChangedFiles = Int(p["changedFiles"]), Additions = Int(p["additions"]), Deletions = Int(p["deletions"]),
            Mergeable = mergeable == "MERGEABLE" ? true : mergeable == "CONFLICTING" ? false : null, Conflicts = mergeable == "CONFLICTING",
            Review = decision == "APPROVED" ? "approved" : decision == "CHANGES_REQUESTED" ? "changes_requested" : "none",
            Checks = PullRequestRules.ChecksOf(checks), Repo = new PrRepo(r.Id, r.Name), Client = new PrClient(r.ClientId, r.ClientName),
        };
    }

    private async Task<List<PullRequestRow>> ListStateAsync(PrRepoRow r, string state, CancellationToken ct)
    {
        var res = await gh.RunAsync(["pr", "list", "--repo", r.Url!, "--state", state, "--limit", state == "open" ? "50" : "25", "--json", Fields], 25_000, ct);
        if (!res.Ok) throw new InvalidOperationException(GitHubCli.Why(res) is { Length: > 0 } why ? why : "gh pr list נכשל");
        try { return (JsonNode.Parse(res.Out.Length > 0 ? res.Out : "[]") as JsonArray ?? []).Where(p => p is not null).Select(p => FromGh(p!, r)).ToList(); }
        catch (System.Text.Json.JsonException e) { throw new InvalidOperationException(e.Message); }
    }

    public async Task<(IReadOnlyList<PullRequestRow> Open, IReadOnlyList<PullRequestRow> Done)> ListAsync(PrRepoRow repo, CancellationToken ct)
    {
        // The host's "closed" already includes the merged ones; each row says which it is. The open ones are what matters.
        var done = ListStateAsync(repo, "closed", ct);
        var open = await ListStateAsync(repo, "open", ct);
        try { return (open, await done); }
        catch (InvalidOperationException) { return (open, []); }
    }

    private static CodeMapCommit AsCommit(JsonNode c, IReadOnlyList<string>? files = null)
    {
        var message = Str(c["commit"]?["message"]);
        var parents = (c["parents"] as JsonArray ?? []).Select(p => Short(Str(p?["sha"]))).ToList();
        var body = string.Join('\n', message.Split('\n').Skip(1)).Trim();
        return new CodeMapCommit(Short(Str(c["sha"])), Subject(message), Str(c["commit"]?["author"]?["name"]), Str(c["commit"]?["author"]?["date"]), files ?? [],
            body.Length > 0 ? body : null, parents.Count > 1, parents);
    }

    private static HostFile FileOf(JsonNode f) => new(Str(f["filename"]) is { Length: > 0 } n ? n : Str(f["path"]), Str(f["status"]) is { Length: > 0 } s ? s : "modified",
        Int(f["additions"]), Int(f["deletions"]), Str(f["previous_filename"]) is { Length: > 0 } prev ? prev : null);

    private static List<HostFile> FilesOf(JsonNode? n) => (n as JsonArray ?? []).Where(f => f is not null).Select(f => FileOf(f!)).Where(f => f.Filename.Length > 0).ToList();

    public async Task<HostDetail> DetailAsync(PrRepoRow repo, PullRequestRow pr, CancellationToken ct)
    {
        var slug = PullRequestRules.SlugOf(repo.Url);
        if (slug is null) return new HostDetail();
        // Three independent questions, asked together: what the request holds, what the branch gained, what the base gained since.
        // A request that is no longer open has no live comparison to make: its branch may be gone, and the base has moved on.
        var viewTask = gh.JsonAsync(["pr", "view", pr.Number.ToString(CultureInfo.InvariantCulture), "--repo", repo.Url!, "--json", "body,files,reviews,comments"], ct);
        var oursTask = pr.State == "open" ? gh.JsonAsync(["api", $"repos/{slug}/compare/{pr.BaseBranch}...{pr.HeadBranch}"], ct) : Task.FromResult<JsonNode?>(null);
        var theirsTask = pr.State == "open" ? gh.JsonAsync(["api", $"repos/{slug}/compare/{pr.HeadBranch}...{pr.BaseBranch}"], ct) : Task.FromResult<JsonNode?>(null);
        var (view, ours, theirs) = (await viewTask, await oursTask, await theirsTask);

        var conversation = new List<PrTimelineItem>();
        foreach (var rv in view?["reviews"] as JsonArray ?? [])
        {
            if (rv is null) continue;
            var said = Str(rv["body"]).Trim();
            var state = Str(rv["state"]);
            conversation.Add(new PrTimelineItem
            {
                At = Str(rv["submittedAt"]) is { Length: > 0 } at ? at : pr.UpdatedAt, Kind = "review",
                Text = $"{(Str(rv["author"]?["login"]) is { Length: > 0 } l ? l : "מישהו")} {(state == "APPROVED" ? "אישר את השינוי" : state == "CHANGES_REQUESTED" ? "ביקש שינויים" : "כתב הערת סקירה")}",
                Detail = said.Length > 0 ? (said.Length > 300 ? said[..300] : said) : null,
                Tone = state == "APPROVED" ? "healthy" : state == "CHANGES_REQUESTED" ? "warning" : "neutral",
            });
        }
        foreach (var cm in (view?["comments"] as JsonArray ?? []).Where(x => x is not null).TakeLast(5))
        {
            var line = Subject(Str(cm!["body"]));
            conversation.Add(new PrTimelineItem { At = Str(cm["createdAt"]), Kind = "comment", Text = $"{(Str(cm["author"]?["login"]) is { Length: > 0 } l ? l : "מישהו")} כתב הערה", Detail = line.Length > 120 ? line[..120] : line });
        }

        var ourFiles = ours is null ? null : FilesOf(ours["files"]);
        var ourPaths = ourFiles?.Select(f => f.Filename).ToList() ?? [];
        var ourCommits = (ours?["commits"] as JsonArray ?? []).Where(c => c is not null).ToList();
        return new HostDetail
        {
            Body = Str(view?["body"]),
            // `gh pr view` names a file `path` and does not say what happened to it; the compare answer is preferred where there is one.
            Files = FilesOf(view?["files"]),
            OurFiles = ourFiles, TheirFiles = theirs is null ? null : FilesOf(theirs["files"]),
            OurCommits = ourCommits.Select(c => AsCommit(c!, ourPaths)).ToList(),
            TheirCommits = (theirs?["commits"] as JsonArray ?? []).Where(c => c is not null).Select(c => AsCommit(c!)).ToList(),
            MergeBase = ours?["merge_base_commit"] is { } mb ? AsCommit(mb) : null,
            MergeBaseSha = Str(ours?["merge_base_commit"]?["sha"]) is { Length: > 0 } s ? s : null,
            HeadSha = ourCommits.Count > 0 ? Str(ourCommits[^1]!["sha"]) : null,
            Ahead = Int(ours?["ahead_by"]), Behind = Int(theirs?["ahead_by"]),
            Conversation = conversation,
        };
    }

    public Task<string?> ContentAsync(PrRepoRow repo, string path, string commit, CancellationToken ct) =>
        gh.TextAsync(["api", $"repos/{Slug(repo)}/contents/{PullRequestRules.EncodePath(path)}?ref={commit}", "-H", "Accept: application/vnd.github.raw"], ct);

    public string BlobUrl(PrRepoRow repo, string @ref, string path) => $"{repo.Url}/blob/{@ref}/{PullRequestRules.EncodePath(path)}";

    public Task<string?> DiffAsync(PrRepoRow repo, PullRequestRow pr, CancellationToken ct) =>
        gh.TextAsync(["api", $"repos/{Slug(repo)}/pulls/{pr.Number}", "-H", "Accept: application/vnd.github.v3.diff"], ct);

    public async Task ReviewAsync(PrRepoRow repo, PullRequestRow pr, string decision, string text, CancellationToken ct)
    {
        var login = await gh.LoginAsync(ct);
        if (login is not null && string.Equals(login, pr.Author, StringComparison.OrdinalIgnoreCase) && decision is "approve" or "request_changes")
            throw AppException.Conflict("review_refused", "הבקשה הזו נפתחה בחשבון הגיט־האוסט שבו DCC עובד עכשיו, והגיט־האוסט לא נותן לאותו חשבון לאשר אותה או לבקש בה תיקון. אישור רשמי ייתן משתמש אחר, ואפשר לכתוב הערה. נטפל בזה כשכל משתמש יעבוד בחשבון שלו.");
        var flag = decision switch { "approve" => "--approve", "request_changes" => "--request-changes", _ => "--comment" };
        var args = new List<string> { "pr", "review", pr.Number.ToString(CultureInfo.InvariantCulture), "--repo", repo.Url!, flag };
        if (text.Length > 0) args.AddRange(["--body", text]);
        var res = await gh.RunAsync(args, 60_000, ct);
        if (res.Ok) return;
        var why = GitHubCli.Why(res);
        if (why.Contains("own pull request", StringComparison.OrdinalIgnoreCase)) throw AppException.Conflict("review_refused", "הגיט־האוסט לא נותן לכותב הבקשה לאשר אותה. אישור רשמי ייתן משתמש אחר.");
        throw AppException.Conflict("review_refused", $"הגיט־האוסט לא קיבל את הסקירה{(why.Length > 0 ? $": {(why.Length > 160 ? why[..160] : why)}" : ".")}");
    }

    public async Task MergeAsync(PrRepoRow repo, PullRequestRow pr, CancellationToken ct)
    {
        var res = await gh.RunAsync(["pr", "merge", pr.Number.ToString(CultureInfo.InvariantCulture), "--repo", repo.Url!, "--merge"], 60_000, ct);
        if (res.Ok) return;
        var why = GitHubCli.Why(res);
        if (Regex.IsMatch(why, "policy|required|protect|review", RegexOptions.IgnoreCase))
            throw AppException.Conflict("review_refused", "הגיט־האוסט לא מרשה למזג: בענף היעד מוגדר שצריך אישור סקירה. צריך להוריד את הדרישה בהגדרות הענף בגיט־האוסט (Settings ← Branches), או שמשתמש אחר יאשר.");
        throw AppException.Conflict("review_refused", $"הגיט־האוסט לא מיזג את הבקשה{(why.Length > 0 ? $": {(why.Length > 160 ? why[..160] : why)}" : ".")}");
    }

    private const string BranchesQuery = """
        query($owner:String!,$name:String!,$base:String!){
          repository(owner:$owner,name:$name){
            refs(refPrefix:"refs/heads/", first:60, orderBy:{field:TAG_COMMIT_DATE, direction:DESC}){
              nodes{
                name
                target{ ... on Commit { committedDate messageHeadline author{ name user{ login } } } }
                associatedPullRequests(first:5, states:[OPEN,MERGED,CLOSED]){ nodes{ number state isDraft baseRefName } }
                compare(headRef:$base){ aheadBy behindBy }
              }
            }
          }
        }
        """;

    public async Task<RepoBranches> BranchesAsync(PrRepoRow repo, CancellationToken ct)
    {
        var slug = Slug(repo);
        var (owner, name) = (slug.Split('/')[0], slug.Split('/').ElementAtOrDefault(1) ?? "");
        // The default branch is asked first, because every other branch is compared to it.
        var meta = await gh.JsonAsync(["api", $"repos/{slug}"], ct);
        var @base = Str(meta?["default_branch"]) is { Length: > 0 } b ? b : "main";
        var res = await gh.JsonAsync(["api", "graphql", "-f", $"query={BranchesQuery}", "-f", $"owner={owner}", "-f", $"name={name}", "-f", $"base={@base}"], ct);
        var nodes = res?["data"]?["repository"]?["refs"]?["nodes"] as JsonArray ?? throw AppException.Conflict("host_unavailable", "GitHub לא החזיר את רשימת הענפים. נסו לסנכרן שוב.");
        var rows = nodes.Where(n => n is not null).Select(n =>
        {
            var branch = Str(n!["name"]);
            var prs = (n["associatedPullRequests"]?["nodes"] as JsonArray ?? []).Where(p => p is not null).ToList();
            // The request that matters is the open one, else the newest.
            var pick = prs.FirstOrDefault(p => Str(p!["state"]) == "OPEN") ?? prs.FirstOrDefault();
            var pr = pick is not null ? new BranchPr(Int(pick["number"]), Str(pick["state"]), pick["isDraft"]?.GetValue<bool>() ?? false) : null;
            // The comparison is from the base's side: what the base is behind by is what the branch holds alone.
            var unique = Int(n["compare"]?["behindBy"]);
            var behind = Int(n["compare"]?["aheadBy"]);
            var (status, advice) = BranchRules.AdviceFor(unique, behind, pr, @base, branch == @base);
            var target = n["target"];
            return new BranchHealth
            {
                Name = branch, Status = status, Advice = advice, Unique = unique, Behind = behind, Pr = pr,
                LastAt = Str(target?["committedDate"]) is { Length: > 0 } at ? at : null,
                LastBy = Str(target?["author"]?["user"]?["login"]) is { Length: > 0 } login ? login : Str(target?["author"]?["name"]) is { Length: > 0 } an ? an : null,
                LastMessage = Str(target?["messageHeadline"]) is { Length: > 0 } msg ? msg : null,
                Origin = branch == @base ? "הענף הראשי של הריפו." : BranchRules.OriginOf(branch),
                Url = $"{repo.Url}/tree/{Uri.EscapeDataString(branch)}",
            };
        });
        return new RepoBranches(@base, BranchRules.Sort(rows), PullRequestService.Now());
    }
}
