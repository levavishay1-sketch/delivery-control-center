using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Dcc.Application.Common;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Repos;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>A file as the run began and as it is now, for the side-by-side view. Text that is not readable, or very large, is reported instead of loaded.</summary>
public sealed record FileVersions(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("before")] string? Before,
    [property: JsonPropertyName("after")] string? After,
    [property: JsonPropertyName("binary")] bool Binary,
    [property: JsonPropertyName("tooLarge")] bool TooLarge);

/// <summary>A run's change as diff text: how many files it shows in full, which ones it lists without a body, and which ones it cut.</summary>
public sealed record ChangesDiff(
    [property: JsonPropertyName("text")] string Text,
    [property: JsonPropertyName("shown")] int Shown,
    [property: JsonPropertyName("withoutBody")] IReadOnlyList<string> WithoutBody,
    [property: JsonPropertyName("cut")] IReadOnlyList<string> Cut);

/// <summary>How long one file's diff (in lines) and the whole diff (in UTF-16 characters) may grow. null = 700 lines, 200,000 characters.</summary>
public sealed record DiffLimits(int? MaxFileLines = null, int? MaxTotalChars = null);

/// <summary>
/// What a run changed in its isolated copy, against its baseline (repo-onboarding/changes.ts and change-diff.ts) —
/// tracked files, whether or not Claude committed them, and new files git does not track yet alike, since
/// <c>/init</c> writes files without committing.
///
/// Paths are read with <c>-z</c>, so a name with spaces or Hebrew letters comes back as it is on disk (the old server
/// read git's quoted form), and a rename's line counts reach its new name. Contents and diffs are git's standard output
/// only: a warning git prints never ends up inside a file. The list is ordered the way the old server's
/// <c>localeCompare</c> ordered it (ICU's root collation, <see cref="StringComparer.InvariantCulture"/>: punctuation
/// first, case second), so the screen shows the files in the same order.
/// </summary>
public static partial class RunChanges
{
    /// <summary>Above this a file is reported as too large instead of being loaded for the side-by-side view.</summary>
    public const int MaxFileBytes = 400_000;

    private const int ListTimeoutMs = 60_000;
    private const int FileTimeoutMs = 30_000;

    /// <summary>Lock files are listed without their body: thousands of generated lines nobody reads. <c>\z</c>, not <c>$</c>: .NET's <c>$</c> also matches before a final "\n", JavaScript's does not.</summary>
    [GeneratedRegex(@"(^|/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock)\z")]
    private static partial Regex Generated();

    [GeneratedRegex("^[0-9]+$")] private static partial Regex Digits();

    /* ── the changed files ──────────────────────────────────────────── */

    public static async Task<List<ChangedFile>> ChangedFilesAsync(string dir, string baselineSha)
    {
        var status = await WorkspaceGit.RunAsync(dir, ["diff", "--name-status", "-z", baselineSha], ListTimeoutMs);
        var numstat = await WorkspaceGit.RunAsync(dir, ["diff", "--numstat", "-z", baselineSha], ListTimeoutMs);
        var counts = NumStat(numstat.Text);
        var files = new List<ChangedFile>();
        foreach (var (letter, path) in NameStatus(status.Text))
        {
            var (additions, deletions) = counts.GetValueOrDefault(path);
            files.Add(new ChangedFile(path, letter, additions, deletions));
        }
        foreach (var p in await UntrackedAsync(dir))
            files.Add(new ChangedFile(p, "A", LineCount(Path.Combine(dir, p)), 0));
        return files.OrderBy(f => f.Path, StringComparer.InvariantCulture).ToList();
    }

    /// <summary>
    /// <c>diff --name-status -z</c>: a status, then the path — or, for a rename or a copy, the old path and the new one.
    /// Only A, M, D, R and T are changes the run made; a rename is listed under its new name.
    /// </summary>
    private static IEnumerable<(string Letter, string Path)> NameStatus(string z)
    {
        var t = z.Split('\0');
        for (var i = 0; i + 1 < t.Length;)
        {
            var code = t[i];
            if (code.Length == 0) yield break;
            var twoPaths = code[0] is 'R' or 'C';
            var path = twoPaths ? (i + 2 < t.Length ? t[i + 2] : "") : t[i + 1];
            i += twoPaths ? 3 : 2;
            if ("AMDRT".Contains(code[0]) && path.Length > 0) yield return (code[..1], path);
        }
    }

