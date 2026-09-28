using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Security.Claims;

using System.Text.Json;
using Dcc.Api.Auth;
using Dcc.Application.Auth;
using Dcc.Infrastructure.Auth;
using Dcc.Infrastructure.Persistence;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Dcc.Api.Sockets;

/// <summary>Timings and limits for authenticated WebSockets (<c>Auth:WebSocket</c>).</summary>
public sealed class SocketOptions
{
    public int AuthTimeoutSeconds { get; set; } = 5;
    public int ReauthGraceSeconds { get; set; } = 30;
    public int CheckIntervalSeconds { get; set; } = 15;
    /// <summary>Ask for a fresh token this long before the current one expires.</summary>
    public int ReauthBeforeExpirySeconds { get; set; } = 60;
    public int MaxMessageBytes { get; set; } = 64 * 1024;
    public int MaxConnectionsPerUser { get; set; } = 10;
}

/// <summary>Close codes, in the private 4000–4999 range.</summary>
public static class SocketCloseCodes
{
    public const WebSocketCloseStatus Unauthorized = (WebSocketCloseStatus)4401;
    public const WebSocketCloseStatus Forbidden = (WebSocketCloseStatus)4403;
    public const WebSocketCloseStatus TooManyConnections = (WebSocketCloseStatus)4429;
}

/// <summary>
/// A WebSocket that carries the same identity and permissions as an HTTP request.
/// A browser cannot put headers on a WebSocket, so:
/// <list type="number">
/// <item>the socket opens with no token in its URL (a URL ends up in logs);</item>
/// <item>the first message must be <c>{"type":"auth","token":"&lt;JWT&gt;"}</c> within
/// <see cref="SocketOptions.AuthTimeoutSeconds"/>, or the socket is closed with 4401;</item>
/// <item>the caller's permission check on the resource runs next — 4403 if it fails;</item>
/// <item>while open, when the token is about to expire or the user's permissions
/// change (perm_version), the server sends <c>{"type":"reauth_required"}</c> and
/// the client has <see cref="SocketOptions.ReauthGraceSeconds"/> to send a fresh
/// <c>auth</c> — otherwise 4401. A revoked permission therefore reaches open sockets too.</item>
/// </list>
/// </summary>
public sealed class AuthenticatedSocket
{
    private static readonly ConcurrentDictionary<Guid, int> OpenPerUser = new();

    private readonly WebSocket _ws;
    private readonly IServiceProvider _services;
    private readonly SocketOptions _o;
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    public Guid UserId { get; private set; }
    private int _permVersion;
    private DateTimeOffset _expiresAt;
    private DateTimeOffset? _reauthDeadline;

    private AuthenticatedSocket(WebSocket ws, IServiceProvider services, SocketOptions o)
    {
        _ws = ws;
        _services = services;
        _o = o;
    }

    /// <summary>
    /// Accepts, authenticates and authorizes a socket, then runs <paramref name="onMessage"/>
    /// for every message other than <c>auth</c> until either side closes.
    /// </summary>
    public static async Task RunAsync(HttpContext http, Func<Guid, IPermissionService, Task<bool>> authorize,
        Func<AuthenticatedSocket, JsonElement, Task> onMessage)
    {
        var o = http.RequestServices.GetRequiredService<IOptions<SocketOptions>>().Value;
        using var ws = await http.WebSockets.AcceptWebSocketAsync();
        var socket = new AuthenticatedSocket(ws, http.RequestServices, o);
        var ct = http.RequestAborted;

        using (var authTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct))
        {
            authTimeout.CancelAfter(TimeSpan.FromSeconds(o.AuthTimeoutSeconds));
            JsonElement? first;
            try { first = await socket.ReceiveAsync(authTimeout.Token); }
            catch (OperationCanceledException) { first = null; }
            if (first is not { } msg || Type(msg) != "auth" || !await socket.AcceptTokenAsync(Token(msg), ct))
            {
                await socket.CloseAsync(SocketCloseCodes.Unauthorized, "authentication required");
                return;
            }
        }

        if (!await authorize(socket.UserId, http.RequestServices.GetRequiredService<IPermissionService>()))
        {
            await socket.CloseAsync(SocketCloseCodes.Forbidden, "forbidden");
            return;
        }

