using System.Net.Mail;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Application.UserDirectory;
using Dcc.Domain.Audit;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Auth;
using Dcc.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.UserDirectory;

/// <summary>
/// Managing users, teams, security roles, assignments, agents and API tokens.
/// The caller's permission is checked by the API before a method here runs;
/// this class enforces the rules that hold whoever calls it (the last
/// administrator cannot be removed, an agent never holds Admin, a role is
/// assigned only where it is assignable…) and records every change.
/// </summary>
public sealed class DirectoryService(
    DccDbContext db,
    IPasswordHasher<UserRow> hasher,
    IPermissionVersionBumper bumper,
    IAuditLog audit,
    IOptions<AuthOptions> authOptions,
    IOptions<AgentOptions> agentOptions)
{
    // ── users ──────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<UserDto>> ListUsersAsync(bool includeAgents, CancellationToken ct)
    {
        var users = await db.Users.AsNoTracking()
            .Where(u => includeAgents || u.Kind != "agent")
            .OrderBy(u => u.DisplayName)
            .ToListAsync(ct);
        return await ToDtosAsync(users, ct);
    }

    public async Task<UserDto> GetUserAsync(Guid id, CancellationToken ct) =>
        (await ToDtosAsync([await FindUserAsync(id, ct)], ct))[0];

    public async Task<UserDto> CreateUserAsync(CreateUserRequest req, Guid actor, CancellationToken ct)
    {
        var email = NormalizeEmail(req.Email);
        if (req.Kind is not ("person" or "guest")) throw AppException.BadRequest("bad_kind", "kind must be person or guest (agents are created under /agents).");
        if (string.IsNullOrWhiteSpace(req.DisplayName)) throw AppException.BadRequest("bad_name", "A display name is required.");
        if (await db.Users.AnyAsync(u => u.Email.ToLower() == email, ct)) throw AppException.Conflict("email_taken", "A user with this email already exists.");

        var now = DateTimeOffset.UtcNow;
        var user = new UserRow { Id = Guid.NewGuid(), Email = email, DisplayName = req.DisplayName.Trim(), Kind = req.Kind, ExpiresAt = req.ExpiresAt, CreatedAt = now };
        db.Users.Add(user);
        if (req.Password is not null)
        {
            AuthService.ValidateNewPassword(req.Password, authOptions.Value.MinPasswordLength);
            db.LocalCredentials.Add(new LocalCredentialRow { UserId = user.Id, PasswordHash = hasher.HashPassword(user, req.Password), ChangedAt = now });
            user.MustChangePassword = true;
        }
        await db.SaveChangesAsync(ct);
        await audit.WriteAsync(new AuditEntry(actor, "user.created", "user", user.Id.ToString(), After: new { user.Email, user.DisplayName, user.Kind, user.ExpiresAt, hasPassword = req.Password is not null }), ct);
        return await GetUserAsync(user.Id, ct);
    }

    public async Task<UserDto> UpdateUserAsync(Guid id, UpdateUserRequest req, Guid actor, CancellationToken ct)
    {
        var user = await FindUserAsync(id, ct);
        var before = new { user.DisplayName, disabled = user.DisabledAt is not null, user.ExpiresAt };
        var accessChanged = false;

        if (req.DisplayName is { } name)
        {
            if (string.IsNullOrWhiteSpace(name)) throw AppException.BadRequest("bad_name", "A display name is required.");
            user.DisplayName = name.Trim();
        }
        if (req.Disabled is { } disable && disable != (user.DisabledAt is not null))
        {
            if (disable)
            {
                if (id == actor) throw AppException.Conflict("self_disable", "You cannot disable your own account.");
                await EnsureNotLastAdminAsync(userId: id, removingAssignmentId: null, ct);
                user.DisabledAt = DateTimeOffset.UtcNow;
            }
            else user.DisabledAt = null;
            accessChanged = true;
        }
        if (req.ClearExpiry) { user.ExpiresAt = null; accessChanged = true; }
        else if (req.ExpiresAt is { } exp) { user.ExpiresAt = exp; accessChanged = true; }

        await db.SaveChangesAsync(ct);
        if (accessChanged)
        {
            if (user.DisabledAt is not null) await RevokeSessionsAsync(id, ct);
            await bumper.BumpUsersAsync([id], ct);
        }
        await audit.WriteAsync(new AuditEntry(actor, "user.updated", "user", id.ToString(), before, new { user.DisplayName, disabled = user.DisabledAt is not null, user.ExpiresAt }), ct);
        return await GetUserAsync(id, ct);
    }

    /// <summary>An administrator sets a password; the user must change it at next sign-in, and their sessions end.</summary>
    public async Task SetPasswordAsync(Guid id, string password, Guid actor, CancellationToken ct)
    {
        var user = await FindUserAsync(id, ct);
        if (user.Kind == "agent") throw AppException.BadRequest("agent_password", "An agent signs in with an API token, not a password.");
        AuthService.ValidateNewPassword(password, authOptions.Value.MinPasswordLength);
        var now = DateTimeOffset.UtcNow;
        var cred = await db.LocalCredentials.FirstOrDefaultAsync(c => c.UserId == id, ct);
        if (cred is null) db.LocalCredentials.Add(cred = new LocalCredentialRow { UserId = id });
        cred.PasswordHash = hasher.HashPassword(user, password);
        cred.ChangedAt = now;
        cred.FailedCount = 0;
        cred.LockedUntil = null;
        user.MustChangePassword = id != actor;
        await db.SaveChangesAsync(ct);
        await RevokeSessionsAsync(id, ct);
        await bumper.BumpUsersAsync([id], ct);
        await audit.WriteAsync(new AuditEntry(actor, "user.password_set", "user", id.ToString()), ct);
    }

    // ── teams ──────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<TeamDto>> ListTeamsAsync(CancellationToken ct) =>
        await db.Teams.AsNoTracking()
            .Where(t => t.ArchivedAt == null)
            .OrderBy(t => t.Name)
            .Select(t => new TeamDto(t.Id, t.Name, t.Description, t.Source, t.ExternalId, t.ClientId, db.TeamMembers.Count(m => m.TeamId == t.Id)))
            .ToListAsync(ct);

    public async Task<TeamDto> CreateTeamAsync(CreateTeamRequest req, Guid actor, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Name)) throw AppException.BadRequest("bad_name", "A team name is required.");
        var name = req.Name.Trim();
        if (await db.Teams.AnyAsync(t => t.ArchivedAt == null && t.Name.ToLower() == name.ToLower(), ct)) throw AppException.Conflict("name_taken", "A team with this name already exists.");
        if (req.ClientId is { } c && !await db.Clients.AnyAsync(x => x.Id == c && x.ArchivedAt == null, ct)) throw AppException.NotFound("client");

        var team = new TeamRow { Id = Guid.NewGuid(), Name = name, Description = req.Description, ClientId = req.ClientId, Source = "local", CreatedBy = actor, CreatedAt = DateTimeOffset.UtcNow };
        db.Teams.Add(team);
        await db.SaveChangesAsync(ct);
        await audit.WriteAsync(new AuditEntry(actor, "team.created", "team", team.Id.ToString(), After: new { team.Name, team.Description, team.ClientId }), ct);
        return new TeamDto(team.Id, team.Name, team.Description, team.Source, null, team.ClientId, 0);
    }

    public async Task ArchiveTeamAsync(Guid id, Guid actor, CancellationToken ct)
    {
        var team = await FindTeamAsync(id, ct);
        await EnsureNotLastAdminAsync(userId: null, removingAssignmentId: null, ct, archivingTeamId: id);
        team.ArchivedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await bumper.BumpTeamMembersAsync(id, ct);
        await audit.WriteAsync(new AuditEntry(actor, "team.archived", "team", id.ToString(), Before: new { team.Name }), ct);
    }

    public async Task<IReadOnlyList<TeamMemberDto>> ListMembersAsync(Guid teamId, CancellationToken ct)
    {
        await FindTeamAsync(teamId, ct);
        return await db.TeamMembers.AsNoTracking()
            .Where(m => m.TeamId == teamId)
            .Join(db.Users, m => m.UserId, u => u.Id, (m, u) => new { m, u })
            .OrderBy(x => x.u.DisplayName)
            .Select(x => new TeamMemberDto(x.u.Id, x.u.Email, x.u.DisplayName, x.u.Kind, x.m.Source))
            .ToListAsync(ct);
    }

    public async Task AddMemberAsync(Guid teamId, Guid userId, Guid actor, CancellationToken ct)
    {
        var team = await FindTeamAsync(teamId, ct);
        if (team.Source == "entra") throw AppException.Conflict("entra_team", "This team mirrors an Entra group; change its members in Entra.");
        await FindUserAsync(userId, ct);
        if (await db.TeamMembers.AnyAsync(m => m.TeamId == teamId && m.UserId == userId, ct)) return;
        db.TeamMembers.Add(new TeamMemberRow { TeamId = teamId, UserId = userId, Source = "local", AddedBy = actor, AddedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync(ct);
        await bumper.BumpUsersAsync([userId], ct);
        await audit.WriteAsync(new AuditEntry(actor, "team.member_added", "team", teamId.ToString(), After: new { userId }), ct);
    }

    public async Task RemoveMemberAsync(Guid teamId, Guid userId, Guid actor, CancellationToken ct)
    {
        var team = await FindTeamAsync(teamId, ct);
        if (team.Source == "entra") throw AppException.Conflict("entra_team", "This team mirrors an Entra group; change its members in Entra.");
        var member = await db.TeamMembers.FirstOrDefaultAsync(m => m.TeamId == teamId && m.UserId == userId, ct) ?? throw AppException.NotFound("team member");
        await EnsureNotLastAdminAsync(userId: null, removingAssignmentId: null, ct, removingMember: (teamId, userId));
        db.TeamMembers.Remove(member);
        await db.SaveChangesAsync(ct);
        await bumper.BumpUsersAsync([userId], ct);
        await audit.WriteAsync(new AuditEntry(actor, "team.member_removed", "team", teamId.ToString(), Before: new { userId }), ct);
    }

    // ── permissions and security roles ─────────────────────────────────

    public static IReadOnlyList<PermissionDto> PermissionCatalog() =>
        Permissions.All.Select(p => new PermissionDto(p.Code, p.Area, p.GlobalOnly, p.DescriptionKey)).ToList();

    public async Task<IReadOnlyList<SecurityRoleDto>> ListRolesAsync(CancellationToken ct)
    {
        var roles = await db.SecurityRoles.AsNoTracking().OrderByDescending(r => r.IsBuiltin).ThenBy(r => r.Name).ToListAsync(ct);
        var perms = await db.SecurityRolePermissions.AsNoTracking().ToListAsync(ct);
        return roles.Select(r => ToDto(r, perms.Where(p => p.SecurityRoleId == r.Id).Select(p => p.PermissionCode))).ToList();
    }

    public async Task<SecurityRoleDto> CreateRoleAsync(SaveSecurityRoleRequest req, Guid actor, CancellationToken ct)
    {
        var (scopes, codes) = ValidateRole(req);
        if (await db.SecurityRoles.AnyAsync(r => r.Name.ToLower() == req.Name.Trim().ToLower(), ct)) throw AppException.Conflict("name_taken", "A security role with this name already exists.");
        var role = new SecurityRoleRow { Id = Guid.NewGuid(), Name = req.Name.Trim(), Description = req.Description, AssignableScopes = scopes, CreatedBy = actor, CreatedAt = DateTimeOffset.UtcNow };
        db.SecurityRoles.Add(role);
        db.SecurityRolePermissions.AddRange(codes.Select(c => new SecurityRolePermissionRow { SecurityRoleId = role.Id, PermissionCode = c }));
        await db.SaveChangesAsync(ct);
        await audit.WriteAsync(new AuditEntry(actor, "security_role.created", "security_role", role.Id.ToString(), After: new { role.Name, scopes, permissions = codes }), ct);
        return ToDto(role, codes);
    }

    public async Task<SecurityRoleDto> UpdateRoleAsync(Guid id, SaveSecurityRoleRequest req, Guid actor, CancellationToken ct)
    {
        var role = await db.SecurityRoles.FirstOrDefaultAsync(r => r.Id == id, ct) ?? throw AppException.NotFound("security role");
        if (role.IsBuiltin) throw AppException.Conflict("builtin_role", "A built-in security role cannot be changed; create a custom one instead.");
        var (scopes, codes) = ValidateRole(req);
        var name = req.Name.Trim();
        if (await db.SecurityRoles.AnyAsync(r => r.Id != id && r.Name.ToLower() == name.ToLower(), ct)) throw AppException.Conflict("name_taken", "A security role with this name already exists.");

        var beforePerms = await db.SecurityRolePermissions.Where(p => p.SecurityRoleId == id).Select(p => p.PermissionCode).ToListAsync(ct);
        var before = new { role.Name, scopes = role.AssignableScopes, permissions = beforePerms };
        role.Name = name;
        role.Description = req.Description;
        role.AssignableScopes = scopes;
        await db.SecurityRolePermissions.Where(p => p.SecurityRoleId == id).ExecuteDeleteAsync(ct);
        db.SecurityRolePermissions.AddRange(codes.Select(c => new SecurityRolePermissionRow { SecurityRoleId = id, PermissionCode = c }));
        await db.SaveChangesAsync(ct);
        await bumper.BumpHoldersOfRoleAsync(id, ct);
        await audit.WriteAsync(new AuditEntry(actor, "security_role.updated", "security_role", id.ToString(), before, new { role.Name, scopes, permissions = codes }), ct);
        return ToDto(role, codes);
    }

    public async Task DeleteRoleAsync(Guid id, Guid actor, CancellationToken ct)
    {
        var role = await db.SecurityRoles.FirstOrDefaultAsync(r => r.Id == id, ct) ?? throw AppException.NotFound("security role");
        if (role.IsBuiltin) throw AppException.Conflict("builtin_role", "A built-in security role cannot be deleted.");
        if (await db.SecurityRoleAssignments.AnyAsync(a => a.SecurityRoleId == id, ct)) throw AppException.Conflict("role_in_use", "Remove the assignments of this security role first.");
        db.SecurityRoles.Remove(role);
        await db.SaveChangesAsync(ct);
        await audit.WriteAsync(new AuditEntry(actor, "security_role.deleted", "security_role", id.ToString(), Before: new { role.Name }), ct);
    }

    // ── assignments ────────────────────────────────────────────────────

    public async Task<IReadOnlyList<AssignmentDto>> ListAssignmentsAsync(string? principalType, Guid? principalId, CancellationToken ct)
    {
        var q = db.SecurityRoleAssignments.AsNoTracking().AsQueryable();
        if (principalType is not null) q = q.Where(a => a.PrincipalType == principalType);
        if (principalId is not null) q = q.Where(a => a.PrincipalId == principalId);
        var rows = await q.OrderBy(a => a.GrantedAt).ToListAsync(ct);

        var roleNames = await db.SecurityRoles.AsNoTracking().ToDictionaryAsync(r => r.Id, r => r.Name, ct);
        var userNames = await db.Users.AsNoTracking().ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
        var teamNames = await db.Teams.AsNoTracking().ToDictionaryAsync(t => t.Id, t => t.Name, ct);
        var clientNames = await db.Clients.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var reqIds = rows.Where(r => r.ScopeType == "requirement").Select(r => r.ScopeId!.Value).ToList();
        var reqNames = await db.Workitems.AsNoTracking().Where(w => reqIds.Contains(w.Id)).ToDictionaryAsync(w => w.Id, w => w.Key ?? w.Title, ct);

        return rows.Select(a => new AssignmentDto(
            a.Id, a.PrincipalType, a.PrincipalId,
            (a.PrincipalType == "user" ? userNames.GetValueOrDefault(a.PrincipalId) : teamNames.GetValueOrDefault(a.PrincipalId)) ?? "?",
            a.SecurityRoleId, roleNames.GetValueOrDefault(a.SecurityRoleId) ?? "?",
            a.ScopeType, a.ScopeId,
            a.ScopeType switch
            {
                "client" => clientNames.GetValueOrDefault(a.ScopeId!.Value),
                "requirement" => reqNames.GetValueOrDefault(a.ScopeId!.Value),
                _ => null,
            },
            a.ExpiresAt, a.GrantedAt)).ToList();
    }

    public async Task<AssignmentDto> CreateAssignmentAsync(CreateAssignmentRequest req, Guid actor, CancellationToken ct)
    {
        if (req.PrincipalType is not ("user" or "team")) throw AppException.BadRequest("bad_principal", "principalType must be user or team.");
        var scopeType = ParseScope(req.ScopeType);
        if ((scopeType == ScopeType.Global) != (req.ScopeId is null)) throw AppException.BadRequest("bad_scope", "A global assignment has no scopeId; a client or requirement one needs it.");

        var role = await db.SecurityRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == req.SecurityRoleId, ct) ?? throw AppException.NotFound("security role");
        if (!role.AssignableScopes.Contains(scopeType.ToDb()))
            throw AppException.BadRequest("scope_not_assignable", $"\"{role.Name}\" can be assigned only at: {string.Join(", ", role.AssignableScopes)}.");

        List<Guid> affected;
        if (req.PrincipalType == "user")
        {
            var user = await FindUserAsync(req.PrincipalId, ct);
            if (user.Kind == "agent" && role.Key == BuiltInSecurityRoles.AdminKey) throw AppException.Conflict("agent_admin", "An AI agent can never hold Admin.");
            affected = [user.Id];
        }
        else
        {
            await FindTeamAsync(req.PrincipalId, ct);
            if (role.Key == BuiltInSecurityRoles.AdminKey &&
                await db.TeamMembers.Where(m => m.TeamId == req.PrincipalId).Join(db.Users, m => m.UserId, u => u.Id, (m, u) => u.Kind).AnyAsync(k => k == "agent", ct))
                throw AppException.Conflict("agent_admin", "This team has an AI agent among its members; an agent can never hold Admin.");
            affected = await db.TeamMembers.Where(m => m.TeamId == req.PrincipalId).Select(m => m.UserId).ToListAsync(ct);
        }

        if (scopeType == ScopeType.Client && !await db.Clients.AnyAsync(c => c.Id == req.ScopeId && c.ArchivedAt == null, ct)) throw AppException.NotFound("client");
        if (scopeType == ScopeType.Requirement && !await db.Workitems.AnyAsync(w => w.Id == req.ScopeId, ct)) throw AppException.NotFound("requirement");

        var exists = await db.SecurityRoleAssignments.AnyAsync(a => a.PrincipalType == req.PrincipalType && a.PrincipalId == req.PrincipalId &&
            a.SecurityRoleId == req.SecurityRoleId && a.ScopeType == scopeType.ToDb() && a.ScopeId == req.ScopeId, ct);
        if (exists) throw AppException.Conflict("already_assigned", "This assignment already exists.");

        var row = new SecurityRoleAssignmentRow
        {
            Id = Guid.NewGuid(), PrincipalType = req.PrincipalType, PrincipalId = req.PrincipalId, SecurityRoleId = req.SecurityRoleId,
            ScopeType = scopeType.ToDb(), ScopeId = req.ScopeId, ExpiresAt = req.ExpiresAt, GrantedBy = actor, GrantedAt = DateTimeOffset.UtcNow,
        };
        db.SecurityRoleAssignments.Add(row);
        await db.SaveChangesAsync(ct);
        await bumper.BumpUsersAsync(affected, ct);
        await audit.WriteAsync(new AuditEntry(actor, "role_assignment.granted", "role_assignment", row.Id.ToString(),
            After: new { row.PrincipalType, row.PrincipalId, role = role.Name, row.ScopeType, row.ScopeId, row.ExpiresAt }), ct);
        return (await ListAssignmentsAsync(row.PrincipalType, row.PrincipalId, ct)).First(a => a.Id == row.Id);
    }

    public async Task DeleteAssignmentAsync(Guid id, Guid actor, CancellationToken ct)
    {
        var row = await db.SecurityRoleAssignments.FirstOrDefaultAsync(a => a.Id == id, ct) ?? throw AppException.NotFound("assignment");
        await EnsureNotLastAdminAsync(userId: null, removingAssignmentId: id, ct);
        var affected = row.PrincipalType == "user"
            ? [row.PrincipalId]
            : await db.TeamMembers.Where(m => m.TeamId == row.PrincipalId).Select(m => m.UserId).ToListAsync(ct);
        db.SecurityRoleAssignments.Remove(row);
        await db.SaveChangesAsync(ct);
        await bumper.BumpUsersAsync(affected, ct);
        await audit.WriteAsync(new AuditEntry(actor, "role_assignment.revoked", "role_assignment", id.ToString(),
            Before: new { row.PrincipalType, row.PrincipalId, row.SecurityRoleId, row.ScopeType, row.ScopeId }), ct);
    }

    // ── agents ─────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<AgentDto>> ListAgentsAsync(CancellationToken ct) =>
        await db.Users.AsNoTracking().Where(u => u.Kind == "agent")
            .OrderBy(u => u.DisplayName)
            .Join(db.AgentProfiles, u => u.Id, a => a.UserId, (u, a) => new AgentDto(u.Id, u.DisplayName, u.Email, a.Mode, a.OwnerUserId, a.SponsorUserId, u.DisabledAt != null, u.ExpiresAt))
            .ToListAsync(ct);

    public async Task<AgentDto> CreateAgentAsync(CreateAgentRequest req, Guid actor, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.DisplayName)) throw AppException.BadRequest("bad_name", "An agent needs a name.");
        var ownerId = req.OwnerUserId ?? actor;
        var owner = await FindUserAsync(ownerId, ct);
        if (owner.Kind != "person" || !owner.IsActive(DateTimeOffset.UtcNow)) throw AppException.BadRequest("bad_owner", "An agent's owner must be an active person.");

        var id = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        db.Users.Add(new UserRow { Id = id, Email = $"agent-{id:N}@agents.dcc.local", DisplayName = req.DisplayName.Trim(), Kind = "agent", ExpiresAt = req.ExpiresAt, CreatedAt = now });
        db.AgentProfiles.Add(new AgentProfileRow { UserId = id, Mode = "delegated", OwnerUserId = ownerId, CreatedAt = now });
        await db.SaveChangesAsync(ct);
        await audit.WriteAsync(new AuditEntry(actor, "agent.created", "user", id.ToString(), After: new { req.DisplayName, mode = "delegated", ownerUserId = ownerId, req.ExpiresAt }), ct);
        return (await ListAgentsAsync(ct)).First(a => a.Id == id);
    }

    public async Task<AgentDto> MakeIndependentAsync(Guid agentId, MakeIndependentRequest req, Guid actor, CancellationToken ct)
    {
        if (!agentOptions.Value.AllowIndependent)
            throw AppException.Forbidden("requires_architecture_review",
                "Independent agents change architecture decision 02 and stay off until its amendment in docs/architecture-review.md is approved.");
        var profile = await db.AgentProfiles.FirstOrDefaultAsync(a => a.UserId == agentId, ct) ?? throw AppException.NotFound("agent");
        var sponsor = await FindUserAsync(req.SponsorUserId, ct);
        if (sponsor.Kind != "person" || !sponsor.IsActive(DateTimeOffset.UtcNow)) throw AppException.BadRequest("bad_sponsor", "The accountable person must be an active person.");
        if (req.ExpiresAt <= DateTimeOffset.UtcNow) throw AppException.BadRequest("bad_expiry", "An independent agent needs an expiry date in the future.");

        var agent = await FindUserAsync(agentId, ct);
        var before = new { profile.Mode, profile.OwnerUserId };
        profile.Mode = "independent";
        profile.SponsorUserId = req.SponsorUserId;
        profile.OwnerUserId = null;
        agent.ExpiresAt = req.ExpiresAt;
        await db.SaveChangesAsync(ct);
        await bumper.BumpUsersAsync([agentId], ct);
        await audit.WriteAsync(new AuditEntry(actor, "agent.made_independent", "user", agentId.ToString(), before, new { profile.Mode, profile.SponsorUserId, agent.ExpiresAt }), ct);
        return (await ListAgentsAsync(ct)).First(a => a.Id == agentId);
    }

    /// <summary>Whether <paramref name="userId"/> owns (or sponsors) the agent — they may manage its tokens.</summary>
    public Task<bool> IsResponsibleForAgentAsync(Guid userId, Guid agentId, CancellationToken ct) =>
        db.AgentProfiles.AnyAsync(a => a.UserId == agentId && (a.OwnerUserId == userId || a.SponsorUserId == userId), ct);

    // ── API tokens ─────────────────────────────────────────────────────

    public async Task<IReadOnlyList<ApiTokenDto>> ListTokensAsync(Guid? forUser, CancellationToken ct) =>
        await db.UserTokens.AsNoTracking()
            .Where(t => t.Type == "api" && (forUser == null || t.UserId == forUser))
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new ApiTokenDto(t.Id, t.UserId, t.Name, t.Scopes, t.CreatedAt, t.ExpiresAt, t.LastUsedAt, t.RevokedAt != null))
            .ToListAsync(ct);

    public async Task<CreatedApiToken> CreateTokenAsync(Guid forUser, string name, DateTimeOffset? expiresAt, Guid actor, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name)) throw AppException.BadRequest("bad_name", "Give the token a name, so you know what uses it.");
        var user = await FindUserAsync(forUser, ct);
        if (!user.IsActive(DateTimeOffset.UtcNow)) throw AppException.BadRequest("inactive", "The account is disabled or expired.");
        if (expiresAt is { } e && e <= DateTimeOffset.UtcNow) throw AppException.BadRequest("bad_expiry", "The expiry must be in the future.");

        var secret = Secrets.NewApiToken();
        var row = new UserTokenRow { Id = Guid.NewGuid(), UserId = forUser, Type = "api", TokenHash = Secrets.Hash(secret), Name = name.Trim(), CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = expiresAt };
        db.UserTokens.Add(row);
        await db.SaveChangesAsync(ct);
        await audit.WriteAsync(new AuditEntry(actor, "api_token.created", "user", forUser.ToString(), After: new { tokenId = row.Id, row.Name, row.ExpiresAt }), ct);
        return new CreatedApiToken(new ApiTokenDto(row.Id, row.UserId, row.Name, row.Scopes, row.CreatedAt, row.ExpiresAt, null, false), secret);
    }

    public async Task<UserTokenRow> FindApiTokenAsync(Guid id, CancellationToken ct) =>
        await db.UserTokens.FirstOrDefaultAsync(t => t.Id == id && t.Type == "api", ct) ?? throw AppException.NotFound("token");

    public async Task RevokeTokenAsync(Guid id, Guid actor, CancellationToken ct)
    {
        var row = await FindApiTokenAsync(id, ct);
        if (row.RevokedAt is not null) return;
        row.RevokedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await audit.WriteAsync(new AuditEntry(actor, "api_token.revoked", "user", row.UserId.ToString(), Before: new { tokenId = id, row.Name }), ct);
    }

    // ── rules shared by the above ──────────────────────────────────────

    /// <summary>
    /// Refuses a change that would leave nobody active holding Admin at global
    /// scope — the system could no longer be administered.
    /// </summary>
    private async Task EnsureNotLastAdminAsync(Guid? userId, Guid? removingAssignmentId, CancellationToken ct,
        Guid? archivingTeamId = null, (Guid TeamId, Guid UserId)? removingMember = null)
    {
        var adminRoleId = await db.SecurityRoles.Where(r => r.Key == BuiltInSecurityRoles.AdminKey).Select(r => r.Id).FirstAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var grants = await db.SecurityRoleAssignments.AsNoTracking()
            .Where(a => a.SecurityRoleId == adminRoleId && a.ScopeType == "global" && (a.ExpiresAt == null || a.ExpiresAt > now))
            .ToListAsync(ct);

        var admins = new HashSet<Guid>();
        foreach (var g in grants)
        {
            if (g.Id == removingAssignmentId) continue;
            if (g.PrincipalType == "user") admins.Add(g.PrincipalId);
            else if (g.PrincipalId != archivingTeamId)
                foreach (var m in await db.TeamMembers.AsNoTracking().Where(m => m.TeamId == g.PrincipalId).Select(m => m.UserId).ToListAsync(ct))
                    if (removingMember is not { } rm || rm.TeamId != g.PrincipalId || rm.UserId != m) admins.Add(m);
        }
        if (userId is { } u) admins.Remove(u);

        var active = await db.Users.AsNoTracking().Where(x => admins.Contains(x.Id) && x.Kind == "person").ToListAsync(ct);
        if (!active.Any(x => x.IsActive(now)))
            throw AppException.Conflict("last_admin", "This would leave no active administrator. Make someone else Admin first.");
    }

    private (string[] Scopes, string[] Codes) ValidateRole(SaveSecurityRoleRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name)) throw AppException.BadRequest("bad_name", "A security role needs a name.");
        var scopes = (req.AssignableScopes ?? []).Distinct().ToArray();
        if (scopes.Length == 0) throw AppException.BadRequest("bad_scopes", "Say where the role may be assigned (global, client, requirement).");
        foreach (var s in scopes) ParseScope(s);
        var codes = (req.Permissions ?? []).Distinct().ToArray();
        var unknown = codes.Where(c => !Permissions.Exists(c)).ToArray();
        if (unknown.Length > 0) throw AppException.BadRequest("unknown_permission", "Unknown permission: " + string.Join(", ", unknown));
        return (scopes, codes);
    }

    private static ScopeType ParseScope(string s)
    {
        try { return ScopeTypes.Parse(s); }
        catch (ArgumentException) { throw AppException.BadRequest("bad_scope", "scope must be global, client or requirement."); }
    }

    private async Task RevokeSessionsAsync(Guid userId, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        await db.UserTokens.Where(t => t.UserId == userId && t.Type == "refresh" && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
    }

    private async Task<UserRow> FindUserAsync(Guid id, CancellationToken ct) =>
        await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct) ?? throw AppException.NotFound("user");

    private async Task<TeamRow> FindTeamAsync(Guid id, CancellationToken ct) =>
        await db.Teams.FirstOrDefaultAsync(t => t.Id == id && t.ArchivedAt == null, ct) ?? throw AppException.NotFound("team");

    private async Task<List<UserDto>> ToDtosAsync(List<UserRow> users, CancellationToken ct)
    {
        var ids = users.Select(u => u.Id).ToList();
        var withPassword = (await db.LocalCredentials.AsNoTracking().Where(c => ids.Contains(c.UserId)).Select(c => c.UserId).ToListAsync(ct)).ToHashSet();
        var providers = (await db.UserIdentities.AsNoTracking().Where(i => ids.Contains(i.UserId)).Select(i => new { i.UserId, i.Provider }).ToListAsync(ct))
            .GroupBy(i => i.UserId).ToDictionary(g => g.Key, g => g.Select(x => x.Provider).Distinct().ToArray());
        return users.Select(u => new UserDto(u.Id, u.Email, u.DisplayName, u.Kind, u.DisabledAt is not null, u.ExpiresAt,
            withPassword.Contains(u.Id), u.MustChangePassword, providers.GetValueOrDefault(u.Id, []), u.CreatedAt)).ToList();
    }

    private static SecurityRoleDto ToDto(SecurityRoleRow r, IEnumerable<string> codes) =>
        new(r.Id, r.Key, r.Name, r.Description, r.IsBuiltin, r.AssignableScopes, codes.Order(StringComparer.Ordinal).ToArray());

    private static string NormalizeEmail(string email)
    {
        var e = (email ?? "").Trim().ToLowerInvariant();
        if (!MailAddress.TryCreate(e, out var parsed) || parsed.Address != e) throw AppException.BadRequest("bad_email", "That is not a valid email address.");
        return e;
    }
}
