using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Clients;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

/// <summary>A client's Azure DevOps connections. Routes and JSON as the old server; the PAT is never returned.</summary>
[ApiController]
public sealed class ConnectionsController(ConnectionService connections, IPermissionService permissions) : ControllerBase
{
    /// <summary>Connections of the clients the caller manages — for the "reuse an existing connection" picker.</summary>
    [HttpGet("connections")]
    public async Task<object> List(CancellationToken ct) =>
        new { connections = await connections.ListAsync(await permissions.ClientsWithAsync(User.UserId(), Permissions.Clients.Manage, ct), ct) };

    /// <summary>The projects a PAT can see, for the connect form. Only for someone who manages a client somewhere.</summary>
    [HttpPost("connections/ado/projects")]
    public async Task<JsonObject> Projects([FromBody] JsonElement body, CancellationToken ct)
    {
        if (!await permissions.HasAnywhereAsync(User.UserId(), Permissions.Clients.Manage, ct))
            throw AppException.Forbidden("forbidden", "You do not have permission for this.");
        return await connections.ListProjectsAsync(body.Url("orgUrl"), body.Required("pat", 10), ct);
    }

    [HttpPost("clients/{id:guid}/connections/ado")]
    [RequirePermission(Permissions.Clients.Manage, ScopeType.Client, From = "id")]
    public async Task<IActionResult> Add(Guid id, [FromBody] JsonElement body, CancellationToken ct) =>
        StatusCode(201, await connections.AddAsync(id, body.Url("orgUrl"), body.Str("project"), body.Required("pat", 10), User.UserId(), ct));

    [HttpPatch("clients/{cid:guid}/connections/{id:guid}")]
    [RequirePermission(Permissions.Clients.Manage, ScopeType.Client, From = "cid")]
    public Task<JsonObject> Update(Guid cid, Guid id, [FromBody] JsonElement body, CancellationToken ct) =>
        connections.UpdateAsync(cid, id, body.Str("orgUrl"), body.Str("project"), body.Str("pat"), User.UserId(), ct);

    [HttpPost("clients/{cid:guid}/connections/{id:guid}/check")]
    [RequirePermission(Permissions.Clients.Manage, ScopeType.Client, From = "cid")]
    public Task<JsonObject> Check(Guid cid, Guid id, CancellationToken ct) => connections.CheckAsync(cid, id, ct);

    [HttpDelete("clients/{cid:guid}/connections/{id:guid}")]
    [RequirePermission(Permissions.Clients.Manage, ScopeType.Client, From = "cid")]
    public Task<JsonObject> Delete(Guid cid, Guid id, CancellationToken ct) => connections.DeleteAsync(cid, id, User.UserId(), ct);
}
