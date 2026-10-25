using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Onboarding;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Dcc.Api.Controllers;

/// <summary>
/// Repository onboarding as a coach (<c>openspec/changes/repository-coach</c>): seven steps, the same for every repository,
/// a different result for each. Routes and JSON as the old server. The routes carry the repository, so the permission is
/// checked here against the client that owns it: reading the run needs repos.read; every change needs repos.onboard — and
/// what runs something on this machine (a step, a model call — the interview's, a request's, the draft's scan — the
/// trial, the build, the delivery, the draft session) is never a guest's, whatever role they hold. A refusal of the engine is a 409 with a sentence for the
/// person; an unknown repository or run too, as before — never a 404.
/// </summary>
[ApiController]
public sealed class OnboardingController(OnboardingRuns runs, OnboardingStore store, IPermissionService permissions) : ControllerBase
{
    private const string RunRoute = "repos/{id:guid}/onboarding/runs/{runId:guid}";

    /// <summary>The repository (its 409s first, as the old server loaded it first), then the person's right on its client.</summary>
    private async Task EnsureAsync(Guid repoId, string permission, bool onTheMachine = false)
    {
        var repo = await store.RepoAsync(repoId, HttpContext.RequestAborted);
        var me = User.UserId();
        if (!await permissions.HasAsync(me, permission, new ScopeRef(ScopeType.Client, repo.ClientId), HttpContext.RequestAborted))
            throw AppException.Forbidden("forbidden", "You do not have permission for this.");
        if (onTheMachine && await store.IsGuestAsync(me, HttpContext.RequestAborted))
            throw AppException.Forbidden("guest_refused", "אורחים לא מפעילים דבר על המחשב של השרת — את הצעד הזה מפעיל מי שמנהל את ההטמעה");
    }

    private static Dictionary<string, string> Record(JsonElement body, string name, int maxLength)
    {
        var map = new Dictionary<string, string>();
        if (body.Obj(name) is not { } o) return map;
        foreach (var p in o.EnumerateObject())
        {
            if (p.Value.ValueKind != JsonValueKind.String) throw AppException.BadRequest("bad_request", $"\"{name}.{p.Name}\" must be text.");
            var s = p.Value.GetString()!;
            if (s.Length > maxLength) throw AppException.BadRequest("bad_request", $"\"{name}.{p.Name}\" is longer than {maxLength} characters.");
            map[p.Name] = s;
        }
        return map;
    }

    private static string? Max(JsonElement body, string name, int maxLength) =>
        body.Str(name) is { } s && s.Length > maxLength ? throw AppException.BadRequest("bad_request", $"\"{name}\" is longer than {maxLength} characters.") : body.Str(name);

    private static JsonNode? Raw(JsonElement body, string name) =>
        body.Has(name) ? JsonNode.Parse(body.GetProperty(name).GetRawText()) : null;

    // ── before a run, and the runs of a repository ─────────────────────

    [HttpGet("onboarding/steps")]
    public JsonObject StepCatalogue() => runs.StepCatalogue();

