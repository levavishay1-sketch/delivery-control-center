using Dcc.Api.Auth;
using Dcc.Application.Auth;
using Dcc.Application.Common;
using Dcc.Application.UserDirectory;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.UserDirectory;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

/// <summary>AI agents, and the API tokens agents, hooks and the MCP server sign in with.</summary>
[ApiController]
public sealed class AgentsController(DirectoryService directory, IPermissionService permissions) : ControllerBase
{
    [HttpGet("agents")]
    [RequirePermission(Permissions.Users.Read)]
    public Task<IReadOnlyList<AgentDto>> List(CancellationToken ct) => directory.ListAgentsAsync(ct);

    /// <summary>A delegated agent: it acts for its owner (default: you) and never exceeds the owner's permissions.</summary>
    [HttpPost("agents")]
    [RequirePermission(Permissions.Agents.Manage)]
    public async Task<IActionResult> Create(CreateAgentRequest req, CancellationToken ct)
    {
        var agent = await directory.CreateAgentAsync(req, User.UserId(), ct);
        return Created($"agents/{agent.Id}", agent);
    }

    /// <summary>Off (403 requires_architecture_review) until the decision-02 amendment is approved.</summary>
    [HttpPost("agents/{id:guid}/make-independent")]
    [RequirePermission(Permissions.Agents.MakeIndependent)]
    public Task<AgentDto> MakeIndependent(Guid id, MakeIndependentRequest req, CancellationToken ct) =>
        directory.MakeIndependentAsync(id, req, User.UserId(), ct);

    /// <summary>Your own tokens; with users.manage, add <c>?userId=</c> to see someone else's.</summary>
    [HttpGet("tokens")]
    public async Task<IReadOnlyList<ApiTokenDto>> Tokens([FromQuery] Guid? userId, CancellationToken ct)
    {
        var me = User.UserId();
        var target = userId ?? me;
        if (target != me && !await CanManageTokensOf(me, target, ct)) throw AppException.Forbidden("forbidden", "You cannot see another user's tokens.");
        return await directory.ListTokensAsync(target, ct);
    }

    /// <summary>
    /// Creates an API token — for yourself (tokens.manage_own), or for an agent
    /// you own or sponsor, or any agent with agents.manage. The secret is shown
    /// once, here; only its hash is kept.
    /// </summary>
    [HttpPost("tokens")]
    public async Task<CreatedApiToken> CreateToken(CreateApiTokenRequest req, CancellationToken ct)
    {
        var me = User.UserId();
        var target = req.ForAgentId ?? me;
        if (target == me)
        {
            if (!await permissions.HasAsync(me, Permissions.Tokens.ManageOwn, ScopeRef.Global, ct)) throw AppException.Forbidden("forbidden", "You may not create API tokens.");
        }
        else if (!await CanManageTokensOf(me, target, ct))
        {
            throw AppException.Forbidden("forbidden", "You may create tokens only for yourself or for agents you are responsible for.");
        }
        return await directory.CreateTokenAsync(target, req.Name, req.ExpiresAt, me, ct);
    }

    [HttpDelete("tokens/{id:guid}")]
    public async Task<IActionResult> RevokeToken(Guid id, CancellationToken ct)
    {
        var me = User.UserId();
        var token = await directory.FindApiTokenAsync(id, ct);
        if (token.UserId != me && !await CanManageTokensOf(me, token.UserId, ct)) throw AppException.Forbidden("forbidden", "You cannot revoke this token.");
        await directory.RevokeTokenAsync(id, me, ct);
        return NoContent();
    }

    private async Task<bool> CanManageTokensOf(Guid me, Guid target, CancellationToken ct) =>
        await permissions.HasAsync(me, Permissions.Users.Manage, ScopeRef.Global, ct) ||
        await permissions.HasAsync(me, Permissions.Agents.Manage, ScopeRef.Global, ct) ||
        await directory.IsResponsibleForAgentAsync(me, target, ct);
}
