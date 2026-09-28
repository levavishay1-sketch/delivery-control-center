namespace Dcc.Infrastructure.Persistence;

// Row types mapped onto the tables the SQL migrations create. SQL stays the
// source of truth for the schema (RLS, guards, constraints); EF Core only
// reads and writes. Column names are snake_case by convention.

public sealed class UserRow
{
    public Guid Id { get; set; }
    public string? EntraOid { get; set; }
    public string Email { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? ClaudeIdentityRef { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? DisabledAt { get; set; }
    public string Kind { get; set; } = "person";
    public DateTimeOffset? ExpiresAt { get; set; }
    public int PermVersion { get; set; } = 1;
    public bool MustChangePassword { get; set; }

    public bool IsActive(DateTimeOffset now) => DisabledAt is null && (ExpiresAt is null || ExpiresAt > now);
}

public sealed class UserIdentityRow
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Provider { get; set; } = "";
    public string Subject { get; set; } = "";
    public string? Email { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
}

public sealed class LocalCredentialRow
{
    public Guid UserId { get; set; }
    public string PasswordHash { get; set; } = "";
    public int FailedCount { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    public DateTimeOffset ChangedAt { get; set; }
}

public sealed class TeamRow
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string Source { get; set; } = "local";
    public string? ExternalId { get; set; }
    public Guid? ClientId { get; set; }
    public Guid? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
}

public sealed class TeamMemberRow
{
    public Guid TeamId { get; set; }
    public Guid UserId { get; set; }
    public string Source { get; set; } = "local";
    public Guid? AddedBy { get; set; }
    public DateTimeOffset AddedAt { get; set; }
}

public sealed class PermissionRow
{
    public string Code { get; set; } = "";
    public string Area { get; set; } = "";
    public string DescriptionKey { get; set; } = "";
}

public sealed class SecurityRoleRow
{
    public Guid Id { get; set; }
    public string? Key { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public bool IsBuiltin { get; set; }
    public string[] AssignableScopes { get; set; } = [];
    public Guid? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class SecurityRolePermissionRow
{
    public Guid SecurityRoleId { get; set; }
    public string PermissionCode { get; set; } = "";
}

public sealed class SecurityRoleAssignmentRow
{
    public Guid Id { get; set; }
    public string PrincipalType { get; set; } = "";
    public Guid PrincipalId { get; set; }
    public Guid SecurityRoleId { get; set; }
    public string ScopeType { get; set; } = "";
    public Guid? ScopeId { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public Guid? GrantedBy { get; set; }
    public DateTimeOffset GrantedAt { get; set; }
}

public sealed class AgentProfileRow
{
    public Guid UserId { get; set; }
    public string Mode { get; set; } = "delegated";
    public Guid? OwnerUserId { get; set; }
    public Guid? SponsorUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class UserTokenRow
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Type { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public string? Name { get; set; }
    public string[] Scopes { get; set; } = [];
    public Guid? FamilyId { get; set; }
    public Guid? ReplacedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
}

public sealed class AuditLogRow
{
    public Guid Id { get; set; }
    public DateTimeOffset At { get; set; }
    public Guid? ActorUserId { get; set; }
    public string Action { get; set; } = "";
    public string TargetType { get; set; } = "";
    public string? TargetId { get; set; }
    public string? Before { get; set; }
    public string? After { get; set; }
    public string? Ip { get; set; }
}

/// <summary>Read-only here: a client, for naming scopes and checking they exist.</summary>
public sealed class ClientRow
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public DateTimeOffset? ArchivedAt { get; set; }
}

/// <summary>Read-only here: a requirement (work item), for scope checks and names.</summary>
public sealed class WorkitemRow
{
    public Guid Id { get; set; }
    public Guid ClientId { get; set; }
    public Guid? ParentId { get; set; }
    public string? Key { get; set; }
    public string Title { get; set; } = "";
}
