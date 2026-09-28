using System.Security.Claims;
using Dcc.Application.Common;
using Dcc.Infrastructure.Auth;

namespace Dcc.Api.Auth;

public static class ClaimsPrincipalExtensions
{
    /// <summary>The signed-in user's id (the token's <c>sub</c>).</summary>
    public static Guid UserId(this ClaimsPrincipal user) =>
        Guid.TryParse(user.FindFirstValue(DccClaims.Subject), out var id)
            ? id
            : throw AppException.Unauthorized("unauthorized", "Not signed in.");
}
