using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Dcc.Infrastructure.Repos;

public sealed record CheckResult
{
    public required string Name { get; init; }
    public required string Command { get; init; }
    public bool Ok { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Skipped { get; init; }
    public long Ms { get; init; }
    public required string Output { get; init; }
}

/// <summary><c>Ran</c> false: the repository declares no checks (or they could not run) — nothing was proved, and the screen says so.</summary>
public sealed record VerifyResult
{
    public bool Ran { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Why { get; init; }
    public required string Commit { get; init; }
    public IReadOnlyList<CheckResult> Checks { get; init; } = [];
}

/// <summary>
/// "How do I know nothing broke?" (merge-verify.ts) — the repository's own checks, run on the merged result before it
/// is pushed: a <c>git worktree</c> at the merge commit under <c>Repos:VerifyPath</c> (default <c>~/.dcc-verify</c>), the shared clone's dependencies
/// linked in (the repository's own workspace packages linked to THIS copy, so a check never compiles the folder
/// someone is editing), and only the commands the repository itself declares. A check that fails brings back its
/// own last lines; a repository with no checks is told so plainly instead of being given a green tick.
/// </summary>
public static class MergeVerifier
{
    /// <summary>The script names worth running on a merge, in the order a person would run them.</summary>
    private static readonly string[] Wanted = ["typecheck", "lint", "test", "audit:stale", "build"];

    /// <summary><c>build</c> is slow and rarely says anything typecheck did not; it runs only when nothing else exists.</summary>
    private const string LastResort = "build";

    private const int PerCheckMs = 300_000;

    private static JsonObject? ReadJson(string file)
    {
        try { return JsonNode.Parse(File.ReadAllText(file)) as JsonObject; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException) { return null; }
    }

    private static async Task<(int Code, string Out)> RunAsync(string command, IReadOnlyList<string> args, string cwd, int timeoutMs)
    {
        var psi = OperatingSystem.IsWindows() ? new ProcessStartInfo("cmd.exe") : new ProcessStartInfo(command);
        if (OperatingSystem.IsWindows()) { psi.ArgumentList.Add("/c"); psi.ArgumentList.Add(command); }
        foreach (var a in args) psi.ArgumentList.Add(a);
        psi.WorkingDirectory = cwd;
        psi.RedirectStandardOutput = psi.RedirectStandardError = psi.RedirectStandardInput = true;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.StandardOutputEncoding = psi.StandardErrorEncoding = Encoding.UTF8;
        psi.Environment["CI"] = "1";
        psi.Environment["NO_COLOR"] = "1";
        Process p;
        try { p = Process.Start(psi)!; }
        catch (Exception e) { return (1, e.Message); }
        using (p)
        {
            p.StandardInput.Close();
            var output = new StringBuilder();
            var gate = new object();
            p.OutputDataReceived += (_, e) => { if (e.Data is not null) lock (gate) output.AppendLine(e.Data); };
            p.ErrorDataReceived += (_, e) => { if (e.Data is not null) lock (gate) output.AppendLine(e.Data); };
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            using var limit = new CancellationTokenSource(timeoutMs);
            try { await p.WaitForExitAsync(limit.Token); }
            catch (OperationCanceledException)
            {
                try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                lock (gate) return (1, $"{output}\n\nהבדיקה לא הסתיימה תוך {timeoutMs / 1000} שניות ונעצרה.");
            }
            lock (gate) return (p.ExitCode, output.ToString().Trim());
        }
    }

    /// <summary>A directory link that needs no privilege: a junction on Windows, a symlink elsewhere.</summary>
    private static async Task LinkAllAsync(IReadOnlyList<(string Link, string Target)> links, string work)
    {
        if (links.Count == 0) return;
        if (!OperatingSystem.IsWindows())
        {
            foreach (var (link, target) in links)
                try { Directory.CreateSymbolicLink(link, target); } catch (IOException) { /* one link short is reported by the check itself */ }
            return;
        }
        // One script, run once: a process per link would cost seconds on a large node_modules.
        var script = Path.Combine(work, "link-dependencies.cmd");
        await File.WriteAllLinesAsync(script, ["@echo off", .. links.Select(l => $"mklink /J \"{l.Link}\" \"{l.Target}\" >nul")]);
        await RunAsync(script, [], work, 120_000);
        File.Delete(script);
    }

    /// <summary>
    /// The dependencies, without installing them again: every entry of the shared clone's node_modules linked into
    /// the copy — except the repository's own workspace packages, which are linked to the copy's own sources.
    /// </summary>
    private static async Task<string?> LinkDependenciesAsync(string from, string to)
    {
        var src = Path.Combine(from, "node_modules");
        if (!Directory.Exists(src)) return "אין תלויות מותקנות בעותק המקומי (node_modules), ולכן אי אפשר להריץ את הבדיקות מכאן.";
        var dst = Path.Combine(to, "node_modules");
        Directory.CreateDirectory(dst);

        // Which package names belong to this repository itself.
        var own = new Dictionary<string, string>();
        foreach (var pattern in (ReadJson(Path.Combine(to, "package.json"))?["workspaces"] as JsonArray ?? []).Select(x => x?.ToString() ?? ""))
        {
            var full = Path.Combine(to, pattern.EndsWith("/*", StringComparison.Ordinal) ? pattern[..^2] : pattern);
            if (!Directory.Exists(full)) continue;
            foreach (var entry in Directory.EnumerateDirectories(full))
                if (ReadJson(Path.Combine(entry, "package.json"))?["name"]?.ToString() is { Length: > 0 } name) own[name] = entry;
        }
        var ownScopes = own.Keys.Where(n => n.StartsWith('@')).Select(n => n.Split('/')[0]).ToHashSet();
        var links = new List<(string, string)>();
        foreach (var entry in Directory.EnumerateFileSystemEntries(src))
        {
            var name = Path.GetFileName(entry);
            if (!ownScopes.Contains(name)) links.Add((Path.Combine(dst, name), entry));
        }
        foreach (var (name, dir) in own)
        {
            var target = Path.Combine([dst, .. name.Split('/')]);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            links.Add((target, dir));
        }
        await LinkAllAsync(links, to);
        return null;
    }