    /// <summary><c>diff --numstat -z</c>: "added\tdeleted\tpath", or "added\tdeleted\t" then the old and the new path for a rename. "-" = binary, counted as 0.</summary>
    private static Dictionary<string, (int Additions, int Deletions)> NumStat(string z)
    {
        var counts = new Dictionary<string, (int, int)>(StringComparer.Ordinal);
        var t = z.Split('\0');
        for (var i = 0; i < t.Length; i++)
        {
            var cols = t[i].Split('\t', 3);
            if (cols.Length < 3) continue;
            var path = cols[2];
            if (path.Length == 0 && i + 2 < t.Length)
            {
                path = t[i + 2];
                i += 2;
            }
            counts[path] = (Count(cols[0]), Count(cols[1]));
        }
        return counts;

        static int Count(string s) => Digits().IsMatch(s) && int.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0;
    }

    private static async Task<List<string>> UntrackedAsync(string dir) =>
        WorkspaceGit.Entries(await WorkspaceGit.RunAsync(dir, ["ls-files", "--others", "--exclude-standard", "-z"], ListTimeoutMs));

    /// <summary>A new file's lines the way the old server counted them: its text split on "\n" — so a final newline counts one more. Unreadable: 0.</summary>
    private static int LineCount(string full)
    {
        try
        {
            if (!File.Exists(full)) return 0;
            var lines = 1;
            using var stream = File.OpenRead(full);
            var buffer = new byte[64 * 1024];
            int read;
            while ((read = stream.Read(buffer, 0, buffer.Length)) > 0) lines += buffer.AsSpan(0, read).Count((byte)'\n');
            return lines;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return 0; }
    }

    /* ── one file, before and after ─────────────────────────────────── */

    /// <summary>
    /// The file at the baseline and in the copy now. <c>before</c> is the blob exactly as git holds it — the old server
    /// read it through a runner that trimmed it, so it lost its final newline there.
    /// </summary>
    public static async Task<FileVersions> FileVersionsAsync(string dir, string baselineSha, string filePath)
    {
        if (string.IsNullOrEmpty(filePath) || filePath.Contains("..", StringComparison.Ordinal) || Path.IsPathRooted(filePath))
            throw AppException.BadRequest("invalid_path", "נתיב לא חוקי");
        var tooLarge = new FileVersions(filePath, null, null, false, true);
        var spec = $"{baselineSha}:{filePath}";

        string? before = null;
        if ((await Git.RunAsync(["cat-file", "-e", spec], dir)).Ok)
        {
            var size = long.TryParse((await Git.RunAsync(["cat-file", "-s", spec], dir)).Out, NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0;
            if (size > MaxFileBytes) return tooLarge;
            var shown = await WorkspaceGit.RunAsync(dir, ["show", spec], FileTimeoutMs);
            before = shown.Code == 0 ? shown.Text : null;
        }

        var full = Path.Combine(dir, filePath);
        string? after = null;
        if (File.Exists(full))
        {
            if (new FileInfo(full).Length > MaxFileBytes) return tooLarge;
            var bytes = await File.ReadAllBytesAsync(full);
            if (bytes.AsSpan().Contains((byte)0)) return new FileVersions(filePath, null, null, true, false);
            after = Encoding.UTF8.GetString(bytes);
        }
        return new FileVersions(filePath, before, after, before?.Contains('\0') ?? false, false);
    }

    /* ── the change as diff text ────────────────────────────────────── */

    /// <summary>
    /// The change as diff text, for the assistants asked what the change is or whether it is sound. Tracked files come
    /// from <c>git diff</c> against the baseline; new files git does not track yet are written as all-added files. Lock
    /// files and binary files are listed without a body, and a file or a whole diff that is very long is cut with a line
    /// saying so. The old server took its git runner as an argument (to keep that module off the database); here git is
    /// run directly.
    /// </summary>
    public static async Task<ChangesDiff> BuildDiffAsync(string dir, string baselineSha, IReadOnlyList<ChangedFile> files, DiffLimits? limits = null)
    {
        var maxFileLines = limits?.MaxFileLines ?? 700;
        var maxTotal = limits?.MaxTotalChars ?? 200_000;
        var parts = new List<string>();
        var withoutBody = new List<string>();
        var cut = new List<string>();
        var shown = 0;
        var total = 0;
        foreach (var f in files)
        {
            var stats = $"{f.Status} +{f.Additions} −{f.Deletions}";
            if (Generated().IsMatch(f.Path))
            {
                parts.Add($"### {f.Path} ({stats}) — generated lock file, diff not shown\n");
                withoutBody.Add(f.Path);
                continue;
            }
            if (total >= maxTotal)
            {
                parts.Add($"### {f.Path} ({stats}) — not shown: the diff is already long enough\n");
                cut.Add(f.Path);
                continue;
            }

            string text;
            var tracked = await WorkspaceGit.RunAsync(dir, ["diff", baselineSha, "--", f.Path], FileTimeoutMs);
            var trackedText = tracked.Text.Trim();
            if (tracked.Code == 0 && trackedText.Length > 0)
            {
                text = trackedText;
            }
            else
            {
                var full = Path.Combine(dir, f.Path);
                if (!File.Exists(full)) continue;
                var bytes = await File.ReadAllBytesAsync(full);
                if (bytes.AsSpan().Contains((byte)0))
                {
                    parts.Add($"### {f.Path} ({stats}) — binary file, not shown\n");
                    withoutBody.Add(f.Path);
                    continue;
                }
                var body = Encoding.UTF8.GetString(bytes).Split('\n');
                text = string.Join("\n", [
                    $"diff --git a/{f.Path} b/{f.Path}", "new file mode 100644", "--- /dev/null", $"+++ b/{f.Path}", $"@@ -0,0 +1,{body.Length} @@",
                    .. body.Select(l => "+" + l),
                ]);
            }

            var lines = text.Split('\n');
            if (lines.Length > maxFileLines)
            {
                text = $"{string.Join("\n", lines.Take(maxFileLines))}\n… ({lines.Length - maxFileLines} more lines of this file's diff are not shown)";
                cut.Add(f.Path);
            }
            parts.Add($"### {f.Path} ({stats})\n{text}\n");
            total += text.Length;
            shown++;
        }
        return new ChangesDiff(string.Join("\n", parts), shown, withoutBody, cut);
    }

    /// <summary>The same, written to a file (UTF-8, no BOM) — the chat's reading tools are Read, Grep and Glob, with no git, so it reads the change from there.</summary>
    public static async Task<ChangesDiff> WriteDiffAsync(string dir, string baselineSha, IReadOnlyList<ChangedFile> files, string outFile)
    {
        var built = await BuildDiffAsync(dir, baselineSha, files);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outFile))!);
        await File.WriteAllTextAsync(outFile, built.Text);
        return built;
    }
}

