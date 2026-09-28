using Dcc.Api.Auth;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Dcc.Api.Controllers;

/// <summary>
/// The record of every change to identity and permissions, newest first. (<c>/audit</c> is the
/// activity log of the work itself — a different record, served by its own controller.)
/// </summary>
[ApiController]
[Route("identity-audit")]
public sealed class IdentityAuditController(DccDbContext db) : ControllerBase
{
    [HttpGet]
    [RequirePermission(Permissions.Audit.Read)]
    public async Task<IActionResult> List([FromQuery] string? targetType, [FromQuery] string? targetId, [FromQuery] int limit = 100, CancellationToken ct = default)
    {
        var q = db.AuditLog.AsNoTracking().AsQueryable();
        if (targetType is not null) q = q.Where(a => a.TargetType == targetType);
        if (targetId is not null) q = q.Where(a => a.TargetId == targetId);
        var rows = await q.OrderByDescending(a => a.At).Take(Math.Clamp(limit, 1, 500)).ToListAsync(ct);
        return Ok(rows.Select(a => new { a.Id, a.At, a.ActorUserId, a.Action, a.TargetType, a.TargetId, before = Json(a.Before), after = Json(a.After) }));
    }

    private static System.Text.Json.Nodes.JsonNode? Json(string? s) => s is null ? null : System.Text.Json.Nodes.JsonNode.Parse(s);
}
