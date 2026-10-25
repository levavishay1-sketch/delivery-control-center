using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Actions;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Requirements;
using Dcc.Infrastructure.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Dcc.Api.Controllers;

/// <summary>A requirement's AI steps — the readiness check, the breakdown, the spec reading — and what they cost.</summary>
[ApiController]
public sealed class RequirementAiController(RequirementService requirements, RequirementAiService ai, IPermissionService permissions) : ControllerBase
{
    private const string Id = "id";

    private async Task<Guid> ClientAsync(Guid id, CancellationToken ct) => (await requirements.LocateAsync(id, ct)).ClientId;

    /// <summary>The button and the chat's proposal are two doors to the same registry entry. Returns at once; the run goes on in the background.</summary>
    [HttpPost("workitems/{id:guid}/assess")]
    [RequirePermission(Permissions.Tasks.RunAi, ScopeType.Requirement, From = Id)]
    public async Task<JsonNode?> Assess(Guid id, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement b, [FromServices] ActionRegistry actions, CancellationToken ct)
    {
        var p = new JsonObject { ["promptKey"] = b.Str("promptKey"), ["customEmphasis"] = b.Str("customEmphasis"), ["model"] = b.Str("model") };
        return await actions.RunAsync("assess", p, new ActionEntity("wi", id, await ClientAsync(id, ct), id), User.UserId(), "button", ct);
    }

    [HttpGet("workitems/{id:guid}/assess-preview")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> AssessPreview(Guid id, [FromQuery] string? promptKey, [FromQuery] string? customEmphasis, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(promptKey)) throw AppException.BadRequest("bad_request", "\"promptKey\" is required.");
        return await ai.PreviewAssessAsync(await ClientAsync(id, ct), id, promptKey, customEmphasis, ct);
    }

    /// <summary>A RE-breakdown (tasks about to be replaced) records why; a first one has nothing to explain away.</summary>
    [HttpPost("workitems/{id:guid}/breakdown")]
    [RequirePermission(Permissions.Tasks.RunAi, ScopeType.Requirement, From = Id)]
    public async Task<JsonNode?> Breakdown(Guid id, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement b, [FromServices] ActionRegistry actions, CancellationToken ct)
    {
        var clientId = await ClientAsync(id, ct);
        if (b.Str("reason")?.Trim() is { Length: > 0 } reason) await requirements.RecordDecisionAsync(clientId, id, User.UserId(), "rebreakdown", reason, ct);
        return await actions.RunAsync("breakdown", [], new ActionEntity("wi", id, clientId, id), User.UserId(), "button", ct);
    }

    [HttpGet("workitems/{id:guid}/breakdown-preview")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> BreakdownPreview(Guid id, CancellationToken ct) => await ai.PreviewBreakdownAsync(await ClientAsync(id, ct), id, ct);

    /// <summary>The exact prompt the spec reading would send.</summary>
    [HttpGet("workitems/{id:guid}/spec/preview")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> SpecPreview(Guid id, CancellationToken ct) => await ai.PreviewSpecMapAsync(await ClientAsync(id, ct), id, ct);

    /// <summary>Read the spec into sections and map the tasks onto it. One Claude call; costs money.</summary>
    [HttpPost("workitems/{id:guid}/spec/map")]
    [RequirePermission(Permissions.Tasks.RunAi, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> SpecMap(Guid id, CancellationToken ct) => await ai.MapSpecAsync(await ClientAsync(id, ct), id, User.UserId(), "button", ct);

    [HttpGet("workitems/{id:guid}/cost")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> Cost(Guid id, CancellationToken ct) => await ai.CostSummaryAsync(await ClientAsync(id, ct), id, ct);

    [HttpGet("workitems/{id:guid}/cost-detail")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public async Task<object> CostDetail(Guid id, CancellationToken ct) => new { rows = await ai.CostDetailAsync(await ClientAsync(id, ct), id, ct) };

    /// <summary>The same rows the ledger shows — what the web's cost detail and the control centre both render.</summary>
    [HttpGet("workitems/{id:guid}/calls")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public async Task<object> Calls(Guid id, [FromServices] ClaudeCenter center, CancellationToken ct) =>
        new { calls = await center.ForEntityAsync(await ClientAsync(id, ct), id, null, null, ct) };

    // ── what one task implements ─────────────────────────────────────

    private async Task<Guid> TaskClientAsync(Guid taskId, string permission, [FromServices] TaskStore store, CancellationToken ct)
    {
        var loc = await store.LocateAsync(taskId, ct) ?? throw AppException.NotFound("task");
        if (!await permissions.HasAsync(User.UserId(), permission, new ScopeRef(ScopeType.Requirement, loc.WorkitemId), ct))
            throw AppException.Forbidden("forbidden", "You do not have permission for this.");
        return loc.ClientId;
    }

    [HttpGet("tasks/{id:guid}/spec")]
    public async Task<List<JsonObject>> TaskSpec(Guid id, [FromServices] TaskStore store, CancellationToken ct) =>
        await ai.SpecForTaskAsync(await TaskClientAsync(id, Permissions.Tasks.Read, store, ct), id, ct);

    [HttpPut("tasks/{id:guid}/spec")]
    public async Task<object> SetTaskSpec(Guid id, [FromBody] JsonElement b, [FromServices] TaskStore store, CancellationToken ct)
    {
        if (!b.Has("anchors") || b.GetProperty("anchors").ValueKind != JsonValueKind.Array) throw AppException.BadRequest("bad_request", "\"anchors\" is required.");
        var anchors = b.GetProperty("anchors").EnumerateArray().Select(x => x.GetString() ?? "").ToList();
        return new { linked = await ai.SetTaskSpecLinksAsync(await TaskClientAsync(id, Permissions.Tasks.Edit, store, ct), id, anchors, ct) };
    }
}
