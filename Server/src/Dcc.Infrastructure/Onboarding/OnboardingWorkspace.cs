using System.Text.Json.Serialization;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Repos;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// The isolated copy a run edits. <c>DefaultBranch</c> is the repository's main line — the branch the run is cut from and
/// is delivered back to; <c>BaseFrom</c> says how that baseline was found ("remote", "local" or "head"), so the screen
/// can say it and a fallback is never silent.
/// </summary>
public sealed record WorkspaceCopy(
    [property: JsonPropertyName("dir")] string Dir,
    [property: JsonPropertyName("baselineSha")] string BaselineSha,
    [property: JsonPropertyName("branch")] string Branch,
    [property: JsonPropertyName("defaultBranch")] string? DefaultBranch,
    [property: JsonPropertyName("baseFrom")] string BaseFrom);

/// <summary>
/// The isolated working copy an onboarding run edits (repo-onboarding/workspace.ts): a <c>git worktree</c> off the shared
/// clone (<see cref="RepoCheckouts"/>), on its own <c>ai/onboarding/&lt;run&gt;</c> branch, pinned to a recorded baseline
/// commit. The developer's own checkout is never touched, and a large repository is downloaded once, not once per run.
/// It lives under <c>Onboarding:WorkspaceRoot</c> (default <c>~/.dcc-repos-onboarding</c>), not TEMP: TEMP can resolve to
/// an 8.3 short name that Claude Code's write check refuses, silently blocking every file a session writes there.
/// </summary>
public sealed class OnboardingWorkspace(IOptions<OnboardingOptions> options, RepoCheckouts checkouts)
{
    private const int FetchTimeoutMs = 300_000;
    private const int SetHeadTimeoutMs = 120_000;
    private const int WorktreeTimeoutMs = 600_000;

    public string Root => options.Value.WorkspaceRoot;

    /// <summary>Where a run's isolated copy is.</summary>
    public string DirOf(Guid runId) => Path.Combine(Root, runId.ToString());

    /// <summary>Per-run files DCC itself keeps (terminal log, status-line snapshot) — outside the copy, so they never show up in its diff.</summary>
    public string RuntimeDir(Guid runId) => Path.Combine(Root, "_runtime", runId.ToString());

    /// <summary>The run's own branch: <c>ai/onboarding/</c> and the first eight characters of its id.</summary>
    public static string BranchOf(Guid runId) => $"ai/onboarding/{runId.ToString()[..8]}";

    /// <summary>
    /// Makes the run's copy — again from scratch when the step runs again for the same run: a previous attempt may have
    /// left a partial checkout or a registered branch behind, and <c>worktree add</c> is not idempotent against either.
    /// Both are scoped to this run alone. A failure is thrown as a sentence for the person.
    /// </summary>
    public async Task<WorkspaceCopy> EnsureAsync(RepoRef repo, Guid runId, Action<string> log)
    {
        log($"dcc$ fetch {repo.AdoRepoRef ?? repo.LocalPath ?? repo.Name}");
        var sharedDir = await checkouts.EnsureAsync(repo)
            ?? throw new InvalidOperationException($"אין אפשרות לשכפל או לגשת לריפו {repo.Name} — בדוק את כתובת ה-Git שלו");
        if (!await Git.ExistsAsync(sharedDir, "HEAD"))
            throw new InvalidOperationException($"העותק המקומי של {repo.Name} לא שלם — מחקו את {sharedDir} והריצו את השלב שוב");

        var (baselineSha, defaultBranch, baseFrom) = await ResolveBaselineAsync(sharedDir, log);
        var branch = BranchOf(runId);
        Directory.CreateDirectory(Root);
        var dir = DirOf(runId);

        if (Directory.Exists(dir))
        {
            await Git.RunAsync(["worktree", "remove", dir, "--force"], sharedDir);
            RepoCheckouts.ForceDelete(dir);
        }
        await Git.RunAsync(["worktree", "prune"], sharedDir);
        await Git.RunAsync(["branch", "-D", branch], sharedDir);

        log($"dcc$ git worktree add -b {branch} {dir} {Head(baselineSha, 7)}  # {defaultBranch ?? "HEAD"}");
        var added = await Git.RunAsync(["worktree", "add", "-b", branch, dir, baselineSha], sharedDir, WorktreeTimeoutMs);
        if (!added.Ok) throw new InvalidOperationException($"יצירת העותק המבודד נכשלה: {Head(added.Out, 300)}");
        return new WorkspaceCopy(dir, baselineSha, branch, defaultBranch, baseFrom);
    }

