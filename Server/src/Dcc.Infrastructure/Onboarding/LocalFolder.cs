using System.Diagnostics;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Repos;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>A folder that may not be opened, in a sentence for the person — answered as a 400.</summary>
public sealed class FolderRefused(string message) : AppException(400, "folder_refused", message);

/// <summary>Shows a folder in the file manager of the machine the server runs on.</summary>
public interface IFolderLauncher
{
    void Open(string folder);
}

/// <summary>Explorer on Windows, <c>open</c> on macOS, <c>xdg-open</c> elsewhere — started and let go.</summary>
public sealed class ShellFolderLauncher : IFolderLauncher
{
    public void Open(string folder)
    {
        var file = OperatingSystem.IsWindows() ? "explorer.exe" : OperatingSystem.IsMacOS() ? "open" : "xdg-open";
        try
        {
            // Not waited for: Explorer reports a non-zero exit code even when it opened the folder.
            using var p = Process.Start(new ProcessStartInfo(file) { ArgumentList = { folder }, UseShellExecute = false });
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { /* no file manager on this machine */ }
    }
}

/// <summary>
/// Opening a folder of DCC's own on the machine the server runs on (local-folder.ts). The code map shows a path for
/// work that exists only on this computer, and a button that opens it. A web request must never be able to open an
/// arbitrary place on disk, so only folders under DCC's own working roots qualify — the shared clones
/// (<c>Repos:CachePath</c>) and the isolated onboarding copies (<c>Onboarding:WorkspaceRoot</c>) — and only for a person
/// who may read the repositories of the client the folder belongs to: a clone is named by its repository, an onboarding
/// copy (and its runtime folder) by its run.
/// </summary>
public sealed class LocalFolder(IOptions<RepoOptions> repos, IOptions<OnboardingOptions> onboarding, IFolderLauncher launcher,
    DccDbContext db, ITenantScope tenant, IPermissionService permissions)
{
    private const string OnlyOurs = "אפשר לפתוח רק תיקיות של DCC עצמו";

    /// <summary>Which DCC folder a path is: under a repository's clone or under an onboarding run's folders.</summary>
    public sealed record Place(string Real, string Kind, Guid Id);

    /// <summary>Opens the folder for <paramref name="userId"/>; <c>opened</c> is the path as a person on this platform writes it.</summary>
    public async Task<string> OpenAsync(string? requested, Guid userId, CancellationToken ct = default)
    {
        var place = Locate(requested);
        if (!await MayReadAsync(place, userId, ct)) throw AppException.Forbidden("forbidden", "You do not have permission for this.");
        launcher.Open(place.Real);
        return place.Real;
    }

    /// <summary>The folder's real path (links and <c>..</c> resolved before the check, so a path that only looks like it is under a root does not pass) and whose it is.</summary>
    public Place Locate(string? requested)
    {
        if (string.IsNullOrEmpty(requested)) throw new FolderRefused("לא נבחרה תיקייה");
        string abs;
        try { abs = Path.GetFullPath(requested); }
        catch (Exception e) when (e is ArgumentException or NotSupportedException or PathTooLongException) { throw new FolderRefused("התיקייה לא קיימת במחשב הזה"); }
        if (!Directory.Exists(abs)) throw new FolderRefused("התיקייה לא קיימת במחשב הזה");
        var real = RealPath(abs);

        foreach (var (root, kind) in new[] { (repos.Value.CachePath, "repo"), (onboarding.Value.WorkspaceRoot, "run") })
        {
            if (!Directory.Exists(root)) continue;
            var rel = Path.GetRelativePath(RealPath(Path.GetFullPath(root)), real);
            if (rel != "." && (rel.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(rel))) continue;
            var parts = rel == "." ? [] : rel.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
            // A clone is <root>/<repo id> (".partial-…" while it downloads); a run is <root>/<run id> or <root>/_runtime/<run id>.
            var name = kind == "repo"
                ? parts.FirstOrDefault()?.Split('.')[0]
                : parts.FirstOrDefault() == "_runtime" ? parts.ElementAtOrDefault(1) : parts.FirstOrDefault();
            if (Guid.TryParseExact(name, "D", out var id)) return new Place(real, kind, id);
            // The root itself, or something in it that belongs to no repository or run: nobody's to open.
            throw new FolderRefused(OnlyOurs);
        }
        throw new FolderRefused(OnlyOurs);
    }

    private async Task<bool> MayReadAsync(Place place, Guid userId, CancellationToken ct)
    {
        var allowed = await permissions.ClientsWithAsync(userId, Permissions.Repos.Read, ct);
        if (place.Kind == "repo")
        {
            var repo = await SqlJson.QuerySingleAsync(db, """select client_id as "clientId" from repo where id = @id""", new { id = place.Id }, ct)
                ?? throw new FolderRefused(OnlyOurs);
            if (repo["clientId"]?.GetValue<string>() is { } owner)
                return await permissions.HasAsync(userId, Permissions.Repos.Read, new ScopeRef(ScopeType.Client, Guid.Parse(owner)), ct);
            // A repository shared between clients: readable through any client that linked it.
            if (allowed is null) return true;
            foreach (var c in allowed)
                if (await tenant.RunAsync(c, d => SqlJson.ScalarAsync<bool>(d, "select exists (select 1 from client_repo where repo_id = @r)", new { r = place.Id }, ct), ct)) return true;
            return false;
        }
        // A run's id says nothing of its client: it is looked for inside each client the person may read, never across them.
        var candidates = allowed ?? (await SqlJson.QueryAsync(db, "select id from client", null, ct)).Select(r => Guid.Parse(r["id"]!.GetValue<string>())).ToHashSet();
        foreach (var c in candidates)
            if (await tenant.RunAsync(c, d => SqlJson.ScalarAsync<bool>(d, "select exists (select 1 from repository_onboarding_run where id = @r)", new { r = place.Id }, ct), ct)) return true;
        return false;
    }

    /// <summary>
    /// The path with every symbolic link and junction on the way resolved, segment by segment (realpath). Lexical
    /// <c>..</c> is already gone (<see cref="Path.GetFullPath(string)"/>); a link's target may bring its own.
    /// </summary>
    public static string RealPath(string fullPath)
    {
        var root = Path.GetPathRoot(fullPath) ?? "";
        var pending = new Queue<string>(fullPath[root.Length..].Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries));
        var current = root;
        var hops = 0;
        while (pending.Count > 0)
        {
            var part = pending.Dequeue();
            if (part == ".") continue;
            if (part == "..")
            {
                current = Path.GetDirectoryName(current) ?? current;
                continue;
            }
            var next = Path.Combine(current, part);
            string? target = null;
            try { target = new DirectoryInfo(next).LinkTarget; }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            if (target is null)
            {
                current = next;
                continue;
            }
            if (++hops > 40) throw new FolderRefused("התיקייה לא קיימת במחשב הזה");
            var resolved = Path.GetFullPath(Path.IsPathRooted(target) ? target : Path.Combine(current, target));
            var resolvedRoot = Path.GetPathRoot(resolved) ?? "";
            var rest = pending.ToArray();
            pending = new Queue<string>(resolved[resolvedRoot.Length..].Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries).Concat(rest));
            current = resolvedRoot;
        }
        return current;
    }
}