    [HttpPost("repos/{id:guid}/onboarding/runs")]
    public async Task<JsonObject> Start(Guid id, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement body)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard, onTheMachine: true);
        var kind = body.Str("kind");
        if (kind is not (null or "onboarding" or "coach")) throw AppException.BadRequest("bad_request", "\"kind\" must be onboarding or coach.");
        List<Guid>? proposals = null;
        if (body.Has("proposalIds") && body.GetProperty("proposalIds").ValueKind != JsonValueKind.Null)
        {
            if (body.GetProperty("proposalIds").ValueKind != JsonValueKind.Array) throw AppException.BadRequest("bad_request", "\"proposalIds\" must be a list of ids.");
            proposals = body.GetProperty("proposalIds").EnumerateArray()
                .Select(x => x.ValueKind == JsonValueKind.String && Guid.TryParse(x.GetString(), out var g) ? g : throw AppException.BadRequest("bad_request", "\"proposalIds\" must be a list of ids."))
                .ToList();
        }
        return await runs.StartAsync(id, User.UserId(), Raw(body, "automation"), kind, proposals);
    }

    /// <summary>Null (as JSON) when the repository never had a run — the repositories page asks once per repository.</summary>
    [HttpGet("repos/{id:guid}/onboarding/latest-run")]
    public async Task<IActionResult> Latest(Guid id)
    {
        await EnsureAsync(id, Permissions.Repos.Read);
        return await runs.LatestAsync(id) is { } latest ? Ok(latest) : Content("null", "application/json");
    }

    [HttpGet("repos/{id:guid}/onboarding/runs")]
    public async Task<JsonObject> List(Guid id)
    {
        await EnsureAsync(id, Permissions.Repos.Read);
        return new JsonObject { ["runs"] = await runs.ListAsync(id) };
    }

    [HttpGet(RunRoute)]
    public async Task<JsonObject> View(Guid id, Guid runId)
    {
        await EnsureAsync(id, Permissions.Repos.Read);
        return await runs.ViewAsync(id, runId);
    }

    // ── the steps ──────────────────────────────────────────────────────

    [HttpPost(RunRoute + "/steps/{stepKey}/run")]
    public async Task<JsonObject> RunStep(Guid id, Guid runId, string stepKey)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard, onTheMachine: true);
        return await runs.RunStepAsync(id, runId, stepKey, User.UserId());
    }

    [HttpPost(RunRoute + "/profile/correct")]
    public async Task<JsonObject> Correct(Guid id, Guid runId, [FromBody] JsonElement body)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard);
        var path = body.Required("path");
        if (path.Length > 200) throw AppException.BadRequest("bad_request", "\"path\" is longer than 200 characters.");
        return await runs.CorrectProfileFactAsync(id, runId, User.UserId(), path, Max(body, "note", 500), body.Bool("undo") ?? false);
    }

    [HttpPost(RunRoute + "/interview")]
    public async Task<JsonObject> Interview(Guid id, Guid runId, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement body)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard, onTheMachine: true);
        return await runs.AnswerInterviewAsync(id, runId, User.UserId(), Record(body, "answers", 200));
    }

    /// <summary>Approves the trial's declared spend: Claude works the tasks in the copy, with read-only commands, on this machine.</summary>
    [HttpPost(RunRoute + "/trial/approve")]
    public async Task<JsonObject> ApproveTrial(Guid id, Guid runId)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard, onTheMachine: true);
        return await runs.ApproveTrialAsync(id, runId, User.UserId());
    }

    // ── the cards ──────────────────────────────────────────────────────

    [HttpPost(RunRoute + "/components/{key}/decide")]
    public async Task<JsonObject> Decide(Guid id, Guid runId, string key, [FromBody] JsonElement body)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard);
        var decision = body.Required("decision");
        if (decision is not ("approve" or "decline" or "defer" or "undo")) throw AppException.BadRequest("bad_request", "\"decision\" must be approve, decline, defer or undo.");
        var answers = body.Has("answers") && body.GetProperty("answers").ValueKind != JsonValueKind.Null ? Record(body, "answers", 500) : null;
        return await runs.DecideComponentAsync(id, runId, User.UserId(), key, decision, Max(body, "reason", 1000), answers);
    }

    [HttpPost(RunRoute + "/components/decide-set")]
    public async Task<JsonObject> DecideSet(Guid id, Guid runId, [FromBody] JsonElement body)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard);
        var decision = body.Required("decision");
        if (decision is not ("approve" or "decline")) throw AppException.BadRequest("bad_request", "\"decision\" must be approve or decline.");
        List<string>? keys = null;
        if (body.Has("keys") && body.GetProperty("keys").ValueKind != JsonValueKind.Null)
        {
            if (body.GetProperty("keys").ValueKind != JsonValueKind.Array) throw AppException.BadRequest("bad_request", "\"keys\" must be a list.");
            keys = body.GetProperty("keys").EnumerateArray()
                .Select(x => x.ValueKind == JsonValueKind.String ? x.GetString()! : throw AppException.BadRequest("bad_request", "\"keys\" must be a list of text.")).ToList();
        }
        return await runs.DecideComponentSetAsync(id, runId, User.UserId(), decision, keys, Max(body, "reason", 1000));
    }

    /// <summary>"תכין skill לתהליך X": one model call on this machine, then a card that waits for a decision like any other.</summary>
    [HttpPost(RunRoute + "/components/request")]
    public async Task<JsonObject> RequestComponent(Guid id, Guid runId, [FromBody] JsonElement body)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard, onTheMachine: true);
        var text = body.Required("text");
        if (text.Length > 2000) throw AppException.BadRequest("bad_request", "\"text\" is longer than 2000 characters.");
        return await runs.RequestComponentAsync(id, runId, User.UserId(), text);
    }

    // ── the /init draft, the build, the delivery ───────────────────────

    /// <summary>The editor reads the copy with Claude Code on this machine, for minutes, against the draft.</summary>
    [HttpPost(RunRoute + "/draft/scan")]
    public async Task<JsonObject> Scan(Guid id, Guid runId)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard, onTheMachine: true);
        return await runs.ScanInitDraftAsync(id, runId, User.UserId());
    }

    /// <summary>Opens the real Claude Code in a terminal on this machine, in the copy — only while the plan waits for decisions.</summary>
    [HttpPost(RunRoute + "/draft/start")]
    public async Task<JsonObject> StartDraft(Guid id, Guid runId, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement body)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard, onTheMachine: true);
        return await runs.StartDraftSessionAsync(id, runId, User.UserId(), body.Bool("resume") ?? false, Max(body, "model", 60), Max(body, "effort", 20));
    }

    /// <summary>Builds the approved components into the copy and verifies each — hooks and the repository's own build and tests run on this machine.</summary>
    [HttpPost(RunRoute + "/build")]
    public async Task<JsonObject> Build(Guid id, Guid runId)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard, onTheMachine: true);
        return await runs.StartBuildAsync(id, runId, User.UserId());
    }

    /// <summary>Commits the approved files in the person's name, pushes the run's branch to the client's remote and opens a pull request.</summary>
    [HttpPost(RunRoute + "/deliver")]
    public async Task<JsonObject> Deliver(Guid id, Guid runId)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard, onTheMachine: true);
        return await runs.DeliverAsync(id, runId, User.UserId());
    }

    [HttpPost(RunRoute + "/cancel")]
    public async Task<JsonObject> Cancel(Guid id, Guid runId)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard);
        return await runs.CancelAsync(id, runId, User.UserId());
    }

    [HttpPatch(RunRoute + "/automation")]
    public async Task<JsonObject> SetAutomation(Guid id, Guid runId, [FromBody] JsonElement body)
    {
        await EnsureAsync(id, Permissions.Repos.Onboard);
        return await runs.UpdateAutomationAsync(id, runId, Raw(body, "automation"), User.UserId());
    }

    // ── the copy's files ───────────────────────────────────────────────

    [HttpGet(RunRoute + "/file")]
    public async Task<FileVersions> File(Guid id, Guid runId, [FromQuery] string? path)
    {
        await EnsureAsync(id, Permissions.Repos.Read);
        if (string.IsNullOrEmpty(path)) throw AppException.BadRequest("bad_request", "\"path\" is required.");
        return await runs.FileVersionsAsync(id, runId, path);
    }

    [HttpGet(RunRoute + "/files")]
    public async Task<JsonObject> Files(Guid id, Guid runId)
    {
        await EnsureAsync(id, Permissions.Repos.Read);
        return await runs.ChangedFilesAsync(id, runId);
    }
}
