namespace Dcc.Infrastructure.Entra;

/// <summary>
/// Bound from the <c>Entra</c> section. Empty until the application is
/// registered in the organisation's Entra ID (Azure Portal → App registrations);
/// until then every Entra feature is off: its endpoints answer 404 and the
/// directory sync does not run.
///
/// The registration needs: a redirect URI (…/auth/entra/callback), a client
/// secret, and Microsoft Graph application permissions User.Read.All,
/// Group.Read.All and User.Invite.All with admin consent.
/// </summary>
public sealed class EntraOptions
{
    public const string Section = "Entra";

    public string Instance { get; set; } = "https://login.microsoftonline.com/";
    public string TenantId { get; set; } = "";
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string CallbackPath { get; set; } = "/auth/entra/callback";

    /// <summary>Where the browser lands after an Entra sign-in (the web client).</summary>
    public string PostLoginRedirect { get; set; } = "/#/auth/complete";

    /// <summary>Where an invited guest lands after redeeming the invitation.</summary>
    public string GuestRedirectUrl { get; set; } = "";

    public int DirectorySyncMinutes { get; set; } = 30;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(TenantId) && !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
}
