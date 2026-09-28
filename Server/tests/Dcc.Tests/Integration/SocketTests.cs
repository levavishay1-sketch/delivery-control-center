using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Dcc.Api.Sockets;
using Dcc.Tests.Support;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Dcc.Tests.Integration;

/// <summary>The WebSocket handshake: auth first, permission next, re-auth while open.</summary>
[Collection(DbCollection.Name)]
public sealed class SocketTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private async Task<WebSocket> ConnectAsync(string path = "/ws/session") =>
        await _f.Server.CreateWebSocketClient().ConnectAsync(new Uri(_f.Server.BaseAddress, path), CancellationToken.None);

    private static Task SendAsync(WebSocket ws, object msg) =>
        ws.SendAsync(JsonSerializer.SerializeToUtf8Bytes(msg), WebSocketMessageType.Text, true, CancellationToken.None);

    /// <summary>Reads until a text message or a close arrives; returns the message type, or null on close.</summary>
    private static async Task<string?> ReceiveAsync(WebSocket ws, int timeoutSeconds = 10)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds));
        var buffer = new byte[4096];
        var r = await ws.ReceiveAsync(buffer, cts.Token);
        if (r.MessageType == WebSocketMessageType.Close) return null;
        return JsonDocument.Parse(Encoding.UTF8.GetString(buffer, 0, r.Count)).RootElement.GetProperty("type").GetString();
    }

    [Fact]
    public async Task No_auth_message_in_time_closes_with_4401()
    {
        using var ws = await ConnectAsync();
        Assert.Null(await ReceiveAsync(ws));
        Assert.Equal(4401, (int)ws.CloseStatus!.Value);
    }

    [Fact]
    public async Task A_valid_token_opens_the_socket()
    {
        var (_, token, _) = await _f.NewUserAsync();
        using var ws = await ConnectAsync();
        await SendAsync(ws, new { type = "auth", token });
        Assert.Equal("ready", await ReceiveAsync(ws));
        await SendAsync(ws, new { type = "ping" });
        Assert.Equal("pong", await ReceiveAsync(ws));
    }

    [Fact]
    public async Task A_bad_token_closes_with_4401()
    {
        using var ws = await ConnectAsync();
        await SendAsync(ws, new { type = "auth", token = "not.a.token" });
        Assert.Null(await ReceiveAsync(ws));
        Assert.Equal(4401, (int)ws.CloseStatus!.Value);
    }

    [Fact]
    public async Task Without_permission_on_the_resource_it_closes_with_4403()
    {
        using var app = _f.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<IStartupFilter, ForbiddenSocketEndpoint>()));
        var (_, token, _) = await _f.NewUserAsync();
        using var ws = await app.Server.CreateWebSocketClient().ConnectAsync(new Uri(app.Server.BaseAddress, "/ws/test-forbidden"), CancellationToken.None);
        await SendAsync(ws, new { type = "auth", token });
        Assert.Null(await ReceiveAsync(ws));
        Assert.Equal(4403, (int)ws.CloseStatus!.Value);
    }

    [Fact]
    public async Task A_permission_change_asks_for_a_new_token_and_closes_if_none_comes()
    {
        var (id, token, _) = await _f.NewUserAsync();
        using var ws = await ConnectAsync();
        await SendAsync(ws, new { type = "auth", token });
        Assert.Equal("ready", await ReceiveAsync(ws));

        await _f.AssignAsync("user", id, "reader", "global", null); // raises perm_version
        Assert.Equal("reauth_required", await ReceiveAsync(ws));
        Assert.Null(await ReceiveAsync(ws)); // grace (2s in tests) passes with no new token
        Assert.Equal(4401, (int)ws.CloseStatus!.Value);
    }

    /// <summary>A test-only endpoint whose resource check always fails.</summary>
    private sealed class ForbiddenSocketEndpoint : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.UseWebSockets();
            app.Map("/ws/test-forbidden", branch => branch.Run(http =>
                AuthenticatedSocket.RunAsync(http, (_, _) => Task.FromResult(false), (_, _) => Task.CompletedTask)));
            next(app);
        };
    }
}
