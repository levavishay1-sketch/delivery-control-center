using System.Security.Cryptography;
using Dcc.Infrastructure.Auth;

namespace Dcc.Tests.Unit;

public sealed class SigningKeyTests
{
    [Fact]
    public void A_key_shorter_than_4096_bits_is_refused()
    {
        var path = Path.GetTempFileName();
        try
        {
            using var rsa = RSA.Create(2048);
            File.WriteAllText(path, rsa.ExportPkcs8PrivateKeyPem());
            var ex = Assert.Throws<InvalidOperationException>(() => JwtSigningKey.Load(path, 4096, createIfMissing: false));
            Assert.Contains("2048", ex.Message);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void A_generated_key_is_4096_bits()
    {
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".pem");
        try
        {
            Assert.Equal(4096, JwtSigningKey.Load(path, 4096, createIfMissing: true).KeySizeBits);
        }
        finally { File.Delete(path); }
    }
}
