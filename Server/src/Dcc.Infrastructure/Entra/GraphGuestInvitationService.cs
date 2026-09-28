using Azure.Identity;
using Dcc.Application.Common;
using Dcc.Application.UserDirectory;
using Dcc.Domain.Audit;
using Dcc.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.Graph;
using Microsoft.Graph.Models;

namespace Dcc.Infrastructure.Entra;

/// <summary>Builds a Microsoft Graph client for the registered application (client-credentials flow).</summary>
public sealed class GraphClientFactory(IOptions<EntraOptions> options)
{
    public GraphServiceClient Create()
    {
        var o = options.Value;
        if (!o.IsConfigured) throw new InvalidOperationException("Entra is not configured.");
        var credential = new ClientSecretCredential(o.TenantId, o.ClientId, o.ClientSecret);
        return new GraphServiceClient(credential, ["https://graph.microsoft.com/.default"]);
    }
}

/// <summary>
/// Invites an outside person into the organisation's Entra ID as a B2B guest
/// (Graph <c>POST /invitations</c>) and creates their guest user here, linked
/// by object id and usually with an expiry.
/// </summary>
public sealed class GraphGuestInvitationService(
    GraphClientFactory graph,
    DccDbContext db,
    IAuditLog audit,
    IOptions<EntraOptions> options) : IGuestInvitationService
{
    public bool IsConfigured => options.Value.IsConfigured;

    public async Task<GuestInvitation> InviteAsync(string email, string displayName, DateTimeOffset? expiresAt, Guid invitedBy, CancellationToken ct = default)
    {
        if (!IsConfigured) throw AppException.NotFound("Entra");
        var normalized = email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email.ToLower() == normalized, ct)) throw AppException.Conflict("email_taken", "A user with this email already exists.");

        var invitation = await graph.Create().Invitations.PostAsync(new Invitation
        {
            InvitedUserEmailAddress = normalized,
            InvitedUserDisplayName = displayName,
            InviteRedirectUrl = string.IsNullOrWhiteSpace(options.Value.GuestRedirectUrl) ? "https://myapps.microsoft.com" : options.Value.GuestRedirectUrl,
            SendInvitationMessage = true,
        }, cancellationToken: ct) ?? throw new InvalidOperationException("Graph returned no invitation.");

        var oid = invitation.InvitedUser?.Id ?? throw new InvalidOperationException("Graph returned no invited user id.");
        var now = DateTimeOffset.UtcNow;
        var user = new UserRow { Id = Guid.NewGuid(), Email = normalized, DisplayName = displayName, Kind = "guest", EntraOid = oid, ExpiresAt = expiresAt, CreatedAt = now };
        db.Users.Add(user);
        db.UserIdentities.Add(new UserIdentityRow { UserId = user.Id, Provider = "entra", Subject = oid, Email = normalized, CreatedAt = now });
        await db.SaveChangesAsync(ct);
        await audit.WriteAsync(new AuditEntry(invitedBy, "user.guest_invited", "user", user.Id.ToString(), After: new { email = normalized, displayName, expiresAt, entraOid = oid }), ct);
        return new GuestInvitation(user.Id, normalized, invitation.InviteRedeemUrl ?? "");
    }
}
