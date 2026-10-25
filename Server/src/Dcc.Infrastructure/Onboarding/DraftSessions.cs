using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Ledger;
using Dcc.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// The <c>/init</c> draft session (draft.ts) — one window inside the plan step: the real, interactive Claude Code in a
/// terminal, run in the isolated copy as a draft generator for AGENTS.md. What it writes stays a draft until the build
/// verifies its claims against the profile. The session's cost is recorded in ledger slices; the person's answers and
/// commands become events.
///
/// A singleton: a session outlives the request that opened it. Every database touch opens its own scope, inside the
/// run's tenant. The run's <c>session</c> column is written read-modify-write from both the monitor and the lifecycle,
/// so every write for one run goes through one queue.
/// </summary>
public sealed partial class DraftSessions(OnboardingTerminal terminal, IServiceScopeFactory scopes, ModelRouter router, ILogger<DraftSessions> log) : IDraftSessions
{
    private static readonly string[] Efforts = ["low", "medium", "high", "xhigh", "max"];
    private static readonly string[] OwnedByMonitor = ["status", "transcriptPath", "transcriptCursor", "apiCalls", "lastMessageId"];
    private static readonly Dictionary<string, string> FactEvent = new()
    {
        ["prompt"] = "onboarding.session.prompt", ["command"] = "onboarding.session.command", ["answer"] = "onboarding.session.answer",
    };

