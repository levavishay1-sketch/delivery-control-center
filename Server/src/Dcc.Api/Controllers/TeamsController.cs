using Dcc.Api.Auth;
using Dcc.Application.UserDirectory;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.UserDirectory;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

[ApiController]
[Route("teams")]
public sealed class TeamsController(DirectoryService directory) : ControllerBase
{
    [HttpGet]
    [RequirePermission(Permissions.Users.Read)]
    public Task<IReadOnlyList<TeamDto>> List(CancellationToken ct) => directory.ListTeamsAsync(ct);

    [HttpPost]
    [RequirePermission(Permissions.Teams.Manage)]
    public async Task<IActionResult> Create(CreateTeamRequest req, CancellationToken ct)
    {
        var team = await directory.CreateTeamAsync(req, User.UserId(), ct);
        return Created($"teams/{team.Id}", team);
    }

    [HttpDelete("{id:guid}")]
    [RequirePermission(Permissions.Teams.Manage)]
    public async Task<IActionResult> Archive(Guid id, CancellationToken ct)
    {
        await directory.ArchiveTeamAsync(id, User.UserId(), ct);
        return NoContent();
    }

    [HttpGet("{id:guid}/members")]
    [RequirePermission(Permissions.Users.Read)]
    public Task<IReadOnlyList<TeamMemberDto>> Members(Guid id, CancellationToken ct) => directory.ListMembersAsync(id, ct);

    [HttpPut("{id:guid}/members/{userId:guid}")]
    [RequirePermission(Permissions.Teams.Manage)]
    public async Task<IActionResult> AddMember(Guid id, Guid userId, CancellationToken ct)
    {
        await directory.AddMemberAsync(id, userId, User.UserId(), ct);
        return NoContent();
    }

    [HttpDelete("{id:guid}/members/{userId:guid}")]
    [RequirePermission(Permissions.Teams.Manage)]
    public async Task<IActionResult> RemoveMember(Guid id, Guid userId, CancellationToken ct)
    {
        await directory.RemoveMemberAsync(id, userId, User.UserId(), ct);
        return NoContent();
    }
}
