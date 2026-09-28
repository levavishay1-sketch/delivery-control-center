using System.Net;
using System.Text;

namespace Dcc.Tests.Support;

/// <summary>
/// Stands in for Azure DevOps. A test sets <see cref="Respond"/> to answer each request
/// (by URL); the default answers 404, like a server that knows nothing.
/// </summary>
public sealed class FakeAdo : HttpMessageHandler
{
    public static Func<HttpRequestMessage, HttpResponseMessage> Respond { get; set; } = _ => new HttpResponseMessage(HttpStatusCode.NotFound);

    public static HttpResponseMessage Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
        Task.FromResult(Respond(request));
}
