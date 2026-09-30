using System.Diagnostics;
using System.Text;

namespace Dcc.Infrastructure.Repos;

/// <summary>
/// Runs git in a folder — the one place that does (ai-assist.ts <c>git()</c>). git.exe is a real
/// executable, so it runs without a shell and every argument stays one argument. It never prompts
/// (GIT_TERMINAL_PROMPT=0), long paths are on (a .NET obj/ tree breaks Windows' 260-char limit),
/// and a timeout kills the whole tree — a credential helper's GUI prompt is a child of git.
/// </summary>
public static class Git
{
    public sealed record Result(int Code, string Out)
    {
        public bool Ok => Code == 0;
    }

    public static async Task<Result> RunAsync(IEnumerable<string> args, string cwd, int? timeoutMs = null, IReadOnlyDictionary<string, string>? env = null, CancellationToken ct = default)
    {
        var list = args.ToList();
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = cwd, RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
            UseShellExecute = false, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        psi.ArgumentList.Add("-c");
        psi.ArgumentList.Add("core.longpaths=true");
        foreach (var a in list) psi.ArgumentList.Add(a);
        psi.Environment["GIT_TERMINAL_PROMPT"] = "0";
        if (env is not null) foreach (var (k, v) in env) psi.Environment[k] = v;

        Process p;
        try { p = Process.Start(psi)!; }
        catch (Exception e) { return new Result(1, e.Message); }
        using (p)
        {
            p.StandardInput.Close();
            // Read whole streams, not lines: `git show` hands back file content, CRLF and all.
            var stdout = p.StandardOutput.ReadToEndAsync(CancellationToken.None);
            var stderr = p.StandardError.ReadToEndAsync(CancellationToken.None);
            using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
            if (timeoutMs is { } ms) limit.CancelAfter(ms);
            try
            {
                await p.WaitForExitAsync(limit.Token);
            }
            catch (OperationCanceledException)
            {
                try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                return new Result(1, $"git {list.FirstOrDefault()} לא הגיב תוך {(timeoutMs ?? 0) / 1000}s — כנראה נדרש אימות אינטראקטיבי (credential manager) שלא זמין מכאן. בצע \"git push\" פעם אחת מהטרמינל שלך כדי שהפרטים יישמרו, ואז נסה שוב.");
            }
            return new Result(p.ExitCode, (await stdout + await stderr).Trim());
        }
    }

    public static Task<Result> RunAsync(string cwd, params string[] args) => RunAsync(args, cwd);

    /// <summary>The non-empty lines of git output.</summary>
    public static List<string> Lines(string s) => s.Split('\n').Select(x => x.Trim()).Where(x => x.Length > 0).ToList();

    /// <summary>The repository's default branch in a clone, e.g. "main".</summary>
    public static async Task<string> DefaultBranchAsync(string dir)
    {
        var o = (await RunAsync(dir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")).Out;
        var b = o.StartsWith("origin/", StringComparison.Ordinal) ? o["origin/".Length..] : o;
        return b.Length > 0 && !b.Contains(' ') && !b.StartsWith("fatal", StringComparison.Ordinal) ? b : "main";
    }

    public static async Task<bool> ExistsAsync(string dir, string rev) => (await RunAsync(dir, "rev-parse", "--verify", "--quiet", rev)).Ok;

    public static async Task<bool> IsAncestorAsync(string dir, string a, string b) => (await RunAsync(dir, "merge-base", "--is-ancestor", a, b)).Ok;

    /// <summary>
    /// Where a task's own work starts: the commit recorded when its branch was created (possibly
    /// another task's branch) — or, for a branch from before that was recorded, where it leaves the default branch.
    /// </summary>
    public static async Task<string?> TaskBaseShaAsync(string dir, string branch, string? baseSha)
    {
        if (!string.IsNullOrEmpty(baseSha) && await IsAncestorAsync(dir, baseSha, branch)) return baseSha;
        var r = await RunAsync(dir, "merge-base", branch, $"origin/{await DefaultBranchAsync(dir)}");
        return r.Ok && r.Out.Length > 0 ? r.Out : null;
    }

    /// <summary>How many commits of its own a task's branch has, beyond what it was built on. 0 = never developed, or it changed nothing.</summary>
    public static async Task<int> TaskCommitCountAsync(string dir, string branch, string? baseSha)
    {
        if (!await ExistsAsync(dir, branch)) return 0;
        var from = await TaskBaseShaAsync(dir, branch, baseSha);
        if (from is null) return 0;
        var count = await RunAsync(dir, "rev-list", "--count", $"{from}..{branch}");
        return int.TryParse(count.Out, out var n) ? n : 0;
    }

    /// <summary>The line worth showing from a failed git run — git's own "fatal:"/"error:" over a trailing hint.</summary>
    public static string FailureDetail(string output)
    {
        var lines = Lines(output);
        return lines.FirstOrDefault(l => l.StartsWith("fatal:", StringComparison.OrdinalIgnoreCase) || l.StartsWith("error:", StringComparison.OrdinalIgnoreCase))
            ?? lines.LastOrDefault() ?? "ללא פירוט";
    }
}
