using System.Globalization;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Requirements;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

/// <summary>The dashboard, the alerts, the budgets, the activity log, and resolving a branch to its requirement. Routes and JSON as the old server.</summary>
[ApiController]
public sealed class DashboardController(DashboardService dashboard, IPermissionService permissions) : ControllerBase
{
    /// <summary>The home screen — across the clients the person may read.</summary>
    [HttpGet("dashboard")]
    public async Task<JsonObject> Dashboard(CancellationToken ct) =>
        await dashboard.DashboardAsync(User.UserId(), await permissions.ClientsWithAsync(User.UserId(), Permissions.Clients.Read, ct), ct);

    [HttpGet("list/alerts")]
    public async Task<object> Alerts(CancellationToken ct) =>
        new { alerts = await dashboard.AlertsAsync(User.UserId(), await permissions.ClientsWithAsync(User.UserId(), Permissions.Clients.Read, ct), 50, ct) };

    [HttpGet("list/budgets")]
    public async Task<object> Budgets(CancellationToken ct) =>
        new { budgets = await dashboard.BudgetsAsync(await permissions.ClientsWithAsync(User.UserId(), Permissions.Budgets.Read, ct), ct) };

    /// <summary>Every event of every client — an organisation-wide view, so it needs audit.read.</summary>
    [HttpGet("audit")]
    [RequirePermission(Permissions.Audit.Read)]
    public Task<JsonObject> Activity([FromQuery] string? actorKind, [FromQuery] string? type, [FromQuery] string? from, [FromQuery] string? to, [FromQuery] int? page, CancellationToken ct)
    {
        if (actorKind is not (null or "" or "user" or "delegated" or "system" or "agent")) throw AppException.BadRequest("bad_request", "\"actorKind\" must be user, delegated, system or agent.");
        static DateTimeOffset? Date(string? s, string name) => string.IsNullOrEmpty(s) ? null
            : DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? d : throw AppException.BadRequest("bad_request", $"\"{name}\" must be a date.");
        return dashboard.ActivityAsync(string.IsNullOrEmpty(actorKind) ? null : actorKind, string.IsNullOrEmpty(type) ? null : type, Date(from, "from"), Date(to, "to"), page ?? 1, ct);
    }

    /// <summary>The requirement a session or a git action belongs to — by its branch (WI-nnnn) or its key. 404 when nothing matches.</summary>
    [HttpGet("resolve")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Client, From = "clientId")]
    public async Task<IActionResult> Resolve([FromQuery] Guid clientId, [FromQuery] string? branch, [FromQuery] string? key, [FromServices] ITenantScope tenant, CancellationToken ct) =>
        await dashboard.ResolveAsync(tenant, clientId, branch, key, ct) is { } r ? Ok(r) : NotFound(new { error = "no match", message = "no match" });
}
