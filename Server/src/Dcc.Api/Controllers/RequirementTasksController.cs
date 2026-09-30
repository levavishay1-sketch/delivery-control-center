using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Requirements;
using Dcc.Infrastructure.Tasks;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

/// <summary>
/// A requirement's tasks: the list and the tree, proposing tasks, putting them in TFS, the requirement's own
/// run (assess, breakdown), starting to build, bug links and research work; and every client's TFS side.
/// </summary>
[ApiController]
public sealed class RequirementTasksController(RequirementService requirements, IPermissionService permissions) : ControllerBase
{
    private const string Id = "id";

    private async Task<Guid> ClientAsync(Guid workitemId, CancellationToken ct) => (await requirements.LocateAsync(workitemId, ct)).ClientId;

    [HttpGet("workitems/{id:guid}/tasks")]
    [RequirePermission(Permissions.Tasks.Read, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> List(Guid id, [FromServices] TaskService tasks, CancellationToken ct) => await tasks.TasksForAsync(await ClientAsync(id, ct), id, ct);

    [HttpPost("workitems/{id:guid}/tasks")]
    [RequirePermission(Permissions.Tasks.Edit, ScopeType.Requirement, From = Id)]
    public async Task<IActionResult> Propose(Guid id, [FromBody] JsonElement b, [FromServices] TaskService tasks, CancellationToken ct)
    {
        if (!b.Has("tasks") || b.GetProperty("tasks").ValueKind != JsonValueKind.Array || b.GetProperty("tasks").GetArrayLength() == 0)
            throw AppException.BadRequest("bad_request", "\"tasks\" needs at least one task.");
        var list = new List<TaskService.ProposedTask>();
        foreach (var t in b.GetProperty("tasks").EnumerateArray())
        {
            var appetite = t.Str("appetite");
            if (appetite is not null && !TaskService.Appetites.Contains(appetite)) throw AppException.BadRequest("bad_request", "\"appetite\" must be small, standard or large.");
            var acceptance = t.Has("acceptance") && t.GetProperty("acceptance").ValueKind == JsonValueKind.Array ? JsonNode.Parse(t.GetProperty("acceptance").GetRawText())!.AsArray() : [];
            var deps = t.Has("dependsOn") && t.GetProperty("dependsOn").ValueKind == JsonValueKind.Array ? t.GetProperty("dependsOn").EnumerateArray().Select(x => x.GetInt32()).ToList() : null;
            list.Add(new TaskService.ProposedTask(t.Required("intent", 0), acceptance, appetite, deps, t.Str("dependencyReason")));
        }
        return StatusCode(201, await tasks.ProposeAsync(await ClientAsync(id, ct), id, User.UserId(), list, b.Str("openspecChangeId"), ct));
    }

    /// <summary>The proposed/approved tree with its dependency edges — each card with its status, each folded check with its own.</summary>
    [HttpGet("workitems/{id:guid}/task-flow")]
    [RequirePermission(Permissions.Tasks.Read, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> TaskFlow(Guid id, [FromServices] TaskTreeService tree, CancellationToken ct) => await tree.FlowForAsync(await ClientAsync(id, ct), id, ct);

    [HttpPost("workitems/{id:guid}/materialize")]
    [RequirePermission(Permissions.Tasks.Edit, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> Materialize(Guid id, [FromServices] TaskAdoSync ado, CancellationToken ct) => await ado.MaterializeAsync(await ClientAsync(id, ct), id, User.UserId(), ct);

    /// <summary>"I'm ready to build this": a stable key, the move to building, the branch and the repositories.</summary>
    [HttpPost("workitems/{id:guid}/start")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> Start(Guid id, [FromServices] TaskTreeService tree, CancellationToken ct) =>
        (await tree.StartBuildingAsync(await ClientAsync(id, ct), id, User.UserId(), ct)).Result;

    // ── the requirement's own run (assess / breakdown) ───────────────

    /// <summary>The latest run for a requirement — the full transcript, live or finished.</summary>
    [HttpGet("workitems/{id:guid}/flow-run")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> FlowRun(Guid id, [FromServices] FlowRunService flows, CancellationToken ct) =>
        await flows.RequirementViewAsync(id, ct) ?? FlowRunService.IdleView();

    /// <summary>Stop the run live for this requirement — found by requirement, never by a run id the caller sends.</summary>
    [HttpPost("workitems/{id:guid}/flow-run/stop")]
    [RequirePermission(Permissions.Tasks.RunAi, ScopeType.Requirement, From = Id)]
    public async Task<object> StopFlowRun(Guid id, [FromServices] FlowRunService flows, CancellationToken ct) =>
        new { stopped = await flows.StopForRequirementAsync(id, ct) ?? false };

    [HttpPost("workitems/{id:guid}/flow-run/message")]
    [RequirePermission(Permissions.Tasks.RunAi, ScopeType.Requirement, From = Id)]
    public async Task<object> MessageFlowRun(Guid id, [FromBody] JsonElement b, [FromServices] FlowRunService flows, CancellationToken ct)
    {
        var text = b.Str("text")?.Trim();
        if (string.IsNullOrEmpty(text)) throw AppException.BadRequest("bad_request", "missing text");
        return new { sent = await flows.MessageForRequirementAsync(id, text, ct) ?? false };
    }

    // ── bugs linked to tasks ─────────────────────────────────────────

    [HttpGet("workitems/{id:guid}/bug-links")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = Id)]
    public async Task<object> BugLinks(Guid id, [FromServices] TaskService tasks, CancellationToken ct) =>
        new { tasks = await tasks.BugLinkedTasksAsync(await ClientAsync(id, ct), id, ct) };

    [HttpPost("workitems/{id:guid}/bug-links")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> LinkBug(Guid id, [FromBody] JsonElement b, [FromServices] TaskService tasks, CancellationToken ct) =>
        await tasks.LinkBugAsync(await ClientAsync(id, ct), id, b.Uuid("taskId") ?? throw AppException.BadRequest("bad_request", "\"taskId\" is required."), ct);

    [HttpDelete("workitems/{id:guid}/bug-links/{taskId:guid}")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> UnlinkBug(Guid id, Guid taskId, [FromServices] TaskService tasks, CancellationToken ct) =>
        await tasks.UnlinkBugAsync(await ClientAsync(id, ct), id, taskId, ct);

    /// <summary>Search a client's tasks — the bug-link picker.</summary>
    [HttpGet("clients/{id:guid}/tasks")]
    [RequirePermission(Permissions.Tasks.Read, ScopeType.Client, From = Id)]
    public async Task<object> Search(Guid id, [FromQuery] string? q, [FromServices] TaskService tasks, CancellationToken ct) =>
        new { tasks = await tasks.SearchAsync(id, q, ct) };

    // ── research and testing requirements ────────────────────────────

    [HttpPost("workitems/{id:guid}/research/start")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> StartResearch(Guid id, [FromServices] TaskService tasks, CancellationToken ct) =>
        await tasks.StartResearchAsync(await ClientAsync(id, ct), id, User.UserId(), ct);

    [HttpPost("workitems/{id:guid}/research/finish")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> FinishResearch(Guid id, [FromBody] JsonElement b, [FromServices] TaskService tasks, CancellationToken ct) =>
        await tasks.FinishResearchAsync(await ClientAsync(id, ct), id, User.UserId(), b.Str("conclusion") ?? throw AppException.BadRequest("bad_request", "\"conclusion\" is required."), ct);

    // ── the TFS side of every client ─────────────────────────────────

    /// <summary>The org-wide TFS mirror — every client's task hierarchy the person may read.</summary>
    [HttpGet("ado-tasks")]
    public async Task<JsonObject> AllAdoTasks([FromServices] TaskTreeService tree, CancellationToken ct) =>
        await tree.AllAsync(await permissions.ClientsWithAsync(User.UserId(), Permissions.Tasks.Read, ct), ct);

    [HttpGet("clients/{id:guid}/ado-tasks")]
    [RequirePermission(Permissions.Tasks.Read, ScopeType.Client, From = Id)]
    public Task<JsonObject> ClientAdoTasks(Guid id, [FromServices] TaskTreeService tree, CancellationToken ct) => tree.ClientTreeAsync(id, ct);
}
