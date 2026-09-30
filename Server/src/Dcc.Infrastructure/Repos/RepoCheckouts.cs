using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.Repos;

/// <summary>Bound from <c>Repos</c>.</summary>
public sealed class RepoOptions
{
    public const string Section = "Repos";

    /// <summary>
    /// Where DCC keeps its own copy of each repository — never the user's working copy. Under the home
    /// folder, not TEMP: TEMP can resolve to an 8.3 short name, which Claude Code's write check refuses.
    /// </summary>
    public string CachePath { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dcc-repos");
}

/// <summary>A repository as a checkout needs it.</summary>
public sealed record RepoRef(Guid Id, string Name, string? LocalPath, string? AdoRepoRef);

/// <summary>The working copy, or why there is none — a sentence for the person, never a silent null.</summary>
public sealed record Checkout(string? Dir, string? Reason);

/// <summary>
/// DCC's own copy of a repository: cloned once (shallow — runs read the current code, not its
/// history), brought up to date on the default branch before each use, one fetch per repository at a
/// time. A clone lands beside its target and moves into place only once it succeeded, so a killed
/// clone is never taken for a usable copy (ai-assist.ts checkoutRepo).
/// </summary>
public sealed partial class RepoCheckouts(IOptions<RepoOptions> options)
{
    private const int CloneTimeoutMs = 600_000;
    private const int UpdateTimeoutMs = 180_000;
    private readonly ConcurrentDictionary<Guid, Lazy<Task<Checkout>>> _running = new();

    public string CacheRoot => options.Value.CachePath;

    [GeneratedRegex(@"^(https?://|git@|file://)")] private static partial Regex GitUrl();

    /// <summary>The local copy IF it is already there — never clones. Screens read with this.</summary>
    public string? Existing(RepoRef r)
    {
        if (!string.IsNullOrEmpty(r.LocalPath) && Directory.Exists(r.LocalPath)) return r.LocalPath;
        var dir = Path.Combine(CacheRoot, r.Id.ToString());
        return Directory.Exists(Path.Combine(dir, ".git")) ? dir : null;
    }

    /// <summary>What to say before touching the repository — an update of a copy that is there is not a download.</summary>
    public string StartLine(RepoRef r) => Existing(r) is not null
        ? $"בודק אם יש עדכונים ל-{r.Name}…"
        : $"מוריד עותק של {r.Name} — בפעם הראשונה (או על רשת איטית) זה יכול לקחת כמה דקות…";

    public Task<Checkout> CheckoutAsync(RepoRef r)
    {
        var lazy = _running.GetOrAdd(r.Id, _ => new Lazy<Task<Checkout>>(() => DoCheckoutAsync(r)));
        return Await(lazy, r.Id);
    }

    private async Task<Checkout> Await(Lazy<Task<Checkout>> lazy, Guid id)
    {
        try { return await lazy.Value; }
        finally { _running.TryRemove(new KeyValuePair<Guid, Lazy<Task<Checkout>>>(id, lazy)); }
    }

    public async Task<string?> EnsureAsync(RepoRef r) => (await CheckoutAsync(r)).Dir;

    private async Task<Checkout> DoCheckoutAsync(RepoRef r)
    {
        if (!string.IsNullOrEmpty(r.LocalPath) && Directory.Exists(r.LocalPath)) return new Checkout(r.LocalPath, null);
        var gitUrl = r.AdoRepoRef is { } u && GitUrl().IsMatch(u) ? u : null;
        if (gitUrl is null)
            return new Checkout(null, !string.IsNullOrEmpty(r.LocalPath)
                ? $"התיקייה המקומית של {r.Name} לא נמצאה ({r.LocalPath}), ואין כתובת git להביא ממנה עותק."
                : $"ל-{r.Name} אין כתובת git תקינה ({r.AdoRepoRef ?? "ריק"}) ואין עותק מקומי.");

        Directory.CreateDirectory(CacheRoot);
        var dir = Path.Combine(CacheRoot, r.Id.ToString());
        // An interrupted clone leaves files with no HEAD — thrown away and fetched again.
        if (Directory.Exists(Path.Combine(dir, ".git")) && !await Git.ExistsAsync(dir, "HEAD")) ForceDelete(dir);
        if (Directory.Exists(Path.Combine(dir, ".git")))
        {
            await Git.RunAsync(["reset", "--hard"], dir, UpdateTimeoutMs);
            await Git.RunAsync(["clean", "-fd"], dir, UpdateTimeoutMs);
            await Git.RunAsync(["checkout", await Git.DefaultBranchAsync(dir)], dir, UpdateTimeoutMs);
            // An update that fails still leaves a usable (older) copy — said, not thrown away.
            var pull = await Git.RunAsync(["pull", "--ff-only"], dir, UpdateTimeoutMs);
            return new Checkout(dir, pull.Ok ? null : $"העותק המקומי של {r.Name} לא עודכן ({Git.FailureDetail(pull.Out)}) — נקרא כפי שהוא.");
        }

        var tmp = $"{dir}.partial-{Guid.NewGuid().ToString("N")[..8]}";
        var cloned = await Git.RunAsync(["clone", "--depth", "1", gitUrl, tmp], CacheRoot, CloneTimeoutMs);
        if (!cloned.Ok || !await Git.ExistsAsync(tmp, "HEAD"))
        {
            ForceDelete(tmp);
            return new Checkout(null, $"הבאת {r.Name} מ-git נכשלה: {Git.FailureDetail(cloned.Out)}");
        }
        if (Directory.Exists(Path.Combine(dir, ".git")) && await Git.ExistsAsync(dir, "HEAD"))
        {
            ForceDelete(tmp);
            return new Checkout(dir, null);
        }
        // Windows can hold a just-written folder for a moment (antivirus, the indexer).
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                ForceDelete(dir);
                Directory.Move(tmp, dir);
                return new Checkout(dir, null);
            }
            catch (IOException) when (attempt < 5) { await Task.Delay(500 * attempt); }
            catch (UnauthorizedAccessException) when (attempt < 5) { await Task.Delay(500 * attempt); }
        }
    }

    /// <summary>Deletes a folder git wrote — its object files are read-only on Windows.</summary>
    public static void ForceDelete(string dir)
    {
        if (!Directory.Exists(dir)) return;
        foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
            File.SetAttributes(f, FileAttributes.Normal);
        Directory.Delete(dir, recursive: true);
    }
}
