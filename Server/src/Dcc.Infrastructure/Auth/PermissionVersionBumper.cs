using Dcc.Application.Auth;
using Dcc.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Dcc.Infrastructure.Auth;

/// <summary>
/// Raises perm_version for everyone a change touches. Their access tokens are
/// then refused as stale (401 token_stale) and the web client fetches a fresh
/// one; their cached permissions are recomputed. Agents that act for an
/// affected person are bumped with them, since their cap moved too.
/// </summary>
public sealed class PermissionVersionBumper(DccDbContext db) : IPermissionVersionBumper
{
    public async Task BumpUsersAsync(IEnumerable<Guid> userIds, CancellationToken ct = default)
    {
        var ids = userIds.Distinct().ToArray();
        if (ids.Length == 0) return;
        var agents = db.AgentProfiles.Where(a => a.OwnerUserId != null && ids.Contains(a.OwnerUserId.Value)).Select(a => a.UserId);
        await db.Users
            .Where(u => ids.Contains(u.Id) || agents.Contains(u.Id))
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.PermVersion, u => u.PermVersion + 1), ct);
    }

    public async Task BumpTeamMembersAsync(Guid teamId, CancellationToken ct = default) =>
        await BumpUsersAsync(await db.TeamMembers.Where(m => m.TeamId == teamId).Select(m => m.UserId).ToListAsync(ct), ct);

    public async Task BumpHoldersOfRoleAsync(Guid securityRoleId, CancellationToken ct = default)
    {
        var assignments = db.SecurityRoleAssignments.Where(a => a.SecurityRoleId == securityRoleId);
        var direct = await assignments.Where(a => a.PrincipalType == "user").Select(a => a.PrincipalId).ToListAsync(ct);
        var viaTeams = await db.TeamMembers
            .Where(m => assignments.Any(a => a.PrincipalType == "team" && a.PrincipalId == m.TeamId))
            .Select(m => m.UserId)
            .ToListAsync(ct);
        await BumpUsersAsync(direct.Concat(viaTeams), ct);
    }
}
