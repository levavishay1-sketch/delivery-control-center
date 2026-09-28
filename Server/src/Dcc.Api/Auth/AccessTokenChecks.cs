using System.Security.Claims;
using Dcc.Infrastructure.Auth;
using Dcc.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;

namespace Dcc.Api.Auth;

/// <summary>
/// What is checked after a JWT's signature, issuer, audience and lifetime pass:
/// the user still exists and is active, and the token's perm_version is the
/// current one. A permission change raises perm_version, so an older token is
/// refused with <c>401 token_stale</c> — the web client then fetches a fresh one.
/// </summary>
public static class AccessTokenChecks
{
    public sealed record Verdict(bool Ok, string? Error);

    public static async Task<Verdict> CheckAsync(ClaimsPrincipal principal, DccDbContext db, CancellationToken ct)
    {
        if (!Guid.TryParse(principal.FindFirstValue(DccClaims.Subject), out var userId)) return new(false, "invalid_token");
        if (!int.TryParse(principal.FindFirstValue(DccClaims.PermVersion), out var pv)) return new(false, "invalid_token");

        var user = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.PermVersion, u.DisabledAt, u.ExpiresAt })
            .FirstOrDefaultAsync(ct);
        if (user is null || user.DisabledAt is not null || (user.ExpiresAt is { } exp && exp <= DateTimeOffset.UtcNow))
            return new(false, "account_disabled");
        return pv == user.PermVersion ? new(true, null) : new(false, "token_stale");
    }

    public static JwtBearerEvents Events() => new()
    {
        OnTokenValidated = async ctx =>
        {
            var db = ctx.HttpContext.RequestServices.GetRequiredService<DccDbContext>();
            var verdict = await CheckAsync(ctx.Principal!, db, ctx.HttpContext.RequestAborted);
            if (!verdict.Ok)
            {
                ctx.HttpContext.Items[AuthErrors.ItemKey] = verdict.Error;
                ctx.Fail(verdict.Error!);
            }
        },
        OnAuthenticationFailed = ctx =>
        {
            ctx.HttpContext.Items.TryAdd(AuthErrors.ItemKey, ctx.Exception is Microsoft.IdentityModel.Tokens.SecurityTokenExpiredException ? "token_expired" : "invalid_token");
            return Task.CompletedTask;
        },
        OnChallenge = async ctx =>
        {
            ctx.HandleResponse();
            await WriteUnauthorizedAsync(ctx.HttpContext);
        },
        OnForbidden = async ctx =>
        {
            ctx.Response.StatusCode = 403;
            await ctx.Response.WriteAsJsonAsync(new { error = "forbidden", message = "You do not have permission for this." });
        },
    };

    public static async Task WriteUnauthorizedAsync(HttpContext http)
    {
        if (http.Response.HasStarted) return;
        var code = http.Items[AuthErrors.ItemKey] as string ?? "unauthorized";
        http.Response.StatusCode = 401;
        await http.Response.WriteAsJsonAsync(new
        {
            error = code,
            message = code switch
            {
                "token_stale" => "Your permissions changed; refresh the session.",
                "token_expired" => "The session token expired; refresh it.",
                "account_disabled" => "This account is disabled or has expired.",
                _ => "Not signed in.",
            },
        });
    }
}

/// <summary>
/// While a user must change their password (first sign-in, or an administrator
/// set it), nothing but the auth endpoints is open to them.
/// </summary>
public sealed class PasswordChangeGate(RequestDelegate next)
{
    private static readonly string[] Open = ["/auth/change-password", "/auth/me", "/auth/logout", "/auth/refresh"];

    public async Task InvokeAsync(HttpContext http)
    {
        if (http.User.Identity?.IsAuthenticated == true &&
            http.User.FindFirstValue(DccClaims.MustChangePassword) == "true" &&
            !Open.Any(p => http.Request.Path.StartsWithSegments(p)))
        {
            http.Response.StatusCode = 403;
            await http.Response.WriteAsJsonAsync(new { error = "password_change_required", message = "Change your password before continuing." });
            return;
        }
        await next(http);
    }
}
