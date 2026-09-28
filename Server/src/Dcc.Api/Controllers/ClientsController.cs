using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Clients;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

/// <summary>Clients: the list, one client's page, onboarding, editing and deleting. Routes and JSON as the old server.</summary>
[ApiController]
public sealed class ClientsController(ClientService clients, IPermissionService permissions) : ControllerBase
{
    [AllowAnonymous]
    [HttpGet("health")]
    public object Health() => new { ok = true };

    /// <summary>The clients the caller may see.</summary>
    [HttpGet("clients")]
    public async Task<object> List(CancellationToken ct) =>
        new { clients = await clients.ListClientsAsync(await permissions.ClientsWithAsync(User.UserId(), Permissions.Clients.Read, ct), ct) };

    [HttpGet("clients/{id:guid}")]
    [RequirePermission(Permissions.Clients.Read, ScopeType.Client, From = "id")]
    public Task<JsonObject> Detail(Guid id, CancellationToken ct) => clients.ClientDetailAsync(id, ct);

    [HttpPatch("clients/{id:guid}")]
    [RequirePermission(Permissions.Clients.Manage, ScopeType.Client, From = "id")]
    public Task<JsonObject> Update(Guid id, [FromBody] JsonElement body, CancellationToken ct) =>
        clients.UpdateClientAsync(id, new ClientService.UpdateClientRequest(
            body.Str("name", 1), body.Str("connectorType"), body.Str("adoProjectRef"), body.Has("adoProjectRef")), User.UserId(), ct);

    /// <summary>Deleting a client removes it for everyone — a global permission, not a per-client one.</summary>
    [HttpDelete("clients/{id:guid}")]
    [RequirePermission(Permissions.Clients.Manage)]
    public Task<JsonObject> Delete(Guid id, CancellationToken ct) => clients.DeleteClientAsync(id, User.UserId(), ct);

    [HttpPost("admin/setup-client")]
    [RequirePermission(Permissions.Clients.Manage)]
    public async Task<IActionResult> Setup([FromBody] JsonElement body, CancellationToken ct)
    {
        var repo = body.Obj("repo") is { } r
            ? new ClientService.SetupRepo(r.Required("name"), r.Str("gitUrl"), r.Str("adoRepoRef"), r.Bool("orgShared"))
            : null;
        var first = body.Obj("firstRequirement") is { } f
            ? new ClientService.SetupRequirement(f.Str("key"), f.Required("title"), f.Str("type"), f.Str("priority"), f.Str("risk"), f.Str("executor"), f.Int("dueInDays"))
            : null;
        var result = await clients.SetupClientAsync(new ClientService.SetupClientRequest(body.Required("clientName", 0), repo, first), User.UserId(), ct);
        return StatusCode(201, result);
    }

    /// <summary>A client's own chat retention; null returns it to the policy's default.</summary>
    [HttpPut("clients/{id:guid}/claude-retention")]
    [RequirePermission(Permissions.Claude.Manage)]
    public Task<JsonObject> Retention(Guid id, [FromBody] JsonElement body, [FromServices] Dcc.Infrastructure.Policy.PolicyService policy, CancellationToken ct)
    {
        if (!body.Has("days")) throw AppException.BadRequest("bad_request", "\"days\" is required (a number, or null for the default).");
        return policy.SetClientRetentionAsync(id, body.Int("days"), User.UserId(), ct);
    }
}
