using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Security.Claims;

using System.Text.Json;
using System.Threading.Channels;
using Dcc.Api.Auth;
using Dcc.Application.Auth;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Auth;
using Dcc.Infrastructure.Onboarding;
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
    /// <summary>The viewer fell too far behind what the server sends it; reconnecting brings a fresh replay.</summary>
    public const WebSocketCloseStatus TooFarBehind = (WebSocketCloseStatus)4408;
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
/// <c>auth</c> — otherwise 4401. The fresh token is checked against the resource
/// again (4403 if it no longer passes), so a revoked permission reaches open sockets too.</item>
/// </list>
/// </summary>
public sealed class AuthenticatedSocket
{
    private static readonly ConcurrentDictionary<Guid, int> OpenPerUser = new();

    private readonly WebSocket _ws;
    private readonly IServiceProvider _services;
    private readonly SocketOptions _o;
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    // Small until the socket is signed in and allowed; then what the endpoint takes (a paste into a terminal is large).
    private int _maxMessageBytes;

    public Guid UserId { get; private set; }
    private int _permVersion;
    private DateTimeOffset _expiresAt;
    private DateTimeOffset? _reauthDeadline;

    private AuthenticatedSocket(WebSocket ws, IServiceProvider services, SocketOptions o)
    {
        _ws = ws;
        _services = services;
        _o = o;
        _maxMessageBytes = o.MaxMessageBytes;
    }

    /// <summary>
    /// Accepts, authenticates and authorizes a socket, then runs <paramref name="onMessage"/>
    /// for every message other than <c>auth</c> until either side closes. <paramref name="onOpen"/>,
    /// when given, runs once after <c>ready</c> and before the first message is read — what the
    /// socket shows from the start (a replay) goes out there; what it returns is disposed when the
    /// socket ends (a subscription). <paramref name="authorize"/> runs again on every fresh token.
    /// <paramref name="maxMessageBytes"/>, when given, is the largest message taken once the socket is
    /// allowed — before that, every socket takes <see cref="SocketOptions.MaxMessageBytes"/>.
    /// </summary>
    public static async Task RunAsync(HttpContext http, Func<Guid, IPermissionService, Task<bool>> authorize,
        Func<AuthenticatedSocket, JsonElement, Task> onMessage, Func<AuthenticatedSocket, CancellationToken, Task<IDisposable?>>? onOpen = null,
        int? maxMessageBytes = null)
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
            if (maxMessageBytes is { } max) socket._maxMessageBytes = max;
            await socket.SendAsync(new { type = "ready" }, ct);

