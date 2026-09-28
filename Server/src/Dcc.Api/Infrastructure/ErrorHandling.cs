using Dcc.Application.Common;
using Dcc.Domain.Events;
using Microsoft.AspNetCore.Diagnostics;

namespace Dcc.Api.Infrastructure;

/// <summary>
/// Turns exceptions into the error shape the web client already reads:
/// <c>{ "error": code, "message": … }</c>. Expected failures (<see cref="AppException"/>,
/// a rejected event) keep their status; anything else is a 500 whose details
/// stay in the server log, never in the response.
/// </summary>
public sealed class DccExceptionHandler(ILogger<DccExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception exception, CancellationToken ct)
    {
        var (status, code, message) = exception switch
        {
            AppException a => (a.Status, a.Code, a.Message),
            EventValidationException e => (400, "invalid_event", e.Message),
            BadHttpRequestException b => (400, "bad_request", b.Message),
            _ => (500, "internal", "Something went wrong on the server."),
        };
        if (status >= 500) logger.LogError(exception, "Unhandled error on {Method} {Path}", http.Request.Method, http.Request.Path);

        http.Response.StatusCode = status;
        await http.Response.WriteAsJsonAsync(new { error = code, message }, ct);
        return true;
    }
}
