using System.Security.Claims;
using Dcc.Application.Auth;
using Dcc.Infrastructure.Auth;
using Dcc.Infrastructure.Entra;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Dcc.Api.Controllers;

/// <summary>
/// Sign-in with Microsoft Entra ID (and Entra B2B guests), through the
/// Authorization Code flow with PKCE that Microsoft.Identity.Web runs on the
/// server as a confidential client. Off — every route answers 404 — until the
/// <c>Entra</c> settings are filled in.
///
/// Flow: /auth/entra/login → Microsoft → /auth/entra/callback (handled by the
/// OpenID Connect middleware) → /auth/entra/complete, which links the Entra
/// identity to an existing DCC user, sets the refresh cookie and sends the
/// browser back to the web client. No token ever appears in a URL.
/// </summary>
[ApiController]
[Route("auth/entra")]
public sealed class EntraAuthController(
    IOptions<EntraOptions> entra,
    IOptions<AuthOptions> authOptions,
    EntraIdentityLinker linker,
    IAuthService auth) : ControllerBase
{
    public const string OidcScheme = "EntraOidc";
    public const string CookieScheme = "EntraCookie";

    [AllowAnonymous]
    [HttpGet("login")]
    public IActionResult Login()
    {
        if (!entra.Value.IsConfigured) return NotFound(new { error = "not_found", message = "Entra sign-in is not configured." });
        return Challenge(new AuthenticationProperties { RedirectUri = Url.Content("~/auth/entra/complete") }, OidcScheme);
    }

    [AllowAnonymous]
    [HttpGet("complete")]
    public async Task<IActionResult> Complete(CancellationToken ct)
    {
        if (!entra.Value.IsConfigured) return NotFound(new { error = "not_found", message = "Entra sign-in is not configured." });
        var result = await HttpContext.AuthenticateAsync(CookieScheme);
        if (!result.Succeeded || result.Principal is null) return Unauthorized(new { error = "unauthorized", message = "The Microsoft sign-in did not complete." });

        var p = result.Principal;
        var oid = p.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier") ?? p.FindFirstValue("oid");
        if (oid is null) return Unauthorized(new { error = "unauthorized", message = "Microsoft did not return an object id." });
        var email = p.FindFirstValue("preferred_username") ?? p.FindFirstValue(ClaimTypes.Email) ?? p.FindFirstValue("email");

        var userId = await linker.LinkAsync(oid, email, p.FindFirstValue("name"), ct);
        var tokens = await auth.SignInExternalAsync(userId, new RequestInfo(HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString()), ct);
        await HttpContext.SignOutAsync(CookieScheme);

        var o = authOptions.Value;
        Response.Cookies.Append(o.RefreshCookieName, tokens.RefreshToken, new CookieOptions
        {
            HttpOnly = true, Secure = true, SameSite = SameSiteMode.Lax, Path = o.RefreshCookiePath, Expires = tokens.RefreshExpiresAt, IsEssential = true,
        });
        // The web client calls /auth/refresh on arrival and receives its access token in the body.
        return Redirect(entra.Value.PostLoginRedirect);
    }
}
