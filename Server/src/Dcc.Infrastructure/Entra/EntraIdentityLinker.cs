using Dcc.Application.Common;
using Dcc.Domain.Audit;
using Dcc.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Dcc.Infrastructure.Entra;

/// <summary>
/// After Entra has proved who someone is, finds the DCC user they are.
/// Nobody registers themselves: the person must already exist here — created
/// by an administrator, invited as a guest, or brought in by the directory
/// sync. The first sign-in links the Entra identity (object id) to that user.
/// </summary>
public sealed class EntraIdentityLinker(DccDbContext db, IAuditLog audit)
{
    public async Task<Guid> LinkAsync(string objectId, string? email, string? name, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var identity = await db.UserIdentities.FirstOrDefaultAsync(i => i.Provider == "entra" && i.Subject == objectId, ct);
        if (identity is not null)
        {
            identity.LastLoginAt = now;
            await db.SaveChangesAsync(ct);
            return identity.UserId;
        }

        var normalized = email?.Trim().ToLowerInvariant();
        var user = normalized is null ? null : await db.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == normalized && u.Kind != "agent", ct);
        if (user is null)
            throw AppException.Forbidden("not_provisioned", "This Microsoft account has no access to DCC yet. Ask an administrator to add you.");

        user.EntraOid ??= objectId;
        db.UserIdentities.Add(new UserIdentityRow { UserId = user.Id, Provider = "entra", Subject = objectId, Email = normalized, CreatedAt = now, LastLoginAt = now });
        await db.SaveChangesAsync(ct);
        await audit.WriteAsync(new AuditEntry(user.Id, "auth.entra_linked", "user", user.Id.ToString(), After: new { objectId, name }), ct);
        return user.Id;
    }
}
