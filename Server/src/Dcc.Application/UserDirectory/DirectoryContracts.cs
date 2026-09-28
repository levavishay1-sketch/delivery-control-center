namespace Dcc.Application.UserDirectory;

// ── users ──────────────────────────────────────────────────────────────
public sealed record UserDto(
    Guid Id,
    string Email,
    string DisplayName,
    string Kind,
    bool Disabled,
    DateTimeOffset? ExpiresAt,
    bool HasPassword,
    bool MustChangePassword,
    string[] Providers,
    DateTimeOffset CreatedAt);

/// <param name="Password">Optional: an initial password. The user must change it on first sign-in.</param>
public sealed record CreateUserRequest(string Email, string DisplayName, string Kind = "person", string? Password = null, DateTimeOffset? ExpiresAt = null);

public sealed record UpdateUserRequest(string? DisplayName, bool? Disabled, DateTimeOffset? ExpiresAt, bool ClearExpiry = false);

public sealed record SetPasswordRequest(string Password);

// ── teams ──────────────────────────────────────────────────────────────
public sealed record TeamDto(Guid Id, string Name, string? Description, string Source, string? ExternalId, Guid? ClientId, int MemberCount);

public sealed record CreateTeamRequest(string Name, string? Description, Guid? ClientId);

public sealed record TeamMemberDto(Guid UserId, string Email, string DisplayName, string Kind, string Source);

// ── security roles ─────────────────────────────────────────────────────
public sealed record PermissionDto(string Code, string Area, bool GlobalOnly, string DescriptionKey);

public sealed record SecurityRoleDto(Guid Id, string? Key, string Name, string? Description, bool IsBuiltin, string[] AssignableScopes, string[] Permissions);

public sealed record SaveSecurityRoleRequest(string Name, string? Description, string[] AssignableScopes, string[] Permissions);

// ── assignments ────────────────────────────────────────────────────────
public sealed record AssignmentDto(
    Guid Id,
    string PrincipalType,
    Guid PrincipalId,
    string PrincipalName,
    Guid SecurityRoleId,
    string SecurityRoleName,
    string ScopeType,
    Guid? ScopeId,
    string? ScopeName,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset GrantedAt);

public sealed record CreateAssignmentRequest(string PrincipalType, Guid PrincipalId, Guid SecurityRoleId, string ScopeType, Guid? ScopeId, DateTimeOffset? ExpiresAt);

// ── agents and API tokens ──────────────────────────────────────────────
public sealed record AgentDto(Guid Id, string DisplayName, string Email, string Mode, Guid? OwnerUserId, Guid? SponsorUserId, bool Disabled, DateTimeOffset? ExpiresAt);

/// <param name="OwnerUserId">The person the agent acts for. Defaults to the caller.</param>
public sealed record CreateAgentRequest(string DisplayName, Guid? OwnerUserId, DateTimeOffset? ExpiresAt);

public sealed record MakeIndependentRequest(Guid SponsorUserId, DateTimeOffset ExpiresAt);

public sealed record ApiTokenDto(Guid Id, Guid UserId, string? Name, string[] Scopes, DateTimeOffset CreatedAt, DateTimeOffset? ExpiresAt, DateTimeOffset? LastUsedAt, bool Revoked);

public sealed record CreateApiTokenRequest(string Name, DateTimeOffset? ExpiresAt, Guid? ForAgentId);

/// <summary>The only time the token itself is shown. It is stored as a hash.</summary>
public sealed record CreatedApiToken(ApiTokenDto Token, string Secret);

// ── Entra (infrastructure now, switched on once the app is registered) ─
public sealed record GuestInvitation(Guid UserId, string Email, string RedeemUrl);

public interface IGuestInvitationService
{
    bool IsConfigured { get; }

    /// <summary>Invites an outside person into the organisation's Entra (B2B) and creates their guest user here.</summary>
    Task<GuestInvitation> InviteAsync(string email, string displayName, DateTimeOffset? expiresAt, Guid invitedBy, CancellationToken ct = default);
}
