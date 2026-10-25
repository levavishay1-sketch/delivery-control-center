using System.Text;
using System.Text.Json;
using Dcc.Application.Common;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Onboarding;
using Dcc.Infrastructure.PullRequests;
using Dcc.Infrastructure.Repos;
using Microsoft.Extensions.Options;

namespace Dcc.Tests.Unit.Onboarding;

/// <summary>
/// Phase 4.7: a run's isolated copy, what it changed, and its delivery (workspace.ts, changes.ts, change-diff.ts,
/// deliver.ts — the old server had no tests for them). Everything runs against real git repositories in a temporary
/// folder: a bare "origin", a clone of it standing in for somebody's working folder, and the worktree a run makes. The
/// pull request is opened through a stand-in <c>gh</c> (a Node script), never the real one, and nothing touches the
/// network or the database.
/// </summary>
public sealed class WorkspaceTests : IDisposable
{
    private static readonly Guid RunId = Guid.Parse("9c02a09e-5b1f-4c3d-8e2a-0123456789ab");
    private const string RunBranch = "ai/onboarding/9c02a09e";
    private const string Title = "DCC onboarding: Claude Code setup for shop";

    private readonly string _root = Directory.CreateTempSubdirectory("dcc-workspace-").FullName;
    private readonly List<string> _log = [];

