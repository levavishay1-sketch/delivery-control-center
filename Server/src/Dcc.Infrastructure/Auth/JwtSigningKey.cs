using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;

namespace Dcc.Infrastructure.Auth;

/// <summary>
/// The RSA key that signs access tokens (RS256). Loaded from a PEM file kept
/// outside git; in Development it is generated on first run. The server does
/// not start with a key shorter than <see cref="AuthOptions.MinRsaKeyBits"/>
/// (4096) — a tampered token then fails signature validation on every request.
/// </summary>
public sealed class JwtSigningKey
{
    public RsaSecurityKey PrivateKey { get; }
    public RsaSecurityKey PublicKey { get; }
    public int KeySizeBits { get; }

    private JwtSigningKey(RSA rsa)
    {
        KeySizeBits = rsa.KeySize;
        var kid = Base64UrlEncoder.Encode(SHA256.HashData(rsa.ExportSubjectPublicKeyInfo()))[..16];
        PrivateKey = new RsaSecurityKey(rsa) { KeyId = kid };
        PublicKey = new RsaSecurityKey(rsa.ExportParameters(false)) { KeyId = kid };
    }

    public static JwtSigningKey Load(string path, int minBits, bool createIfMissing)
    {
        var rsa = RSA.Create();
        if (File.Exists(path))
        {
            rsa.ImportFromPem(File.ReadAllText(path));
        }
        else if (createIfMissing)
        {
            rsa.KeySize = Math.Max(minBits, 4096);
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
            File.WriteAllText(path, rsa.ExportPkcs8PrivateKeyPem());
        }
        else
        {
            throw new InvalidOperationException($"JWT signing key not found at {Path.GetFullPath(path)}");
        }

        if (rsa.KeySize < minBits)
            throw new InvalidOperationException($"JWT signing key is {rsa.KeySize} bits; at least {minBits} are required.");
        return new JwtSigningKey(rsa);
    }
}
