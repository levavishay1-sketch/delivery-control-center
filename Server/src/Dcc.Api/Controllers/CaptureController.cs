using System.Globalization;
using System.Text.Json;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Requirements;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

/// <summary>
/// The capture endpoint: the session-end hook (kind session), the post-tool-use hook (kind git) and the web's
/// "add note" / "correct note" (kind note) post here. Route, body and the 201 <c>{ eventId, workitemId, assigned }</c>
/// answer as the old server.
/// </summary>
[ApiController]
public sealed class CaptureController(CaptureService capture, IPermissionService permissions) : ControllerBase
{
    /// <summary>
    /// The scope is in the body, so the permission is checked here rather than by <see cref="RequirePermissionAttribute"/> —
    /// with its answers: 404 when the client or requirement does not exist, 403 otherwise. Session and git activity
    /// need requirements.read where they land (the requirement, else the client's inbox): anyone who may see the
    /// work may log their own part of it. A note is content, so it needs requirements.edit there.
    /// </summary>
    [HttpPost("events")]
    public async Task<IActionResult> Record([FromBody] JsonElement b, CancellationToken ct)
    {
        var kind = b.Str("kind");
        if (kind is not ("session" or "git" or "note")) throw AppException.BadRequest("bad_request", "\"kind\" must be session, git or note.");
        var workitemId = b.Uuid("workitemId");
        var workitemKey = b.Str("workitemKey") is { Length: > 0 } k ? k : null; // the old check was truthiness: "" named nothing
        var clientId = b.Uuid("clientId");
        var branch = b.Str("branch"); // a detached HEAD sends null: the same as no branch
        var occurredAt = OccurredAt(b);
        var session = kind == "session" && b.Obj("session") is { } s ? ParseSession(s) : null;
        var git = kind == "git" && b.Obj("git") is { } g ? ParseGit(g) : null;
        var note = kind == "note" && b.Obj("note") is { } n ? ParseNote(n) : null;

        // Who may write it: a session or git activity is the caller's own part of work they may see; a note is content.
        var permission = kind == "note" ? Permissions.Requirements.Edit : Permissions.Requirements.Read;

        // No confident match ⇒ unassigned (the client's inbox), never guessed.
        CaptureService.Target? target;
        try
        {
            target = await capture.ResolveAsync(workitemId, workitemKey, clientId, branch, ct);
        }
        catch (AppException e) when (e.Status == 404 && workitemId is null && clientId is { } keyClient)
        {
            // Keys are guessable (WI-1284), so "no such key" is told only to someone who may write into the client: anyone
            // else gets the very refusal a key that IS there gets — the wall never answers "is WI-1284 in there?".
            if (await DeniedAsync(permission, new ScopeRef(ScopeType.Client, keyClient), ct) is { } denied) return denied;
            throw;
        }
        if (target is null) return Error(422, "cannot determine client; pass clientId or a resolvable workitem");

        // Before the missing-body answers, so a caller outside the wall learns nothing from which refusal comes back.
        var scope = target.WorkitemId is { } w ? new ScopeRef(ScopeType.Requirement, w) : new ScopeRef(ScopeType.Client, target.ClientId);
        if (await DeniedAsync(permission, scope, ct) is { } refused) return refused;

        if (kind == "session" && session is null) return Error(400, "session body required");
        if (kind == "git" && git is null) return Error(400, "git body required");
        if (kind == "note" && note is null) return Error(400, "note body required");

        var who = await capture.WhoAsync(User.UserId(), ct);
        var ev = kind switch
        {
            "session" => await capture.RecordSessionAsync(target, who, session!, occurredAt, ct),
            "git" => await capture.RecordGitAsync(target, who, git!, occurredAt, ct),
            _ => await capture.RecordNoteAsync(target, who, note!, occurredAt, ct),
        };
        return StatusCode(201, new { eventId = ev.Id, workitemId = target.WorkitemId, assigned = target.WorkitemId is not null });
    }

