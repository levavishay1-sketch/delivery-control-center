using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Chat;
using Dcc.Infrastructure.Claude;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Dcc.Api.Controllers;

/// <summary>
/// The one chat (a dock over every screen, a conversation per topic) and the Claude control centre: calls, costs,
/// conclusions, conversations. Routes and JSON as the old server.
/// </summary>
[ApiController]
public sealed class ClaudeController(ChatService chat, IPermissionService permissions) : ControllerBase
{
    private static readonly string[] Kinds = ["wi", "task", "pr", "run", "app", "gaps"];

    private static (string Kind, string? Id) Topic(JsonElement b)
    {
        var t = b.Obj("topic") ?? throw AppException.BadRequest("bad_request", "\"topic\" is required.");
        var kind = t.Required("kind");
        if (!Kinds.Contains(kind)) throw AppException.BadRequest("bad_request", $"\"topic.kind\" must be one of {string.Join(", ", Kinds)}.");
        var id = t.Str("id");
        if (id is { Length: > 200 }) throw AppException.BadRequest("bad_request", "\"topic.id\" is too long.");
        return (kind, id);
    }

    private static ScreenContext Context(JsonElement b)
    {
        if (b.Obj("context") is not { } c) return new ScreenContext(null, null, null, null, null);
        List<string>? Strings(string name, int max, int maxLen)
        {
            if (!c.Has(name) || c.GetProperty(name).ValueKind != JsonValueKind.Array) return null;
            var list = c.GetProperty(name).EnumerateArray().Select(x => x.GetString() ?? "").ToList();
            if (list.Count > max || list.Any(x => x.Length > maxLen)) throw AppException.BadRequest("bad_request", $"\"context.{name}\" is too long.");
            return list;
        }
        var facts = c.Obj("facts") is { } f ? JsonNode.Parse(f.GetRawText()) as JsonObject : null;
        return new ScreenContext(c.Str("screen"), facts, Strings("suggestions", 12, 200), Strings("actions", 30, 60), c.Str("place"));
    }

    /// <summary>The chat needs claude.chat somewhere, and the right to read what the topic is about.</summary>
    private async Task EnsureTopicAsync(string kind, string? id, ScreenContext ctx, CancellationToken ct)
    {
        var me = User.UserId();
        if (!await permissions.HasAnywhereAsync(me, Permissions.Claude.Chat, ct)) throw AppException.Forbidden("forbidden", "You do not have permission for this.");
        var topic = await chat.ResolveAsync(kind, id, ctx, ct);
        var allowed = topic.Kind switch
        {
            "app" => true,
            _ when topic.WorkitemId is { } w => await permissions.HasAsync(me, Permissions.Requirements.Read, new ScopeRef(ScopeType.Requirement, w), ct),
            _ => await permissions.HasAsync(me, Permissions.Clients.Read, new ScopeRef(ScopeType.Client, topic.ClientId), ct),
        };
        if (!allowed) throw AppException.Forbidden("forbidden", "You do not have permission for this.");
    }

