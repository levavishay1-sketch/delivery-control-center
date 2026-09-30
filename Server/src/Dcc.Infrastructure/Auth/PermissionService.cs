using Dcc.Application.Auth;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;

namespace Dcc.Infrastructure.Auth;

/// <summary>
/// Computes what a principal may do, from the database, and answers checks.
/// The result is cached per (user, perm_version): every change that affects a
/// user raises their perm_version (<see cref="PermissionVersionBumper"/>), so a
/// stale entry is simply never looked up again.
/// </summary>
public sealed class PermissionService(DccDbContext db, IMemoryCache cache) : IPermissionService
{
    private static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(10);

    public async Task<EffectivePermissions> GetEffectiveAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.PermVersion, u.DisabledAt, u.ExpiresAt })
            .FirstOrDefaultAsync(ct);
        if (user is null || user.DisabledAt is not null || (user.ExpiresAt is { } exp && exp <= DateTimeOffset.UtcNow))
            return EffectivePermissions.None;

        return await cache.GetOrCreateAsync(("perms", userId, user.PermVersion), async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheFor;
            return new EffectivePermissions(await LoadGrantsAsync(userId, ct));
        }) ?? EffectivePermissions.None;
    }

    public async Task<bool> HasAsync(Guid userId, string permission, ScopeRef scope, CancellationToken ct = default)
    {
        var context = await ResolveAsync(scope, ct);
        if (context is null) return false; // the client or requirement does not exist
        if (!(await GetEffectiveAsync(userId, ct)).Has(permission, context)) return false;

        // A delegated agent never exceeds the person it acts for (decision 02).
        var owner = await DelegatedOwnerAsync(userId, ct);
        return owner is null || (await GetEffectiveAsync(owner.Value, ct)).Has(permission, context);
    }

    public async Task<IReadOnlyDictionary<string, string[]>> ClaimForAsync(Guid userId, CancellationToken ct = default)
    {
        var own = (await GetEffectiveAsync(userId, ct)).ToClaim();
        var owner = await DelegatedOwnerAsync(userId, ct);
        if (owner is null) return own;

        var ownerPerms = await GetEffectiveAsync(owner.Value, ct);
        var capped = new Dictionary<string, string[]>();
        foreach (var (key, codes) in own)
        {
            var context = await ResolveAsync(FromClaimKey(key), ct);
            if (context is null) continue;
            var kept = codes.Where(c => ownerPerms.Has(c, context)).ToArray();
            if (kept.Length > 0) capped[key] = kept;
        }
        return capped;
    }

    public async Task<IReadOnlySet<Guid>?> ClientsWithAsync(Guid userId, string permission, CancellationToken ct = default)
    {
        var own = (await GetEffectiveAsync(userId, ct)).ClientsWith(permission);
        var owner = await DelegatedOwnerAsync(userId, ct);
        if (owner is null) return own;

        // A delegated agent reaches only where its owner does, too.
        var ownerSet = (await GetEffectiveAsync(owner.Value, ct)).ClientsWith(permission);
        if (own is null) return ownerSet;
        if (ownerSet is null) return own;
        return own.Intersect(ownerSet).ToHashSet();
    }

    public async Task<bool> ScopeExistsAsync(ScopeRef scope, CancellationToken ct = default) =>
        await ResolveAsync(scope, ct) is not null;

    public async Task<bool> HasAnywhereAsync(Guid userId, string permission, CancellationToken ct = default)
    {
        var claim = await ClaimForAsync(userId, ct);
        return claim.Values.Any(codes => codes.Contains(permission));
    }

    private async Task<List<(Scope, string)>> LoadGrantsAsync(Guid userId, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var teamIds = db.TeamMembers
            .Where(m => m.UserId == userId)
            .Join(db.Teams.Where(t => t.ArchivedAt == null), m => m.TeamId, t => t.Id, (m, t) => t.Id);

        var rows = await db.SecurityRoleAssignments.AsNoTracking()
            .Where(a => a.ExpiresAt == null || a.ExpiresAt > now)
            .Where(a => (a.PrincipalType == "user" && a.PrincipalId == userId) ||
                        (a.PrincipalType == "team" && teamIds.Contains(a.PrincipalId)))
            .Join(db.SecurityRolePermissions, a => a.SecurityRoleId, p => p.SecurityRoleId,
                (a, p) => new { a.ScopeType, a.ScopeId, p.PermissionCode })
            .ToListAsync(ct);

        return rows.Select(r => (new Scope(ScopeTypes.Parse(r.ScopeType), r.ScopeId), r.PermissionCode)).ToList();
    }

    private async Task<Guid?> DelegatedOwnerAsync(Guid userId, CancellationToken ct) =>
        await db.AgentProfiles.AsNoTracking()
            .Where(a => a.UserId == userId && a.Mode == "delegated")
            .Select(a => a.OwnerUserId)
            .FirstOrDefaultAsync(ct);

    /// <summary>Turns a scope named by a request into where it sits: its client, and a requirement's ancestors.</summary>
    public async Task<ScopeContext?> ResolveAsync(ScopeRef scope, CancellationToken ct)
    {
        switch (scope.Type)
        {
            case ScopeType.Global:
                return ScopeContext.Global;
            case ScopeType.Client:
                var exists = await db.Clients.AsNoTracking().AnyAsync(c => c.Id == scope.Id, ct);
                return exists ? ScopeContext.ForClient(scope.Id!.Value) : null;
            case ScopeType.Requirement:
                var chain = await RequirementChainAsync(scope.Id!.Value, ct);
                return chain.Count == 0 ? null : ScopeContext.ForRequirement(chain[0].ClientId, chain.Select(c => c.Id).ToList());
            default:
                return null;
        }
    }

    /// <summary>
    /// The requirement and its ancestors, nearest first. Read as the owning role
    /// (outside a tenant scope): it only yields ids, to decide a permission.
    /// </summary>
    private async Task<List<(Guid Id, Guid ClientId)>> RequirementChainAsync(Guid id, CancellationToken ct)
    {
        const string sql = """
            with recursive chain as (
              select id, parent_id, client_id, 0 as depth from workitem where id = @id
              union all
              select w.id, w.parent_id, w.client_id, c.depth + 1 from workitem w join chain c on w.id = c.parent_id
              where c.depth < 64
            )
            select id, client_id from chain order by depth
            """;
        var conn = (NpgsqlConnection)db.Database.GetDbConnection();
        var opened = conn.State != System.Data.ConnectionState.Open;
        if (opened) await conn.OpenAsync(ct);
        try
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("id", id);
            var list = new List<(Guid, Guid)>();
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) list.Add((r.GetGuid(0), r.GetGuid(1)));
            return list;
        }
        finally
        {
            if (opened) await conn.CloseAsync();
        }
    }

    private static ScopeRef FromClaimKey(string key) => key switch
    {
        "*" => ScopeRef.Global,
        _ when key.StartsWith("c:", StringComparison.Ordinal) => new ScopeRef(ScopeType.Client, Guid.Parse(key[2..])),
        _ => new ScopeRef(ScopeType.Requirement, Guid.Parse(key[2..])),
    };
}