    /// <summary>null when the caller holds <paramref name="permission"/> on <paramref name="scope"/>; else the refusal <see cref="RequirePermissionAttribute"/> gives.</summary>
    private async Task<IActionResult?> DeniedAsync(string permission, ScopeRef scope, CancellationToken ct)
    {
        if (await permissions.HasAsync(User.UserId(), permission, scope, ct)) return null;
        return await permissions.ScopeExistsAsync(scope, ct)
            ? StatusCode(403, new { error = "forbidden", message = "You do not have permission for this.", permission })
            : NotFound(new { error = "not_found", message = $"{(scope.Type == ScopeType.Client ? "client" : "workitem")} not found" });
    }

    /// <summary>The old refusals carried their sentence as <c>error</c>; <c>message</c> repeats it in the shape every other answer has.</summary>
    private ObjectResult Error(int status, string sentence) => StatusCode(status, new { error = sentence, message = sentence });

    private static CaptureService.Session ParseSession(JsonElement s) => new(
        s.Required("sessionId"), s.Str("transcriptPath"), s.Required("summary", 0), s.Str("model"),
        s.Int("tokensIn"), s.Int("tokensOut"), Number(s, "costUsd"));

    private static CaptureService.Git ParseGit(JsonElement g)
    {
        var kind = g.Required("kind");
        if (!CaptureService.GitKinds.Contains(kind)) throw AppException.BadRequest("bad_request", "\"git.kind\" must be commit, push, branch_created or pull_request.");
        return new(g.Required("repo", 0), g.Required("branch", 0), kind, g.Int("count"), g.Int("prNumber"), Strings(g, "shas"));
    }

    private static CaptureService.Note ParseNote(JsonElement n)
    {
        var source = n.Str("source") ?? "manual";
        if (!CaptureService.NoteSources.Contains(source)) throw AppException.BadRequest("bad_request", "\"note.source\" must be manual, email, slack, phone or meeting.");
        return new(n.Required("body", 0), source, n.Uuid("corrects"));
    }

    /// <summary>
    /// When it happened, as the old <c>z.coerce.date()</c> read it: a date string or epoch milliseconds. The log refuses
    /// a time more than five minutes ahead of the server's clock, so that is a 400 here rather than a database error.
    /// </summary>
    private static DateTimeOffset? OccurredAt(JsonElement b)
    {
        if (!b.Has("occurredAt") || b.GetProperty("occurredAt").ValueKind == JsonValueKind.Null) return null;
        var v = b.GetProperty("occurredAt");
        DateTimeOffset at;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var ms) && ms is >= -62135596800000 and <= 253402300799999)
            at = DateTimeOffset.FromUnixTimeMilliseconds(ms);
        else if (v.ValueKind != JsonValueKind.String || !DateTimeOffset.TryParse(v.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out at))
            throw AppException.BadRequest("bad_request", "\"occurredAt\" must be a date.");
        if (at > DateTimeOffset.UtcNow.AddMinutes(5)) throw AppException.BadRequest("bad_request", "\"occurredAt\" is in the future.");
        return at;
    }

    private static decimal? Number(JsonElement o, string name)
    {
        if (!o.Has(name) || o.GetProperty(name).ValueKind == JsonValueKind.Null) return null;
        return o.GetProperty(name) is { ValueKind: JsonValueKind.Number } v && v.TryGetDecimal(out var d)
            ? d
            : throw AppException.BadRequest("bad_request", $"\"{name}\" must be a number.");
    }

    private static List<string>? Strings(JsonElement o, string name)
    {
        if (!o.Has(name) || o.GetProperty(name).ValueKind == JsonValueKind.Null) return null;
        var v = o.GetProperty(name);
        if (v.ValueKind != JsonValueKind.Array || v.EnumerateArray().Any(x => x.ValueKind != JsonValueKind.String))
            throw AppException.BadRequest("bad_request", $"\"{name}\" must be a list of text.");
        return v.EnumerateArray().Select(x => x.GetString()!).ToList();
    }
}