    /// <summary>
    /// TypeScript projects no declared check reaches: a repository may point its typecheck at some of its projects
    /// only, and a merge that breaks another comes back green from every declared check. Every tsconfig the root's
    /// references do not reach is checked with <c>tsc -p &lt;dir&gt; --noEmit</c> — nothing the repository has no tsconfig for.
    /// </summary>
    private static List<(string Name, string[] Args, string Label)> UncoveredProjects(string dir)
    {
        var referenced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in ReadJson(Path.Combine(dir, "tsconfig.json"))?["references"] as JsonArray ?? [])
            if (r?["path"]?.ToString() is { } p) referenced.Add(Path.GetFullPath(Path.Combine(dir, p)));
        var found = new List<string>();
        void Walk(string d, int depth)
        {
            if (depth > 3) return;
            foreach (var sub in Directory.EnumerateDirectories(d))
            {
                var name = Path.GetFileName(sub);
                if (name is "node_modules" or "dist" || name.StartsWith('.')) continue;
                if (File.Exists(Path.Combine(sub, "tsconfig.json"))) found.Add(sub);
                Walk(sub, depth + 1);
            }
        }
        Walk(dir, 0);
        return found
            .Where(sub => !referenced.Contains(Path.GetFullPath(sub)))
            // A project that only re-exports another is not a project of its own.
            .Where(sub => ReadJson(Path.Combine(sub, "tsconfig.json")) is not { } cfg || cfg["compilerOptions"] is not null)
            .Select(sub =>
            {
                var rel = Path.GetRelativePath(dir, sub).Replace('\\', '/');
                return ($"tsc:{rel}", new[] { "exec", "--", "tsc", "-p", rel, "--noEmit" }, $"npx tsc -p {rel} --noEmit");
            }).ToList();
    }

    /// <summary>What this repository says a change is verified by — plus the TypeScript projects none of that reaches.</summary>
    private static List<(string Name, string[] Args, string Label)> ChecksOf(string dir)
    {
        var scripts = ReadJson(Path.Combine(dir, "package.json"))?["scripts"] as JsonObject;
        var found = Wanted.Where(n => scripts?[n] is not null).ToList();
        var use = found.Any(n => n != LastResort) ? found.Where(n => n != LastResort).ToList() : found;
        var declared = use.Select(n => (n, new[] { "run", n }, $"npm run {n}")).ToList();
        // Only where the repository declared some check itself: a repository with none is told so, not handed one.
        return declared.Count > 0 ? [.. declared, .. UncoveredProjects(dir)] : declared;
    }

    private static async Task RemoveAsync(string sharedDir, string dir)
    {
        // The links are removed as links first, never followed: the shared clone's node_modules stays as it was.
        // Enumeration does not descend into a link, so only the copy's own entries are listed.
        var modules = Path.Combine(dir, "node_modules");
        if (Directory.Exists(modules))
            foreach (var entry in Directory.EnumerateDirectories(modules, "*", SearchOption.AllDirectories).Where(e => File.GetAttributes(e).HasFlag(FileAttributes.ReparsePoint)).ToList())
                try { Directory.Delete(entry); } catch (IOException) { }
        await Git.RunAsync(["worktree", "remove", dir, "--force"], sharedDir);
        if (Directory.Exists(dir)) RepoCheckouts.ForceDelete(dir);
        await Git.RunAsync(["worktree", "prune"], sharedDir);
    }

    /// <summary>Run the repository's checks against one commit, in a copy of its own. <paramref name="sharedDir"/> is read, never changed.</summary>
    public static async Task<VerifyResult> VerifyCommitAsync(string root, string sharedDir, string commit, string label)
    {
        Directory.CreateDirectory(root);
        var dir = Path.Combine(root, label);
        await RemoveAsync(sharedDir, dir);
        var added = await Git.RunAsync(["worktree", "add", "--detach", dir, commit], sharedDir, 300_000);
        if (!added.Ok) return new VerifyResult { Ran = false, Why = $"לא הצלחנו להכין עותק לבדיקה: {(added.Out.Length > 200 ? added.Out[..200] : added.Out)}", Commit = commit };
        try
        {
            var wanted = ChecksOf(dir);
            if (wanted.Count == 0)
                return new VerifyResult { Ran = false, Why = "במאגר הזה אין סקריפטים של בדיקה (typecheck / lint / test / build), ולכן אין מה להריץ. אחרי הדחיפה כדאי לבדוק כמו שאתם רגילים.", Commit = commit };
            if (await LinkDependenciesAsync(sharedDir, dir) is { } problem) return new VerifyResult { Ran = false, Why = problem, Commit = commit };
            var checks = new List<CheckResult>();
            foreach (var (name, args, label2) in wanted)
            {
                var at = Stopwatch.StartNew();
                var (code, output) = await RunAsync("npm", args, dir, PerCheckMs);
                checks.Add(new CheckResult { Name = name, Command = label2, Ok = code == 0, Ms = at.ElapsedMilliseconds, Output = string.Join('\n', output.Split('\n').TakeLast(40)) });
            }
            return new VerifyResult { Ran = true, Commit = commit, Checks = checks };
        }
        finally
        {
            await RemoveAsync(sharedDir, dir);
        }
    }
}
