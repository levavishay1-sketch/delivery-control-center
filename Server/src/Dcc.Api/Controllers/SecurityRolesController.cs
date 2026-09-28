using Dcc.Api.Auth;
using Dcc.Application.UserDirectory;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.UserDirectory;
using Microsoft.AspNetCore.Mvc;

namespace Dcc.Api.Controllers;

/// <summary>The permission catalog, security roles, and who holds which role where.</summary>
[ApiController]
public sealed class SecurityRolesController(DirectoryService directory) : ControllerBase
{
    [HttpGet("permissions")]
    [RequirePermission(Permissions.Users.Read)]
    public IReadOnlyList<PermissionDto> Catalog() => DirectoryService.PermissionCatalog();

    [HttpGet("security-roles")]
    [RequirePermission(Permissions.Users.Read)]
    public Task<IReadOnlyList<SecurityRoleDto>> List(CancellationToken ct) => directory.ListRolesAsync(ct);

    [HttpPost("security-roles")]
    [RequirePermission(Permissions.Roles.Manage)]
    public async Task<IActionResult> Create(SaveSecurityRoleRequest req, CancellationToken ct)
    {
        var role = await directory.CreateRoleAsync(req, User.UserId(), ct);
        return Created($"security-roles/{role.Id}", role);
    }

    [HttpPut("security-roles/{id:guid}")]
    [RequirePermission(Permissions.Roles.Manage)]
    public Task<SecurityRoleDto> Update(Guid id, SaveSecurityRoleRequest req, CancellationToken ct) => directory.UpdateRoleAsync(id, req, User.UserId(), ct);

    [HttpDelete("security-roles/{id:guid}")]
    [RequirePermission(Permissions.Roles.Manage)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await directory.DeleteRoleAsync(id, User.UserId(), ct);
        return NoContent();
    }

    [HttpGet("role-assignments")]
    [RequirePermission(Permissions.Users.Read)]
    public Task<IReadOnlyList<AssignmentDto>> Assignments([FromQuery] string? principalType, [FromQuery] Guid? principalId, CancellationToken ct) =>
        directory.ListAssignmentsAsync(principalType, principalId, ct);

    [HttpPost("role-assignments")]
    [RequirePermission(Permissions.Roles.Manage)]
    public async Task<IActionResult> Assign(CreateAssignmentRequest req, CancellationToken ct)
    {
        var a = await directory.CreateAssignmentAsync(req, User.UserId(), ct);
        return Created($"role-assignments/{a.Id}", a);
    }

    [HttpDelete("role-assignments/{id:guid}")]
    [RequirePermission(Permissions.Roles.Manage)]
    public async Task<IActionResult> Unassign(Guid id, CancellationToken ct)
    {
        await directory.DeleteAssignmentAsync(id, User.UserId(), ct);
        return NoContent();
    }
}
