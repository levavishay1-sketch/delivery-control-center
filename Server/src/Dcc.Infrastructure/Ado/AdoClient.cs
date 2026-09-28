using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Dcc.Infrastructure.Ado;

/// <summary>The outcome of a GET against the Azure DevOps REST API.</summary>
public sealed record AdoResult(bool Ok, int Status, string? ApiVersion, JsonElement? Body, string Detail, bool ResourceMissing = false);

/// <summary>
/// Low-level Azure DevOps REST calls, for cloud and on-prem Server alike.
/// On-prem ships older API surfaces (Server 2022 → 7.x, 2020 → 6.0, 2019 → 5.0,
/// TFS 2018 → 4.1); an old server 404s a version it does not know, so a call
/// walks down the list — and remembers per host which version worked, so the
/// walk happens once. Every call has a 20-second timeout: an unreachable host
/// must never hang the person's request.
/// </summary>
public sealed class AdoClient(IHttpClientFactory http)
{
    public const string HttpClientName = "ado";
    public static readonly string[] ApiVersions = ["7.1", "7.0", "6.0", "5.1", "5.0", "4.1"];

    private static readonly ConcurrentDictionary<string, string> WorkingVersion = new();

    public async Task<AdoResult> GetAsync(string baseUrl, string path, string pat, CancellationToken ct = default)
    {
        var clean = baseUrl.TrimEnd('/');
        var client = http.CreateClient(HttpClientName);
        (int Status, string Text)? last = null;
        foreach (var v in VersionsFor(clean))
        {
            HttpResponseMessage res;
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, $"{clean}/_apis/{path}{(path.Contains('?') ? "&" : "?")}api-version={v}");
                req.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(":" + pat)));
                req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                res = await client.SendAsync(req, ct);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
            {
                return new AdoResult(false, 0, null, null, $"שגיאת רשת: {e.Message} — האם {clean} נגיש מהשרת?");
            }

            using (res)
            {
                if (res.IsSuccessStatusCode)
                {
                    WorkingVersion[Host(clean)] = v;
                    JsonElement? body = null;
                    try { body = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct)).RootElement.Clone(); } catch (JsonException) { }
                    return new AdoResult(true, (int)res.StatusCode, v, body, "");
                }
                if (res.StatusCode == HttpStatusCode.Unauthorized)
                    return new AdoResult(false, 401, null, null, "401 — ה-PAT נדחה. בדוק שהוא בתוקף ושיש לו Work Items + Code (Read).");

                // A genuine "not found" from ADO carries a JSON message ("TF401232: … does not exist");
                // a version-probe miss is an HTML "Page not found".
                if (res.StatusCode == HttpStatusCode.NotFound && res.Content.Headers.ContentType?.MediaType?.Contains("json") == true)
                {
                    try
                    {
                        var b = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct)).RootElement;
                        if (b.TryGetProperty("message", out var m) && m.GetString() is { } msg &&
                            System.Text.RegularExpressions.Regex.IsMatch(msg, "does not exist|TF401232|was not found|deleted", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                            return new AdoResult(false, 404, null, null, msg.Length > 200 ? msg[..200] : msg, ResourceMissing: true);
                    }
                    catch (JsonException) { }
                }
                last = ((int)res.StatusCode, res.ReasonPhrase ?? "");
            }
        }
        return new AdoResult(false, last?.Status ?? 0, null, null, last is { } l ? $"{l.Status} {l.Text}" : "no response");
    }

    private static IEnumerable<string> VersionsFor(string baseUrl) =>
        WorkingVersion.TryGetValue(Host(baseUrl), out var cached) ? ApiVersions.Where(v => v != cached).Prepend(cached) : ApiVersions;

    private static string Host(string baseUrl) =>
        Uri.TryCreate(baseUrl, UriKind.Absolute, out var u) ? u.Authority : baseUrl;
}
