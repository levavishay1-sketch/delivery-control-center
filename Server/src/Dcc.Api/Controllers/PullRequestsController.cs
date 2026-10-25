using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.PullRequests;
using Dcc.Infrastructure.Repos;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

/// <summary>
/// The pull-request centre: every open request DCC can see, one request, a file before and after, a review, a merge,
/// deciding a conflict, and a repository's branches. Routes and JSON as the old server. A person sees the requests of
/// the repositories their clients own or have linked; acting on a request needs no more than seeing it (as the old
/// server), except checking a conflict decision, which runs the repository's own scripts on this machine.
/// </summary>
[ApiController]
public sealed class PullRequestsController(PullRequestService prs, IPermissionService permissions) : ControllerBase
{
    private async Task<HashSet<Guid>?> VisibleAsync(string permission, CancellationToken ct) =>
        await prs.VisibleReposAsync(await permissions.ClientsWithAsync(User.UserId(), permission, ct), ct);

    /// <summary>A repository's requests are a person's to see (or act on) when the permission covers its client — or a client it is linked to.</summary>
    private async Task EnsureAsync(Guid repoId, string permission, CancellationToken ct)
    {
        await prs.RepoAsync(repoId, ct);
        if (await VisibleAsync(permission, ct) is { } visible && !visible.Contains(repoId))
            throw AppException.Forbidden("forbidden", "You do not have permission for this.");
    }

    [HttpGet("pull-requests")]
    public async Task<PullRequestList> List([FromQuery] string? refresh, CancellationToken ct) =>
        await prs.ListAsync(await VisibleAsync(Permissions.PullRequests.Read, ct), refresh == "1", ct);

    [HttpGet("repos/{id:guid}/pull-requests/{number:int}/quick")]
    public async Task<PullRequestQuick> Quick(Guid id, int number, CancellationToken ct)
    {
        await EnsureAsync(id, Permissions.PullRequests.Read, ct);
        return await prs.QuickAsync(id, number, ct);
    }

    [HttpGet("repos/{id:guid}/pull-requests/{number:int}")]
    public async Task<PullRequestDetail> Detail(Guid id, int number, [FromQuery] string? refresh, CancellationToken ct)
    {
        await EnsureAsync(id, Permissions.PullRequests.Read, ct);
        return await prs.DetailAsync(id, number, refresh == "1", ct);
    }

    [HttpGet("repos/{id:guid}/pull-requests/{number:int}/file")]
    public async Task<JsonObject> File(Guid id, int number, [FromQuery] string? path, CancellationToken ct)
    {
        await EnsureAsync(id, Permissions.PullRequests.Read, ct);
        if (string.IsNullOrEmpty(path)) throw AppException.BadRequest("bad_request", "\"path\" is required.");
        return await prs.FileAsync(id, number, path, ct);
    }

    /// <summary>A review written in DCC, sent to the host as the operator's account and recorded under the person.</summary>
    [HttpPost("repos/{id:guid}/pull-requests/{number:int}/review")]
    public async Task<JsonObject> Review(Guid id, int number, [FromBody] JsonElement body, CancellationToken ct)
    {
        await EnsureAsync(id, Permissions.PullRequests.Read, ct);
        var decision = body.Required("decision");
        if (decision is not ("comment" or "approve" or "request_changes")) throw AppException.BadRequest("bad_request", "\"decision\" must be comment, approve or request_changes.");
        var text = body.Str("text") ?? "";
        if (text.Length > 4000) throw AppException.BadRequest("bad_request", "\"text\" is longer than 4000 characters.");
        return await prs.ReviewAsync(id, number, decision, text, User.UserId(), ct);
    }

    /// <summary>What the two sides wrote in each conflicting file, for a person to decide between.</summary>
    [HttpGet("repos/{id:guid}/pull-requests/{number:int}/conflict")]
    public async Task<ConflictContent> Conflict(Guid id, int number, [FromServices] ConflictService conflicts, CancellationToken ct)
    {
        await EnsureAsync(id, Permissions.PullRequests.Read, ct);
        return await conflicts.ContentAsync(id, number, ct);
    }

    /// <summary>A decision carries whole files; the old server took bodies up to 40 MB.</summary>
    private const long MaxDecisionBytes = 40_000_000;

    private static ConflictDecision Decision(JsonElement body)
    {
        if (!body.Has("files") || body.GetProperty("files").ValueKind != JsonValueKind.Array) throw AppException.BadRequest("bad_request", "\"files\" is required.");
        var files = body.GetProperty("files").EnumerateArray().Select(f => new ResolvedFile(f.Required("path"), f.Str("content") ?? throw AppException.BadRequest("bad_request", "\"content\" is required."))).ToList();
        if (files.Count is 0 or > 100) throw AppException.BadRequest("bad_request", "\"files\" needs 1 to 100 files.");
        if (files.Any(f => f.Path.Length > 400 || f.Content.Length > 2_000_000)) throw AppException.BadRequest("bad_request", "A file's path or content is too long.");
        return new ConflictDecision(files, body.Str("headSha"), body.Str("baseSha"));
    }

    /// <summary>Does the decision hold? The repository's own checks, run on the merged result on this machine — nothing is pushed.</summary>
    [HttpPost("repos/{id:guid}/pull-requests/{number:int}/conflict/verify")]
    [RequestSizeLimit(MaxDecisionBytes)]
    public async Task<VerifyResult> Verify(Guid id, int number, [FromBody] JsonElement body, [FromServices] ConflictService conflicts, CancellationToken ct)
    {
        await EnsureAsync(id, Permissions.PullRequests.Merge, ct);
        return await conflicts.VerifyAsync(id, number, User.UserId(), Decision(body), ct);
    }

    /// <summary>The decision itself: one merge commit on the request's branch, pushed as the person. Never forced.</summary>
    [HttpPost("repos/{id:guid}/pull-requests/{number:int}/conflict/resolve")]
    [RequestSizeLimit(MaxDecisionBytes)]
    public async Task<JsonObject> Resolve(Guid id, int number, [FromBody] JsonElement body, [FromServices] ConflictService conflicts, CancellationToken ct)
    {
        await EnsureAsync(id, Permissions.PullRequests.Read, ct);
        return await conflicts.ResolveAsync(id, number, User.UserId(), Decision(body), ct);
    }

    /// <summary>The host's own merge, without an approval — a way through until each person acts as their own account.</summary>
    [HttpPost("repos/{id:guid}/pull-requests/{number:int}/merge")]
    public async Task<JsonObject> Merge(Guid id, int number, CancellationToken ct)
    {
        await EnsureAsync(id, Permissions.PullRequests.Read, ct);
        return await prs.MergeAsync(id, number, User.UserId(), ct);
    }

    /// <summary>Every branch of a repository, and what to do about each one.</summary>
    [HttpGet("repos/{id:guid}/branches")]
    public async Task<RepoBranches> Branches(Guid id, [FromQuery] string? refresh, CancellationToken ct)
    {
        await EnsureAsync(id, Permissions.PullRequests.Read, ct);
        return await prs.BranchesAsync(id, refresh == "1", ct);
    }
}