    [HttpPost("claude/chat/open")]
    public async Task<JsonObject> Open([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement b, CancellationToken ct)
    {
        var (kind, id) = Topic(b);
        var ctx = Context(b);
        await EnsureTopicAsync(kind, id, ctx, ct);
        return await chat.OpenAsync(kind, id, User.UserId(), ctx, ct);
    }

    [HttpPost("claude/chat/ask")]
    public async Task<JsonObject> Ask([FromBody] JsonElement b, CancellationToken ct)
    {
        var (kind, id) = Topic(b);
        var ctx = Context(b);
        var question = b.Required("question");
        if (question.Length > 4000) throw AppException.BadRequest("bad_request", "\"question\" is too long.");
        await EnsureTopicAsync(kind, id, ctx, ct);
        return await chat.AskAsync(kind, id, User.UserId(), question, ctx, ct);
    }

    [HttpPost("claude/messages/{id:guid}/helpful")]
    public Task<JsonObject> Helpful(Guid id, [FromBody] JsonElement b, CancellationToken ct) =>
        chat.MarkHelpfulAsync(id, User.UserId(), b.Bool("helpful") ?? throw AppException.BadRequest("bad_request", "\"helpful\" is required."), b.Str("note"), ct);

    /// <summary>A proposal runs only from here — the person's click.</summary>
    [HttpPost("claude/proposals/{id:guid}/run")]
    public Task<JsonObject> RunProposal(Guid id, CancellationToken ct) => chat.RunProposalAsync(id, User.UserId(), ct);

    [HttpPost("claude/proposals/{id:guid}/cancel")]
    public Task<JsonObject> CancelProposal(Guid id, CancellationToken ct) => chat.CancelCardAsync(id, User.UserId(), "proposal", ct);

    [HttpGet("claude/proposals/{id:guid}/preview")]
    public Task<JsonObject> PreviewProposal(Guid id, CancellationToken ct) => chat.ProposalPreviewAsync(id, User.UserId(), ct);

    [HttpPost("claude/messages/{id:guid}/run-code")]
    public Task<JsonObject> RunCode(Guid id, CancellationToken ct) => chat.RunCodeQuestionAsync(id, User.UserId(), ct);

    [HttpPost("claude/messages/{id:guid}/run-code/cancel")]
    public Task<JsonObject> CancelCode(Guid id, CancellationToken ct) => chat.CancelCardAsync(id, User.UserId(), "declared_cost", ct);

    // ── conversations ────────────────────────────────────────────────

    [HttpGet("claude/conversations")]
    public async Task<object> Conversations([FromQuery] Guid? clientId, [FromQuery] Guid? userId, [FromQuery] int? limit, CancellationToken ct)
    {
        // Everyone sees their own; claude.manage sees everyone's, in the clients it may read.
        var manage = await permissions.HasAnywhereAsync(User.UserId(), Permissions.Claude.Manage, ct);
        var allowed = manage ? await permissions.ClientsWithAsync(User.UserId(), Permissions.Claude.Manage, ct) : null;
        return new { conversations = await chat.ListAsync(null, clientId, manage ? userId : User.UserId(), null, limit, allowed, ct) };
    }

    [HttpGet("claude/conversations/{id:guid}")]
    public async Task<IActionResult> Conversation(Guid id, CancellationToken ct)
    {
        var c = await chat.GetAsync(id, ct);
        if (c is null) return NotFound(new { error = "conversation", message = "conversation not found" });
        var mine = c["conversation"]!["createdBy"]!.GetValue<string>() == User.UserId().ToString();
        if (!mine && !await permissions.HasAsync(User.UserId(), Permissions.Claude.Manage,
                new ScopeRef(ScopeType.Client, Guid.Parse(c["conversation"]!["clientId"]!.GetValue<string>())), ct))
            return NotFound(new { error = "conversation", message = "conversation not found" });
        return Ok(c);
    }

    /// <summary>The daily retention pass, on demand — nothing expires early.</summary>
    [HttpPost("claude/retention/run")]
    [RequirePermission(Permissions.Claude.Manage)]
    public Task<JsonObject> Retention(CancellationToken ct) => chat.ArchiveExpiredAsync(ct);

    // ── the control centre ───────────────────────────────────────────

    private async Task<CenterFilter> FilterAsync(CancellationToken ct)
    {
        var q = Request.Query;
        Guid? G(string k) => Guid.TryParse(q[k], out var g) ? g : null;
        int? I(string k) => int.TryParse(q[k], out var n) ? n : null;
        string? S(string k) => q[k].ToString() is { Length: > 0 } s ? s : null;
        return new CenterFilter
        {
            Month = S("month"), ClientId = G("clientId"), UserId = G("userId"), Capability = S("capability"), Model = S("model"), Outcome = S("outcome"),
            Escalated = S("escalated") is "1" or "true", WorkitemId = G("workitemId"), Limit = I("limit"), Offset = I("offset"),
            Allowed = await permissions.ClientsWithAsync(User.UserId(), Permissions.Claude.Manage, ct),
        };
    }

    [HttpGet("claude/overview")]
    [RequirePermission(Permissions.Claude.Manage)]
    public async Task<JsonObject> Overview([FromServices] ClaudeCenter center, CancellationToken ct) => await center.OverviewAsync(await FilterAsync(ct), ct);

    [HttpGet("claude/calls")]
    [RequirePermission(Permissions.Claude.Manage)]
    public async Task<JsonObject> Calls([FromServices] ClaudeCenter center, CancellationToken ct) => await center.CallsAsync(await FilterAsync(ct), ct);

    [HttpGet("claude/calls/{id:guid}")]
    [RequirePermission(Permissions.Claude.Manage)]
    public async Task<IActionResult> Call(Guid id, [FromServices] ClaudeCenter center, CancellationToken ct) =>
        await center.CallAsync(id, ct) is { } row ? Ok(row) : NotFound(new { error = "call", message = "call not found" });

    [HttpGet("claude/insights")]
    [RequirePermission(Permissions.Claude.Manage)]
    public async Task<JsonObject> Insights([FromQuery] string? month, [FromQuery] Guid? clientId, [FromServices] InsightsService insights, CancellationToken ct) =>
        await insights.ViewAsync(month, clientId, await permissions.ClientsWithAsync(User.UserId(), Permissions.Claude.Manage, ct), ct);

    /// <summary>The analysis is a named action: one recorded usage_insights call, on a click, never in the background.</summary>
    [HttpPost("claude/insights/analyse")]
    [RequirePermission(Permissions.Claude.Manage)]
    public async Task<JsonObject> Analyse([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement b, [FromServices] InsightsService insights, CancellationToken ct) =>
        await insights.AnalyseAsync(b.Str("month"), b.Uuid("clientId"), User.UserId(), await permissions.ClientsWithAsync(User.UserId(), Permissions.Claude.Manage, ct), ct);

    [HttpPost("claude/insights/{id:guid}/task")]
    [RequirePermission(Permissions.Claude.Manage)]
    public async Task<IActionResult> InsightTask(Guid id, [FromServices] InsightsService insights, CancellationToken ct)
    {
        var (result, created) = await insights.OpenTaskAsync(id, User.UserId(), ct);
        return StatusCode(created ? 201 : 200, result);
    }

    [HttpPost("claude/insights/{id:guid}/dismiss")]
    [RequirePermission(Permissions.Claude.Manage)]
    public Task<JsonObject> Dismiss(Guid id, [FromServices] InsightsService insights, CancellationToken ct) => insights.DismissAsync(id, ct);
}