    /// <summary>
    /// Which commit a run starts from — never the shared clone's HEAD. A shared clone may also be somebody's own working
    /// folder (<c>repo.LocalPath</c>), handed back untouched, so it stands on whatever branch they last switched to; a run
    /// cut from there quietly carries their unmerged work into its own branch, and from there into the pull request it
    /// opens. So the baseline is the main line as the remote declares it, made current by <c>git fetch</c> — which only
    /// moves remote-tracking refs and is safe in a folder somebody is working in, as <c>reset</c>/<c>checkout</c> would
    /// not be.
    ///
    /// A git answer is taken only when git succeeded. The old server read these answers with stderr joined in, so a failed
    /// <c>symbolic-ref</c> handed back git's "fatal: …" line as if it were a ref: the <c>remote set-head</c> retry below
    /// never ran, and a detached HEAD was named "fatal: ref HEAD is not a symbolic ref". Here the retry runs as intended
    /// and a detached HEAD has no branch (null).
    /// </summary>
    private static async Task<(string Sha, string? Branch, string From)> ResolveBaselineAsync(string sharedDir, Action<string> log)
    {
        async Task<string> ShaAsync(string rev)
        {
            var r = await Git.RunAsync(["rev-parse", "--verify", "--quiet", rev], sharedDir);
            return r.Ok ? Git.ShaOf(r.Out) : "";
        }
        async Task<string> SymbolicAsync(string name)
        {
            var r = await Git.RunAsync(["symbolic-ref", "--short", name], sharedDir);
            return r.Ok ? r.Out : "";
        }

        if ((await Git.RunAsync(["remote", "get-url", "origin"], sharedDir)).Ok)
        {
            log("dcc$ git fetch origin --prune");
            await Git.RunAsync(["fetch", "origin", "--prune"], sharedDir, FetchTimeoutMs);
            // `origin/HEAD` is what the remote calls its main line; a clone made with `--depth` or an older git may not
            // have it until it is asked for.
            var originHead = await SymbolicAsync("refs/remotes/origin/HEAD");
            if (originHead.Length == 0)
            {
                await Git.RunAsync(["remote", "set-head", "origin", "-a"], sharedDir, SetHeadTimeoutMs);
                originHead = await SymbolicAsync("refs/remotes/origin/HEAD");
            }
            var sha = originHead.Length > 0 ? await ShaAsync(originHead) : "";
            if (sha.Length > 0)
                return (sha, originHead.StartsWith("origin/", StringComparison.Ordinal) ? originHead["origin/".Length..] : originHead, "remote");
        }

        // No remote, or a remote that would not say: the local main line, by its usual names.
        foreach (var name in new[] { "main", "master" })
        {
            var sha = await ShaAsync($"refs/heads/{name}");
            if (sha.Length == 0) continue;
            log($"dcc$ no origin/HEAD — using local {name}");
            return (sha, name, "local");
        }

        var head = await ShaAsync("HEAD");
        if (head.Length == 0) throw new InvalidOperationException("העותק המקומי לא שלם — אין ממה להתחיל");
        var current = await SymbolicAsync("HEAD") is { Length: > 0 } b ? b : null;
        log($"dcc$ no main line found — starting from the current branch ({current ?? "detached"})");
        return (head, current, "head");
    }

    /// <summary>How many files git tracks in the copy — a figure on the connect card.</summary>
    public static async Task<int> TrackedFileCountAsync(string dir) =>
        WorkspaceGit.Entries(await WorkspaceGit.RunAsync(dir, ["ls-files", "-z"], 60_000)).Count;

    /// <summary>
    /// What Claude Code configuration the repository already carries — one line on the connect card, so <c>/init</c>'s
    /// "I found an existing CLAUDE.md" question does not come as a surprise. A folder entry counts like a file, as the
    /// old server's directory listing counted it.
    /// </summary>
    public static ExistingSetup ExistingSetupOf(string dir)
    {
        var claudeMd = Path.Combine(dir, "CLAUDE.md");
        var dotClaude = Path.Combine(dir, ".claude");
        return new ExistingSetup(
            ClaudeMdLines: File.Exists(claudeMd) ? LineCount(claudeMd) : null,
            AgentsMd: Path.Exists(Path.Combine(dir, "AGENTS.md")),
            Rules: CountIn(Path.Combine(dotClaude, "rules"), (n, _) => n.EndsWith(".md", StringComparison.Ordinal)),
            Skills: CountIn(Path.Combine(dotClaude, "skills"), (_, full) => Path.Exists(Path.Combine(full, "SKILL.md"))),
            Hooks: CountIn(Path.Combine(dotClaude, "hooks"), (n, _) => !n.StartsWith('.')),
            Agents: CountIn(Path.Combine(dotClaude, "agents"), (n, _) => n.EndsWith(".md", StringComparison.Ordinal)),
            Settings: Path.Exists(Path.Combine(dotClaude, "settings.json")));
    }

    /// <summary>The entries of a folder (files and folders alike) that <paramref name="pick"/> keeps; 0 when it cannot be read.</summary>
    private static int CountIn(string dir, Func<string, string, bool> pick)
    {
        try { return Directory.EnumerateFileSystemEntries(dir).Count(full => pick(Path.GetFileName(full), full)); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return 0; }
    }

    /// <summary>The text split on "\n", as the old server counted it — a final newline counts one more line.</summary>
    private static int? LineCount(string file)
    {
        try { return File.ReadAllText(file).Count(c => c == '\n') + 1; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return null; }
    }

    private static string Head(string s, int n) => s.Length <= n ? s : s[..n];
}
