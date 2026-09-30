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

/// <summary>Gaps, blockers and attachments of a requirement. Routes and JSON as the old server.</summary>
[ApiController]
public sealed class GapsAndBlockersController(RequirementService requirements, IPermissionService permissions) : ControllerBase
{
    // ── gaps ─────────────────────────────────────────────────────────

    [HttpPost("workitems/{id:guid}/gaps")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = "id")]
    public async Task<IActionResult> ProposeGap(Guid id, [FromBody] JsonElement b, [FromServices] GapService gaps, CancellationToken ct)
    {
        var (_, clientId, _) = await requirements.LocateAsync(id, ct);
        if (!b.Has("blocking") || !b.Has("confidence")) throw AppException.BadRequest("bad_request", "description, blocking and confidence are required.");
        var row = await gaps.ProposeAsync(clientId, id, new GapService.ProposeRequest(b.Required("description", 0), b.Bool("blocking") ?? false,
            b.GetProperty("confidence").GetDouble(), b.Str("mode") ?? "delegated"), User.UserId(), ct);
        return StatusCode(201, row);
    }

    [HttpPost("gaps/{id:guid}/verify")]
    public async Task<JsonObject> VerifyGap(Guid id, [FromBody] JsonElement b, [FromServices] GapService gaps, CancellationToken ct)
    {
        var clientId = ClientId(b);
        await EnsureEditAsync(await gaps.RequirementOfAsync(clientId, id, ct), "gap", ct);
        return await gaps.VerifyAsync(clientId, id, b.Required("outcome"), b.Str("spunOffTitle"), b.Str("answer"), b.Uuid("ownerId"), User.UserId(), ct);
    }

    [HttpPatch("gaps/{id:guid}")]
    public async Task<JsonObject> UpdateGap(Guid id, [FromBody] JsonElement b, [FromServices] GapService gaps, CancellationToken ct)
    {
        var clientId = ClientId(b);
        await EnsureEditAsync(await gaps.RequirementOfAsync(clientId, id, ct), "gap", ct);
        return await gaps.UpdateAsync(clientId, id, b.Str("description"), b.Bool("blocking"), ct);
    }

    [HttpDelete("gaps/{id:guid}")]
    public async Task<JsonObject> DeleteGap(Guid id, [FromBody] JsonElement b, [FromServices] GapService gaps, CancellationToken ct)
    {
        var clientId = ClientId(b);
        await EnsureEditAsync(await gaps.RequirementOfAsync(clientId, id, ct), "gap", ct);
        return await gaps.DeleteAsync(clientId, id, ct);
    }

    // ── blockers ─────────────────────────────────────────────────────

    [HttpGet("clients/{clientId:guid}/blockers")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Client, From = "clientId")]
    public async Task<object> WaitingOnMe(Guid clientId, [FromServices] BlockerService blockers, CancellationToken ct) =>
        new { blockers = await blockers.WaitingOnAsync(clientId, User.UserId(), ct) };

    [HttpPost("workitems/{id:guid}/blockers")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = "id")]
    public async Task<IActionResult> RaiseBlocker(Guid id, [FromBody] JsonElement b, [FromServices] BlockerService blockers, CancellationToken ct)
    {
        var (_, clientId, _) = await requirements.LocateAsync(id, ct);
        return StatusCode(201, await blockers.RaiseAsync(clientId, id, b.Required("questionType", 0), b.Required("question", 0), b.Uuid("taskId"), User.UserId(), ct));
    }

    [HttpPost("blockers/{id:guid}/answer")]
    public async Task<JsonObject> AnswerBlocker(Guid id, [FromBody] JsonElement b, [FromServices] BlockerService blockers, CancellationToken ct)
    {
        var clientId = ClientId(b);
        await EnsureEditAsync(await blockers.RequirementOfAsync(clientId, id, ct), "blocker", ct);
        return await blockers.AnswerAsync(clientId, id, b.Required("answer", 0), User.UserId(), ct);
    }

    [HttpPatch("blockers/{id:guid}")]
    public async Task<JsonObject> UpdateBlocker(Guid id, [FromBody] JsonElement b, [FromServices] BlockerService blockers, CancellationToken ct)
    {
        var clientId = ClientId(b);
        await EnsureEditAsync(await blockers.RequirementOfAsync(clientId, id, ct), "blocker", ct);
        return await blockers.UpdateAsync(clientId, id, b.Str("question"), b.Str("questionType"), ct);
    }

    [HttpDelete("blockers/{id:guid}")]
    public async Task<JsonObject> DeleteBlocker(Guid id, [FromBody] JsonElement b, [FromServices] BlockerService blockers, CancellationToken ct)
    {
        var clientId = ClientId(b);
        await EnsureEditAsync(await blockers.RequirementOfAsync(clientId, id, ct), "blocker", ct);
        return await blockers.DeleteAsync(clientId, id, ct);
    }

    // ── attachments ──────────────────────────────────────────────────

    [HttpPost("workitems/{id:guid}/attachments")]
    [RequirePermission(Permissions.Requirements.Edit, ScopeType.Requirement, From = "id")]
    public async Task<IActionResult> Attach(Guid id, [FromBody] JsonElement b, [FromServices] AttachmentService attachments, CancellationToken ct)
    {
        var (_, clientId, _) = await requirements.LocateAsync(id, ct);
        byte[] bytes;
        try { bytes = Convert.FromBase64String(b.Required("contentBase64")); }
        catch (FormatException) { throw AppException.BadRequest("bad_request", "\"contentBase64\" is not base64."); }
        return StatusCode(201, await attachments.AddAsync(clientId, id, b.Required("name"), bytes, User.UserId(), ct));
    }

    /// <summary>DCC holds the bytes, so it hands them back — a file from TFS without them redirects there.</summary>
    [HttpGet("workitems/{id:guid}/attachments/{attId:guid}/content")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Requirement, From = "id")]
    public async Task<IActionResult> Content(Guid id, Guid attId, [FromServices] AttachmentService attachments, CancellationToken ct)
    {
        var (_, clientId, _) = await requirements.LocateAsync(id, ct);
        var row = await attachments.ContentAsync(clientId, attId, ct);
        if (row is null) return NotFound(new { error = "not_found", message = "לא נמצאה צרופה" });
        if (row.Bytes is null)
            return row.AdoUrl is not null ? Redirect(row.AdoUrl) : NotFound(new { error = "not_found", message = "הקובץ עצמו לא נשמר ב-DCC (הצרופה נמשכה מ-TFS)" });
        Response.Headers.ContentDisposition = $"attachment; filename*=UTF-8''{Uri.EscapeDataString(row.Name)}";
        return File(row.Bytes, "application/octet-stream");
    }

    private static Guid ClientId(JsonElement b) => b.Uuid("clientId") ?? throw AppException.BadRequest("bad_request", "\"clientId\" is required.");

    private async Task EnsureEditAsync(Guid? requirementId, string what, CancellationToken ct)
    {
        if (requirementId is not { } r) throw AppException.NotFound(what);
        if (!await permissions.HasAsync(User.UserId(), Permissions.Requirements.Edit, new ScopeRef(ScopeType.Requirement, r), ct))
            throw AppException.Forbidden("forbidden", "You do not have permission for this.");
    }
}
