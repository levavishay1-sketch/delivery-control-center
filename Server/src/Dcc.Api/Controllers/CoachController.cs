using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Auth;
using Dcc.Infrastructure.Onboarding;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

/// <summary>
/// The coach — what continues after an onboarding run — and opening a DCC folder on this machine. Routes and JSON as
/// the old server. A repository's coach is a person's to see with repos.read on the client that owns it, and to decide
/// on with repos.onboard there (an approval starts a run). The weekly recheck of the marketplace, run now, reaches the
/// network on every client's behalf: settings.manage. Opening a folder starts the file manager of the machine the
/// server runs on, so it works only in Development. None of the three server-side actions is ever a guest's.
/// </summary>
[ApiController]
public sealed class CoachController(CoachService coach, IPermissionService permissions) : ControllerBase
{
    private bool IsGuest => User.FindFirstValue(DccClaims.Kind) == "guest";

    private static AppException Forbidden() => AppException.Forbidden("forbidden", "You do not have permission for this.");

    /// <summary>
    /// The client that owns the repository must grant <paramref name="permission"/>. A repository no client owns — or
    /// none at all — is left to the coach, which refuses it in words (a 409, as before).
    /// </summary>
    private async Task EnsureAsync(Guid repoId, string permission, CancellationToken ct)
    {
        if (await coach.OwnerAsync(repoId, ct) is not { } owner) return;
        if (!await permissions.HasAsync(User.UserId(), permission, new ScopeRef(ScopeType.Client, owner), ct)) throw Forbidden();
    }

    /// <summary>The coach panel — new proposals are written as it is read, once each.</summary>
    [HttpGet("repos/{id:guid}/coach")]
    public async Task<JsonObject> View(Guid id, CancellationToken ct)
    {
        await EnsureAsync(id, Permissions.Repos.Read, ct);
        return await coach.ViewAsync(id, ct);
    }

    /// <summary>Approve (a coach run starts: <c>runId</c>) or decline a proposal.</summary>
    [HttpPost("repos/{id:guid}/coach/proposals/{proposalId:guid}/decide")]
    public async Task<JsonObject> Decide(Guid id, Guid proposalId, [FromBody] JsonElement body, CancellationToken ct)
    {
        if (IsGuest) throw Forbidden();
        await EnsureAsync(id, Permissions.Repos.Onboard, ct);
        var decision = body.Required("decision");
        if (decision is not ("approve" or "decline")) throw AppException.BadRequest("bad_request", "\"decision\" must be approve or decline.");
        var reason = body.Str("reason");
        if (reason is { Length: > 1000 }) throw AppException.BadRequest("bad_request", "\"reason\" is longer than 1000 characters.");
        return await coach.DecideAsync(id, proposalId, User.UserId(), decision, reason, ct);
    }

    /// <summary>Every remembered marketplace source fetched again now — only public http(s) addresses are fetched.</summary>
    [HttpPost("coach/recheck")]
    [RequirePermission(Permissions.Settings.Manage)]
    public async Task<object> Recheck(CancellationToken ct)
    {
        if (IsGuest) throw Forbidden();
        var (checkedCount, changed) = await coach.RecheckMarketplaceSourcesAsync(ct: ct);
        return new { @checked = checkedCount, changed };
    }

    /// <summary>
    /// Opens a DCC working folder in the file manager of the machine the server runs on — a shared clone or an
    /// onboarding copy, for a person who may read the repositories of the client it belongs to.
    /// </summary>
    [HttpPost("open-folder")]
    public async Task<object> OpenFolder([FromBody] JsonElement body, [FromServices] LocalFolder folders, [FromServices] IHostEnvironment env, CancellationToken ct)
    {
        if (IsGuest) throw Forbidden();
        // A file manager opens on the server's own screen: that is someone's desk only when the server is a developer's machine.
        if (!env.IsDevelopment()) throw new FolderRefused("פתיחת תיקייה זמינה רק כשהשרת רץ על מחשב הפיתוח");
        var path = body.Required("path");
        if (path.Length > 1000) throw AppException.BadRequest("bad_request", "\"path\" is longer than 1000 characters.");
        return new { opened = await folders.OpenAsync(path, User.UserId(), ct) };
    }
}