    /// <summary>A model name as the CLI takes it — it goes on a command line, so nothing else gets through.</summary>
    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,59}$")] private static partial Regex ModelName();

    private sealed class RunState
    {
        public readonly SemaphoreSlim Patch = new(1, 1);
        public readonly SemaphoreSlim Poll = new(1, 1);
        public readonly SemaphoreSlim Slice = new(1, 1);
        public CancellationTokenSource? Monitor;
    }

    private readonly ConcurrentDictionary<Guid, RunState> _runs = new();

    private RunState Of(Guid runId) => _runs.GetOrAdd(runId, _ => new RunState());

    // ── the run row ──────────────────────────────────────────────────

    private sealed record Row(JsonObject Session, Guid TriggeredBy);

    private async Task<T> InTenantAsync<T>(Guid clientId, Func<DccDbContext, Task<T>> fn)
    {
        await using var scope = scopes.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<ITenantScope>().RunAsync(clientId, fn);
    }

    private async Task<Row?> LoadAsync(DraftCtx ctx)
    {
        var row = await InTenantAsync(ctx.ClientId, d => SqlJson.QuerySingleAsync(d, """
            select session, triggered_by as "triggeredBy" from repository_onboarding_run where id = @run and repo_id = @repo
            """, new { run = ctx.RunId, repo = ctx.RepoId }));
        return row is null ? null : new Row(RunSessions.Of(row["session"]), Guid.Parse(row["triggeredBy"]!.GetValue<string>()));
    }

    /// <summary>
    /// <c>{ ...session, ...patch }</c>: <paramref name="set"/> keys take their value (a JSON null stays a null) and
    /// <paramref name="remove"/> keys go — what a JavaScript spread of <c>undefined</c> did. Serialised per run.
    /// </summary>
    private async Task PatchAsync(DraftCtx ctx, JsonObject set, params string[] remove)
    {
        var state = Of(ctx.RunId);
        await state.Patch.WaitAsync();
        try
        {
            await InTenantAsync(ctx.ClientId, async d =>
            {
                var current = await SqlJson.QuerySingleAsync(d, "select session from repository_onboarding_run where id = @run for update", new { run = ctx.RunId });
                if (current is null) return 0;
                var next = RunSessions.Of(current["session"]);
                foreach (var (k, v) in set) next[k] = v?.DeepClone();
                foreach (var k in remove) next.Remove(k);
                return await SqlJson.ExecuteAsync(d, "update repository_onboarding_run set session = @s where id = @run", new { run = ctx.RunId, s = SqlJson.Jsonb(next) });
            });
        }
        finally { state.Patch.Release(); }
    }

    /// <summary>An event of the run (<c>runId</c> first in its payload, as events.ts spread it).</summary>
    private async Task EventAsync(DraftCtx ctx, string type, JsonObject payload, Guid? actor)
    {
        var p = new JsonObject { ["runId"] = ctx.RunId.ToString() };
        foreach (var (k, v) in payload) p[k] = v?.DeepClone();
        await using var scope = scopes.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<RepoAiEvents>().AppendAsync(ctx.ClientId, ctx.RepoId, type, p, actor);
    }

    private static string Iso(DateTimeOffset t) => t.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static string NowIso() => Iso(DateTimeOffset.UtcNow);

    private static JsonObject TotalsJson((double CostUsd, double InputTokens, double OutputTokens, double ApiDurationMs) t) => new()
    {
        ["costUsd"] = t.CostUsd, ["inputTokens"] = t.InputTokens, ["outputTokens"] = t.OutputTokens, ["apiDurationMs"] = t.ApiDurationMs,
    };

    private static double Num(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? d : 0;

    private static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    /// <summary>JavaScript's <c>Math.round</c>: half up, never "-0".</summary>
    private static double Round(double x) => Math.Floor(x + 0.5) + 0.0;

    // ── the ledger ───────────────────────────────────────────────────

    /// <summary>
    /// The session's spend since the ledger cursor, written as ONE ledger row, and the cursor moved. The money is only
    /// in the ledger. One slice at a time per run, so a stop and the exit it causes never record the same spend twice.
    /// </summary>
    private async Task RecordSliceAsync(DraftCtx ctx, Guid? by)
    {
        var state = Of(ctx.RunId);
        await state.Slice.WaitAsync();
        try
        {
            var row = await LoadAsync(ctx);
            if (row is null) return;
            var s = row.Session;
            var now = RunSessions.Totals(s);
            var cur = s["ledgerCursor"] as JsonObject;
            var cost = Math.Max(0, now.CostUsd - Num(cur?["costUsd"]));
            var input = Math.Max(0, Round(now.InputTokens - Num(cur?["inputTokens"])));
            var output = Math.Max(0, Round(now.OutputTokens - Num(cur?["outputTokens"])));
            var apiMs = Math.Max(0, Round(now.ApiDurationMs - Num(cur?["apiDurationMs"])));
            if (cost > 0 || input > 0 || output > 0)
            {
                var startedAt = Str(cur?["at"]) is { Length: > 0 } at ? DateTimeOffset.Parse(at, CultureInfo.InvariantCulture)
                    : Str(s["startedAt"]) is { Length: > 0 } st ? DateTimeOffset.Parse(st, CultureInfo.InvariantCulture) : DateTimeOffset.UtcNow;
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    await scope.ServiceProvider.GetRequiredService<ClaudeLedger>().RecordAsync(new ClaudeCallInput
                    {
                        ClientId = ctx.ClientId, UserId = by ?? row.TriggeredBy, EntityKind = "onboarding_run", EntityId = ctx.RunId.ToString(),
                        Capability = "onboarding_init", Trigger = "session", Screen = "onboarding", Label = "טיוטת /init בסשן",
                        StartedAt = startedAt, DurationMs = (int)Math.Min(int.MaxValue, apiMs), ModelUsed = RunSessions.ModelId(s), Effort = RunSessions.Effort(s),
                        InputTokens = (int)Math.Min(int.MaxValue, input), OutputTokens = (int)Math.Min(int.MaxValue, output), CostUsd = (decimal)cost,
                        Meta = new { stepKey = "plan" },
                    });
                }
                catch (Exception e) { log.LogError(e, "[ledger] a draft-session slice was NOT recorded (run {RunId})", ctx.RunId); }
            }
            var cursor = TotalsJson(now);
            cursor["stepKey"] = "plan";
            cursor["at"] = NowIso();
            await PatchAsync(ctx, new JsonObject { ["ledgerCursor"] = cursor });
        }
        finally { state.Slice.Release(); }
    }

    // ── starting, resuming, stopping ─────────────────────────────────

    public async Task LaunchAsync(DraftCtx ctx, string workspacePath, JsonObject session, Guid by, bool resume, string? model, string? effort, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(workspacePath)) throw new DraftRefused("אין עותק מבודד — החיבור עוד לא רץ");
        // An empty choice is no flag at all, as before (the CLI's own default).
        if (model is { Length: > 0 } && !ModelName().IsMatch(model) || effort is { Length: > 0 } && !Efforts.Contains(effort))
            throw new DraftRefused("המודל או רמת המאמץ שנבחרו לא מוכרים");
        // The session is a window inside the plan step: never opened while a trial, a build or a delivery runs in the same copy.
        var plan = await InTenantAsync(ctx.ClientId, d => SqlJson.ScalarAsync<string>(d,
            "select status from repository_onboarding_step where run_id = @run and step_key = 'plan'", new { run = ctx.RunId }, ct));
        if (plan != Steps.WaitingForUser) throw new DraftRefused("טיוטת /init נפתחת כשהתוכנית פתוחה לאישור");
        if (terminal.State(ctx.RunId) == "live") throw new DraftRefused("הסשן כבר פעיל");

        if (resume) await RecordSliceAsync(ctx, by);
        var prior = resume ? (await LoadAsync(ctx))?.Session ?? RunSessions.Of(session) : RunSessions.Of(session);
        var priorId = Str(prior["id"]);
        if (resume && string.IsNullOrEmpty(priorId)) throw new DraftRefused("עדיין לא היה סשן טיוטה בהרצה הזו");
        var sessionId = resume ? priorId! : Guid.NewGuid().ToString();
        var rec = router.Route("onboarding_init");
        var chosenModel = model ?? rec.Model;
        var chosenEffort = effort ?? rec.Effort;
        try { File.Delete(terminal.StatusFile(ctx.RunId)); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or DirectoryNotFoundException) { }

        // The end of the process is handled only after the start is fully written down — the order the person reads.
        var launched = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            await terminal.StartAsync(new TerminalLaunch(ctx.RunId, workspacePath, sessionId, resume, chosenModel, chosenEffort,
                code => _ = OnExitAsync(ctx, code, launched.Task)), ct);
        }
        catch (Exception e)
        {
            // Whatever ended the start, an exit already waiting on it must not wait forever.
            launched.TrySetResult();
            if (e is OperationCanceledException) throw;
            throw new DraftRefused($"לא ניתן להפעיל את Claude Code: {e.Message}");
        }
        try
        {
            var at = NowIso();
            var start = new JsonObject { ["id"] = sessionId, ["state"] = "live", ["startedAt"] = at, ["model"] = chosenModel, ["effort"] = chosenEffort };
            JsonObject cursor;
            if (resume)
            {
                var b = TotalsJson(RunSessions.Totals(prior));
                start["base"] = b;
                cursor = (JsonObject)b.DeepClone();
            }
            else cursor = TotalsJson((0, 0, 0, 0));
            cursor["stepKey"] = "plan";
            cursor["at"] = at;
            start["ledgerCursor"] = cursor;
            await PatchAsync(ctx, start, resume ? ["endedAt", "exitCode", "status"] : ["endedAt", "exitCode", "status", "base"]);
            await EventAsync(ctx, resume ? "onboarding.session.resumed" : "onboarding.session.started",
                new JsonObject { ["sessionId"] = sessionId, ["model"] = chosenModel, ["effort"] = chosenEffort }, by);
            StartMonitor(ctx);
        }
        finally { launched.TrySetResult(); }
    }

    private async Task OnExitAsync(DraftCtx ctx, int? exitCode, Task launched)
    {
        try
        {
            await launched;
            await PollAsync(ctx, wait: true);
            StopMonitor(ctx.RunId);
            await RecordSliceAsync(ctx, terminal.LastInputUser(ctx.RunId));
            var end = new JsonObject { ["state"] = "ended", ["endedAt"] = NowIso(), ["exitCode"] = exitCode };
            await PatchAsync(ctx, end);
            await EventAsync(ctx, "onboarding.session.ended", new JsonObject { ["exitCode"] = exitCode }, terminal.LastInputUser(ctx.RunId));
        }
        catch (Exception e) { log.LogError(e, "draft session {RunId}: its end was not recorded", ctx.RunId); }
    }

    public async Task StopAsync(DraftCtx ctx, Guid? by, CancellationToken ct)
    {
        await terminal.StopAsync(ctx.RunId, graceful: true);
        StopMonitor(ctx.RunId);
        await RecordSliceAsync(ctx, by);
    }

    // ── the monitor: the status line and the transcript become facts ──

    private void StartMonitor(DraftCtx ctx)
    {
        StopMonitor(ctx.RunId);
        var cts = new CancellationTokenSource();
        Of(ctx.RunId).Monitor = cts;
        using (ExecutionContext.SuppressFlow())
        {
            _ = Task.Run(async () =>
            {
                using var timer = new PeriodicTimer(TimeSpan.FromSeconds(3));
                try
                {
                    while (await timer.WaitForNextTickAsync(cts.Token)) await PollAsync(ctx, wait: false);
                }
                catch (OperationCanceledException) { }
            });
        }
    }

    private void StopMonitor(Guid runId)
    {
        if (_runs.TryGetValue(runId, out var state) && Interlocked.Exchange(ref state.Monitor, null) is { } cts)
        {
            cts.Cancel();
            cts.Dispose();
        }
    }

    /// <summary>
    /// One pass: the status-line snapshot becomes the session's status, the transcript's new lines become events. A
    /// tick skips while a pass runs; the end of the session waits for it and reads once more, so the last spend is seen.
    /// </summary>
    private async Task PollAsync(DraftCtx ctx, bool wait)
    {
        var state = Of(ctx.RunId);
        if (wait) await state.Poll.WaitAsync();
        else if (!await state.Poll.WaitAsync(0)) return;
        try
        {
            var row = await LoadAsync(ctx);
            if (row is null) return;
            var s = row.Session;
            var next = (JsonObject)s.DeepClone();
            var snap = Transcript.ReadStatusSnapshot(terminal.StatusFile(ctx.RunId));
            var id = Str(s["id"]);
            if (snap is not null && (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(snap.SessionId) || snap.SessionId == id))
            {
                var fresh = JsonSerializer.SerializeToNode(snap.Status)!.AsObject();
                // updatedAt is when the snapshot was read, not a change: only a change of the figures is written.
                if (Canon(Without(fresh, "updatedAt")) != Canon(Without(s["status"] as JsonObject, "updatedAt"))) next["status"] = fresh;
                if (!string.IsNullOrEmpty(snap.TranscriptPath)) next["transcriptPath"] = snap.TranscriptPath;
            }
            var actor = terminal.LastInputUser(ctx.RunId) ?? row.TriggeredBy;
            if (Str(next["transcriptPath"]) is { Length: > 0 } transcript)
            {
                var scan = Transcript.Scan(transcript, (int)Num(s["transcriptCursor"]), Str(s["lastMessageId"]));
                foreach (var f in scan.Facts)
                {
                    var payload = f.Payload();
                    payload["stepKey"] = "plan";
                    await EventAsync(ctx, FactEvent[f.Kind], payload, actor);
                }
                next["transcriptCursor"] = scan.Cursor;
                next["apiCalls"] = Num(s["apiCalls"]) + scan.ApiCalls;
                next["lastMessageId"] = scan.LastMessageId;
            }
            var set = new JsonObject();
            var remove = new List<string>();
            var changed = false;
            foreach (var k in OwnedByMonitor)
            {
                if (next.TryGetPropertyValue(k, out var v)) set[k] = v?.DeepClone();
                else remove.Add(k);
                if (Canon(next[k]) != Canon(s[k]) || next.ContainsKey(k) != s.ContainsKey(k)) changed = true;
            }
            if (changed) await PatchAsync(ctx, set, [.. remove]);
        }
        catch (Exception e) when (e is not OutOfMemoryException) { /* a transient read error: the next tick tries again */ }
        finally { state.Poll.Release(); }
    }

    private static JsonObject? Without(JsonObject? o, string key)
    {
        if (o is null) return null;
        var copy = (JsonObject)o.DeepClone();
        copy.Remove(key);
        return copy;
    }

    /// <summary>A JSON value in one canonical spelling — keys sorted, numbers as doubles — so a value read back from jsonb (keys reordered) compares equal to the one written.</summary>
    private static string Canon(JsonNode? n)
    {
        var sb = new StringBuilder();
        Write(n);
        return sb.ToString();

        void Write(JsonNode? x)
        {
            switch (x)
            {
                case null: sb.Append("null"); break;
                case JsonObject o:
                    sb.Append('{');
                    foreach (var (k, v) in o.OrderBy(p => p.Key, StringComparer.Ordinal))
                    {
                        sb.Append(JsonSerializer.Serialize(k)).Append(':');
                        Write(v);
                        sb.Append(',');
                    }
                    sb.Append('}');
                    break;
                case JsonArray a:
                    sb.Append('[');
                    foreach (var v in a)
                    {
                        Write(v);
                        sb.Append(',');
                    }
                    sb.Append(']');
                    break;
                case JsonValue v when v.GetValueKind() == JsonValueKind.Number && v.TryGetValue<double>(out var d):
                    sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
                    break;
                default: sb.Append(x.ToJsonString()); break;
            }
        }
    }

    // ── typing into the session ──────────────────────────────────────

    /// <summary>Types an instruction into the live draft session, as the person who pressed send. Sent only while the session looks idle, unless forced.</summary>
    public async Task<JsonObject> SendAsync(DraftCtx ctx, JsonObject session, Guid by, string text, string? messageId, bool force, CancellationToken ct)
    {
        var t = ComponentVerifier.JsTrim(text.Replace("\r\n", "\n"));
        if (t.Length == 0) throw new DraftRefused("אין מה לשלוח");
        if (t.Length > 4000) throw new DraftRefused("ההוראה ארוכה מדי — עד 4,000 תווים");
        if (terminal.State(ctx.RunId) != "live") throw new DraftRefused("סשן הטיוטה לא פעיל — פתחו אותו מכרטיס הטיוטה ואז שלחו");
        var file = Str(RunSessions.Of(session)["transcriptPath"]) ?? "";
        if (!force)
        {
            var (idle, why) = Transcript.SessionIdle(file);
            if (!idle) return new JsonObject { ["sent"] = false, ["busy"] = true, ["reason"] = why };
        }
        var before = file.Length > 0 ? Transcript.LineCount(file) : 0;
        // A bracketed paste, so a line break inside the text is part of it and not Enter.
        if (!terminal.Input(ctx.RunId, $"\u001b[200~{t}\u001b[201~", by)) throw new DraftRefused("סשן הטיוטה לא פעיל");
        await Task.Delay(500, CancellationToken.None);
        terminal.Input(ctx.RunId, "\r", by);
        await EventAsync(ctx, "onboarding.session.instructed",
            new JsonObject { ["text"] = t.Length > 500 ? $"{t[..499]}…" : t, ["forced"] = force, ["messageId"] = messageId }, by);
        var confirmed = false;
        for (var i = 0; i < 12 && file.Length > 0 && !confirmed; i++)
        {
            await Task.Delay(500, CancellationToken.None);
            confirmed = Transcript.PromptSeenAfter(file, before, t);
        }
        return new JsonObject { ["sent"] = true, ["confirmed"] = confirmed };
    }

    // ── after a restart, at shutdown ─────────────────────────────────

    public async Task<bool> RecoverAsync(DraftCtx ctx, JsonObject session, CancellationToken ct)
    {
        var was = Str(RunSessions.Of(session)["state"]);
        if (was == "live")
        {
            await PatchAsync(ctx, new JsonObject { ["state"] = "disconnected" });
            await EventAsync(ctx, "onboarding.session.disconnected", new JsonObject { ["reason"] = "api_restart" }, null);
            terminal.Line(ctx.RunId, "[השרת הופעל מחדש — סשן הטיוטה נותק. אפשר לחדש אותו מאותה נקודה]");
        }
        if (was is "live" or "disconnected") terminal.MarkDisconnected(ctx.RunId);
        return was == "live";
    }

    public void KillAll()
    {
        foreach (var id in _runs.Keys) StopMonitor(id);
        terminal.KillAll();
    }
}
