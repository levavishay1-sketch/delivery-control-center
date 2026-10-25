using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// Reads a marketplace source's page so its tool descriptions can be scanned for injections (marketplace-sources.ts
/// <c>fetchPage</c>, which ran <c>curl -sSL --max-time 8 --max-filesize 400000</c>). Best effort and bounded: a network
/// that refuses is "not scanned" (null), never a failure of the run or of the weekly recheck.
///
/// The address comes from a model, so the fetcher only ever talks to the public internet: http or https on the
/// scheme's own port, no user name in the address, and every address a name resolves to must be public — no
/// loopback, private, link-local (the cloud metadata service), carrier-grade NAT, multicast or documentation range,
/// and no IPv6 form that wraps one of those. The check runs again at the moment of connecting, on the address actually
/// dialled, so a redirect or a name that changes its answer between the check and the connection cannot reach inside.
/// There is no proxy: a proxy would make the dialled address the proxy's, not the page's.
/// </summary>
public static class PageFetcher
{
    /// <summary>curl's <c>--max-filesize</c>: a larger body is no page.</summary>
    public const int MaxBytes = 400_000;

    /// <summary>What the scan reads at most, in UTF-16 units (the old <c>.slice(0, 200_000)</c>).</summary>
    public const int MaxChars = 200_000;

    /// <summary>curl's default for <c>-L</c>; every hop is checked like the first.</summary>
    private const int MaxRedirects = 50;

    private static readonly Lazy<HttpClient> Client = new(() => new HttpClient(new SocketsHttpHandler
    {
        AllowAutoRedirect = false, UseProxy = false, UseCookies = false, AutomaticDecompression = DecompressionMethods.None,
        PooledConnectionLifetime = TimeSpan.FromMinutes(2), ConnectCallback = ConnectToPublicAddressAsync,
    })
    { Timeout = Timeout.InfiniteTimeSpan });

