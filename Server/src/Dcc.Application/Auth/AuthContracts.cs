using Dcc.Domain.Auth;

namespace Dcc.Application.Auth;

/// <summary>The signed-in principal, as resolved from a token on every request.</summary>
public sealed record CurrentUser(Guid Id, string Email, string DisplayName, string Kind, int PermVersion);

/// <summary>What a successful sign-in or refresh hands back. The refresh token goes into an httpOnly cookie, never the body.</summary>
public sealed record IssuedTokens(string AccessToken, DateTimeOffset AccessExpiresAt, string RefreshToken, DateTimeOffset RefreshExpiresAt, bool MustChangePassword)
{
    /// <summary>The stored row of the refresh token just issued (used to link a rotation).</summary>
    public Guid RefreshRowId { get; init; }
}

public sealed record RequestInfo(string? Ip, string? UserAgent);

public interface IAuthService
{
    /// <summary>Email + password (the local credential). Five failures lock the account for 15 minutes.</summary>
    Task<IssuedTokens> LoginAsync(string email, string password, RequestInfo req, CancellationToken ct = default);

    /// <summary>Rotates the refresh token. Presenting one that was already rotated revokes its whole chain.</summary>
    Task<IssuedTokens> RefreshAsync(string refreshToken, RequestInfo req, CancellationToken ct = default);

    Task LogoutAsync(string refreshToken, CancellationToken ct = default);

    Task<IssuedTokens> ChangePasswordAsync(Guid userId, string currentPassword, string newPassword, RequestInfo req, CancellationToken ct = default);

    /// <summary>Signs a user in whose identity an external provider (Entra) already proved.</summary>
    Task<IssuedTokens> SignInExternalAsync(Guid userId, RequestInfo req, CancellationToken ct = default);
}

/// <summary>Where a permission check applies, as a request names it (route values).</summary>
public sealed record ScopeRef(ScopeType Type, Guid? Id)
{
    public static readonly ScopeRef Global = new(ScopeType.Global, null);
}

public interface IPermissionService
{
    /// <summary>
    /// Everything the user may do, by scope — direct assignments plus those of
    /// their teams, unexpired only; for a delegated agent, capped by its owner.
    /// Cached per (user, perm_version), so a change is seen at once.
    /// </summary>
    Task<EffectivePermissions> GetEffectiveAsync(Guid userId, CancellationToken ct = default);

    /// <summary>The authoritative check behind <c>[RequirePermission]</c>.</summary>
    Task<bool> HasAsync(Guid userId, string permission, ScopeRef scope, CancellationToken ct = default);

    /// <summary>The token's <c>perms</c> claim: this user's own permissions only.</summary>
    Task<IReadOnlyDictionary<string, string[]>> ClaimForAsync(Guid userId, CancellationToken ct = default);

    /// <summary>
    /// The clients on which the user holds <paramref name="permission"/> — to filter a
    /// list that spans clients. <c>null</c> means every client (a global grant).
    /// </summary>
    Task<IReadOnlySet<Guid>?> ClientsWithAsync(Guid userId, string permission, CancellationToken ct = default);

    /// <summary>Whether the user holds <paramref name="permission"/> anywhere at all — for an org-wide library everyone who works with it may read.</summary>
    Task<bool> HasAnywhereAsync(Guid userId, string permission, CancellationToken ct = default);
}

/// <summary>
/// Raises <c>users.perm_version</c> for everyone a change affects, so their
/// tokens are refused as stale and their cached permissions recomputed.
/// </summary>
public interface IPermissionVersionBumper
{
    Task BumpUsersAsync(IEnumerable<Guid> userIds, CancellationToken ct = default);
    Task BumpTeamMembersAsync(Guid teamId, CancellationToken ct = default);
    Task BumpHoldersOfRoleAsync(Guid securityRoleId, CancellationToken ct = default);
}
