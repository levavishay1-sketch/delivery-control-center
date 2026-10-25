using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Requirements;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

/// <summary>
/// The contention map and the Reviewer — what the skills report while a requirement is being built: the files its work
/// touches (and which other active requirements touch them), and the Reviewer's verdict. Routes and JSON as the old server.
/// </summary>
[ApiController]
public sealed class ContentionController(RequirementService requirements, ContentionService contention) : ControllerBase
{
    private const string Id = "id";

    private async Task<Guid> ClientAsync(Guid workitemId, CancellationToken ct) => (await requirements.LocateAsync(workitemId, ct)).ClientId;

    private static List<string> Strings(JsonElement body, string name)
    {
        if (!body.Has(name) || body.GetProperty(name).ValueKind != JsonValueKind.Array) return [];
        return body.GetProperty(name).EnumerateArray().Select(x => x.ValueKind == JsonValueKind.String ? x.GetString()! : throw AppException.BadRequest("bad_request", $"\"{name}\" must be a list of text.")).ToList();
    }

    [HttpPost("workitems/{id:guid}/touches")]
    [RequirePermission(Permissions.Tasks.Edit, ScopeType.Requirement, From = Id)]
    public async Task<IActionResult> Touches(Guid id, [FromBody] JsonElement body, CancellationToken ct)
    {
        var paths = Strings(body, "paths");
        if (paths.Count == 0) throw AppException.BadRequest("bad_request", "\"paths\" needs at least one path.");
        var kind = body.Str("kind") ?? "declared";
        if (kind is not ("declared" or "branch")) throw AppException.BadRequest("bad_request", "\"kind\" must be declared or branch.");
        return StatusCode(201, await contention.RecordTouchesAsync(await ClientAsync(id, ct), id, body.Required("repo"), body.Str("branch"), paths, kind, ct));
    }

    [HttpPost("workitems/{id:guid}/touches/release")]
    [RequirePermission(Permissions.Tasks.Edit, ScopeType.Requirement, From = Id)]
    public async Task<JsonObject> Release(Guid id, CancellationToken ct) => await contention.ReleaseAsync(await ClientAsync(id, ct), id, ct);

    /// <summary>A repository's paths and the active requirements touching each — :repo is the repository's name.</summary>
    [HttpGet("repos/{repo}/contention")]
    [RequirePermission(Permissions.Requirements.Read, ScopeType.Client, From = "clientId")]
    public async Task<object> Contention(string repo, [FromQuery] Guid? clientId, CancellationToken ct)
    {
        if (clientId is not { } c) throw AppException.BadRequest("bad_request", "clientId query param required");
        return new { contention = await contention.ContentionAsync(c, Uri.UnescapeDataString(repo), ct) };
    }

    /// <summary>The Reviewer's verdict — a hat worn before a person's approval, not instead of it.</summary>
    [HttpPost("workitems/{id:guid}/review")]
    [RequirePermission(Permissions.Tasks.Edit, ScopeType.Requirement, From = Id)]
    public async Task<IActionResult> Review(Guid id, [FromBody] JsonElement body, CancellationToken ct)
    {
        var verdict = body.Required("verdict");
        if (verdict is not ("pass" or "changes_requested")) throw AppException.BadRequest("bad_request", "\"verdict\" must be pass or changes_requested.");
        var findings = new List<ContentionService.Finding>();
        if (body.Has("findings") && body.GetProperty("findings").ValueKind == JsonValueKind.Array)
            foreach (var f in body.GetProperty("findings").EnumerateArray())
            {
                var severity = f.Required("severity");
                if (severity is not ("info" or "warn" or "block")) throw AppException.BadRequest("bad_request", "A finding's \"severity\" must be info, warn or block.");
                findings.Add(new ContentionService.Finding(f.Required("file", 0), f.Int("line"), severity, f.Required("note", 0)));
            }
        var row = await contention.RecordReviewAsync(await ClientAsync(id, ct), id, User.UserId(), body.Str("prRef"), verdict, findings, Strings(body, "overlapFocus"), ct);
        return StatusCode(201, row);
    }
}
