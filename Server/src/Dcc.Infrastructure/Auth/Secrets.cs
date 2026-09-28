using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Dcc.Infrastructure.Auth;

/// <summary>Random tokens and their stored form. Only a SHA-256 hash of a token is ever kept.</summary>
public static class Secrets
{
    public const string ApiTokenPrefix = "dcc_pat_";

    public static string NewRefreshToken() => Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));

    public static string NewApiToken() => ApiTokenPrefix + Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));

    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
