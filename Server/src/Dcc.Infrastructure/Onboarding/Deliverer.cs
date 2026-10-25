using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Dcc.Application.Common;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.PullRequests;
using Dcc.Infrastructure.Repos;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// One delivery. <c>Files</c> are the only files staged — by name, what the person approved; everything else in the copy
/// stays out of the commit. <c>BaselineSha</c> is where the run started: what the session committed by itself since then
/// is delivered too. <c>Author</c> is the acting person, whose name the commit carries.
/// </summary>
public sealed record DeliverInput(
    string Dir, string Branch, string? DefaultBranch, string? BaselineSha, (string Name, string Email) Author,
    string Title, string Body, IReadOnlyList<string> Files, Action<string> Log);

/// <summary>
/// Delivery (repo-onboarding/deliver.ts): commit what the session produced under the acting person's own name, push the
/// onboarding branch, and open a pull request — with <c>gh</c> when it is there, otherwise a compare link. It uses the
/// operator's own git and gh credentials, so every push and request is attributable to a person; merging stays a human
/// action in the git host.
///
/// Where it differs from the old server, deliberately:
///  - an empty file list is refused (409) — the old server then staged everything with <c>git add -A</c>;
///  - <c>gh pr create</c> names the repository (<c>--repo</c>: the remote's https address, or the remote as git has it)
///    instead of running in the copy, because <see cref="GitHubCli"/> runs in no working folder; its failure note carries
///    gh's own words, not Node's "Command failed: …" line;
///  - file counts are read with <c>-z</c> from git's standard output alone, so a warning is never counted as a file.
/// </summary>
public sealed partial class Deliverer(GitHubCli gh)
{
    private const int PushTimeoutMs = 180_000;
    private const int PrCreateTimeoutMs = 120_000;

    [GeneratedRegex("/pull/([0-9]+)")] private static partial Regex PullNumber();

