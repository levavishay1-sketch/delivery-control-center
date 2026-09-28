using Dcc.Application.Auth;
using Dcc.Domain.Audit;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.Auth;

/// <summary>
/// Runs on every start, after migrations:
/// <list type="number">
/// <item>syncs the permission catalog from code into <c>permission</c>;</item>
/// <item>syncs the built-in security roles (by key) and their permissions;</item>
/// <item>creates the first administrator when nobody holds Admin globally.</item>
/// </list>
/// </summary>
public sealed class CatalogSeeder(
    DccDbContext db,
    IPasswordHasher<UserRow> hasher,
    IPermissionVersionBumper bumper,
    IAuditLog audit,
    IOptions<BootstrapOptions> bootstrap,
    ILogger<CatalogSeeder> logger)
{
    public async Task SeedAsync(CancellationToken ct = default)
    {
        await SyncPermissionsAsync(ct);
        await SyncBuiltInRolesAsync(ct);
        await EnsureAdminAsync(ct);
    }

    private async Task SyncPermissionsAsync(CancellationToken ct)
    {
        var existing = await db.Permissions.ToDictionaryAsync(p => p.Code, ct);
        foreach (var def in Permissions.All)
        {
            if (existing.Remove(def.Code, out var row))
            {
                row.Area = def.Area;
                row.DescriptionKey = def.DescriptionKey;
            }
            else
            {
                db.Permissions.Add(new PermissionRow { Code = def.Code, Area = def.Area, DescriptionKey = def.DescriptionKey });
            }
        }
        // A permission removed from the code no longer exists; its grants go with it (cascade).
        db.Permissions.RemoveRange(existing.Values);
        await db.SaveChangesAsync(ct);
    }

    private async Task SyncBuiltInRolesAsync(CancellationToken ct)
    {
        foreach (var def in BuiltInSecurityRoles.All)
        {
            var role = await db.SecurityRoles.FirstOrDefaultAsync(r => r.Key == def.Key, ct);
            var scopes = def.AssignableScopes.Select(s => s.ToDb()).ToArray();
            if (role is null)
            {
                role = new SecurityRoleRow { Id = Guid.NewGuid(), Key = def.Key, Name = def.Name, Description = def.Description, IsBuiltin = true, AssignableScopes = scopes, CreatedAt = DateTimeOffset.UtcNow };
                db.SecurityRoles.Add(role);
            }
            else
            {
                role.Name = def.Name;
                role.Description = def.Description;
                role.IsBuiltin = true;
                role.AssignableScopes = scopes;
            }
            await db.SaveChangesAsync(ct);

            var current = await db.SecurityRolePermissions.Where(p => p.SecurityRoleId == role.Id).Select(p => p.PermissionCode).ToListAsync(ct);
            var wanted = def.Permissions.ToHashSet();
            if (current.ToHashSet().SetEquals(wanted)) continue;

            await db.SecurityRolePermissions.Where(p => p.SecurityRoleId == role.Id).ExecuteDeleteAsync(ct);
            db.SecurityRolePermissions.AddRange(wanted.Select(code => new SecurityRolePermissionRow { SecurityRoleId = role.Id, PermissionCode = code }));
            await db.SaveChangesAsync(ct);
            await bumper.BumpHoldersOfRoleAsync(role.Id, ct);
            logger.LogInformation("built-in security role {Role} now has {Count} permissions", def.Key, wanted.Count);
        }
    }

    private async Task EnsureAdminAsync(CancellationToken ct)
    {
        var adminRoleId = await db.SecurityRoles.Where(r => r.Key == BuiltInSecurityRoles.AdminKey).Select(r => r.Id).FirstAsync(ct);
        var someoneIsAdmin = await db.SecurityRoleAssignments.AnyAsync(a =>
            a.SecurityRoleId == adminRoleId && a.ScopeType == "global" && a.PrincipalType == "user" &&
            (a.ExpiresAt == null || a.ExpiresAt > DateTimeOffset.UtcNow), ct);
        if (someoneIsAdmin) return;

        var o = bootstrap.Value;
        var email = o.InitialAdminEmail.Trim().ToLowerInvariant();
        var now = DateTimeOffset.UtcNow;
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == email, ct);
        if (user is null)
        {
            user = new UserRow { Id = Guid.NewGuid(), Email = email, DisplayName = o.InitialAdminName, Kind = "person", CreatedAt = now };
            db.Users.Add(user);
        }
        user.MustChangePassword = true;

        // A random password, written only to a file outside git. Never logged, never printed.
        var password = DatabaseBootstrapper.RandomSecret(24);
        var cred = await db.LocalCredentials.FirstOrDefaultAsync(c => c.UserId == user.Id, ct);
        if (cred is null) db.LocalCredentials.Add(cred = new LocalCredentialRow { UserId = user.Id });
        cred.PasswordHash = hasher.HashPassword(user, password);
        cred.ChangedAt = now;
        cred.FailedCount = 0;
        cred.LockedUntil = null;

        db.SecurityRoleAssignments.Add(new SecurityRoleAssignmentRow
        {
            Id = Guid.NewGuid(), PrincipalType = "user", PrincipalId = user.Id, SecurityRoleId = adminRoleId, ScopeType = "global", GrantedAt = now,
        });
        await db.SaveChangesAsync(ct);
        await bumper.BumpUsersAsync([user.Id], ct);

        var path = Path.GetFullPath(o.InitialAdminPasswordFile);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path,
            $"email={email}\npassword={password}\n# You will be asked to change it on first sign-in. Delete this file afterwards.\n", ct);

        await audit.WriteAsync(new AuditEntry(null, "bootstrap.admin_created", "user", user.Id.ToString(), After: new { email, role = BuiltInSecurityRoles.AdminKey, scope = "global" }), ct);
        logger.LogWarning("No administrator existed: created {Email} with Admin at global scope. Its one-time password is in {Path}.", email, path);
    }
}
