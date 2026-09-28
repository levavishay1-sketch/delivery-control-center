using Dcc.Application.Auth;
using Dcc.Domain.Auth;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Dcc.Api.Auth;

/// <summary>
/// The server-side permission check on a controller or action. The scope comes
/// from the route (or query) value named <see cref="From"/>:
/// <code>
/// [RequirePermission(Permissions.Users.Manage)]                                   // global
/// [RequirePermission(Permissions.Clients.Read, ScopeType.Client, From = "clientId")]
/// [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = "id")]
/// </code>
/// It asks <see cref="IPermissionService"/>, which reads the database (cached
/// per perm_version) — never the token's claims, which are for display only.
/// Several attributes on one action must all pass.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public sealed class RequirePermissionAttribute(string permission, ScopeType scope = ScopeType.Global) : Attribute, IAsyncAuthorizationFilter
{
    public string Permission { get; } = permission;
    public ScopeType Scope { get; } = scope;

    /// <summary>The route or query value that holds the client / requirement id.</summary>
    public string? From { get; init; }

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        if (http.User.Identity?.IsAuthenticated != true)
        {
            context.Result = new ObjectResult(new { error = "unauthorized", message = "Not signed in." }) { StatusCode = 401 };
            return;
        }

        Guid? id = null;
        if (Scope != ScopeType.Global)
        {
            var key = From ?? throw new InvalidOperationException($"[RequirePermission({Permission})] with a {Scope} scope needs From = \"routeKey\".");
            var raw = context.RouteData.Values.TryGetValue(key, out var v) ? v?.ToString() : http.Request.Query[key].ToString();
            if (!Guid.TryParse(raw, out var parsed))
            {
                context.Result = new BadRequestObjectResult(new { error = "bad_scope", message = $"\"{key}\" must be an id." });
                return;
            }
            id = parsed;
        }

        var permissions = http.RequestServices.GetRequiredService<IPermissionService>();
        if (!await permissions.HasAsync(http.User.UserId(), Permission, new ScopeRef(Scope, id), http.RequestAborted))
            context.Result = new ObjectResult(new { error = "forbidden", message = "You do not have permission for this.", permission = Permission }) { StatusCode = 403 };
    }
}