    public async Task<DeliverResult> DeliverAsync(DeliverInput input, CancellationToken ct = default)
    {
        var (dir, branch, log) = (input.Dir, input.Branch, input.Log);
        if (input.Files.Count == 0)
            throw AppException.Conflict("nothing_approved", "אין קבצים מאושרים למסירה — רק קבצים של רכיבים שאושרו נכנסים ל-commit, ולא כל מה שנמצא בעותק.");

        // git's answer is not checked, as before: what got staged is what is committed. A file git refuses alone (an
        // ignored one) stays out while the rest goes in; a file that is not there at all makes git refuse the whole add.
        await Git.RunAsync(["add", "--", .. input.Files], dir);
        var staged = WorkspaceGit.Entries(await WorkspaceGit.RunAsync(dir, ["diff", "--cached", "--name-only", "-z"], null)).Count;
        string? commitSha = null;
        if (staged > 0)
        {
            var (name, email) = input.Author;
            log($"dcc$ git commit -m \"{input.Title}\"   ({name} <{email}>)");
            var c = await Git.RunAsync(["-c", $"user.name={name}", "-c", $"user.email={email}", "commit", "-m", $"{input.Title}\n\nCo-Authored-By: Claude <noreply@anthropic.com>"], dir);
            if (!c.Ok) throw new InvalidOperationException($"commit נכשל: {Head(c.Out, 300)}");
            commitSha = (await Git.RunAsync(["rev-parse", "--short", "HEAD"], dir)).Out;
            log($"[{branch} {commitSha}] {staged} files changed");
        }

        // Claude may have committed by itself during the session: whatever is on the branch since the baseline is work to
        // deliver, whether or not anything was left for this commit.
        var hasBaseline = !string.IsNullOrEmpty(input.BaselineSha);
        var filesCommitted = hasBaseline
            ? WorkspaceGit.Entries(await WorkspaceGit.RunAsync(dir, ["diff", "--name-only", "-z", $"{input.BaselineSha}..HEAD"], null)).Count
            : staged;
        var ahead = hasBaseline
            ? int.TryParse((await Git.RunAsync(["rev-list", "--count", $"{input.BaselineSha}..HEAD"], dir)).Out, NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0
            : staged > 0 ? 1 : 0;
        var nothingToDeliver = staged == 0 && ahead == 0;

        var remoteRes = await Git.RunAsync(["remote", "get-url", "origin"], dir);
        var remote = remoteRes.Ok && remoteRes.Out.Length > 0 ? remoteRes.Out : null;
        var originHead = await Git.RunAsync(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir);
        var fromOrigin = originHead.Ok ? StripOrigin(originHead.Out) : "";
        var @base = fromOrigin.Length > 0 ? fromOrigin : !string.IsNullOrEmpty(input.DefaultBranch) ? input.DefaultBranch : "main";
        var common = new DeliverResult { Branch = branch, Base = @base, CommitSha = commitSha, FilesCommitted = filesCommitted, Remote = remote };

        if (nothingToDeliver) return common with { LocalOnly = remote is null, Note = "לא היו שינויים למסור" };
        if (remote is null)
        {
            log($"no remote — branch {branch} stays in the local clone; merge it into {@base} by hand");
            return common with { LocalOnly = true };
        }

        log($"dcc$ git push -u origin {branch}");
        var push = await Git.RunAsync(["push", "-u", "origin", branch], dir, PushTimeoutMs);
        if (!push.Ok) throw new InvalidOperationException($"git push נכשל: {Head(push.Out, 400)}");
        var pushed = common with { Pushed = true, CompareUrl = CompareUrl(remote, @base, branch) };
        if (!await gh.AvailableAsync(ct))
        {
            log("gh is not installed — open the pull request from the compare link");
            return pushed;
        }

        var bodyFile = Path.Combine(Path.GetTempPath(), $"dcc-pr-body-{Guid.NewGuid()}.md");
        await File.WriteAllTextAsync(bodyFile, input.Body, ct);
        try
        {
            log($"dcc$ gh pr create --base {@base} --head {branch}");
            // gh reads an ssh:// or git@host: address as well as an https one; where it cannot open a request (a remote that
            // is a folder), it says why, and that goes into the note — as when it ran in the copy.
            var r = await gh.RunAsync(["pr", "create", "--repo", Git.HttpsRepoUrl(remote) ?? remote, "--title", input.Title, "--body-file", bodyFile, "--base", @base, "--head", branch], PrCreateTimeoutMs, ct);
            if (r.Ok)
            {
                var outText = r.Out.Trim();
                var prUrl = outText.Split('\n')[^1];
                var m = PullNumber().Match(prUrl);
                log($"✓ {prUrl}");
                return pushed with
                {
                    PrNumber = m.Success && int.TryParse(m.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var number) ? number : null,
                    PrUrl = prUrl,
                };
            }
            log("gh pr create failed — open the pull request from the compare link");
            var why = r.Err.Trim() is { Length: > 0 } err ? err : r.Out.Trim();
            return pushed with { Note = $"gh pr create נכשל: {Head(why, 200)}" };
        }
        finally
        {
            try { File.Delete(bodyFile); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* best effort */ }
        }
    }

    /// <summary>The host's page for opening the request by hand, or null when the remote has no https address.</summary>
    public static string? CompareUrl(string remote, string @base, string branch) =>
        Git.HttpsRepoUrl(remote) is { } httpsBase ? $"{httpsBase}/compare/{EncodeUriComponent(@base)}...{EncodeUriComponent(branch)}?expand=1" : null;

    /// <summary>JavaScript's <c>encodeURIComponent</c>: <see cref="Uri.EscapeDataString(string)"/> also escapes <c>! * ' ( )</c>, which it leaves as they are.</summary>
    private static string EncodeUriComponent(string s)
    {
        var escaped = new StringBuilder(Uri.EscapeDataString(s));
        foreach (var c in "!*'()") escaped.Replace($"%{(int)c:X2}", c.ToString());
        return escaped.ToString();
    }

    private static string StripOrigin(string r) => r.StartsWith("origin/", StringComparison.Ordinal) ? r["origin/".Length..] : r;

    private static string Head(string s, int n) => s.Length <= n ? s : s[..n];
}
