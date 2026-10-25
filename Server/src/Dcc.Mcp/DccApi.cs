using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Dcc.Mcp;

/// <summary>
/// Where the DCC API is and whose token to call it with. Read from the environment the MCP client starts this
/// process with, so the token lives in the developer's own MCP configuration and nowhere else.
/// </summary>
public sealed record DccApiSettings(Uri BaseUrl, string? Token)
{
    public const string UrlVariable = "DCC_API_URL";
    public const string TokenVariable = "DCC_API_TOKEN";
    public const string DefaultUrl = "http://localhost:5080";

    public static DccApiSettings FromEnvironment() =>
        From(Environment.GetEnvironmentVariable(UrlVariable), Environment.GetEnvironmentVariable(TokenVariable));

    public static DccApiSettings From(string? url, string? token)
    {
        var raw = string.IsNullOrWhiteSpace(url) ? DefaultUrl : url.Trim();
        // A trailing slash, so the relative routes land under a path too (http://localhost:5173/api/ through the web's proxy).
        if (!raw.EndsWith('/')) raw += "/";
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var baseUrl) || baseUrl.Scheme is not ("http" or "https"))
            throw new InvalidOperationException($"{UrlVariable} must be an http(s) address, such as {DefaultUrl} (it is \"{url}\").");
        return new DccApiSettings(baseUrl, string.IsNullOrWhiteSpace(token) ? null : token.Trim());
    }

    /// <summary>The one HTTP client this process uses: the API's address and <c>Authorization: Bearer</c> with the token.</summary>
    public HttpClient CreateHttpClient()
    {
        var http = new HttpClient { BaseAddress = BaseUrl, Timeout = TimeSpan.FromSeconds(30) };
        if (Token is not null) http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("dcc-mcp", DccMcpServer.Info.Version));
        return http;
    }
}

/// <summary>What the API answered: the status, and the body when it was JSON.</summary>
public sealed record ApiAnswer(HttpStatusCode Status, JsonNode? Body)
{
    public bool Ok => (int)Status is >= 200 and < 300;

    /// <summary>The <c>message</c> of an <c>{error, message}</c> body, else its <c>error</c> — what to tell the caller.</summary>
    public string? Message => Body is JsonObject o ? (o["message"] ?? o["error"]) is JsonValue v && v.TryGetValue<string>(out var s) ? s : null : null;
}

/// <summary>
/// The REST API, called as the token's person. Every tool goes through here and nothing else, so a tool reads only
/// what that person may read on the web: the permission checks and the wall between clients are the API's own,
/// never a second copy here.
/// </summary>
public sealed class DccApi(HttpClient http)
{
    /// <summary>Where the API is — named in the sentence a tool answers when it cannot be reached.</summary>
    public Uri? BaseAddress => http.BaseAddress;

    /// <summary>GET a route, given relative to the API's address and without a leading slash (<c>workitems/{id}</c>).</summary>
    public async Task<ApiAnswer> GetAsync(string path, CancellationToken ct)
    {
        using var res = await http.GetAsync(path, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        JsonNode? body = null;
        if (text.Length > 0)
        {
            try { body = JsonNode.Parse(text); }
            catch (JsonException) { /* not JSON (a proxy's error page): the status alone says what happened */ }
        }
        return new ApiAnswer(res.StatusCode, body);
    }
}