        var count = OpenPerUser.AddOrUpdate(socket.UserId, 1, (_, n) => n + 1);
        try
        {
            if (count > o.MaxConnectionsPerUser)
            {
                await socket.CloseAsync(SocketCloseCodes.TooManyConnections, "too many connections");
                return;
            }
            await socket.SendAsync(new { type = "ready" }, ct);

            using var loopCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var watch = socket.WatchAsync(loopCts.Token);
            try
            {
                while (socket._ws.State == WebSocketState.Open)
                {
                    var next = await socket.ReceiveAsync(loopCts.Token);
                    if (next is not { } m) break;
                    if (Type(m) == "auth")
                    {
                        if (!await socket.AcceptTokenAsync(Token(m), ct)) { await socket.CloseAsync(SocketCloseCodes.Unauthorized, "invalid token"); break; }
                        await socket.SendAsync(new { type = "reauthed" }, ct);
                        continue;
                    }
                    await onMessage(socket, m);
                }
            }
            catch (OperationCanceledException) { }
            catch (WebSocketException) { }
            finally
            {
                await loopCts.CancelAsync();
                try { await watch; } catch (OperationCanceledException) { }
            }
        }
        finally
        {
            OpenPerUser.AddOrUpdate(socket.UserId, 0, (_, n) => Math.Max(0, n - 1));
        }
    }

    public async Task SendAsync(object message, CancellationToken ct)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(message, JsonSerializerOptions.Web);
        await _sendLock.WaitAsync(ct);
        try
        {
            if (_ws.State == WebSocketState.Open) await _ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
        }
        finally { _sendLock.Release(); }
    }

    /// <summary>Checks the token like an HTTP request would: signature, lifetime, then active user and perm_version.</summary>
    private async Task<bool> AcceptTokenAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token)) return false;
        var key = _services.GetRequiredService<JwtSigningKey>();
        var auth = _services.GetRequiredService<IOptions<AuthOptions>>().Value;
        var result = await new JsonWebTokenHandler { MapInboundClaims = false }.ValidateTokenAsync(token, TokenIssuer.ValidationParameters(key, auth));
        if (!result.IsValid) return false;

        var principal = new ClaimsPrincipal(result.ClaimsIdentity);
        using var scope = _services.CreateScope();
        var verdict = await AccessTokenChecks.CheckAsync(principal, scope.ServiceProvider.GetRequiredService<DccDbContext>(), ct);
        if (!verdict.Ok) return false;
        if (principal.FindFirstValue(DccClaims.MustChangePassword) == "true") return false;

        var userId = principal.UserId();
        if (UserId != Guid.Empty && userId != UserId) return false; // a socket never changes hands
        UserId = userId;
        _permVersion = int.Parse(principal.FindFirstValue(DccClaims.PermVersion)!);
        _expiresAt = ((JsonWebToken)result.SecurityToken).ValidTo;
        _reauthDeadline = null;
        return true;
    }

    /// <summary>Asks for a fresh token when this one nears expiry or permissions change; closes if none comes.</summary>
    private async Task WatchAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(1, _o.CheckIntervalSeconds)));
        while (await timer.WaitForNextTickAsync(ct))
        {
            var now = DateTimeOffset.UtcNow;
            if (_reauthDeadline is { } deadline)
            {
                if (now >= deadline) { await CloseAsync(SocketCloseCodes.Unauthorized, "reauthentication required"); return; }
                continue;
            }

            int current;
            using (var scope = _services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<DccDbContext>();
                var user = await db.Users.FindAsync([UserId], ct);
                if (user is null || !user.IsActive(now)) { await CloseAsync(SocketCloseCodes.Unauthorized, "account disabled"); return; }
                current = user.PermVersion;
            }

            if (current != _permVersion || _expiresAt - now <= TimeSpan.FromSeconds(_o.ReauthBeforeExpirySeconds))
            {
                _reauthDeadline = now.AddSeconds(_o.ReauthGraceSeconds);
                await SendAsync(new { type = "reauth_required" }, ct);
            }
        }
    }

    private async Task<JsonElement?> ReceiveAsync(CancellationToken ct)
    {
        var buffer = new byte[8 * 1024];
        using var ms = new MemoryStream();
        while (true)
        {
            var r = await _ws.ReceiveAsync(buffer, ct);
            if (r.MessageType == WebSocketMessageType.Close) return null;
            ms.Write(buffer, 0, r.Count);
            if (ms.Length > _o.MaxMessageBytes)
            {
                await CloseAsync(WebSocketCloseStatus.MessageTooBig, "message too big");
                return null;
            }
            if (r.EndOfMessage) break;
        }
        try { return JsonDocument.Parse(ms.ToArray()).RootElement.Clone(); }
        catch (JsonException) { return JsonDocument.Parse("{}").RootElement.Clone(); }
    }

    private async Task CloseAsync(WebSocketCloseStatus status, string reason)
    {
        if (_ws.State is WebSocketState.Open or WebSocketState.CloseReceived)
        {
            try { await _ws.CloseAsync(status, reason, CancellationToken.None); }
            catch (WebSocketException) { }
        }
    }

    private static string? Type(JsonElement m) =>
        m.ValueKind == JsonValueKind.Object && m.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;

    private static string? Token(JsonElement m) =>
        m.TryGetProperty("token", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
}
