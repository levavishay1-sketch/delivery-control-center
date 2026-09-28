using Dcc.Api.Auth;
using Dcc.Application.Auth;
using Dcc.Application.UserDirectory;
using Dcc.Infrastructure.Auth;
using Dcc.Infrastructure.UserDirectory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Dcc.Api.Controllers;

/// <summary>
/// Sign-in, session refresh, sign-out and password change. The access token
/// travels in the response body (the client keeps it in memory only); the
/// refresh token only ever travels in an httpOnly cookie.
/// </summary>
[ApiController]
[Route("auth")]
public sealed class AuthController(IAuthService auth, IPermissionService permissions, DirectoryService directory, IOptions<AuthOptions> options) : ControllerBase
{
    private readonly AuthOptions _o = options.Value;

    public sealed record LoginRequest(string Email, string Password);
    public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest req, CancellationToken ct) =>
        await Respond(await auth.LoginAsync(req.Email, req.Password, Info(), ct), ct);

    [AllowAnonymous]
    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh(CancellationToken ct) =>
        await Respond(await auth.RefreshAsync(Request.Cookies[_o.RefreshCookieName] ?? "", Info(), ct), ct);

    [AllowAnonymous]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        await auth.LogoutAsync(Request.Cookies[_o.RefreshCookieName] ?? "", ct);
        Response.Cookies.Delete(_o.RefreshCookieName, CookieOptions(DateTimeOffset.UnixEpoch));
        return NoContent();
    }

    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest req, CancellationToken ct) =>
        await Respond(await auth.ChangePasswordAsync(User.UserId(), req.CurrentPassword, req.NewPassword, Info(), ct), ct);

    /// <summary>Who is signed in, and what they may do — the same permissions the token carries.</summary>
    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken ct)
    {
        var id = User.UserId();
        return Ok(new
        {
            user = await directory.GetUserAsync(id, ct),
            permissions = await permissions.ClaimForAsync(id, ct),
            mustChangePassword = User.FindFirst(DccClaims.MustChangePassword)?.Value == "true",
        });
    }

    private async Task<IActionResult> Respond(IssuedTokens t, CancellationToken ct)
    {
        Response.Cookies.Append(_o.RefreshCookieName, t.RefreshToken, CookieOptions(t.RefreshExpiresAt));
        Response.Headers.CacheControl = "no-store";
        var userId = Guid.Parse(new Microsoft.IdentityModel.JsonWebTokens.JsonWebToken(t.AccessToken).Subject);
        return Ok(new
        {
            accessToken = t.AccessToken,
            expiresAt = t.AccessExpiresAt,
            mustChangePassword = t.MustChangePassword,
            user = await directory.GetUserAsync(userId, ct),
            permissions = await permissions.ClaimForAsync(userId, ct),
        });
    }

    private CookieOptions CookieOptions(DateTimeOffset expires) => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Strict,
        Path = _o.RefreshCookiePath,
        Expires = expires,
        IsEssential = true,
    };

    private RequestInfo Info() => new(HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString());
}
