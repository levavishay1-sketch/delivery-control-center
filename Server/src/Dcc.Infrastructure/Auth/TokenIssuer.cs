using Dcc.Application.Auth;
using Dcc.Infrastructure.Persistence;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Dcc.Infrastructure.Auth;

/// <summary>Claim names in the access token.</summary>
public static class DccClaims
{
    public const string Subject = "sub";
    public const string Email = "email";
    public const string Name = "name";
    public const string Kind = "kind";
    /// <summary>perm_version at issue time; a lower one than the user's current is refused as stale.</summary>
    public const string PermVersion = "pv";
    /// <summary>This user's own permissions, by scope — for the web client to show or hide parts of a screen.</summary>
    public const string Permissions = "perms";
    /// <summary>Present and true while the user must change their password; nothing but the auth endpoints is allowed.</summary>
    public const string MustChangePassword = "mcp";
    /// <summary>"jwt" or "api_token" — how the request authenticated.</summary>
    public const string AuthMethod = "amr_dcc";
}

/// <summary>Issues the access token (RS256 JWT) and a refresh token (stored as a hash).</summary>
public sealed class TokenIssuer(DccDbContext db, JwtSigningKey key, IPermissionService permissions, IOptions<AuthOptions> options)
{
    private readonly AuthOptions _o = options.Value;
    private static readonly JsonWebTokenHandler Handler = new() { SetDefaultTimesOnTokenCreation = false };

    public async Task<IssuedTokens> IssueAsync(UserRow user, RequestInfo req, Guid? familyId, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var accessExpires = now.AddMinutes(_o.AccessTokenMinutes);
        var claims = new Dictionary<string, object>
        {
            [DccClaims.Subject] = user.Id.ToString(),
            [DccClaims.Email] = user.Email,
            [DccClaims.Name] = user.DisplayName,
            [DccClaims.Kind] = user.Kind,
            [DccClaims.PermVersion] = user.PermVersion,
            [DccClaims.Permissions] = await permissions.ClaimForAsync(user.Id, ct),
            [JwtRegisteredClaimNames.Jti] = Guid.NewGuid().ToString("N"),
        };
        if (user.MustChangePassword) claims[DccClaims.MustChangePassword] = true;

        var access = Handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = _o.Issuer,
            Audience = _o.Audience,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = accessExpires.UtcDateTime,
            Claims = claims,
            SigningCredentials = new SigningCredentials(key.PrivateKey, SecurityAlgorithms.RsaSha256),
        });

        var refresh = Secrets.NewRefreshToken();
        var refreshExpires = now.AddDays(_o.RefreshTokenDays);
        var row = new UserTokenRow
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Type = "refresh",
            TokenHash = Secrets.Hash(refresh),
            FamilyId = familyId ?? Guid.NewGuid(),
            CreatedAt = now,
            ExpiresAt = refreshExpires,
            Ip = req.Ip,
            UserAgent = Truncate(req.UserAgent, 400),
        };
        db.UserTokens.Add(row);
        await db.SaveChangesAsync(ct);

        return new IssuedTokens(access, accessExpires, refresh, refreshExpires, user.MustChangePassword) { RefreshRowId = row.Id };
    }

    public TokenValidationParameters ValidationParameters() => ValidationParameters(key, _o);

    public static TokenValidationParameters ValidationParameters(JwtSigningKey key, AuthOptions o) => new()
    {
        ValidIssuer = o.Issuer,
        ValidAudience = o.Audience,
        IssuerSigningKey = key.PublicKey,
        ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        RequireSignedTokens = true,
        RequireExpirationTime = true,
        ClockSkew = TimeSpan.FromSeconds(30),
        NameClaimType = DccClaims.Name,
    };

    private static string? Truncate(string? s, int max) => s is null || s.Length <= max ? s : s[..max];
}
