using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Audit;
using Dcc.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.Auth;

/// <summary>
/// Sign-in with a local password, refresh-token rotation, sign-out and password
/// change. Every outcome that matters is written to the audit log.
/// </summary>
public sealed class AuthService(
    DccDbContext db,
    TokenIssuer tokens,
    IPasswordHasher<UserRow> hasher,
    IPermissionVersionBumper bumper,
    IAuditLog audit,
    IOptions<AuthOptions> options) : IAuthService
{
    private readonly AuthOptions _o = options.Value;

    /// <summary>A rotated refresh token presented again within this window is a race between tabs, not theft.</summary>
    private static readonly TimeSpan RotationGrace = TimeSpan.FromSeconds(10);

    // Verified against when the email is unknown, so an unknown email takes as long as a wrong password.
    private static readonly string DummyHash = new PasswordHasher<UserRow>().HashPassword(new UserRow(), Guid.NewGuid().ToString());

    public async Task<IssuedTokens> LoginAsync(string email, string password, RequestInfo req, CancellationToken ct = default)
    {
        var normalized = (email ?? "").Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == normalized, ct);
        var cred = user is null ? null : await db.LocalCredentials.FirstOrDefaultAsync(c => c.UserId == user.Id, ct);
        var now = DateTimeOffset.UtcNow;

        if (user is null || cred is null)
        {
            hasher.VerifyHashedPassword(new UserRow(), DummyHash, password ?? "");
            await audit.WriteAsync(new AuditEntry(null, "auth.login_failed", "user", null, After: new { email = normalized, reason = "unknown" }, Ip: req.Ip), ct);
            throw InvalidCredentials();
        }

        if (cred.LockedUntil is { } until && until > now)
            throw AppException.Unauthorized("account_locked", $"Too many failed attempts. Try again after {until:HH:mm} UTC.");

        var result = hasher.VerifyHashedPassword(user, cred.PasswordHash, password ?? "");
        if (result == PasswordVerificationResult.Failed)
        {
            cred.FailedCount++;
            var locked = cred.FailedCount >= _o.MaxFailedLogins;
            if (locked)
            {
                cred.LockedUntil = now.AddMinutes(_o.LockoutMinutes);
                cred.FailedCount = 0;
            }
            await db.SaveChangesAsync(ct);
            await audit.WriteAsync(new AuditEntry(user.Id, locked ? "auth.locked" : "auth.login_failed", "user", user.Id.ToString(), Ip: req.Ip), ct);
            throw InvalidCredentials();
        }

        if (!user.IsActive(now))
            throw AppException.Unauthorized("account_disabled", "This account is disabled or has expired.");

        cred.FailedCount = 0;
        cred.LockedUntil = null;
        if (result == PasswordVerificationResult.SuccessRehashNeeded) cred.PasswordHash = hasher.HashPassword(user, password!);
        await TouchIdentityAsync(user.Id, "local", user.Email, now, ct);
        await db.SaveChangesAsync(ct);

        await audit.WriteAsync(new AuditEntry(user.Id, "auth.login", "user", user.Id.ToString(), Ip: req.Ip), ct);
        return await tokens.IssueAsync(user, req, familyId: null, ct);
    }

    public async Task<IssuedTokens> RefreshAsync(string refreshToken, RequestInfo req, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(refreshToken)) throw AppException.Unauthorized("invalid_refresh", "Not signed in.");
        var hash = Secrets.Hash(refreshToken);
        var row = await db.UserTokens.FirstOrDefaultAsync(t => t.TokenHash == hash && t.Type == "refresh", ct);
        var now = DateTimeOffset.UtcNow;
        if (row is null) throw AppException.Unauthorized("invalid_refresh", "Not signed in.");

        if (row.ReplacedBy is not null || row.RevokedAt is not null)
        {
            if (row.ReplacedBy is not null && row.RevokedAt is { } rotatedAt && now - rotatedAt < RotationGrace)
                throw AppException.Conflict("refresh_race", "Another tab refreshed the session a moment ago; retry.");

            // A token that was already used came back: assume it was stolen, end the whole chain.
            await RevokeFamilyAsync(row.FamilyId, now, ct);
            await audit.WriteAsync(new AuditEntry(row.UserId, "auth.refresh_reuse", "user", row.UserId.ToString(), Ip: req.Ip), ct);
            throw AppException.Unauthorized("invalid_refresh", "This session has ended. Sign in again.");
        }

        if (row.ExpiresAt is { } exp && exp <= now) throw AppException.Unauthorized("invalid_refresh", "The session expired. Sign in again.");

        var user = await db.Users.FirstAsync(u => u.Id == row.UserId, ct);
        if (!user.IsActive(now))
        {
            await RevokeFamilyAsync(row.FamilyId, now, ct);
            throw AppException.Unauthorized("account_disabled", "This account is disabled or has expired.");
        }

        var issued = await tokens.IssueAsync(user, req, row.FamilyId, ct);
        row.ReplacedBy = issued.RefreshRowId;
        row.RevokedAt = now;
        row.LastUsedAt = now;
        await db.SaveChangesAsync(ct);
        return issued;
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(refreshToken)) return;
        var hash = Secrets.Hash(refreshToken);
        var row = await db.UserTokens.AsNoTracking().FirstOrDefaultAsync(t => t.TokenHash == hash && t.Type == "refresh", ct);
        if (row is null) return;
        await RevokeFamilyAsync(row.FamilyId, DateTimeOffset.UtcNow, ct);
        await audit.WriteAsync(new AuditEntry(row.UserId, "auth.logout", "user", row.UserId.ToString()), ct);
    }

    public async Task<IssuedTokens> ChangePasswordAsync(Guid userId, string currentPassword, string newPassword, RequestInfo req, CancellationToken ct = default)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct) ?? throw AppException.NotFound("user");
        var cred = await db.LocalCredentials.FirstOrDefaultAsync(c => c.UserId == userId, ct)
                   ?? throw AppException.BadRequest("no_password", "This account signs in without a password.");

        if (hasher.VerifyHashedPassword(user, cred.PasswordHash, currentPassword ?? "") == PasswordVerificationResult.Failed)
            throw AppException.BadRequest("wrong_password", "The current password is not correct.");
        ValidateNewPassword(newPassword, _o.MinPasswordLength);
        if (newPassword == currentPassword) throw AppException.BadRequest("same_password", "Choose a password different from the current one.");

        var now = DateTimeOffset.UtcNow;
        cred.PasswordHash = hasher.HashPassword(user, newPassword);
        cred.ChangedAt = now;
        cred.FailedCount = 0;
        cred.LockedUntil = null;
        user.MustChangePassword = false;
        await db.SaveChangesAsync(ct);

        // Every other session ends; the old token (with the "must change" mark) goes stale.
        await db.UserTokens.Where(t => t.UserId == userId && t.Type == "refresh" && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
        await bumper.BumpUsersAsync([userId], ct);
        await db.Entry(user).ReloadAsync(ct);

        await audit.WriteAsync(new AuditEntry(userId, "auth.password_changed", "user", userId.ToString(), Ip: req.Ip), ct);
        return await tokens.IssueAsync(user, req, familyId: null, ct);
    }

    public async Task<IssuedTokens> SignInExternalAsync(Guid userId, RequestInfo req, CancellationToken ct = default)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct) ?? throw AppException.NotFound("user");
        if (!user.IsActive(DateTimeOffset.UtcNow)) throw AppException.Unauthorized("account_disabled", "This account is disabled or has expired.");
        await audit.WriteAsync(new AuditEntry(user.Id, "auth.login_external", "user", user.Id.ToString(), Ip: req.Ip), ct);
        return await tokens.IssueAsync(user, req, familyId: null, ct);
    }

    public static void ValidateNewPassword(string? password, int minLength)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < minLength)
            throw AppException.BadRequest("weak_password", $"A password needs at least {minLength} characters.");
    }

    private async Task RevokeFamilyAsync(Guid? familyId, DateTimeOffset now, CancellationToken ct)
    {
        if (familyId is null) return;
        await db.UserTokens.Where(t => t.FamilyId == familyId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
    }

    private async Task TouchIdentityAsync(Guid userId, string provider, string email, DateTimeOffset now, CancellationToken ct)
    {
        var identity = await db.UserIdentities.FirstOrDefaultAsync(i => i.UserId == userId && i.Provider == provider, ct);
        if (identity is null)
            db.UserIdentities.Add(new UserIdentityRow { UserId = userId, Provider = provider, Subject = userId.ToString(), Email = email, CreatedAt = now, LastLoginAt = now });
        else
            identity.LastLoginAt = now;
    }

    private static AppException InvalidCredentials() => AppException.Unauthorized("invalid_credentials", "The email or password is not correct.");
}
