using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Infrastructure.Onboarding;
using Dcc.Infrastructure.Persistence;
using Dcc.Tests.Support;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Dcc.Tests.Integration;

/// <summary>
/// Phase 4.7, the interactive half of onboarding: the run's terminal socket, the <c>/init</c> draft session in a real
/// pseudo-terminal (a stand-in interactive claude), the coach, and opening a DCC folder on this machine. The run rows
/// are written straight into the database — the engine is not needed to drive a session.
/// </summary>
[Collection(DbCollection.Name)]
public sealed class OnboardingSessionTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static readonly ConcurrentDictionary<DccFactory, WebApplicationFactory<Program>> Apps = new();
    private static readonly ConcurrentDictionary<DccFactory, WebApplicationFactory<Program>> ProductionApps = new();
    private static readonly FakeLauncher Launcher = new();

    /// <summary>The API with the onboarding sessions, the stand-in claude in the terminal, and no file manager or engine of its own.</summary>
    private WebApplicationFactory<Program> App => Apps.GetOrAdd(_f, f =>
    {
        var script = Path.Combine(f.TempDir, "fake-claude-terminal.cjs");
        File.WriteAllText(script, FakeClaudeTerminal.Script);
        return f.WithWebHostBuilder(b => b.ConfigureTestServices(s => Sessions(s, script)));
    });

    private WebApplicationFactory<Program> ProductionApp => ProductionApps.GetOrAdd(_f, f => f.WithWebHostBuilder(b =>
    {
        b.UseEnvironment("Production");
        b.ConfigureTestServices(s => Sessions(s, "none"));
    }));

    private static void Sessions(IServiceCollection s, string script)
    {
        s.AddOnboardingSessions();
        s.PostConfigure<OnboardingTerminalOptions>(o =>
        {
            o.Bin = "node";
            o.BinArgs = [script];
        });
        // No weekly recheck reaching the network from a test host.
        foreach (var d in s.Where(d => d.ImplementationType == typeof(CoachSchedule)).ToList()) s.Remove(d);
        s.AddSingleton<IFolderLauncher>(Launcher);
        s.AddScoped<ICoachRunStarter, FakeCoachRunStarter>();
    }

    private IDraftSessions Drafts => App.Services.GetRequiredService<IDraftSessions>();
    private IOnboardingTerminal Terminal => App.Services.GetRequiredService<IOnboardingTerminal>();

    // ── helpers ──────────────────────────────────────────────────────

    private HttpClient Http(string token, WebApplicationFactory<Program>? app = null)
    {
        var c = (app ?? App).CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false, AllowAutoRedirect = false });
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    private static async Task<string> Message(HttpResponseMessage res) =>
        Regex.Unescape((await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString() ?? "");

    /// <summary>A person with <paramref name="roleKey"/> on <paramref name="clientId"/> (none when null), signed in afresh.</summary>
    private async Task<(Guid Id, string Token)> UserAsync(string? roleKey, Guid clientId, string kind = "person")
    {
        var (id, token, password) = await _f.NewUserAsync(kind);
        if (roleKey is null) return (id, token);
        await _f.AssignAsync("user", id, roleKey, "client", clientId);
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", id));
        return (id, (await _f.LoginAsync(email, password)).AccessToken);
    }

    private sealed record Run(Guid ClientId, Guid RepoId, Guid RunId, Guid By, string Workspace)
    {
        public DraftCtx Ctx => new(RepoId, RunId, ClientId, By);
    }

    /// <summary>A repository of its own and a run in it, with the plan step in <paramref name="planStatus"/>.</summary>
    private async Task<Run> NewRunAsync(string planStatus = "WaitingForUser", string runStatus = "WaitingForUser", string session = """{"state":"none"}""", Guid? clientId = null)
    {
        var client = clientId ?? await _f.NewClientAsync();
        var repo = await _f.ScalarAsync<Guid>("insert into repo(name, client_id) values (@n, @c) returning id", ("n", "ob-" + Guid.NewGuid().ToString("N")[..6]), ("c", client));
        var by = await _f.ScalarAsync<Guid>("select id from users order by created_at limit 1");
        var workspace = Path.Combine(_f.TempDir, "ws-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(workspace);
        var run = await _f.ScalarAsync<Guid>("""
            insert into repository_onboarding_run (repo_id, client_id, status, current_step_key, workspace_path, session, triggered_by)
            values (@r, @c, @s, 'plan', @w, @session::jsonb, @by) returning id
            """, ("r", repo), ("c", client), ("s", runStatus), ("w", workspace), ("session", session), ("by", by));
        await _f.ExecAsync("insert into repository_onboarding_step (run_id, client_id, step_key, step_order, status) values (@run, @c, 'plan', 4, @s)",
            ("run", run), ("c", client), ("s", planStatus));
        return new Run(client, repo, run, by, workspace);
    }

    private async Task<JsonObject> SessionAsync(Guid runId) =>
        RunSessions.Of(JsonNode.Parse(await _f.ScalarAsync<string>("select session::text from repository_onboarding_run where id = @id", ("id", runId))));

    private async Task<JsonObject> WaitForSessionAsync(Guid runId, Func<JsonObject, bool> until, int seconds = 25)
    {
        var deadline = DateTime.UtcNow.AddSeconds(seconds);
        while (true)
        {
            var s = await SessionAsync(runId);
            if (until(s)) return s;
            if (DateTime.UtcNow > deadline) throw new TimeoutException($"the session never got there: {s.ToJsonString()}");
            await Task.Delay(200);
        }
    }

    private static string? State(JsonObject s) => s["state"]?.GetValue<string>();

    private async Task<List<(string Type, JsonObject Payload, Guid? Actor)>> EventsAsync(Guid runId)
    {
        var json = await _f.ScalarAsync<string>("""
            select coalesce(json_agg(json_build_object('type', type, 'payload', payload, 'actor', actor_user_id) order by occurred_at, id), '[]')::text
            from repo_ai_event where payload->>'runId' = @run
            """, ("run", runId.ToString()));
        return JsonNode.Parse(json)!.AsArray().Select(e => (e!["type"]!.GetValue<string>(), e["payload"]!.AsObject(),
            e["actor"] is JsonValue a ? Guid.Parse(a.GetValue<string>()) : (Guid?)null)).ToList();
    }

    /// <summary>The run's events once <paramref name="count"/> of type <paramref name="type"/> are written (the end of a session is written just after its state).</summary>
    private async Task<List<(string Type, JsonObject Payload, Guid? Actor)>> WaitForEventAsync(Guid runId, string type, int count = 1)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (true)
        {
            var events = await EventsAsync(runId);
            if (events.Count(e => e.Type == type) >= count || DateTime.UtcNow > deadline) return events;
            await Task.Delay(100);
        }
    }

    private async Task LaunchAsync(Run r, bool resume = false) =>
        await Drafts.LaunchAsync(r.Ctx, r.Workspace, await SessionAsync(r.RunId), r.By, resume, null, null, CancellationToken.None);

    /// <summary>/exit, and the end written down (the last slice is recorded before the state turns "ended").</summary>
    private async Task StopAsync(Run r)
    {
        await Drafts.StopAsync(r.Ctx, r.By, CancellationToken.None);
        await WaitForSessionAsync(r.RunId, s => State(s) == "ended");
    }

    /// <summary>A test never leaves a process behind, whatever it asserted.</summary>
    private async Task CleanUpAsync(Run r)
    {
        if (Terminal.State(r.RunId) == "live") await Drafts.StopAsync(r.Ctx, r.By, CancellationToken.None);
    }

    private string Screen(Guid runId)
    {
        var (replay, _, sub) = Terminal.Subscribe(runId, _ => { });
        sub.Dispose();
        return replay;
    }

    // ── the socket ───────────────────────────────────────────────────

    private async Task<WebSocket> TerminalAsync(Guid repoId, Guid runId, string? token)
    {
        var ws = await App.Server.CreateWebSocketClient().ConnectAsync(new Uri(App.Server.BaseAddress, $"/repos/{repoId}/onboarding/runs/{runId}/terminal"), CancellationToken.None);
        if (token is not null) await SendAsync(ws, new { type = "auth", token });
        return ws;
    }

    private static Task SendAsync(WebSocket ws, object msg) =>
        ws.SendAsync(JsonSerializer.SerializeToUtf8Bytes(msg), WebSocketMessageType.Text, true, CancellationToken.None);

    /// <summary>One whole message (a replay spans many frames), or null when the socket closed.</summary>
    private static async Task<JsonElement?> ReceiveAsync(WebSocket ws, int seconds = 15)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(seconds));
        var buffer = new byte[64 * 1024];
        using var ms = new MemoryStream();
        while (true)
        {
            var r = await ws.ReceiveAsync(buffer, cts.Token);
            if (r.MessageType == WebSocketMessageType.Close) return null;
            ms.Write(buffer, 0, r.Count);
            if (r.EndOfMessage) break;
        }
        return JsonDocument.Parse(ms.ToArray()).RootElement.Clone();
    }

    private static string Type(JsonElement? m) => m?.GetProperty("type").GetString() ?? "(closed)";

    /// <summary>Reads until what the screen showed (from <paramref name="seen"/> on) holds <paramref name="text"/>.</summary>
    private static async Task<string> UntilShownAsync(WebSocket ws, string text, string seen = "", int seconds = 20)
    {
        var shown = new StringBuilder(seen);
        var deadline = DateTime.UtcNow.AddSeconds(seconds);
        while (!shown.ToString().Contains(text, StringComparison.Ordinal))
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException($"\"{text}\" was never shown: {shown}");
            var m = await ReceiveAsync(ws, seconds) ?? throw new InvalidOperationException($"closed ({ws.CloseStatus}) before \"{text}\" was shown: {shown}");
            if (Type(m) is "replay" or "output") shown.Append(m.GetProperty("data").GetString());
        }
        return shown.ToString();
    }

    private async Task AssertClosedAsync(Guid repoId, Guid runId, string? token, int code)
    {
        using var ws = await TerminalAsync(repoId, runId, token);
        Assert.Null(await ReceiveAsync(ws));
        Assert.Equal(code, (int)ws.CloseStatus!.Value);
    }

    [Fact]
    public async Task The_terminal_needs_a_token_then_repos_read_on_the_client_that_owns_the_repository()
    {
        var r = await NewRunAsync();
        await AssertClosedAsync(r.RepoId, r.RunId, null, 4401);
        await AssertClosedAsync(r.RepoId, r.RunId, "not.a.token", 4401);
        await AssertClosedAsync(r.RepoId, r.RunId, (await UserAsync(null, r.ClientId)).Token, 4403);
        await AssertClosedAsync(r.RepoId, r.RunId, (await UserAsync("client_manager", await _f.NewClientAsync())).Token, 4403);

        // Watching is reading — a guest who may read the repositories watches, as on the run's own page; typing never.
        using (var guestWs = await TerminalAsync(r.RepoId, r.RunId, (await UserAsync("client_manager", r.ClientId, kind: "guest")).Token))
            Assert.Equal("ready", Type(await ReceiveAsync(guestWs)));

        var (_, reader) = await UserAsync("reader", r.ClientId);
        // A run of another repository of the same client, under this repository's address.
        var other = await NewRunAsync(clientId: r.ClientId);
        await AssertClosedAsync(r.RepoId, other.RunId, reader, 4403);

        using var ws = await TerminalAsync(r.RepoId, r.RunId, reader);
        Assert.Equal("ready", Type(await ReceiveAsync(ws)));
        Assert.Equal("replay", Type(await ReceiveAsync(ws)));
        var state = await ReceiveAsync(ws);
        Assert.Equal("state", Type(state));
        Assert.Equal("none", state!.Value.GetProperty("state").GetString());
    }

    [Fact]
    public async Task A_fresh_token_is_checked_against_the_run_again_so_a_revoked_permission_closes_the_terminal()
    {
        var r = await NewRunAsync();
        var (id, _, password) = await _f.NewUserAsync();
        var assignment = await _f.AssignAsync("user", id, "reader", "client", r.ClientId);
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", id));
        using var ws = await TerminalAsync(r.RepoId, r.RunId, (await _f.LoginAsync(email, password)).AccessToken);
        Assert.Equal("ready", Type(await ReceiveAsync(ws)));
        Assert.Equal("replay", Type(await ReceiveAsync(ws)));
        Assert.Equal("state", Type(await ReceiveAsync(ws)));

        (await _f.Client(await _f.AdminTokenAsync()).DeleteAsync($"/role-assignments/{assignment}")).EnsureSuccessStatusCode();
        Assert.Equal("reauth_required", Type(await ReceiveAsync(ws)));
        // The person signs in again — a valid token, but no longer one that may watch this run.
        await SendAsync(ws, new { type = "auth", token = (await _f.LoginAsync(email, password)).AccessToken });
        Assert.Null(await ReceiveAsync(ws));
        Assert.Equal(4403, (int)ws.CloseStatus!.Value);
    }

    [Fact]
    public async Task A_fresh_token_that_still_may_watch_keeps_the_same_terminal_open()
    {
        var r = await NewRunAsync();
        var (id, _, password) = await _f.NewUserAsync();
        await _f.AssignAsync("user", id, "reader", "client", r.ClientId);
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", id));
        using var ws = await TerminalAsync(r.RepoId, r.RunId, (await _f.LoginAsync(email, password)).AccessToken);
        Assert.Equal("ready", Type(await ReceiveAsync(ws)));
        Assert.Equal("replay", Type(await ReceiveAsync(ws)));
        Assert.Equal("state", Type(await ReceiveAsync(ws)));

        // One more role changes what the person may do: the socket asks for a fresh token, and with one stays open —
        // the screen is not drawn again from the start (what the web client now does every hour).
        await _f.AssignAsync("user", id, "client_manager", "client", r.ClientId);
        Assert.Equal("reauth_required", Type(await ReceiveAsync(ws)));
        await SendAsync(ws, new { type = "auth", token = (await _f.LoginAsync(email, password)).AccessToken });
        Assert.Equal("reauthed", Type(await ReceiveAsync(ws)));
        Terminal.Line(r.RunId, "after the fresh token");
        await UntilShownAsync(ws, "after the fresh token");
        Assert.Equal(WebSocketState.Open, ws.State);
    }

    [Fact]
    public async Task The_terminal_replays_the_screen_and_takes_keystrokes_only_from_who_may_onboard()
    {
        var r = await NewRunAsync();
        var (managerId, manager) = await UserAsync("client_manager", r.ClientId);
        var (_, reader) = await UserAsync("reader", r.ClientId);
        var (_, guest) = await UserAsync("client_manager", r.ClientId, kind: "guest");
        try
        {
            await LaunchAsync(r);
            Assert.Equal("הסשן כבר פעיל", (await Assert.ThrowsAsync<DraftRefused>(() => LaunchAsync(r))).Message);

            // A guest holding the manager's role watches like a reader, and like a reader types to nobody.
            using (var guestWs = await TerminalAsync(r.RepoId, r.RunId, guest))
            {
                Assert.Equal("ready", Type(await ReceiveAsync(guestWs)));
                Assert.Equal("replay", Type(await ReceiveAsync(guestWs)));
                await SendAsync(guestWs, new { type = "input", data = "from the guest\r" });
            }

            using var watcher = await TerminalAsync(r.RepoId, r.RunId, reader);
            Assert.Equal("ready", Type(await ReceiveAsync(watcher)));
            var replay = await ReceiveAsync(watcher);
            Assert.Equal("replay", Type(replay));
            var seen = replay!.Value.GetProperty("data").GetString()!;
            Assert.Contains("dcc$ claude --session-id ", seen);
            var state = await ReceiveAsync(watcher);
            Assert.Equal("live", state!.Value.GetProperty("state").GetString());
            seen = await UntilShownAsync(watcher, "שלום", seen);

            // The reader watches; their keystrokes reach nobody. A paste larger than a sign-in message may be does not close the socket.
            await SendAsync(watcher, new { type = "input", data = "from the reader\r" });
            await SendAsync(watcher, new { type = "input", data = new string('x', 200 * 1024) });

            using var typist = await TerminalAsync(r.RepoId, r.RunId, manager);
            Assert.Equal("ready", Type(await ReceiveAsync(typist)));
            Assert.Contains("שלום", (await ReceiveAsync(typist))!.Value.GetProperty("data").GetString());
            Assert.Equal("state", Type(await ReceiveAsync(typist)));
            await SendAsync(typist, new { type = "resize", cols = 100, rows = 30 });
            await SendAsync(typist, new { type = "input", data = "from the manager\r" });

            seen = await UntilShownAsync(watcher, "you said: from the manager", seen);
            Assert.DoesNotContain("from the reader", seen);
            Assert.DoesNotContain("from the guest", seen);
            Assert.Equal(managerId, Terminal.LastInputUser(r.RunId));
        }
        finally { await CleanUpAsync(r); }
    }

    // ── the /init draft session ──────────────────────────────────────

    [Fact]
    public async Task A_draft_session_runs_records_its_spend_in_slices_and_resumes_the_same_conversation()
    {
        var r = await NewRunAsync();
        try
        {
            await LaunchAsync(r);
            Assert.Equal("live", Terminal.State(r.RunId));
            var started = await WaitForSessionAsync(r.RunId, s => s["transcriptPath"] is not null && s["status"]?["costUsd"]?.GetValue<double>() > 0);
            var sessionId = started["id"]!.GetValue<string>();
            Assert.Equal("live", State(started));
            Assert.Equal(0.0, started["ledgerCursor"]!["costUsd"]!.GetValue<double>());
            var screen = Screen(r.RunId);
            Assert.Contains($"FAKE CLAUDE new {sessionId} שלום", screen);
            Assert.Contains($"dcc$ claude --session-id {sessionId} --settings ", screen);

            // The /init turn ended: an instruction is typed in and seen in the transcript.
            var sent = await Drafts.SendAsync(r.Ctx, started, r.By, "hello there", "m-1", false, CancellationToken.None);
            Assert.True(sent["sent"]!.GetValue<bool>());
            Assert.True(sent["confirmed"]!.GetValue<bool>());

            // A turn still running: not typed unless forced.
            Assert.True((await Drafts.SendAsync(r.Ctx, started, r.By, "work on the docs", null, false, CancellationToken.None))["confirmed"]!.GetValue<bool>());
            var busy = await Drafts.SendAsync(r.Ctx, started, r.By, "and now this", null, false, CancellationToken.None);
            Assert.False(busy["sent"]!.GetValue<bool>());
            Assert.True(busy["busy"]!.GetValue<bool>());
            Assert.Equal("Claude ממתין לאישור שלך או מריץ פעולה", busy["reason"]!.GetValue<string>());
            Assert.True((await Drafts.SendAsync(r.Ctx, started, r.By, "and now this", null, true, CancellationToken.None))["sent"]!.GetValue<bool>());
            Assert.Equal("אין מה לשלוח", (await Assert.ThrowsAsync<DraftRefused>(() => Drafts.SendAsync(r.Ctx, started, r.By, "  \r\n ", null, true, CancellationToken.None))).Message);

            await StopAsync(r);
            Assert.Equal("ended", Terminal.State(r.RunId));
            Assert.Contains("[סשן Claude הסתיים]", Screen(r.RunId));
            var ended = await SessionAsync(r.RunId);
            Assert.Equal(0, ended["exitCode"]!.GetValue<int>());
            Assert.NotNull(ended["endedAt"]);

            // Four prompts at $0.02 (/init, two typed, one forced): all of it in the ledger, in slices of the run.
            Assert.Equal(0.08m, await _f.ScalarAsync<decimal>("""
                select coalesce(sum(cost_usd), 0) from claude_call
                where entity_kind = 'onboarding_run' and entity_id = @id and capability = 'onboarding_init' and trigger = 'session'
                """, ("id", r.RunId.ToString())));
            Assert.Equal(800L, await _f.ScalarAsync<long>("select coalesce(sum(input_tokens), 0) from claude_call where entity_id = @id", ("id", r.RunId.ToString())));
            Assert.Equal(0L, await _f.ScalarAsync<long>("""
                select count(*) from claude_call where entity_id = @id and (label <> 'טיוטת /init בסשן' or screen <> 'onboarding' or meta->>'stepKey' <> 'plan')
                """, ("id", r.RunId.ToString())));

            var events = await WaitForEventAsync(r.RunId, "onboarding.session.ended");
            var types = events.Select(e => e.Type).ToList();
            Assert.Contains("onboarding.session.started", types);
            Assert.Equal(sessionId, events.First(e => e.Type == "onboarding.session.started").Payload["sessionId"]!.GetValue<string>());
            Assert.Contains(events, e => e.Type == "onboarding.session.command" && e.Payload["command"]!.GetValue<string>() == "/init" && e.Payload["stepKey"]!.GetValue<string>() == "plan");
            Assert.Contains(events, e => e.Type == "onboarding.session.prompt" && e.Payload["text"]!.GetValue<string>() == "hello there");
            var instructed = events.Where(e => e.Type == "onboarding.session.instructed").ToList();
            Assert.Equal(3, instructed.Count);
            Assert.Equal("m-1", instructed[0].Payload["messageId"]!.GetValue<string>());
            Assert.True(instructed[2].Payload["forced"]!.GetValue<bool>());
            Assert.Contains(events, e => e.Type == "onboarding.session.ended" && e.Payload["exitCode"]!.GetValue<int>() == 0);

            // Resumed: the same conversation, with what it spent so far as its base.
            await LaunchAsync(r, resume: true);
            var resumed = await WaitForSessionAsync(r.RunId, s => State(s) == "live");
            Assert.Equal(sessionId, resumed["id"]!.GetValue<string>());
            Assert.Equal(0.08, resumed["base"]!["costUsd"]!.GetValue<double>(), 6);
            Assert.Contains($"FAKE CLAUDE resumed {sessionId}", Screen(r.RunId));
            Assert.Contains($"dcc$ claude --resume {sessionId} --settings ", Screen(r.RunId));
            Assert.True((await Drafts.SendAsync(r.Ctx, resumed, r.By, "after resuming", null, false, CancellationToken.None))["confirmed"]!.GetValue<bool>());
            await StopAsync(r);
            Assert.Equal(0.10m, await _f.ScalarAsync<decimal>("select coalesce(sum(cost_usd), 0) from claude_call where entity_id = @id", ("id", r.RunId.ToString())));
            Assert.Contains("onboarding.session.resumed", (await WaitForEventAsync(r.RunId, "onboarding.session.ended", 2)).Select(e => e.Type));
        }
        finally { await CleanUpAsync(r); }
    }

    [Fact]
    public async Task The_draft_session_opens_only_while_the_plan_waits_and_resumes_only_a_session_there_was()
    {
        foreach (var status in new[] { "Pending", "Running", "Completed" })
        {
            var r = await NewRunAsync(planStatus: status);
            Assert.Equal("טיוטת /init נפתחת כשהתוכנית פתוחה לאישור", (await Assert.ThrowsAsync<DraftRefused>(() => LaunchAsync(r))).Message);
            Assert.Equal("none", Terminal.State(r.RunId));
        }
        // A model goes on a command line: only a plain name gets that far. An empty choice is no choice, as before.
        var pending = await NewRunAsync(planStatus: "Pending");
        Assert.Equal("המודל או רמת המאמץ שנבחרו לא מוכרים", (await Assert.ThrowsAsync<DraftRefused>(() =>
            Drafts.LaunchAsync(pending.Ctx, pending.Workspace, new JsonObject(), pending.By, false, "opus\" & calc", null, CancellationToken.None))).Message);
        Assert.Equal("המודל או רמת המאמץ שנבחרו לא מוכרים", (await Assert.ThrowsAsync<DraftRefused>(() =>
            Drafts.LaunchAsync(pending.Ctx, pending.Workspace, new JsonObject(), pending.By, false, null, "extreme", CancellationToken.None))).Message);
        Assert.Equal("טיוטת /init נפתחת כשהתוכנית פתוחה לאישור", (await Assert.ThrowsAsync<DraftRefused>(() =>
            Drafts.LaunchAsync(pending.Ctx, pending.Workspace, new JsonObject(), pending.By, false, "", "", CancellationToken.None))).Message);

        var waiting = await NewRunAsync();
        Assert.Equal("עדיין לא היה סשן טיוטה בהרצה הזו", (await Assert.ThrowsAsync<DraftRefused>(() => LaunchAsync(waiting, resume: true))).Message);
        Assert.Equal("סשן הטיוטה לא פעיל — פתחו אותו מכרטיס הטיוטה ואז שלחו",
            (await Assert.ThrowsAsync<DraftRefused>(() => Drafts.SendAsync(waiting.Ctx, new JsonObject(), waiting.By, "hi", null, true, CancellationToken.None))).Message);
    }

    [Fact]
    public async Task After_a_restart_a_live_session_is_marked_disconnected_once()
    {
        var r = await NewRunAsync(session: """{"state":"live","id":"5f0e7b52-8d2c-4c1e-9a36-1f7d1f4f2a10"}""");
        Assert.True(await Drafts.RecoverAsync(r.Ctx, await SessionAsync(r.RunId), CancellationToken.None));
        Assert.Equal("disconnected", State(await SessionAsync(r.RunId)));
        Assert.Equal("disconnected", Terminal.State(r.RunId));
        Assert.Contains("[השרת הופעל מחדש — סשן הטיוטה נותק. אפשר לחדש אותו מאותה נקודה]", Screen(r.RunId));
        var disconnected = Assert.Single(await EventsAsync(r.RunId), e => e.Type == "onboarding.session.disconnected");
        Assert.Equal("api_restart", disconnected.Payload["reason"]!.GetValue<string>());
        Assert.Null(disconnected.Actor);

        // Already disconnected: nothing new is written.
        Assert.False(await Drafts.RecoverAsync(r.Ctx, await SessionAsync(r.RunId), CancellationToken.None));
        Assert.Single(await EventsAsync(r.RunId), e => e.Type == "onboarding.session.disconnected");
    }

    [Fact]
    public void A_letter_split_between_two_reads_of_the_terminal_is_decoded_whole()
    {
        var bytes = Encoding.UTF8.GetBytes("שלום");
        var d = new TerminalDecoder();
        Assert.Equal("ש", d.Decode(bytes.AsSpan(0, 3)));
        Assert.Equal("לום", d.Decode(bytes.AsSpan(3)));
        var cut = new TerminalDecoder();
        Assert.Equal("", cut.Decode(bytes.AsSpan(0, 1)));
        Assert.Equal("�", cut.Decode([], flush: true));
    }

    // ── the coach ────────────────────────────────────────────────────

    private async Task<Guid> ProposalAsync(Run r, string key = "build_gate_hook", string title = "hook: build עובר לפני \"סיימתי\"") =>
        await _f.ScalarAsync<Guid>("""
            insert into repo_coach_proposal (repo_id, client_id, kind, component_key, title, why, evidence, measure)
            values (@r, @c, 'add', @k, @t, 'בדיקת build נכשלה ב-2 מתוך 3 משימות', '{"check":"build"}'::jsonb, '{"key":"check_build_fail_rate","before":0.67}'::jsonb)
            returning id
            """, ("r", r.RepoId), ("c", r.ClientId), ("k", key), ("t", title));

    private string Decide(Run r, Guid proposalId) => $"/repos/{r.RepoId}/coach/proposals/{proposalId}/decide";

    [Fact]
    public async Task The_coach_panel_shows_the_repositorys_proposals_to_a_reader_of_its_client()
    {
        var r = await NewRunAsync();
        var p = await ProposalAsync(r);
        var (_, reader) = await UserAsync("reader", r.ClientId);

        var view = await Ok(await Http(reader).GetAsync($"/repos/{r.RepoId}/coach"));
        var proposal = Assert.Single(view.GetProperty("proposals").EnumerateArray());
        Assert.Equal(p.ToString(), proposal.GetProperty("id").GetString());
        Assert.Equal("proposed", proposal.GetProperty("status").GetString());
        Assert.Equal("build", proposal.GetProperty("evidence").GetProperty("check").GetString());
        Assert.Equal(JsonValueKind.Null, proposal.GetProperty("decidedAt").ValueKind);
        Assert.Equal(JsonValueKind.Null, proposal.GetProperty("runId").ValueKind);
        var health = view.GetProperty("health");
        Assert.Equal(0, health.GetProperty("tasks").GetInt32());
        Assert.Equal(30, health.GetProperty("windowDays").GetInt32());
        Assert.Equal(JsonValueKind.Null, health.GetProperty("score").ValueKind);
        Assert.Empty(view.GetProperty("installed").EnumerateArray());
        Assert.Equal(JsonValueKind.Null, view.GetProperty("lastRun").ValueKind);
        Assert.Empty(view.GetProperty("newInWorld").EnumerateArray());
        Assert.Equal(JsonValueKind.Array, view.GetProperty("acrossRepos").ValueKind);

        Assert.Equal(HttpStatusCode.Forbidden, (await Http((await UserAsync("reader", await _f.NewClientAsync())).Token).GetAsync($"/repos/{r.RepoId}/coach")).StatusCode);
        var unknown = await Http(reader).GetAsync($"/repos/{Guid.NewGuid()}/coach");
        Assert.Equal(HttpStatusCode.Conflict, unknown.StatusCode);
        Assert.Equal("הריפו לא נמצא או משותף", await Message(unknown));
    }

    [Fact]
    public async Task A_check_that_keeps_failing_becomes_one_proposal_with_its_evidence_written_once()
    {
        var r = await NewRunAsync(planStatus: "Completed", runStatus: "Completed");
        var req = await _f.NewRequirementAsync(r.ClientId);
        await _f.ExecAsync("insert into workitem_repo(client_id, workitem_id, repo_id, link_kind) values (@c, @w, @r, 'declared')", ("c", r.ClientId), ("w", req), ("r", r.RepoId));
        // Three developed tasks; the build check failed on the first two — not a one-off.
        foreach (var (seq, result) in new[] { (1, "failed"), (2, "failed"), (3, "passed") })
        {
            var task = await _f.ScalarAsync<Guid>("insert into task (client_id, workitem_id, seq, intent, kind) values (@c, @w, @s, @i, 'task') returning id",
                ("c", r.ClientId), ("w", req), ("s", seq), ("i", $"משימה {seq}"));
            await _f.ExecAsync("""
                insert into task (client_id, workitem_id, seq, intent, kind, parent_task_id, check_kind, check_result)
                values (@c, @w, @s, 'build', 'check', @p, 'build', @res)
                """, ("c", r.ClientId), ("w", req), ("s", 100 + seq), ("p", task), ("res", result));
            await _f.ExecAsync("insert into flow_run (client_id, workitem_id, task_id, kind, state) values (@c, @w, @t, 'implement', 'done')",
                ("c", r.ClientId), ("w", req), ("t", task));
        }
        var (_, reader) = await UserAsync("reader", r.ClientId);

        var view = await Ok(await Http(reader).GetAsync($"/repos/{r.RepoId}/coach"));
        var health = view.GetProperty("health");
        Assert.Equal(3, health.GetProperty("tasks").GetInt32());
        Assert.Equal(1.0 / 3, health.GetProperty("firstPassRate").GetDouble(), 10);
        Assert.Equal(0, health.GetProperty("rerunsPerTask").GetDouble());
        Assert.Equal(67, health.GetProperty("score").GetInt32());
        Assert.Equal(JsonValueKind.Null, health.GetProperty("costPerTaskUsd").ValueKind);
        Assert.Equal(r.RunId.ToString(), view.GetProperty("lastRun").GetProperty("id").GetString());
        var p = Assert.Single(view.GetProperty("proposals").EnumerateArray());
        Assert.Equal("add", p.GetProperty("kind").GetString());
        Assert.Equal("build_gate_hook", p.GetProperty("componentKey").GetString());
        Assert.Equal("proposed", p.GetProperty("status").GetString());
        Assert.Equal("בדיקת build נכשלה ב-2 מתוך 3 משימות ב-30 הימים האחרונים (#1, #2). זה לא אירוע בודד.", p.GetProperty("why").GetString());
        Assert.Equal(0.67, p.GetProperty("measure").GetProperty("before").GetDouble());
        Assert.Equal(3, p.GetProperty("evidence").GetProperty("ran").GetInt32());
        Assert.Equal("משימה 1", p.GetProperty("evidence").GetProperty("failed")[0].GetProperty("intent").GetString());
        Assert.Equal("build-gate", p.GetProperty("evidence").GetProperty("seed").GetProperty("params").GetProperty("template").GetString());

        // Read again: the same proposal, not a second one, and one event that it was written.
        var again = await Ok(await Http(reader).GetAsync($"/repos/{r.RepoId}/coach"));
        Assert.Equal(p.GetProperty("id").GetString(), Assert.Single(again.GetProperty("proposals").EnumerateArray()).GetProperty("id").GetString());
        Assert.Equal(1L, await _f.ScalarAsync<long>("""
            select count(*) from repo_ai_event where repo_id = @r and type = 'coach.proposal.created' and payload->>'componentKey' = 'build_gate_hook' and actor_user_id is null
            """, ("r", r.RepoId)));
    }

    [Fact]
    public async Task Approving_a_proposal_while_a_run_is_live_is_refused_before_anything_is_saved()
    {
        var r = await NewRunAsync(); // a run that waits for the plan: live
        var p = await ProposalAsync(r);
        var later = await ProposalAsync(r, "environment_note", "שורת הנחיה: מה חסר בסביבה של הסוכן");
        var (managerId, manager) = await UserAsync("client_manager", r.ClientId);
        var (_, reader) = await UserAsync("reader", r.ClientId);
        Task<string> StatusAsync(Guid id) => _f.ScalarAsync<string>("select status from repo_coach_proposal where id = @id", ("id", id));

        Assert.Equal(HttpStatusCode.Forbidden, (await Http(reader).PostAsJsonAsync(Decide(r, p), new { decision = "approve" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Http(manager).PostAsJsonAsync(Decide(r, p), new { decision = "maybe" })).StatusCode);

        var refused = await Http(manager).PostAsJsonAsync(Decide(r, p), new { decision = "approve" });
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("כבר יש הרצה פעילה לריפו הזה — סיימו או בטלו אותה קודם", await Message(refused));
        Assert.Equal("proposed", await StatusAsync(p));
        Assert.Equal(0L, await _f.ScalarAsync<long>("select count(*) from repo_coach_proposal where id = @id and decided_at is not null", ("id", p)));
        Assert.Equal(0L, await _f.ScalarAsync<long>("select count(*) from repo_ai_event where type = 'coach.proposal.decided' and payload->>'proposalId' = @id", ("id", p.ToString())));

        // The run is over; a run that starts in the moment between the check and the start leaves the proposal waiting again.
        await _f.ExecAsync("update repository_onboarding_run set status = 'Completed', completed_at = now() where id = @id", ("id", r.RunId));
        FakeCoachRunStarter.FailNext = true;
        Assert.Equal(HttpStatusCode.Conflict, (await Http(manager).PostAsJsonAsync(Decide(r, p), new { decision = "approve" })).StatusCode);
        Assert.Equal("proposed", await StatusAsync(p));

        var approved = await Ok(await Http(manager).PostAsJsonAsync(Decide(r, p), new { decision = "approve" }));
        Assert.Equal("approved", approved.GetProperty("status").GetString());
        var runId = approved.GetProperty("runId").GetString();
        Assert.Equal(runId, (await _f.ScalarAsync<Guid>("select run_id from repo_coach_proposal where id = @id", ("id", p))).ToString());
        Assert.Equal(managerId, await _f.ScalarAsync<Guid>("select decided_by from repo_coach_proposal where id = @id", ("id", p)));

        var again = await Http(manager).PostAsJsonAsync(Decide(r, p), new { decision = "decline" });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("ההצעה כבר הוכרעה", await Message(again));

        var declined = await Ok(await Http(manager).PostAsJsonAsync(Decide(r, later), new { decision = "decline", reason = "  not now  " }));
        Assert.Equal("declined", declined.GetProperty("status").GetString());
        Assert.False(declined.TryGetProperty("runId", out _));
        Assert.Equal("not now", await _f.ScalarAsync<string>("select decline_reason from repo_coach_proposal where id = @id", ("id", later)));
        Assert.Equal("  not now  ", await _f.ScalarAsync<string>(
            "select payload->>'reason' from repo_ai_event where type = 'coach.proposal.decided' and payload->>'proposalId' = @id", ("id", later.ToString())));
    }

    [Fact]
    public async Task Across_repositories_the_coach_names_only_components_of_DCCs_own_catalog()
    {
        // Another client delivered a run with two verified components: one of the catalog, under its own words, and one of its own.
        var other = await NewRunAsync(planStatus: "Completed", runStatus: "Completed");
        await _f.ExecAsync("""
            insert into onboarding_component (run_id, client_id, key, kind, family, title, why, what, source, "group", risk, status) values
              (@run, @c, 'build_gate_hook', 'hook', 'verification', 'SECRET build gate of the other client', 'w', 'w', 'rule', 'g', 'reversible', 'verified'),
              (@run, @c, 'other_private_card', 'rule', 'knowledge', 'PRIVATE card of the other client', 'w', 'w', 'user', 'g', 'reversible', 'verified')
            """, ("run", other.RunId), ("c", other.ClientId));
        await _f.ExecAsync("""
            insert into repository_onboarding_step (run_id, client_id, step_key, step_order, status, result)
            values (@run, @c, 'build', 5, 'Completed', '{"delta":{"before":{"passed":1},"after":{"passed":3}}}'::jsonb)
            """, ("run", other.RunId), ("c", other.ClientId));

        var mine = await NewRunAsync();
        var (_, reader) = await UserAsync("reader", mine.ClientId);
        var res = await Http(reader).GetAsync($"/repos/{mine.RepoId}/coach");
        var text = await res.Content.ReadAsStringAsync();
        var across = (await Ok(res)).GetProperty("acrossRepos").EnumerateArray().ToList();

        var gate = Assert.Single(across, a => a.GetProperty("key").GetString() == "build_gate_hook");
        Assert.Equal("hook: build עובר לפני \"סיימתי\"", gate.GetProperty("title").GetString());
        Assert.True(gate.GetProperty("repos").GetInt32() >= 1);
        Assert.True(gate.GetProperty("improved").GetInt32() >= 1);
        Assert.DoesNotContain(across, a => a.GetProperty("key").GetString() == "other_private_card");
        Assert.DoesNotContain("SECRET", text);
        Assert.DoesNotContain("PRIVATE", text);
    }

    // ── opening a folder ─────────────────────────────────────────────

    [Fact]
    public async Task A_folder_opens_only_under_DCCs_own_roots_for_a_reader_of_its_client()
    {
        var r = await NewRunAsync();
        var (_, reader) = await UserAsync("reader", r.ClientId);
        var (_, stranger) = await UserAsync("reader", await _f.NewClientAsync());
        var (_, guest) = await UserAsync("client_manager", r.ClientId, kind: "guest");
        var onboardingRoot = Path.Combine(_f.TempDir, "onboarding");
        var clone = Directory.CreateDirectory(Path.Combine(_f.RepoCachePath, r.RepoId.ToString(), "src")).FullName;
        var copy = Directory.CreateDirectory(Path.Combine(onboardingRoot, r.RunId.ToString(), "docs")).FullName;
        var runtime = Directory.CreateDirectory(Path.Combine(onboardingRoot, "_runtime", r.RunId.ToString())).FullName;
        var outside = Directory.CreateDirectory(Path.Combine(_f.TempDir, "elsewhere-" + Guid.NewGuid().ToString("N")[..6])).FullName;
        Task<HttpResponseMessage> Open(string token, string path) => Http(token).PostAsJsonAsync("/open-folder", new { path });

        foreach (var folder in new[] { clone, copy, runtime })
        {
            var before = Launcher.Opened.Count;
            var opened = await Ok(await Open(reader, folder));
            Assert.Equal(folder, opened.GetProperty("opened").GetString(), ignoreCase: true);
            Assert.Equal(before + 1, Launcher.Opened.Count);
        }
        var count = Launcher.Opened.Count;
        Assert.Equal(HttpStatusCode.Forbidden, (await Open(stranger, clone)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Open(guest, clone)).StatusCode);

        async Task RefusedAsync(string path, string message)
        {
            var res = await Open(reader, path);
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
            Assert.Equal(message, await Message(res));
        }
        await RefusedAsync(outside, "אפשר לפתוח רק תיקיות של DCC עצמו");
        await RefusedAsync(Path.Combine(clone, "..", "..", "..", Path.GetFileName(outside)), "אפשר לפתוח רק תיקיות של DCC עצמו");
        await RefusedAsync(_f.RepoCachePath, "אפשר לפתוח רק תיקיות של DCC עצמו");
        await RefusedAsync(Path.Combine(clone, "missing"), "התיקייה לא קיימת במחשב הזה");
        if (OperatingSystem.IsWindows())
        {
            // A junction inside a root that leads out of it: resolved before the check.
            var link = Path.Combine(_f.RepoCachePath, r.RepoId.ToString(), "way-out");
            using (var p = Process.Start(new ProcessStartInfo("cmd.exe") { ArgumentList = { "/c", "mklink", "/J", link, outside }, UseShellExecute = false, RedirectStandardOutput = true })!)
                await p.WaitForExitAsync();
            Assert.True(Directory.Exists(link));
            await RefusedAsync(link, "אפשר לפתוח רק תיקיות של DCC עצמו");
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await Http(reader).PostAsJsonAsync("/open-folder", new { })).StatusCode);
        Assert.Equal(count, Launcher.Opened.Count);
    }

    [Fact]
    public async Task Outside_Development_no_folder_is_opened()
    {
        var r = await NewRunAsync();
        var (_, reader) = await UserAsync("reader", r.ClientId);
        var clone = Directory.CreateDirectory(Path.Combine(_f.RepoCachePath, r.RepoId.ToString(), "lib")).FullName;
        var count = Launcher.Opened.Count;
        var res = await Http(reader, ProductionApp).PostAsJsonAsync("/open-folder", new { path = clone });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("פתיחת תיקייה זמינה רק כשהשרת רץ על מחשב הפיתוח", await Message(res));
        Assert.Equal(count, Launcher.Opened.Count);
    }

    // ── stand-ins ────────────────────────────────────────────────────

    /// <summary>Records the folders it was asked to open — a test never starts Explorer.</summary>
    private sealed class FakeLauncher : IFolderLauncher
    {
        private readonly ConcurrentQueue<string> _opened = new();
        public IReadOnlyCollection<string> Opened => _opened;
        public void Open(string folder) => _opened.Enqueue(folder);
    }

    /// <summary>The engine's start of a coach run, reduced to what the coach relies on: a run row, and the proposals approved with its id.</summary>
    private sealed class FakeCoachRunStarter(DccDbContext db, ITenantScope tenant) : ICoachRunStarter
    {
        public static volatile bool FailNext;

        public async Task<Guid> StartCoachRunAsync(Guid repoId, Guid userId, IReadOnlyList<Guid> proposalIds, CancellationToken ct)
        {
            if (FailNext)
            {
                FailNext = false;
                throw new CoachRefused("כבר יש הרצה פעילה לריפו הזה — סיימו או בטלו אותה קודם");
            }
            var clientId = (await SqlJson.ScalarAsync<Guid?>(db, "select client_id from repo where id = @id", new { id = repoId }, ct))!.Value;
            return await tenant.RunAsync(clientId, async d =>
            {
                var runId = (await SqlJson.ScalarAsync<Guid?>(d, """
                    insert into repository_onboarding_run (repo_id, client_id, kind, status, session, triggered_by)
                    values (@r, @c, 'coach', 'Pending', @s, @u) returning id
                    """, new { r = repoId, c = clientId, s = SqlJson.Jsonb(new { state = "none" }), u = userId }, ct))!.Value;
                await SqlJson.ExecuteAsync(d, "update repo_coach_proposal set run_id = @run, status = 'approved' where id = any(@ids)",
                    new { run = runId, ids = proposalIds.ToArray() }, ct);
                return runId;
            }, ct);
        }
    }
}