            using var loopCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var watch = socket.WatchAsync(loopCts.Token);
            IDisposable? opened = null;
            try
            {
                if (onOpen is not null) opened = await onOpen(socket, loopCts.Token);
                while (socket._ws.State == WebSocketState.Open)
                {
                    var next = await socket.ReceiveAsync(loopCts.Token);
                    if (next is not { } m) break;
                    if (Type(m) == "auth")
                    {
                        if (!await socket.AcceptTokenAsync(Token(m), ct)) { await socket.CloseAsync(SocketCloseCodes.Unauthorized, "invalid token"); break; }
                        if (!await authorize(socket.UserId, http.RequestServices.GetRequiredService<IPermissionService>()))
                        {
                            await socket.CloseAsync(SocketCloseCodes.Forbidden, "forbidden");
                            break;
                        }
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
                opened?.Dispose();
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
            if (ms.Length > _maxMessageBytes)
            {
                await CloseAsync(WebSocketCloseStatus.MessageTooBig, "message too big");
                return null;
            }
            if (r.EndOfMessage) break;
        }
        try { return JsonDocument.Parse(ms.ToArray()).RootElement.Clone(); }
        catch (JsonException) { return JsonDocument.Parse("{}").RootElement.Clone(); }
    }

    internal async Task CloseAsync(WebSocketCloseStatus status, string reason)
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

/// <summary>
/// The run's terminal (<c>/repos/{id}/onboarding/runs/{runId}/terminal</c>): the live Claude Code session plus DCC's
/// own lines. Watching needs repos.read on the client that owns the repository — as the run view does — and typing or
/// resizing needs repos.onboard there, never for a guest: the keystrokes reach a process on this machine. On connect the
/// screen as it is now is replayed, then its state; after that every output and change of state as it happens.
/// </summary>
public static class OnboardingTerminalSocket
{
    public static Task RunAsync(HttpContext http, Guid repoId, Guid runId)
    {
        var terminal = http.RequestServices.GetRequiredService<IOnboardingTerminal>();
        var canType = false;
        return AuthenticatedSocket.RunAsync(http,
            authorize: async (userId, permissions) =>
            {
                var ct = http.RequestAborted;
                var clientId = await ClientOfRunAsync(http.RequestServices, repoId, runId, ct);
                if (clientId is null) return false;
                var scope = new ScopeRef(ScopeType.Client, clientId);
                if (!await permissions.HasAsync(userId, Permissions.Repos.Read, scope, ct)) return false;
                canType = await permissions.HasAsync(userId, Permissions.Repos.Onboard, scope, ct) && !await IsGuestAsync(http.RequestServices, userId, ct);
                return true;
            },
            onMessage: (socket, m) =>
            {
                if (!canType || m.ValueKind != JsonValueKind.Object || !m.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String) return Task.CompletedTask;
                if (type.ValueEquals("input") && m.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.String)
                    terminal.Input(runId, data.GetString()!, socket.UserId);
                else if (type.ValueEquals("resize") && Whole(m, "cols") is { } cols && Whole(m, "rows") is { } rows)
                    terminal.Resize(runId, cols, rows);
                return Task.CompletedTask;
            },
            onOpen: async (socket, ct) =>
            {
                var outbox = new Outbox();
                var (replay, state, subscription) = terminal.Subscribe(runId, outbox.Post);
                outbox.Subscription = subscription;
                try
                {
                    await socket.SendAsync(new { type = "replay", data = replay }, ct);
                    await socket.SendAsync(new { type = "state", state }, ct);
                }
                catch
                {
                    outbox.Dispose();
                    throw;
                }
                _ = outbox.PumpAsync(socket, ct);
                return outbox;
            },
            maxMessageBytes: MaxMessageBytes);
    }

    /// <summary>A keystroke message carries a whole paste; the old server took up to ~100 MB, a terminal paste never needs more than this.</summary>
    private const int MaxMessageBytes = 4 * 1024 * 1024;

    /// <summary>
    /// What waits to go to one viewer. The terminal calls <see cref="Post"/> from the process's own reader, under its
    /// lock, so it only queues and this socket sends from <see cref="PumpAsync"/> — a slow browser never holds up the
    /// session. A viewer that falls this far behind is cut off (it reconnects to a fresh replay) instead of holding the
    /// output in memory without end; a chunk is never dropped, which would garble the screen.
    /// </summary>
    private sealed class Outbox : IDisposable
    {
        /// <summary>Twice the replay a reconnect brings.</summary>
        private const long MaxBacklogChars = 4_000_000;

        private readonly Channel<(object Message, int Size)> _queue = Channel.CreateUnbounded<(object, int)>(new UnboundedChannelOptions { SingleReader = true });
        private long _backlog;
        private int _behind;

        public IDisposable? Subscription { get; set; }

        public void Post(TerminalMessage m)
        {
            if (Volatile.Read(ref _behind) == 1) return;
            var size = (m.Data?.Length ?? 0) + 32;
            if (Interlocked.Add(ref _backlog, size) > MaxBacklogChars)
            {
                Interlocked.Exchange(ref _behind, 1);
                _queue.Writer.TryComplete();
                return;
            }
            object message = m.Type == "output" ? new { type = "output", data = m.Data } : new { type = "state", state = m.State };
            _queue.Writer.TryWrite((message, size));
        }

        public async Task PumpAsync(AuthenticatedSocket socket, CancellationToken ct)
        {
            try
            {
                await foreach (var (message, size) in _queue.Reader.ReadAllAsync(ct))
                {
                    if (Volatile.Read(ref _behind) == 1) break;
                    await socket.SendAsync(message, ct);
                    Interlocked.Add(ref _backlog, -size);
                }
                if (Volatile.Read(ref _behind) == 1) await socket.CloseAsync(SocketCloseCodes.TooFarBehind, "too far behind");
            }
            catch (Exception e) when (e is OperationCanceledException or WebSocketException or ObjectDisposedException) { /* the socket is closing */ }
        }

        public void Dispose()
        {
            Subscription?.Dispose();
            _queue.Writer.TryComplete();
        }
    }

    /// <summary>A whole number, as the old server's <c>Number(m.cols)</c> read it; the terminal itself refuses a size out of range.</summary>
    private static int? Whole(JsonElement m, string name) =>
        m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : null;

    /// <summary>The client that owns the repository, when the run is one of its runs — looked for inside that client only.</summary>
    private static async Task<Guid?> ClientOfRunAsync(IServiceProvider services, Guid repoId, Guid runId, CancellationToken ct)
    {
        var db = services.GetRequiredService<DccDbContext>();
        if (await SqlJson.ScalarAsync<Guid?>(db, "select client_id from repo where id = @id", new { id = repoId }, ct) is not { } clientId) return null;
        var found = await services.GetRequiredService<ITenantScope>().RunAsync(clientId, d => SqlJson.ScalarAsync<bool>(d,
            "select exists (select 1 from repository_onboarding_run where id = @run and repo_id = @repo)", new { run = runId, repo = repoId }, ct), ct);
        return found ? clientId : null;
    }

    private static async Task<bool> IsGuestAsync(IServiceProvider services, Guid userId, CancellationToken ct) =>
        await SqlJson.ScalarAsync<string>(services.GetRequiredService<DccDbContext>(), "select kind from users where id = @id", new { id = userId }, ct) == "guest";
}
