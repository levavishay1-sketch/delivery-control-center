using System.Security.Claims;
using System.Text.Encodings.Web;
using Dcc.Infrastructure.Auth;
using Dcc.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Dcc.Api.Auth;

/// <summary>
/// Authenticates <c>Authorization: Bearer dcc_pat_…</c> — the long-lived API
/// tokens used by agents, hooks and the MCP server. The token is looked up by
/// its SHA-256 hash; revoked, expired, or belonging to an inactive user ⇒ 401.
/// Permissions are then checked live, like any other request.
/// </summary>
public sealed class ApiTokenAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    DccDbContext db) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "ApiToken";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        const string prefix = "Bearer ";
        if (!header.StartsWith(prefix + Secrets.ApiTokenPrefix, StringComparison.Ordinal)) return AuthenticateResult.NoResult();

        var hash = Secrets.Hash(header[prefix.Length..].Trim());
        var now = DateTimeOffset.UtcNow;
        var token = await db.UserTokens.FirstOrDefaultAsync(t => t.TokenHash == hash && t.Type == "api", Context.RequestAborted);
        if (token is null || token.RevokedAt is not null || (token.ExpiresAt is { } exp && exp <= now))
            return Fail("invalid_token");

        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == token.UserId, Context.RequestAborted);
        if (user is null || !user.IsActive(now)) return Fail("account_disabled");

        // Record use, at most every five minutes, so a busy hook does not write on every call.
        if (token.LastUsedAt is null || now - token.LastUsedAt > TimeSpan.FromMinutes(5))
        {
            token.LastUsedAt = now;
            await db.SaveChangesAsync(Context.RequestAborted);
        }

        var identity = new ClaimsIdentity(
        [
            new Claim(DccClaims.Subject, user.Id.ToString()),
            new Claim(DccClaims.Email, user.Email),
            new Claim(DccClaims.Name, user.DisplayName),
            new Claim(DccClaims.Kind, user.Kind),
            new Claim(DccClaims.AuthMethod, "api_token"),
        ], SchemeName, DccClaims.Name, null);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }

    private AuthenticateResult Fail(string code)
    {
        Context.Items[AuthErrors.ItemKey] = code;
        return AuthenticateResult.Fail(code);
    }
}

/// <summary>Why authentication failed, carried to the 401 body so the client knows whether to refresh or sign in.</summary>
public static class AuthErrors
{
    public const string ItemKey = "dcc.auth_error";
}