    public void Dispose()
    {
        try { RepoCheckouts.ForceDelete(_root); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    /* ── helpers ─────────────────────────────────────────────────────── */

    private static async Task<string> GitAsync(string cwd, params string[] args)
    {
        var r = await Git.RunAsync(["-c", "user.name=t", "-c", "user.email=t@x", "-c", "commit.gpgsign=false", .. args], cwd);
        Assert.True(r.Ok, r.Out);
        return r.Out;
    }

    private static void Write(string root, string relative, string text) => WriteBytes(root, relative, Encoding.UTF8.GetBytes(text));

    private static void WriteBytes(string root, string relative, byte[] bytes)
    {
        var full = Path.Combine(root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllBytes(full, bytes);
    }

    /// <summary>A new repository on <paramref name="branch"/>, its files exactly as written (no line-ending conversion), committed.</summary>
    private async Task<string> RepoAsync(string name, string branch, params (string Path, string Text)[] files)
    {
        var dir = Path.Combine(_root, name);
        Directory.CreateDirectory(dir);
        await GitAsync(dir, "init", "-q", "-b", branch);
        await GitAsync(dir, "config", "core.autocrlf", "false");
        await GitAsync(dir, "config", "commit.gpgsign", "false");
        foreach (var (path, text) in files) Write(dir, path, text);
        await GitAsync(dir, "add", "-A");
        await GitAsync(dir, "commit", "-q", "-m", "baseline");
        return dir;
    }

    /// <summary>A bare origin on main, the repository that filled it, and a clone of it — somebody's working folder.</summary>
    private async Task<(string Bare, string Seed, string Clone)> OriginAsync()
    {
        var bare = Path.Combine(_root, "origin.git");
        Directory.CreateDirectory(bare);
        await GitAsync(bare, "init", "--bare", "-q", "-b", "main");
        var seed = await RepoAsync("seed", "main", ("README.md", "# shop\n"), ("src/a.ts", "export const a = 1;\n"));
        await GitAsync(seed, "push", "-q", bare, "main");
        await GitAsync(_root, "clone", "-q", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", bare, "clone");
        return (bare, seed, Path.Combine(_root, "clone"));
    }

    private OnboardingWorkspace Workspace() => new(
        Options.Create(new OnboardingOptions { WorkspaceRoot = Path.Combine(_root, "ws") }),
        new RepoCheckouts(Options.Create(new RepoOptions { CachePath = Path.Combine(_root, "cache") })));

    private static RepoRef Local(string dir) => new(Guid.NewGuid(), "shop", dir, null);

    /// <summary>A gh that is not there.</summary>
    private Deliverer NoGh() => new(new GitHubCli(Options.Create(new GitHubOptions { Bin = Path.Combine(_root, "no-such-gh.exe") })));

    private DeliverInput Input(string dir, string? baselineSha, params string[] files) =>
        new(dir, RunBranch, "main", baselineSha, ("Dana Levi", "dana@acme.test"), Title, "## הדוח\n\nשורה שנייה\n", files, _log.Add);

    private static async Task<string> HeadAsync(string dir) => await GitAsync(dir, "rev-parse", "HEAD");

    /* ── the isolated copy ───────────────────────────────────────────── */

    [Fact]
    public async Task Cuts_the_copy_on_its_own_branch_from_the_remote_main_line_never_from_the_folder_s_current_branch()
    {
        var (bare, seed, clone) = await OriginAsync();
        // Somebody's unmerged work in their own folder, and a newer main on the remote that their folder has not fetched.
        await GitAsync(clone, "switch", "-q", "-c", "feature");
        Write(clone, "wip.ts", "export const wip = true;\n");
        await GitAsync(clone, "add", "-A");
        await GitAsync(clone, "commit", "-q", "-m", "wip");
        Write(seed, "src/b.ts", "export const b = 2;\n");
        await GitAsync(seed, "add", "-A");
        await GitAsync(seed, "commit", "-q", "-m", "b");
        await GitAsync(seed, "push", "-q", bare, "main");
        var remoteMain = await HeadAsync(seed);

        var ws = Workspace();
        var copy = await ws.EnsureAsync(Local(clone), RunId, _log.Add);

        Assert.Equal(Path.Combine(_root, "ws", RunId.ToString()), copy.Dir);
        Assert.Equal(RunBranch, copy.Branch);
        Assert.Equal("main", copy.DefaultBranch);
        Assert.Equal("remote", copy.BaseFrom);
        Assert.Equal(remoteMain, copy.BaselineSha);
        Assert.Equal(remoteMain, await HeadAsync(copy.Dir));
        Assert.Equal(RunBranch, await GitAsync(copy.Dir, "branch", "--show-current"));
        Assert.True(File.Exists(Path.Combine(copy.Dir, "src", "b.ts")));
        Assert.False(File.Exists(Path.Combine(copy.Dir, "wip.ts")));
        Assert.Equal("feature", await GitAsync(clone, "branch", "--show-current"));
        Assert.Equal($"dcc$ fetch {clone}", _log[0]);
        Assert.Contains("dcc$ git fetch origin --prune", _log);
        Assert.Contains($"dcc$ git worktree add -b {RunBranch} {copy.Dir} {remoteMain[..7]}  # main", _log);
    }

    [Fact]
    public async Task Running_again_for_the_same_run_starts_from_a_clean_copy()
    {
        var (_, _, clone) = await OriginAsync();
        var ws = Workspace();
        var first = await ws.EnsureAsync(Local(clone), RunId, _log.Add);
        Write(first.Dir, "leftover.md", "from the first attempt\n");
        await GitAsync(first.Dir, "add", "-A");
        await GitAsync(first.Dir, "commit", "-q", "-m", "first attempt");

        var second = await ws.EnsureAsync(Local(clone), RunId, _log.Add);

        Assert.Equal(first.Dir, second.Dir);
        Assert.False(File.Exists(Path.Combine(second.Dir, "leftover.md")));
        Assert.Equal(second.BaselineSha, await HeadAsync(second.Dir));
    }

    /// <summary>
    /// A folder without <c>origin/HEAD</c> still gets the remote's main line — recreated by the fetch itself on git 2.48+,
    /// by <c>remote set-head</c> before that (which the old server never reached: it took git's "fatal: …" for a ref).
    /// </summary>
    [Fact]
    public async Task Asks_the_remote_for_its_main_line_when_the_folder_does_not_know_it()
    {
        var (_, seed, clone) = await OriginAsync();
        await GitAsync(clone, "remote", "set-head", "origin", "-d");

        var copy = await Workspace().EnsureAsync(Local(clone), RunId, _log.Add);

        Assert.Equal("remote", copy.BaseFrom);
        Assert.Equal("main", copy.DefaultBranch);
        Assert.Equal(await HeadAsync(seed), copy.BaselineSha);
    }

    [Fact]
    public async Task Without_a_remote_starts_from_the_local_main_line()
    {
        var dir = await RepoAsync("local", "master", ("README.md", "# local\n"));
        var master = await HeadAsync(dir);
        await GitAsync(dir, "switch", "-q", "-c", "feature");
        Write(dir, "wip.ts", "x\n");
        await GitAsync(dir, "add", "-A");
        await GitAsync(dir, "commit", "-q", "-m", "wip");

        var copy = await Workspace().EnsureAsync(Local(dir), RunId, _log.Add);

        Assert.Equal(("local", "master", master), (copy.BaseFrom, copy.DefaultBranch, copy.BaselineSha));
        Assert.Contains("dcc$ no origin/HEAD — using local master", _log);
        Assert.DoesNotContain("dcc$ git fetch origin --prune", _log);
    }

    [Fact]
    public async Task With_no_main_line_starts_from_the_current_branch_and_says_so()
    {
        var dir = await RepoAsync("trunk", "trunk", ("README.md", "# trunk\n"));
        var ws = Workspace();

        var onTrunk = await ws.EnsureAsync(Local(dir), RunId, _log.Add);
        Assert.Equal(("head", "trunk"), (onTrunk.BaseFrom, onTrunk.DefaultBranch));
        Assert.Contains("dcc$ no main line found — starting from the current branch (trunk)", _log);

        await GitAsync(dir, "switch", "-q", "--detach");
        var detached = await ws.EnsureAsync(Local(dir), Guid.Parse("11111111-2222-3333-4444-555555555555"), _log.Add);
        Assert.Equal("head", detached.BaseFrom);
        Assert.Null(detached.DefaultBranch);
        Assert.Equal("ai/onboarding/11111111", detached.Branch);
        Assert.Contains("dcc$ no main line found — starting from the current branch (detached)", _log);
    }

    [Fact]
    public async Task Works_from_DCC_s_own_shallow_copy_of_the_repository()
    {
        var (bare, seed, _) = await OriginAsync();
        var repo = new RepoRef(Guid.NewGuid(), "shop", null, "file:///" + bare.Replace('\\', '/'));

        var copy = await Workspace().EnsureAsync(repo, RunId, _log.Add);

        Assert.Equal(("remote", "main"), (copy.BaseFrom, copy.DefaultBranch));
        Assert.Equal(await HeadAsync(seed), copy.BaselineSha);
        Assert.True(File.Exists(Path.Combine(copy.Dir, "src", "a.ts")));
        Assert.Equal($"dcc$ fetch {repo.AdoRepoRef}", _log[0]);
    }

    [Fact]
    public async Task A_repository_that_cannot_be_reached_is_refused_in_words()
    {
        var e = await Assert.ThrowsAsync<InvalidOperationException>(() => Workspace().EnsureAsync(new RepoRef(Guid.NewGuid(), "ghost", null, null), RunId, _log.Add));
        Assert.Equal("אין אפשרות לשכפל או לגשת לריפו ghost — בדוק את כתובת ה-Git שלו", e.Message);
        Assert.Equal("dcc$ fetch ghost", _log.Single());
    }

    [Fact]
    public void Names_the_run_s_branch_copy_and_runtime_folder()
    {
        var ws = Workspace();
        Assert.Equal(RunBranch, OnboardingWorkspace.BranchOf(RunId));
        Assert.Equal(Path.Combine(_root, "ws", RunId.ToString()), ws.DirOf(RunId));
        Assert.Equal(Path.Combine(_root, "ws", "_runtime", RunId.ToString()), ws.RuntimeDir(RunId));
    }

    [Fact]
    public async Task Counts_tracked_files_whatever_their_names()
    {
        var dir = await RepoAsync("count", "main", ("README.md", "x\n"), ("docs/שלום עולם.md", "y\n"), ("src/a b.ts", "z\n"));
        Write(dir, "untracked.txt", "not counted\n");
        Assert.Equal(3, await OnboardingWorkspace.TrackedFileCountAsync(dir));
    }

    [Fact]
    public void Reads_the_Claude_Code_setup_the_repository_already_carries()
    {
        var dir = Path.Combine(_root, "setup");
        Write(dir, "CLAUDE.md", "# Project\n\nRules.\n");
        Write(dir, "AGENTS.md", "# Agents\n");
        Write(dir, ".claude/rules/api.md", "x");
        Write(dir, ".claude/rules/web.md", "x");
        Write(dir, ".claude/rules/notes.txt", "x");
        Write(dir, ".claude/skills/deploy/SKILL.md", "x");
        Write(dir, ".claude/skills/half-made/README.md", "x");
        Write(dir, ".claude/hooks/guard.mjs", "x");
        Write(dir, ".claude/hooks/.gitkeep", "");
        Write(dir, ".claude/agents/reviewer.md", "x");
        Write(dir, ".claude/settings.json", "{}");

        Assert.Equal(new ExistingSetup(4, true, 2, 1, 1, 1, true), OnboardingWorkspace.ExistingSetupOf(dir));
        Directory.CreateDirectory(Path.Combine(_root, "empty"));
        Assert.Equal(new ExistingSetup(null, false, 0, 0, 0, 0, false), OnboardingWorkspace.ExistingSetupOf(Path.Combine(_root, "empty")));
    }

    /* ── what the run changed ────────────────────────────────────────── */

    private static readonly string TenLines = string.Concat(Enumerable.Range(1, 10).Select(i => $"export const v{i} = {i};\n"));

    /// <summary>A copy at its baseline, then: an edit, a deletion, a rename with an edit, a binary edit, Claude's own commit and new untracked files.</summary>
    private async Task<(string Dir, string Baseline)> ChangedCopyAsync()
    {
        var dir = await RepoAsync("changes", "main",
            ("README.md", "# shop\n"), ("src/old.ts", "export const old = 1;\n"), ("src/a.ts", TenLines), (".gitignore", "*.log\n"));
        WriteBytes(dir, "logo.png", [0x89, 0x50, 0x4E, 0x47, 0, 1, 2]);
        await GitAsync(dir, "add", "-A");
        await GitAsync(dir, "commit", "-q", "-m", "logo");
        var baseline = await HeadAsync(dir);

        Write(dir, "README.md", "# shop\n\nSet up for Claude Code.\n");
        File.Delete(Path.Combine(dir, "src", "old.ts"));
        await GitAsync(dir, "mv", "src/a.ts", "src/renamed.ts");
        Write(dir, "src/renamed.ts", TenLines.Replace("v10 = 10", "v10 = 11", StringComparison.Ordinal));
        WriteBytes(dir, "logo.png", [0x89, 0x50, 0x4E, 0x47, 0, 9, 9]);
        Write(dir, "CLAUDE.md", "# Shop\n\nSee AGENTS.md.\n");
        await GitAsync(dir, "add", "CLAUDE.md");
        await GitAsync(dir, "commit", "-q", "-m", "claude committed this");
        Write(dir, "docs/שלום עולם.md", "a\nb\n");
        Write(dir, "build.log", "ignored\n");
        return (dir, baseline);
    }

    [Fact]
    public async Task Lists_tracked_changes_and_new_files_in_the_order_the_screen_showed_them()
    {
        var (dir, baseline) = await ChangedCopyAsync();

        var files = await RunChanges.ChangedFilesAsync(dir, baseline);

        Assert.Equal(
        [
            new ChangedFile("CLAUDE.md", "A", 3, 0),
            new ChangedFile("docs/שלום עולם.md", "A", 3, 0),
            new ChangedFile("logo.png", "M", 0, 0),
            new ChangedFile("README.md", "M", 2, 0),
            new ChangedFile("src/old.ts", "D", 0, 1),
            new ChangedFile("src/renamed.ts", "R", 1, 1),
        ], files);
    }

    [Fact]
    public async Task Orders_paths_the_way_localeCompare_did()
    {
        var dir = await RepoAsync("order", "main", ("keep.txt", "x\n"));
        var baseline = await HeadAsync(dir);
        string[] names = ["src/a.ts", "README.md", ".claude/settings.json", "AGENTS.md", "CLAUDE.md", "docs/x.md", "src/A-b.ts", "src/a_b.ts", "src/ab.ts", "b.md", "package-lock.json", "notes 2.txt"];
        foreach (var n in names) Write(dir, n, "x\n");

        var files = await RunChanges.ChangedFilesAsync(dir, baseline);

        Assert.Equal([".claude/settings.json", "AGENTS.md", "b.md", "CLAUDE.md", "docs/x.md", "notes 2.txt", "package-lock.json", "README.md", "src/a_b.ts", "src/A-b.ts", "src/a.ts", "src/ab.ts"],
            files.Select(f => f.Path));
    }

    [Fact]
    public async Task Gives_a_file_as_it_was_at_the_baseline_and_as_it_is_now()
    {
        var (dir, baseline) = await ChangedCopyAsync();

        var readme = await RunChanges.FileVersionsAsync(dir, baseline, "README.md");
        Assert.Equal(new FileVersions("README.md", "# shop\n", "# shop\n\nSet up for Claude Code.\n", false, false), readme);
        Assert.Equal(new FileVersions("CLAUDE.md", null, "# Shop\n\nSee AGENTS.md.\n", false, false), await RunChanges.FileVersionsAsync(dir, baseline, "CLAUDE.md"));
        Assert.Equal(new FileVersions("src/old.ts", "export const old = 1;\n", null, false, false), await RunChanges.FileVersionsAsync(dir, baseline, "src/old.ts"));
        Assert.Equal(new FileVersions("logo.png", null, null, true, false), await RunChanges.FileVersionsAsync(dir, baseline, "logo.png"));
        Assert.Equal(new FileVersions("nowhere.md", null, null, false, false), await RunChanges.FileVersionsAsync(dir, baseline, "nowhere.md"));
        Assert.Equal("""{"path":"README.md","before":"# shop\n","after":"# shop\n\nSet up for Claude Code.\n","binary":false,"tooLarge":false}""", JsonSerializer.Serialize(readme));
    }

    [Fact]
    public async Task Reports_a_very_large_file_or_a_binary_baseline_instead_of_loading_it()
    {
        var dir = await RepoAsync("large", "main", ("big-then.txt", new string('x', RunChanges.MaxFileBytes + 1)), ("data.bin", "a\0b"));
        var baseline = await HeadAsync(dir);
        Write(dir, "big-now.txt", new string('y', RunChanges.MaxFileBytes + 1));
        Write(dir, "data.bin", "text now\n");

        Assert.Equal(new FileVersions("big-then.txt", null, null, false, true), await RunChanges.FileVersionsAsync(dir, baseline, "big-then.txt"));
        Assert.Equal(new FileVersions("big-now.txt", null, null, false, true), await RunChanges.FileVersionsAsync(dir, baseline, "big-now.txt"));
        // As before: a baseline with a NUL byte is flagged binary, and both sides are still handed back.
        Assert.Equal(new FileVersions("data.bin", "a\0b", "text now\n", true, false), await RunChanges.FileVersionsAsync(dir, baseline, "data.bin"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("../secrets.txt")]
    [InlineData("docs/../../x")]
    [InlineData("/etc/passwd")]
    [InlineData(@"C:\Windows\win.ini")]
    public async Task Refuses_a_path_outside_the_copy(string path)
    {
        var e = await Assert.ThrowsAsync<AppException>(() => RunChanges.FileVersionsAsync(_root, "HEAD", path));
        Assert.Equal((400, "נתיב לא חוקי"), (e.Status, e.Message));
    }

    [Fact]
    public async Task Writes_the_change_as_diff_text_with_lock_and_binary_files_listed_without_a_body()
    {
        var dir = await RepoAsync("diff", "main", ("README.md", "# shop\n"), ("package-lock.json", "{}\n"));
        var baseline = await HeadAsync(dir);
        Write(dir, "README.md", "# shop!\n");
        Write(dir, "package-lock.json", "{ \"lockfileVersion\": 3 }\n");
        Write(dir, "docs/new.md", "x\ny\n");
        WriteBytes(dir, "img.bin", [1, 0, 2]);
        var files = await RunChanges.ChangedFilesAsync(dir, baseline);

        var diff = await RunChanges.BuildDiffAsync(dir, baseline, [.. files, new ChangedFile("gone.txt", "A", 0, 0)]);

        var readmeDiff = (await Git.RunAsync(["diff", baseline, "--", "README.md"], dir)).Out;
        Assert.Equal(string.Join("\n",
            "### docs/new.md (A +3 −0)\ndiff --git a/docs/new.md b/docs/new.md\nnew file mode 100644\n--- /dev/null\n+++ b/docs/new.md\n@@ -0,0 +1,3 @@\n+x\n+y\n+\n",
            "### img.bin (A +1 −0) — binary file, not shown\n",
            "### package-lock.json (M +1 −1) — generated lock file, diff not shown\n",
            $"### README.md (M +1 −1)\n{readmeDiff}\n"), diff.Text);
        Assert.StartsWith("diff --git a/README.md b/README.md", readmeDiff);
        Assert.Equal(2, diff.Shown);
        Assert.Equal(["img.bin", "package-lock.json"], diff.WithoutBody);
        Assert.Empty(diff.Cut);
    }

    [Fact]
    public async Task Cuts_a_long_file_and_stops_once_the_diff_is_long_enough()
    {
        var dir = await RepoAsync("limits", "main", ("keep.txt", "x\n"));
        var baseline = await HeadAsync(dir);
        Write(dir, "a.md", "1\n2\n3\n4\n5\n");
        Write(dir, "b.md", "b\n");
        var files = await RunChanges.ChangedFilesAsync(dir, baseline);

        // a.md: five header lines and six body lines ("1\n…5\n" split on "\n"); seven are kept.
        var cut = await RunChanges.BuildDiffAsync(dir, baseline, files, new DiffLimits(MaxFileLines: 7));
        Assert.Contains("@@ -0,0 +1,6 @@\n+1\n+2\n… (4 more lines of this file's diff are not shown)\n", cut.Text);
        Assert.Equal(2, cut.Shown);
        Assert.Equal(["a.md"], cut.Cut);

        var full = await RunChanges.BuildDiffAsync(dir, baseline, files, new DiffLimits(MaxTotalChars: 10));
        Assert.EndsWith("\n### b.md (A +2 −0) — not shown: the diff is already long enough\n", full.Text);
        Assert.Equal(1, full.Shown);
        Assert.Equal(["b.md"], full.Cut);
    }

    /// <summary>A lock file's name must end the path, as JavaScript's <c>$</c> meant it: one with a final newline is not a lock file (and, not being there, is skipped).</summary>
    [Fact]
    public async Task Knows_a_lock_file_only_by_the_end_of_its_path()
    {
        var dir = await RepoAsync("lock-name", "main", ("keep.txt", "x\n"));
        var baseline = await HeadAsync(dir);

        var diff = await RunChanges.BuildDiffAsync(dir, baseline, [new ChangedFile("yarn.lock\n", "A", 0, 0)]);

        Assert.Equal(("", 0), (diff.Text, diff.Shown));
        Assert.Empty(diff.WithoutBody);
    }

    [Fact]
    public async Task Writes_the_diff_to_a_file_the_chat_can_read()
    {
        var dir = await RepoAsync("write", "main", ("keep.txt", "x\n"));
        var baseline = await HeadAsync(dir);
        Write(dir, "שלום.md", "שלום\n");
        var files = await RunChanges.ChangedFilesAsync(dir, baseline);
        var outFile = Path.Combine(_root, "chat", "change", "changes.diff");

        var written = await RunChanges.WriteDiffAsync(dir, baseline, files, outFile);

        Assert.Equal(Encoding.UTF8.GetBytes(written.Text), await File.ReadAllBytesAsync(outFile));
        Assert.Contains("+שלום\n", written.Text);
    }

    /* ── delivery ────────────────────────────────────────────────────── */

    /// <summary>A copy with no remote, on the run's branch, at its baseline.</summary>
    private async Task<(string Dir, string Baseline)> LocalCopyAsync()
    {
        var dir = await RepoAsync("deliver", "main", ("README.md", "# shop\n"));
        await GitAsync(dir, "switch", "-q", "-c", RunBranch);
        return (dir, await HeadAsync(dir));
    }

    [Fact]
    public async Task Refuses_to_deliver_an_empty_file_list_instead_of_adding_everything()
    {
        var (dir, baseline) = await LocalCopyAsync();
        Write(dir, "CLAUDE.md", "# Shop\n");

        var e = await Assert.ThrowsAsync<AppException>(() => NoGh().DeliverAsync(Input(dir, baseline)));

        Assert.Equal((409, "nothing_approved"), (e.Status, e.Code));
        Assert.Equal("אין קבצים מאושרים למסירה — רק קבצים של רכיבים שאושרו נכנסים ל-commit, ולא כל מה שנמצא בעותק.", e.Message);
        Assert.Equal(baseline, await HeadAsync(dir));
        Assert.Equal("?? CLAUDE.md", await GitAsync(dir, "status", "--porcelain"));
    }

    [Fact]
    public async Task Without_a_remote_commits_only_the_approved_files_in_the_person_s_name_and_stays_local()
    {
        var (dir, baseline) = await LocalCopyAsync();
        Write(dir, "CLAUDE.md", "# Shop\n");
        Write(dir, ".claude/settings.json", "{}\n");
        Write(dir, "scratch.txt", "not approved\n");

        var r = await NoGh().DeliverAsync(Input(dir, baseline, "CLAUDE.md", ".claude/settings.json"));

        var sha = await GitAsync(dir, "rev-parse", "--short", "HEAD");
        Assert.Equal(new DeliverResult { Branch = RunBranch, Base = "main", CommitSha = sha, FilesCommitted = 2, Remote = null, LocalOnly = true }, r);
        Assert.Equal("Dana Levi <dana@acme.test>", await GitAsync(dir, "log", "-1", "--format=%an <%ae>"));
        Assert.Equal($"{Title}\n\nCo-Authored-By: Claude <noreply@anthropic.com>", await GitAsync(dir, "log", "-1", "--format=%B"));
        Assert.Equal("?? scratch.txt", await GitAsync(dir, "status", "--porcelain"));
        Assert.Equal(
        [
            $"dcc$ git commit -m \"{Title}\"   (Dana Levi <dana@acme.test>)",
            $"[{RunBranch} {sha}] 2 files changed",
            $"no remote — branch {RunBranch} stays in the local clone; merge it into main by hand",
        ], _log);
        Assert.DoesNotContain("\"note\"", JsonSerializer.Serialize(r));
    }

    [Fact]
    public async Task Says_so_when_there_is_nothing_to_deliver()
    {
        var (dir, baseline) = await LocalCopyAsync();

        var r = await NoGh().DeliverAsync(Input(dir, baseline, "README.md"));

        Assert.Equal(new DeliverResult { Branch = RunBranch, Base = "main", FilesCommitted = 0, LocalOnly = true, Note = "לא היו שינויים למסור" }, r);
        Assert.Empty(_log);
    }

    [Fact]
    public async Task Delivers_what_the_session_committed_by_itself_since_the_baseline()
    {
        var (dir, baseline) = await LocalCopyAsync();
        Write(dir, "AGENTS.md", "# Agents\n");
        await GitAsync(dir, "add", "AGENTS.md");
        await GitAsync(dir, "commit", "-q", "-m", "claude committed this");

        var r = await NoGh().DeliverAsync(Input(dir, baseline, "AGENTS.md"));

        Assert.Equal(new DeliverResult { Branch = RunBranch, Base = "main", CommitSha = null, FilesCommitted = 1, LocalOnly = true }, r);
    }

    /// <summary>As before, git's answer to <c>add</c> is not checked: a file that is not there makes git refuse the whole add, so nothing is staged.</summary>
    [Fact]
    public async Task An_approved_file_that_is_not_there_leaves_nothing_staged_as_before()
    {
        var (dir, baseline) = await LocalCopyAsync();
        Write(dir, "CLAUDE.md", "# Shop\n");

        var r = await NoGh().DeliverAsync(Input(dir, baseline, "CLAUDE.md", ".claude/missing.md"));

        Assert.Equal(new DeliverResult { Branch = RunBranch, Base = "main", FilesCommitted = 0, LocalOnly = true, Note = "לא היו שינויים למסור" }, r);
        Assert.Equal(baseline, await HeadAsync(dir));
        Assert.Equal("?? CLAUDE.md", await GitAsync(dir, "status", "--porcelain"));
    }

    /// <summary>An approved file the repository ignores is refused by git alone; the other approved files are still committed.</summary>
    [Fact]
    public async Task An_approved_file_the_repository_ignores_stays_out_and_the_rest_is_committed()
    {
        var dir = await RepoAsync("deliver-ignored", "main", ("README.md", "# shop\n"), (".gitignore", "CLAUDE.local.md\n"));
        await GitAsync(dir, "switch", "-q", "-c", RunBranch);
        var baseline = await HeadAsync(dir);
        Write(dir, "CLAUDE.md", "# Shop\n");
        Write(dir, "CLAUDE.local.md", "# mine\n");

        var r = await NoGh().DeliverAsync(Input(dir, baseline, "CLAUDE.md", "CLAUDE.local.md"));

        Assert.Equal(new DeliverResult { Branch = RunBranch, Base = "main", CommitSha = await GitAsync(dir, "rev-parse", "--short", "HEAD"), FilesCommitted = 1, LocalOnly = true }, r);
        Assert.Equal("CLAUDE.md", await GitAsync(dir, "show", "--name-only", "--format=", "HEAD"));
        Assert.Equal("", await GitAsync(dir, "status", "--porcelain"));
    }

    [Fact]
    public async Task Pushes_the_run_s_branch_and_without_gh_leaves_the_request_to_the_person()
    {
        var (bare, _, clone) = await OriginAsync();
        var copy = await Workspace().EnsureAsync(Local(clone), RunId, _ => { });
        Write(copy.Dir, "CLAUDE.md", "# Shop\n");
        Assert.Equal([new ChangedFile("CLAUDE.md", "A", 2, 0)], await RunChanges.ChangedFilesAsync(copy.Dir, copy.BaselineSha));

        var r = await NoGh().DeliverAsync(Input(copy.Dir, copy.BaselineSha, "CLAUDE.md") with { Branch = copy.Branch, DefaultBranch = copy.DefaultBranch });

        Assert.True(r.Pushed);
        Assert.False(r.LocalOnly);
        Assert.Equal((copy.Branch, "main", 1), (r.Branch, r.Base, r.FilesCommitted));
        Assert.EndsWith("origin.git", r.Remote);
        Assert.Null(r.PrUrl);
        Assert.Null(r.CompareUrl);
        Assert.Equal(await HeadAsync(copy.Dir), await GitAsync(bare, "rev-parse", $"refs/heads/{copy.Branch}"));
        Assert.Contains($"dcc$ git push -u origin {copy.Branch}", _log);
    }

    /// <summary>A copy whose origin reads as GitHub but pushes into a local bare repository, and a stand-in gh that records its call.</summary>
    private async Task<(string Dir, string Baseline, Deliverer Deliverer, string CallFile)> GitHubCopyAsync(bool ghSucceeds, string remote = "https://github.com/acme/shop.git")
    {
        var bare = Path.Combine(_root, "gh-origin.git");
        Directory.CreateDirectory(bare);
        await GitAsync(bare, "init", "--bare", "-q", "-b", "main");
        var (dir, baseline) = await LocalCopyAsync();
        await GitAsync(dir, "remote", "add", "origin", remote);
        await GitAsync(dir, "remote", "set-url", "--push", "origin", bare);

        var callFile = Path.Combine(_root, "gh-call.json");
        var script = Path.Combine(_root, "fake-gh.cjs");
        File.WriteAllText(script, $$"""
            const fs = require("fs");
            const args = process.argv.slice(2);
            if (args[0] === "--version") { console.log("gh version 2.0.0 (stand-in)"); process.exit(0); }
            const body = fs.readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
            fs.writeFileSync({{JsonSerializer.Serialize(callFile)}}, JSON.stringify({ args, body }));
            if ({{(ghSucceeds ? "true" : "false")}}) { console.log("Creating pull request for {{RunBranch}} into main\n\nhttps://github.com/acme/shop/pull/42"); process.exit(0); }
            console.error("a pull request for branch \"{{RunBranch}}\" into branch \"main\" already exists:\nhttps://github.com/acme/shop/pull/41");
            process.exit(1);
            """);
        var gh = new GitHubCli(Options.Create(new GitHubOptions { Bin = "node", BinArgs = [script] }));
        return (dir, baseline, new Deliverer(gh), callFile);
    }

    [Fact]
    public async Task Opens_the_pull_request_with_gh_against_the_repository_the_remote_names()
    {
        var (dir, baseline, deliverer, callFile) = await GitHubCopyAsync(ghSucceeds: true);
        Write(dir, "CLAUDE.md", "# Shop\n");

        var r = await deliverer.DeliverAsync(Input(dir, baseline, "CLAUDE.md"));

        Assert.True(r.Pushed);
        Assert.False(r.LocalOnly);
        Assert.Equal(42, r.PrNumber);
        Assert.Equal("https://github.com/acme/shop/pull/42", r.PrUrl);
        Assert.Equal("https://github.com/acme/shop/compare/main...ai%2Fonboarding%2F9c02a09e?expand=1", r.CompareUrl);
        Assert.Equal("https://github.com/acme/shop.git", r.Remote);
        Assert.Null(r.Note);
        var call = JsonDocument.Parse(await File.ReadAllTextAsync(callFile)).RootElement;
        var args = call.GetProperty("args").EnumerateArray().Select(a => a.GetString()!).ToList();
        Assert.Equal(["pr", "create", "--repo", "https://github.com/acme/shop", "--title", Title, "--body-file", args[7], "--base", "main", "--head", RunBranch], args);
        Assert.Equal("## הדוח\n\nשורה שנייה\n", call.GetProperty("body").GetString());
        Assert.False(File.Exists(args[7]));
        Assert.Contains("✓ https://github.com/acme/shop/pull/42", _log);
    }

    /// <summary>A remote with no https address still gets its request from gh, which reads ssh:// itself — as when gh ran in the copy; only the compare link is missing.</summary>
    [Fact]
    public async Task Opens_the_pull_request_for_an_ssh_remote_too()
    {
        var (dir, baseline, deliverer, callFile) = await GitHubCopyAsync(ghSucceeds: true, remote: "ssh://git@github.com/acme/shop.git");
        Write(dir, "CLAUDE.md", "# Shop\n");

        var r = await deliverer.DeliverAsync(Input(dir, baseline, "CLAUDE.md"));

        Assert.Equal((true, 42, (string?)null, (string?)null), (r.Pushed, r.PrNumber, r.CompareUrl, r.Note));
        var args = JsonDocument.Parse(await File.ReadAllTextAsync(callFile)).RootElement.GetProperty("args").EnumerateArray().Select(a => a.GetString()!).ToList();
        Assert.Equal(["--repo", "ssh://git@github.com/acme/shop.git"], args.Skip(2).Take(2));
    }

    [Fact]
    public async Task When_gh_fails_hands_back_the_compare_link_and_says_why()
    {
        var (dir, baseline, deliverer, _) = await GitHubCopyAsync(ghSucceeds: false);
        Write(dir, "CLAUDE.md", "# Shop\n");

        var r = await deliverer.DeliverAsync(Input(dir, baseline, "CLAUDE.md"));

        Assert.True(r.Pushed);
        Assert.Null(r.PrNumber);
        Assert.Null(r.PrUrl);
        Assert.Equal("https://github.com/acme/shop/compare/main...ai%2Fonboarding%2F9c02a09e?expand=1", r.CompareUrl);
        Assert.Equal($"gh pr create נכשל: a pull request for branch \"{RunBranch}\" into branch \"main\" already exists:\nhttps://github.com/acme/shop/pull/41", r.Note);
        Assert.Contains("gh pr create failed — open the pull request from the compare link", _log);
    }

    [Fact]
    public void Builds_the_compare_link_the_way_encodeURIComponent_did()
    {
        Assert.Equal("https://github.com/acme/shop/compare/main...ai%2Fonboarding%2F(x)!*~'?expand=1", Deliverer.CompareUrl("git@github.com:acme/shop.git", "main", "ai/onboarding/(x)!*~'"));
        Assert.Equal("https://dev.azure.com/org/p/_git/r/compare/release%2F1.0...ai%2Fonboarding%2F9c02a09e?expand=1", Deliverer.CompareUrl("https://dev.azure.com/org/p/_git/r", "release/1.0", RunBranch));
        Assert.Null(Deliverer.CompareUrl(@"C:\repos\shop.git", "main", RunBranch));
    }
}
