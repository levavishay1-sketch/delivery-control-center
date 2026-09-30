using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Domain.Tasks;
using Dcc.Infrastructure.Actions;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Requirements;
using Dcc.Infrastructure.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Dcc.Api.Controllers;

/// <summary>
/// Tasks: one task's page and everything done to it — develop, check, roll back, push, approve, delete,
/// manual work. Routes and JSON as the old server. A task is guarded by its requirement's permission.
/// </summary>
[ApiController]
public sealed class TasksController(TaskStore store, IPermissionService permissions) : ControllerBase
{
    private async Task<(Guid ClientId, Guid WorkitemId)> TaskAsync(Guid taskId, string permission, CancellationToken ct)
    {
        var loc = await store.LocateAsync(taskId, ct) ?? throw AppException.NotFound("task");
        if (!await permissions.HasAsync(User.UserId(), permission, new ScopeRef(ScopeType.Requirement, loc.WorkitemId), ct))
            throw AppException.Forbidden("forbidden", "You do not have permission for this.");
        return loc;
    }

    // ── read ─────────────────────────────────────────────────────────

    /// <summary>Everything the screen decides by comes from here — it never works a fact out of its own partial data.</summary>
    [HttpGet("tasks/{id:guid}")]
    public async Task<JsonObject> Page(Guid id, [FromServices] TaskService tasks, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Read, ct);
        return await tasks.PageAsync(c, id, ct);
    }

    [HttpGet("tasks/{id:guid}/runs/{runId:guid}/log")]
    public async Task<object> RunLog(Guid id, Guid runId, [FromServices] TaskRunService runs, CancellationToken ct)
    {
        await TaskAsync(id, Permissions.Tasks.Read, ct);
        return new { lines = await runs.RunLogAsync(id, runId, ct) };
    }

    [HttpGet("tasks/{id:guid}/built-on")]
    public async Task<JsonNode?> BuiltOn(Guid id, [FromServices] TaskFacts facts, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Read, ct);
        return JsonSerializer.SerializeToNode(await facts.BuiltOnAsync(c, id, ct), TaskFacts.Json);
    }

    [HttpGet("tasks/{id:guid}/implement-preview")]
    public async Task<JsonObject> ImplementPreview(Guid id, [FromServices] TaskRunService runs, CancellationToken ct)
    {
        var (c, w) = await TaskAsync(id, Permissions.Tasks.Read, ct);
        return await runs.PreviewAsync(c, w, id, ct);
    }

    [HttpGet("tasks/{id:guid}/flow-run")]
    public async Task<JsonObject> FlowRun(Guid id, [FromServices] FlowRunService flows, CancellationToken ct)
    {
        await TaskAsync(id, Permissions.Tasks.Read, ct);
        return await flows.TaskViewAsync(id, ct) ?? FlowRunService.IdleView();
    }

    /// <summary>files: null = the branch was not found, which is not the same as a branch that changed nothing ([]).</summary>
    [HttpGet("tasks/{id:guid}/files")]
    public async Task<object> Files(Guid id, [FromServices] TaskCodeService code, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Read, ct);
        return new { files = await code.ChangedFilesAsync(c, id, ct) };
    }

    [HttpGet("tasks/{id:guid}/file")]
    public async Task<JsonObject> File(Guid id, [FromQuery] string? path, [FromServices] TaskCodeService code, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Read, ct);
        if (string.IsNullOrEmpty(path)) throw AppException.BadRequest("bad_request", "\"path\" is required.");
        return await code.FileVersionsAsync(c, id, path, ct);
    }

    [HttpGet("tasks/{id:guid}/overlaps")]
    public async Task<JsonArray> Overlaps(Guid id, [FromServices] TaskCodeService code, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Read, ct);
        return await code.OverlapsAsync(c, id, ct);
    }

    [HttpGet("tasks/{id:guid}/delete-check")]
    public async Task<JsonObject> DeleteCheck(Guid id, [FromServices] TaskRunService runs, CancellationToken ct)
    {
        var (c, w) = await TaskAsync(id, Permissions.Tasks.Read, ct);
        return await runs.PrecheckDeleteAsync(c, w, id, ct);
    }

    // ── Claude ───────────────────────────────────────────────────────

    /// <summary>Hand the task to Claude, through the same action (and approval gate) the chat's proposal uses.</summary>
    [HttpPost("tasks/{id:guid}/implement")]
    public async Task<JsonNode?> Implement(Guid id, [FromServices] ActionRegistry actions, CancellationToken ct)
    {
        var (c, w) = await TaskAsync(id, Permissions.Tasks.RunAi, ct);
        return await actions.RunAsync("implement", [], new ActionEntity("task", id, c, w), User.UserId(), "button", ct);
    }

    /// <summary>The optional end-to-end check — added to one task on request.</summary>
    [HttpPost("tasks/{id:guid}/checks/e2e")]
    public async Task<object> AddE2e(Guid id, [FromServices] TaskRunService runs, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        return new { added = await runs.EnsureStandardChecksAsync(c, id, ["e2e"], false, User.UserId(), ct) };
    }

    [HttpPost("tasks/{id:guid}/rollback")]
    public async Task<JsonObject> Rollback(Guid id, [FromServices] TaskRunService runs, CancellationToken ct)
    {
        var (c, w) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        return await runs.RollbackAsync(c, w, id, User.UserId(), ct);
    }

    /// <summary>The one deliberately manual step: the task's branch to the repository's real remote, with the git credentials already set up.</summary>
    [HttpPost("tasks/{id:guid}/push")]
    public async Task<JsonObject> Push(Guid id, [FromServices] TaskRunService runs, CancellationToken ct)
    {
        var (c, w) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        return await runs.PushAsync(c, w, id, User.UserId(), ct);
    }

    // ── approve, edit, delete ────────────────────────────────────────

    [HttpPost("tasks/{id:guid}/approve")]
    public async Task<JsonNode?> Approve(Guid id, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement b, [FromServices] ActionRegistry actions, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        var appetite = b.Str("appetite");
        if (appetite is not null && !TaskService.Appetites.Contains(appetite)) throw AppException.BadRequest("bad_request", "\"appetite\" must be small, standard or large.");
        var p = new JsonObject { ["intent"] = b.Str("intent"), ["appetite"] = appetite };
        if (b.Has("prompt")) p["prompt"] = b.Str("prompt") ?? "";
        return await actions.RunAsync("approve_task", p, new ActionEntity("task", id, c, null), User.UserId(), "button", ct);
    }

    [HttpPost("tasks/{id:guid}/reject")]
    public async Task<JsonObject> Reject(Guid id, [FromServices] TaskRunService runs, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        return await runs.RejectAsync(c, id, ct);
    }

    /// <summary>The old-shape call (wording and size) is the light edit; anything richer goes through the edit that mirrors TFS and notes the scope.</summary>
    [HttpPatch("tasks/{id:guid}")]
    public async Task<JsonObject> Edit(Guid id, [FromBody] JsonElement b, [FromServices] TaskAdoSync ado, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        var appetite = b.Str("appetite");
        if (appetite is not null && !TaskService.Appetites.Contains(appetite)) throw AppException.BadRequest("bad_request", "\"appetite\" must be small, standard or large.");
        if (!b.Has("prompt") && !b.Has("scopeChanged")) return await ado.UpdateAsync(c, id, b.Str("intent"), appetite, ct);
        return await ado.EditAsync(c, id, User.UserId(), b.Str("intent"), b.Has("prompt") ? b.Str("prompt") ?? "" : null, appetite, b.Bool("scopeChanged") ?? false, ct);
    }

    [HttpDelete("tasks/{id:guid}")]
    public async Task<JsonObject> Delete(Guid id, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement b, [FromServices] TaskRunService runs, CancellationToken ct)
    {
        var (c, w) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        return await runs.DeleteAsync(c, w, id, User.UserId(), new TaskRunService.DeleteOptions(
            b.Bool("confirmSubtree") ?? false, b.Bool("confirmAdoLinked") ?? false, b.Bool("confirmCoTouch") ?? false,
            b.Bool("rollbackImplemented") ?? false, b.Bool("confirmOrphanCode") ?? false), ct);
    }

    [HttpPost("tasks/{id:guid}/progress")]
    public async Task<JsonObject> Progress(Guid id, [FromBody] JsonElement b, [FromServices] TaskService tasks, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        var to = b.Required("to");
        if (!TaskService.States.Contains(to)) throw AppException.BadRequest("bad_request", $"\"to\" must be one of {string.Join(", ", TaskService.States)}.");
        var mode = b.Str("mode") ?? "interactive";
        if (mode is not ("delegated" or "interactive")) throw AppException.BadRequest("bad_request", "\"mode\" must be delegated or interactive.");
        return await tasks.ProgressAsync(c, id, User.UserId(), mode, to, b.Bool("overrideChecks") ?? false, b.Str("overrideReason"), b.Str("reopenReason"), ct);
    }

    [HttpPost("tasks/{id:guid}/active")]
    public async Task<JsonObject> Active(Guid id, [FromBody] JsonElement b, [FromServices] TaskService tasks, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        return await tasks.SetActiveAsync(c, id, b.Bool("active") ?? throw AppException.BadRequest("bad_request", "\"active\" is required."), User.UserId(), ct);
    }

    /// <summary>The "someone looked" trigger: is the work item Removed in TFS now? No poller exists.</summary>
    [HttpPost("tasks/{id:guid}/ado-recheck")]
    public async Task<JsonObject> AdoRecheck(Guid id, [FromServices] TaskService tasks, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        return await tasks.CheckAdoRemovedAsync(c, id, User.UserId(), ct);
    }

    // ── manual work ──────────────────────────────────────────────────

    [HttpPut("tasks/{id:guid}/manual")]
    public async Task<JsonObject> Manual(Guid id, [FromBody] JsonElement b, [FromServices] ManualWorkService manual, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        return await manual.SetManualAsync(c, id, b.Bool("manual") ?? throw AppException.BadRequest("bad_request", "\"manual\" is required."), User.UserId(), ct);
    }

    [HttpPost("tasks/{id:guid}/manual-report")]
    public async Task<JsonObject> ManualReport(Guid id, [FromBody] JsonElement b, [FromServices] ManualWorkService manual, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        if (!b.Has("summary")) throw AppException.BadRequest("bad_request", "\"summary\" is required.");
        return await manual.ReportAsync(c, id, User.UserId(), new ManualReportInput(b.Str("summary"), b.Str("customisation"), b.Str("components"), b.Str("reference")), ct);
    }

    [HttpDelete("tasks/{id:guid}/manual-report")]
    public async Task<JsonObject> CancelManualReport(Guid id, [FromServices] ManualWorkService manual, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        return await manual.CancelReportAsync(c, id, User.UserId(), ct);
    }

    /// <summary>The id is the CHECK's.</summary>
    [HttpPost("tasks/{id:guid}/manual-result")]
    public async Task<JsonObject> ManualResult(Guid id, [FromBody] JsonElement b, [FromServices] ManualWorkService manual, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        var result = b.Required("result");
        if (result is not ("passed" or "failed" or "not_run")) throw AppException.BadRequest("bad_request", "\"result\" must be passed, failed or not_run.");
        return await manual.SetCheckAsync(c, id, result, b.Str("note"), User.UserId(), ct);
    }

    /// <summary>Bring a dependency's work into the task's own branch — a conflict is an answer, not an error.</summary>
    [HttpPost("tasks/{id:guid}/merge-dependency")]
    public async Task<JsonObject> MergeDependency(Guid id, [FromBody] JsonElement b, [FromServices] TaskCodeService code, CancellationToken ct)
    {
        var (c, _) = await TaskAsync(id, Permissions.Tasks.Edit, ct);
        return await code.MergeDependencyAsync(c, id, b.Uuid("dependencyId") ?? throw AppException.BadRequest("bad_request", "\"dependencyId\" is required."), User.UserId(), ct);
    }
}
