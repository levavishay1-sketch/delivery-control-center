using Dcc.Api.Auth;
using Dcc.Application.UserDirectory;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.UserDirectory;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

[ApiController]
[Route("users")]
public sealed class UsersController(DirectoryService directory, IGuestInvitationService guests) : ControllerBase
{
    public sealed record InviteGuestRequest(string Email, string DisplayName, DateTimeOffset? ExpiresAt);

    /// <summary>
    /// <c>{ users: [...] }</c>, as the old server answered — the web client's owner pickers
    /// read it, so any signed-in user gets id, email and name; with users.read, the full record.
    /// </summary>
    [HttpGet]
    public async Task<object> List([FromQuery] bool includeAgents, [FromServices] Dcc.Application.Auth.IPermissionService permissions, CancellationToken ct)
    {
        var users = await directory.ListUsersAsync(includeAgents, ct);
        if (await permissions.HasAsync(User.UserId(), Permissions.Users.Read, Dcc.Application.Auth.ScopeRef.Global, ct)) return new { users };
        return new { users = users.Where(u => !u.Disabled).Select(u => new { u.Id, u.Email, u.DisplayName }) };
    }

    [HttpGet("{id:guid}")]
    [RequirePermission(Permissions.Users.Read)]
    public Task<UserDto> Get(Guid id, CancellationToken ct) => directory.GetUserAsync(id, ct);

    [HttpPost]
    [RequirePermission(Permissions.Users.Manage)]
    public async Task<IActionResult> Create(CreateUserRequest req, CancellationToken ct)
    {
        var user = await directory.CreateUserAsync(req, User.UserId(), ct);
        return Created($"users/{user.Id}", user);
    }

    [HttpPatch("{id:guid}")]
    [RequirePermission(Permissions.Users.Manage)]
    public Task<UserDto> Update(Guid id, UpdateUserRequest req, CancellationToken ct) => directory.UpdateUserAsync(id, req, User.UserId(), ct);

    /// <summary>An administrator sets a password; the user must change it at next sign-in.</summary>
    [HttpPost("{id:guid}/password")]
    [RequirePermission(Permissions.Users.Manage)]
    public async Task<IActionResult> SetPassword(Guid id, SetPasswordRequest req, CancellationToken ct)
    {
        await directory.SetPasswordAsync(id, req.Password, User.UserId(), ct);
        return NoContent();
    }

    /// <summary>Invites an outside person as an Entra B2B guest. 404 until Entra is configured.</summary>
    [HttpPost("invite-guest")]
    [RequirePermission(Permissions.Users.InviteGuest)]
    public async Task<IActionResult> InviteGuest(InviteGuestRequest req, CancellationToken ct)
    {
        if (!guests.IsConfigured) return NotFound(new { error = "not_found", message = "Guest invitations need Entra to be configured." });
        return Ok(await guests.InviteAsync(req.Email, req.DisplayName, req.ExpiresAt, User.UserId(), ct));
    }
}
