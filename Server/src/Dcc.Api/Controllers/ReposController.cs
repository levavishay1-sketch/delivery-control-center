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

/// <summary>Repositories and which clients use them. Routes and JSON as the old server.</summary>
[ApiController]
public sealed class ReposController(ClientService clients, IPermissionService permissions) : ControllerBase
{
    [HttpGet("repos")]
    public async Task<object> List(CancellationToken ct) =>
        new { repos = await clients.ListReposAsync(await permissions.ClientsWithAsync(User.UserId(), Permissions.Repos.Read, ct), ct) };

    [HttpPatch("repos/{id:guid}")]
    public async Task<JsonObject> Update(Guid id, [FromBody] JsonElement body, CancellationToken ct)
    {
        await EnsureCanManageAsync(id, ct);
        return await clients.UpdateRepoAsync(id, new ClientService.UpdateRepoRequest(
            body.Str("name", 1), body.Str("adoRepoRef"), body.Has("adoRepoRef"), body.Str("defaultBranch"), body.Str("localPath"), body.Has("localPath")), User.UserId(), ct);
    }

    [HttpDelete("repos/{id:guid}")]
    public async Task<JsonObject> Delete(Guid id, CancellationToken ct)
    {
        await EnsureCanManageAsync(id, ct);
        return await clients.DeleteRepoAsync(id, User.UserId(), ct);
    }

    [HttpPost("clients/{id:guid}/repos")]
    [RequirePermission(Permissions.Repos.Manage, ScopeType.Client, From = "id")]
    public async Task<IActionResult> Link(Guid id, [FromBody] JsonElement body, CancellationToken ct) =>
        StatusCode(201, await clients.LinkRepoAsync(id, new ClientService.LinkRepoRequest(body.Uuid("repoId"), body.Str("name"), body.Str("gitUrl"), body.Str("adoRepoRef")), User.UserId(), ct));

    [HttpDelete("clients/{cid:guid}/repos/{repoId:guid}")]
    [RequirePermission(Permissions.Repos.Manage, ScopeType.Client, From = "cid")]
    public Task<JsonObject> Unlink(Guid cid, Guid repoId, CancellationToken ct) => clients.UnlinkRepoAsync(cid, repoId, User.UserId(), ct);

    /// <summary>A client's own repository needs repos.manage on that client; a shared one, globally.</summary>
    private async Task EnsureCanManageAsync(Guid repoId, CancellationToken ct)
    {
        var owner = await clients.RepoOwnerAsync(repoId, ct);
        var scope = owner is { } c ? new ScopeRef(ScopeType.Client, c) : ScopeRef.Global;
        if (!await permissions.HasAsync(User.UserId(), Permissions.Repos.Manage, scope, ct))
            throw AppException.Forbidden("forbidden", "You do not have permission for this.");
    }
}