    /// <summary>
    /// The page's text, decoded as UTF-8 and cut to <see cref="MaxChars"/>; null when the address is not a public
    /// http(s) one, the body is over <see cref="MaxBytes"/>, the whole exchange takes longer than
    /// <paramref name="timeoutMs"/> (rounded up to whole seconds, as curl's <c>--max-time</c> was) or anything else
    /// fails. Like curl without <c>-f</c>, an error page's body is still a page.
    /// </summary>
    public static async Task<string?> FetchAsync(string url, int timeoutMs = 8000, CancellationToken ct = default)
    {
        if (!TryPublicUrl(url, out var uri)) return null;
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(Math.Ceiling(timeoutMs / 1000.0)));
        try
        {
            for (var hop = 0; hop <= MaxRedirects; hop++)
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, uri);
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("*/*"));
                request.Headers.UserAgent.Add(new ProductInfoHeaderValue("dcc-onboarding", "1"));
                using var response = await Client.Value.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                if (IsRedirect(response.StatusCode) && response.Headers.Location is { } location)
                {
                    if (!TryPublicUrl(new Uri(uri, location).AbsoluteUri, out uri)) return null;
                    continue;
                }
                if (response.Content.Headers.ContentLength > MaxBytes) return null;
                var body = await ReadAtMostAsync(response.Content, MaxBytes, cts.Token);
                if (body is null) return null;
                var text = Encoding.UTF8.GetString(body);
                return text.Length > MaxChars ? text[..MaxChars] : text;
            }
            return null; // more redirects than curl follows
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>
    /// An address the fetcher may start from: absolute http or https, no user name or password, the scheme's own port,
    /// and — when the host is written as an IP address — a public one. A name is checked once it resolves, at connection time.
    /// </summary>
    public static bool TryPublicUrl(string url, out Uri uri)
    {
        uri = null!;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed)) return false;
        if (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps) return false;
        if (parsed.UserInfo.Length > 0 || parsed.Host.Length == 0 || parsed.Port != DefaultPort(parsed.Scheme)) return false;
        if (parsed.HostNameType is UriHostNameType.IPv4 or UriHostNameType.IPv6 && (!IPAddress.TryParse(parsed.Host.Trim('[', ']'), out var ip) || !IsPublic(ip))) return false;
        uri = parsed;
        return true;
    }

    /// <summary>Whether an address is on the public internet. IPv4-mapped, NAT64 and 6to4 addresses are judged by the IPv4 address they carry.</summary>
    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        var b = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork) return IsPublicV4(b);
        if (address.AddressFamily != AddressFamily.InterNetworkV6) return false;
        // 64:ff9b::/96, NAT64's well-known prefix: the last four bytes are an IPv4 address.
        if (b[0] == 0x00 && b[1] == 0x64 && b[2] == 0xff && b[3] == 0x9b && b.AsSpan(4, 8).IndexOfAnyExcept((byte)0) < 0) return IsPublicV4(b.AsSpan(12, 4));
        // 2002::/16, 6to4: bytes 2–5 are an IPv4 address.
        if (b[0] == 0x20 && b[1] == 0x02) return IsPublicV4(b.AsSpan(2, 4));
        // Only global unicast (2000::/3) is public — loopback, unique-local, link-local, site-local, multicast and the
        // IPv4-compatible forms are all outside it. Within it: the IETF block 2001::/23 (Teredo among it), and the
        // documentation ranges 2001:db8::/32 and 3fff::/20.
        if ((b[0] & 0xE0) != 0x20) return false;
        if (b[0] == 0x20 && b[1] == 0x01 && b[2] <= 0x01) return false;
        if (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8) return false;
        if (b[0] == 0x3f && b[1] == 0xff && (b[2] & 0xF0) == 0) return false;
        return true;
    }

    private static bool IsPublicV4(ReadOnlySpan<byte> b) => !(
        b[0] == 0 || b[0] == 10 || b[0] == 127 || b[0] >= 224                 // "this network", private, loopback, multicast and reserved
        || (b[0] == 100 && (b[1] & 0xC0) == 64)                               // 100.64/10, carrier-grade NAT
        || (b[0] == 169 && b[1] == 254)                                        // link-local — the cloud metadata service lives here
        || (b[0] == 172 && (b[1] & 0xF0) == 16)                                // 172.16/12, private
        || (b[0] == 192 && b[1] == 0 && (b[2] == 0 || b[2] == 2))              // 192.0.0/24 protocol assignments, 192.0.2/24 documentation
        || (b[0] == 192 && b[1] == 88 && b[2] == 99)                           // 6to4 relay anycast
        || (b[0] == 192 && b[1] == 168)                                        // private
        || (b[0] == 198 && (b[1] & 0xFE) == 18)                                // 198.18/15, benchmarking
        || (b[0] == 198 && b[1] == 51 && b[2] == 100)                          // documentation
        || (b[0] == 203 && b[1] == 0 && b[2] == 113));                         // documentation

    private static int DefaultPort(string scheme) => scheme == Uri.UriSchemeHttps ? 443 : 80;

    private static bool IsRedirect(HttpStatusCode code) => (int)code is 300 or 301 or 302 or 303 or 307 or 308;

    /// <summary>Every connection — the first request's and each redirect's — dials only public addresses on the scheme's own port.</summary>
    private static async ValueTask<Stream> ConnectToPublicAddressAsync(SocketsHttpConnectionContext context, CancellationToken ct)
    {
        var endpoint = context.DnsEndPoint;
        var scheme = context.InitialRequestMessage.RequestUri?.Scheme ?? Uri.UriSchemeHttps;
        if (endpoint.Port != DefaultPort(scheme)) throw new HttpRequestException($"Port {endpoint.Port} is not {scheme}'s own.");
        var addresses = IPAddress.TryParse(endpoint.Host.Trim('[', ']'), out var literal) ? [literal] : await Dns.GetHostAddressesAsync(endpoint.Host, ct);
        if (addresses.Length == 0 || !addresses.All(IsPublic)) throw new HttpRequestException($"{endpoint.Host} is not a public address.");
        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(addresses, endpoint.Port, ct);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    /// <summary>The body, or null once it passes <paramref name="max"/> bytes (curl stops such a transfer too).</summary>
    private static async Task<byte[]?> ReadAtMostAsync(HttpContent content, int max, CancellationToken ct)
    {
        await using var stream = await content.ReadAsStreamAsync(ct);
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await stream.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > max) return null;
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }
}