/// <summary>
/// git with its standard output alone, as bytes — for answers that must stay exact: a <c>-z</c> list of paths, a blob, a
/// diff. <see cref="Git"/>'s runner joins stderr into its answer and trims it, so a warning (a line-ending conversion)
/// would become part of a file and a file would lose its final newline. Same environment as that runner: long paths on,
/// never a prompt, and a timeout (null = none, where the old server set none) that kills the whole tree.
/// </summary>
internal static class WorkspaceGit
{
    public sealed record Output(int Code, byte[] Bytes)
    {
        /// <summary>The bytes as UTF-8, a BOM kept as U+FEFF and invalid bytes as U+FFFD — as Node's <c>toString("utf8")</c> read them.</summary>
        public string Text => Encoding.UTF8.GetString(Bytes);
    }

    public static async Task<Output> RunAsync(string cwd, IEnumerable<string> args, int? timeoutMs)
    {
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = cwd, RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
            UseShellExecute = false, CreateNoWindow = true, StandardErrorEncoding = Encoding.UTF8,
        };
        psi.ArgumentList.Add("-c");
        psi.ArgumentList.Add("core.longpaths=true");
        foreach (var a in args) psi.ArgumentList.Add(a);
        psi.Environment["GIT_TERMINAL_PROMPT"] = "0";

        Process p;
        try { p = Process.Start(psi)!; }
        catch (Exception) { return new Output(1, []); }
        using (p)
        {
            p.StandardInput.Close();
            using var buffer = new MemoryStream();
            var stdout = p.StandardOutput.BaseStream.CopyToAsync(buffer, CancellationToken.None);
            var stderr = p.StandardError.ReadToEndAsync(CancellationToken.None);
            using var limit = new CancellationTokenSource();
            if (timeoutMs is { } ms) limit.CancelAfter(ms);
            try { await p.WaitForExitAsync(limit.Token); }
            catch (OperationCanceledException)
            {
                try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                return new Output(1, []);
            }
            await stdout;
            await stderr;
            return new Output(p.ExitCode, buffer.ToArray());
        }
    }

    /// <summary>The entries of a <c>-z</c> answer, exactly as git wrote them.</summary>
    public static List<string> Entries(Output o) => o.Text.Split('\0').Where(s => s.Length > 0).ToList();
}
