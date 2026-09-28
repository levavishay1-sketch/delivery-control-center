using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Api.Auth;
using Dcc.Api.Infrastructure;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Glossary;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Policy;
using Dcc.Infrastructure.Prompts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

/// <summary>What the whole organisation shares: the prompt library, the model policy, the "i" glossary.</summary>
[ApiController]
public sealed class LibraryController(IPermissionService permissions) : ControllerBase
{
    // ── prompts ──────────────────────────────────────────────────────

    /// <summary>Every prompt DCC sends to Claude — for anyone who works with it anywhere.</summary>
    [HttpGet("prompts")]
    public async Task<object> Prompts([FromServices] PromptService prompts, CancellationToken ct)
    {
        if (!await permissions.HasAnywhereAsync(User.UserId(), Permissions.Prompts.Read, ct))
            throw AppException.Forbidden("forbidden", "You do not have permission for this.");
        return new { items = await prompts.ListAsync(ct) };
    }

    /// <summary>An edit changes the next call from that prompt, in every client — a global permission.</summary>
    [HttpPatch("prompts/{id:guid}")]
    [RequirePermission(Permissions.Prompts.Manage)]
    public Task<JsonObject> UpdatePrompt(Guid id, [FromBody] JsonElement body, [FromServices] PromptService prompts, CancellationToken ct) =>
        prompts.UpdateAsync(id, new PromptService.UpdatePromptRequest(
            body.Str("title"), body.Str("description"), body.Has("description"), body.Str("body"),
            body.Str("bodyHe"), body.Has("bodyHe"), body.Str("defaultModel"), body.Has("defaultModel")), User.UserId(), ct);

    // ── model policy ─────────────────────────────────────────────────

    [HttpGet("claude/policy")]
    [RequirePermission(Permissions.Settings.Read)]
    public Task<JsonObject> Policy([FromServices] PolicyService policy, CancellationToken ct) => policy.ViewAsync(ct);

    [HttpPut("claude/policy")]
    [RequirePermission(Permissions.Claude.Manage)]
    public Task<JsonObject> UpdatePolicy([FromBody] JsonElement body, [FromServices] PolicyService policy, CancellationToken ct) =>
        policy.UpdateAsync(body, User.UserId(), ct);

    // ── the "i" glossary ─────────────────────────────────────────────

    /// <summary>Every concept, once: the "i" reads them all from here. Open without signing in — the login screen has an "i" too.</summary>
    [AllowAnonymous]
    [HttpGet("claude/glossary")]
    public object Glossary([FromServices] GlossaryService glossary) => new { concepts = glossary.All };

    /// <summary>What one screen's chat knows about.</summary>
    [HttpGet("claude/glossary/{screen}")]
    public IActionResult ScreenGlossary(string screen, [FromServices] GlossaryService glossary) =>
        glossary.For(screen) is { } g ? Ok(g) : NotFound(new { error = "glossary" });

    // ── development only ─────────────────────────────────────────────

    /// <summary>Every work item, across clients — for wiring a Claude Code session locally. 404 outside Development.</summary>
    [HttpGet("dev/workitems")]
    [RequirePermission(Permissions.Requirements.Read)]
    public async Task<IActionResult> DevWorkitems([FromServices] IHostEnvironment env, [FromServices] DccDbContext db, CancellationToken ct)
    {
        if (!env.IsDevelopment()) return NotFound(new { error = "dev only" });
        return Ok(await SqlJson.QueryAsync(db, "select id, key, title, phase::text as \"phase\" from workitem order by created_at desc", null, ct));
    }
}
