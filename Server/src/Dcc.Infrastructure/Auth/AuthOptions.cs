namespace Dcc.Infrastructure.Auth;

/// <summary>Bound from the <c>Auth</c> section of appsettings.</summary>
public sealed class AuthOptions
{
    public const string Section = "Auth";

    public string Issuer { get; set; } = "dcc";
    public string Audience { get; set; } = "dcc-web";

    /// <summary>Access token (JWT) lifetime. A permission change still takes effect at once, through perm_version.</summary>
    public int AccessTokenMinutes { get; set; } = 60;

    public int RefreshTokenDays { get; set; } = 14;

    /// <summary>PEM file holding the RSA private key that signs tokens. Created on first run in Development.</summary>
    public string SigningKeyPath { get; set; } = "../../.local/jwt-signing.pem";

    /// <summary>The server refuses to start with a shorter key.</summary>
    public int MinRsaKeyBits { get; set; } = 4096;

    /// <summary>Path of the refresh cookie as the browser sees it (the web client reaches the API under /api).</summary>
    public string RefreshCookiePath { get; set; } = "/api/auth";

    public string RefreshCookieName { get; set; } = "dcc_refresh";

    public int MaxFailedLogins { get; set; } = 5;
    public int LockoutMinutes { get; set; } = 15;
    public int MinPasswordLength { get; set; } = 12;
}

/// <summary>Bound from <c>Bootstrap</c>: the first administrator, created when there is none.</summary>
public sealed class BootstrapOptions
{
    public const string Section = "Bootstrap";

    public string InitialAdminEmail { get; set; } = "admin@dcc.local";
    public string InitialAdminName { get; set; } = "Administrator";

    /// <summary>Where the generated password is written (outside git). Never logged, never printed.</summary>
    public string InitialAdminPasswordFile { get; set; } = "../../.local/initial-admin.txt";
}

/// <summary>Bound from <c>Agents</c>.</summary>
public sealed class AgentOptions
{
    public const string Section = "Agents";

    /// <summary>
    /// Independent agents change architecture decision 02. Off until the
    /// amendment in docs/architecture-review.md is approved.
    /// </summary>
    public bool AllowIndependent { get; set; }
}
