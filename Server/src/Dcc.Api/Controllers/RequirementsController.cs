using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Requirements;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

/// <summary>Requirements (WorkItems): the lists, one requirement, its timeline, brief, flow, spec, repositories and dependencies.</summary>
[ApiController]
public sealed class RequirementsController(RequirementService requirements, IPermissionService permissions) : ControllerBase
{
    private const string Id = "id";

    [HttpGet("list/workitems")]
    public async Task<object> ListAll(CancellationToken ct) =>
        new { items = await requirements.ListAllAsync(await permissions.ClientsWithAsync(User.UserId(), Permissions.Requirements.Read, ct), ct) };

    [HttpGet("list/initiatives")]
    public async Task<object> ListInitiatives(CancellationToken ct) =>
        new { initiatives = await requirements.ListInitiativesAsync(await permissions.ClientsWithAsync(User.UserId(), Permissions.Requirements.Read, ct), ct) };

    /// <summary>A new requirement — under a parent (its client) or at the top of a client.</summary>
    [HttpPost("workitems")]
    public async Task<IActionResult> Create([FromBody] JsonElement b, CancellationToken ct)
    {
        var parentId = b.Uuid("parentId");
        var clientId = parentId is { } p ? await requirements.ClientOfAsync(p, ct) ?? throw AppException.NotFound("parent") : b.Uuid("clientId");
        if (clientId is null) throw AppException.NotFound("clientId or parentId is required");
        var scope = parentId is { } pp ? new ScopeRef(ScopeType.Requirement, pp) : new ScopeRef(ScopeType.Client, clientId);
        if (!await permissions.HasAsync(User.UserId(), Permissions.Requirements.Create, scope, ct))
            throw AppException.Forbidden("forbidden", "You do not have permission for this.");

        var budget = b.Has("budgetUsd") && b.GetProperty("budgetUsd").ValueKind == JsonValueKind.Number ? b.GetProperty("budgetUsd").GetDecimal() : (decimal?)null;
        var row = await requirements.CreateAsync(new RequirementService.CreateRequest(clientId.Value, parentId, b.Uuid("ownerId"), b.Str("key"), b.Required("title", 0),
            b.Str("type"), b.Str("requirementType"), b.Str("priority"), b.Str("risk"), b.Str("executor"), b.Int("dueInDays"), budget, b.Int("linkedAdoId"),
            b.Str("adoAreaPath")), User.UserId(), ct);
        return StatusCode(201, row);
    }

    [HttpGet("workitems/{id:guid}")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public Task<JsonObject> Detail(Guid id, CancellationToken ct) => requirements.DetailAsync(id, ct);

    [HttpPatch("workitems/{id:guid}")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = Id)]
    public Task<JsonObject> Update(Guid id, [FromBody] JsonElement b, CancellationToken ct) => requirements.UpdateAsync(id, b, User.UserId(), ct);

    [HttpDelete("workitems/{id:guid}")]
    [RequirePermission(Permissions.Requirements.Delete, ScopeType.Requirement, From = Id)]
    public Task<JsonObject> Delete(Guid id, CancellationToken ct) => requirements.DeleteAsync(id, ct);

    [HttpGet("workitems/{id:guid}/timeline")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public Task<JsonObject> Timeline(Guid id, CancellationToken ct) => requirements.TimelineAsync(id, ct);

    /// <summary>The Context Brief, as Markdown — what a SessionStart hook prints.</summary>
    [HttpGet("workitems/{id:guid}/brief")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public async Task<IActionResult> Brief(Guid id, [FromServices] BriefService brief, CancellationToken ct)
    {
        var (_, clientId, _) = await requirements.LocateAsync(id, ct);
        return Content(await brief.BriefForAsync(clientId, id, ct), "text/markdown; charset=utf-8");
    }

    [HttpGet("requirements/{id:guid}/flow")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public Task<JsonObject> Flow(Guid id, CancellationToken ct) => requirements.FlowAsync(id, ct);

    [HttpGet("workitems/{id:guid}/spec")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> Spec(Guid id, [FromServices] SpecService spec, CancellationToken ct)
    {
        var (_, clientId, _) = await requirements.LocateAsync(id, ct);
        return await spec.SpecForAsync(clientId, id, ct);
    }

    [HttpGet("clients/{clientId:guid}/inbox")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Client, From = "clientId")]
    public async Task<object> Inbox(Guid clientId, CancellationToken ct) => new { events = await requirements.InboxAsync(clientId, ct) };

    [HttpPost("workitems/{id:guid}/assign")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> Assign(Guid id, [FromBody] JsonElement b, [FromServices] Dcc.Infrastructure.Persistence.DccDbContext db, CancellationToken ct)
    {
        var ownerId = b.Uuid("ownerId");
        if (ownerId is null && b.Str("email") is { } email)
            ownerId = await Dcc.Infrastructure.Persistence.SqlJson.ScalarAsync<Guid?>(db, "select id from users where lower(email) = lower(@e)", new { e = email }, ct)
                      ?? throw AppException.NotFound("user");
        return await requirements.AssignAsync(id, ownerId ?? throw AppException.BadRequest("bad_request", "ownerId or email required"), ct);
    }

    [HttpPost("workitems/{id:guid}/ado-link")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = Id)]
    public Task<JsonObject> AdoLink(Guid id, [FromBody] JsonElement b, CancellationToken ct) =>
        requirements.AdoLinkAsync(id, b.Int("linkedAdoId") ?? throw AppException.BadRequest("bad_request", "\"linkedAdoId\" is required."), ct);

    [HttpPost("workitems/{id:guid}/repos")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = Id)]
    public async Task<IActionResult> LinkRepo(Guid id, [FromBody] JsonElement b, CancellationToken ct) =>
        StatusCode(201, await requirements.LinkRepoAsync(id, b.Uuid("repoId"), b.Str("name"), b.Str("gitUrl"), b.Str("linkKind"), User.UserId(), ct));

    [HttpDelete("workitems/{id:guid}/repos/{repoId:guid}")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = Id)]
    public Task<JsonObject> UnlinkRepo(Guid id, Guid repoId, CancellationToken ct) => requirements.UnlinkRepoAsync(id, repoId, User.UserId(), ct);

    [HttpPost("workitems/{id:guid}/depends-on")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = Id)]
    public async Task<IActionResult> DependsOn(Guid id, [FromBody] JsonElement b, CancellationToken ct)
    {
        await requirements.LinkDependencyAsync(id, b.Uuid("dependsOnWorkitemId") ?? throw AppException.BadRequest("bad_request", "\"dependsOnWorkitemId\" is required."),
            b.Str("kind"), b.Str("reason"), User.UserId(), ct);
        return StatusCode(201, new { linked = true });
    }

    [HttpDelete("workitems/{id:guid}/depends-on/{depId:guid}")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = Id)]
    public Task<JsonObject> DeleteDependency(Guid id, Guid depId, CancellationToken ct) => requirements.DeleteDependencyAsync(id, depId, ct);
}
