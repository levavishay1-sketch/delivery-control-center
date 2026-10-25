using System.Collections.Concurrent;
using System.Globalization;
using Dcc.Domain.Git;

namespace Dcc.Infrastructure.Repos;

/// <summary>What a map of a working copy is asked for. <c>Ref</c>: a branch read without checking it out (default HEAD).</summary>
public sealed record CodeMapInput(string? Branch = null, string? BaselineSha = null, string? PrUrl = null, int? PrNumber = null, string? Ref = null, string? BranchLabel = null);

/// <summary>
/// The git facts of a working copy for the code map (code-map.ts <c>readCodeMapFacts</c>). Local commands only — no
/// network, so a screen that polls every couple of seconds stays cheap — and memoised for a few seconds on top. A
/// folder that is not a git repository is reported as that, never read further: git's error text would otherwise
/// reach the screen as if it were data.
/// </summary>
public static class CodeMapReader
{
    private const int MaxOurs = 8;
    private const int MaxBaseAfter = 12;
    private const int Before = 2;
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(8);
    private static readonly ConcurrentDictionary<string, (DateTimeOffset At, CodeMapFacts Facts)> Cache = new();

    private static async Task<List<CodeMapCommit>> LogAsync(string dir, string range, int limit)
    {
        var r = await Git.RunAsync(["log", $"--format={CodeMaps.LogFormat}", "--name-only", "-n", limit.ToString(CultureInfo.InvariantCulture), range], dir, 25_000);
        return r.Ok ? CodeMaps.ParseLog(r.Out) : [];
    }

    private static int Num(string s) => int.TryParse(s.Trim(), out var n) ? n : 0;

    public static async Task<CodeMapFacts> ReadFactsAsync(string dir, CodeMapInput input)
    {
        if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir))
            return new CodeMapFacts { Dir = string.IsNullOrEmpty(dir) ? null : Path.GetFullPath(dir), Unreadable = "התיקייה לא קיימת במחשב הזה — ייתכן שנמחקה." };
        var inside = await Git.RunAsync(dir, "rev-parse", "--is-inside-work-tree");
        if (!inside.Ok || inside.Out.Trim() != "true")
            return new CodeMapFacts { Dir = Path.GetFullPath(dir), Unreadable = "git לא מזהה בתיקייה הזו ריפו. כנראה העותק המקומי של הריפו נמחק או נפגע. אין בזה נזק לעבודה שב-GitHub; כדאי לבטל את ההרצה ולהתחיל חדשה." };

        // Text out of git is data only when the command succeeded.
        async Task<string> Ok(params string[] args) { var r = await Git.RunAsync(dir, args); return r.Ok ? r.Out.Trim() : ""; }
        // A task's branch is read without checking it out, so the tip is a named ref rather than HEAD.
        var tip = input.Ref ?? "HEAD";
        var key = $"{dir}|{tip}|{input.Branch}|{input.BaselineSha}";
        if (Cache.TryGetValue(key, out var hit) && DateTimeOffset.UtcNow - hit.At < Ttl)
            return hit.Facts with { PrUrl = input.PrUrl ?? hit.Facts.PrUrl, PrNumber = input.PrNumber ?? hit.Facts.PrNumber };

        var head = await Ok("symbolic-ref", "--short", "refs/remotes/origin/HEAD");
        var baseBranch = head.StartsWith("origin/", StringComparison.Ordinal) ? head["origin/".Length..] : head.Length > 0 ? head : "main";
        var baseRef = $"origin/{baseBranch}";
        var branch = input.Branch ?? (await Ok("branch", "--show-current") is { Length: > 0 } b ? b : null);
        var remote = await Ok("remote", "get-url", "origin");

        var baseline = input.BaselineSha;
        if (baseline is null && branch is not null)
        {
            var mb = await Git.RunAsync(dir, "merge-base", input.Ref ?? branch, baseRef);
            baseline = mb.Ok && mb.Out.Trim().Length > 0 ? mb.Out.Trim() : null;
        }

        var facts = new CodeMapFacts { BaseBranch = baseBranch, Branch = branch, BaselineSha = baseline, RepoUrl = remote.Length > 0 ? Git.HttpsRepoUrl(remote) : null, Dir = Path.GetFullPath(dir) };
        if (baseline is not null)
        {
            var ours = (await LogAsync(dir, $"{baseline}..{tip}", MaxOurs)).AsEnumerable().Reverse().ToList();
            var after = (await LogAsync(dir, $"{baseline}..{baseRef}", MaxBaseAfter)).AsEnumerable().Reverse().ToList();
            var behind = await Git.RunAsync(["rev-list", "--count", $"{tip}..{baseRef}"], dir, 20_000);
            var ourFiles = ours.SelectMany(c => c.Files).ToHashSet();
            facts = facts with
            {
                OurCommits = ours, BaseAfter = after,
                BaselineCommit = (await LogAsync(dir, baseline, 1)).FirstOrDefault(),
                BaseBefore = (await LogAsync(dir, $"{baseline}~1", Before)).AsEnumerable().Reverse().ToList(),
                Behind = behind.Ok ? Num(behind.Out) : 0,
                BehindTouching = after.Count(c => c.Files.Any(ourFiles.Contains)),
            };
        }
        if (tip == "HEAD") facts = facts with { UncommittedFiles = Git.Lines((await Git.RunAsync(["status", "--porcelain"], dir, 20_000)).Out).Count };
        if (branch is not null)
        {
            var remoteAhead = await Git.RunAsync(dir, "rev-list", "--count", $"origin/{branch}..{tip}");
            var merged = await Git.RunAsync(dir, "merge-base", "--is-ancestor", tip, baseRef);
            facts = facts with { Pushed = remoteAhead.Ok && Num(remoteAhead.Out) == 0, Merged = merged.Ok && facts.OurCommits.Count > 0 };
        }
        // A worktree's .git is a file; the fetch record lives in the shared directory.
        var common = await Ok("rev-parse", "--git-common-dir");
        var fetchHead = common.Length > 0 ? Path.GetFullPath(Path.Combine(dir, common, "FETCH_HEAD")) : "";
        if (fetchHead.Length > 0 && File.Exists(fetchHead))
            facts = facts with { FetchedAt = new DateTimeOffset(File.GetLastWriteTimeUtc(fetchHead), TimeSpan.Zero).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture) };

        Cache[key] = (DateTimeOffset.UtcNow, facts);
        return facts with { PrUrl = input.PrUrl, PrNumber = input.PrNumber };
    }

    /// <summary>The map of a working copy, in one call — what every screen uses.</summary>
    public static async Task<CodeMap> ForWorkspaceAsync(string dir, CodeMapInput input) =>
        CodeMaps.From(await ReadFactsAsync(dir, input), input.BranchLabel ?? input.Branch);
}
