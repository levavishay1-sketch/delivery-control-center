using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dcc.Infrastructure.Claude;

/// <summary>What a background run was asked to do.</summary>
public sealed record FlowRunInput(Guid RunId, Guid ClientId, Guid WorkitemId, Guid? TaskId, string Kind, Guid UserId, string Trigger, JsonObject? Options);

/// <summary>One kind of background run (assess, breakdown, implement) — resolved from a fresh scope when the run starts.</summary>
public interface IFlowRunWork
{
    string Kind { get; }
    Task<JsonNode> RunAsync(FlowRunInput input, CancellationToken ct);
}

/// <summary>
/// Durable background jobs for the local claude CLI (ai-assist.ts startFlowRun). A run is kicked off
/// detached — the request returns at once and the work goes on in its own scope. The transcript lives in
/// <see cref="FlowRunHub"/> while it runs and is written to <c>flow_run</c> once at the end, so the person
/// can leave the screen and come back to everything Claude did.
/// </summary>
public sealed class FlowRunService(DccDbContext db, FlowRunHub hub, IServiceScopeFactory scopes, ILogger<FlowRunService> log)
{
    public async Task<(Guid RunId, bool AlreadyRunning)> StartAsync(Guid clientId, Guid workitemId, string kind, Guid userId, Guid? taskId = null, string trigger = "button", JsonObject? options = null, CancellationToken ct = default)
    {
        // A run that already finished is not "already running" — "run again" right after one starts a new one.
        if (hub.Live(workitemId, taskId) is { } live) return (live.Id, true);

        var runId = await SqlJson.ScalarAsync<Guid>(db, """
            insert into flow_run (client_id, workitem_id, task_id, kind, state, started_by, log)
            values (@c, @w, @t, @k, 'running', @u, '[]'::jsonb) returning id
            """, new { c = clientId, w = workitemId, t = taskId, k = kind, u = userId }, ct);
        hub.Open(runId, kind, workitemId, taskId);
        var input = new FlowRunInput(runId, clientId, workitemId, taskId, kind, userId, trigger, options);

        // Its own scope and no flowing context: the request that started it is about to end.
        using (ExecutionContext.SuppressFlow())
            _ = Task.Run(() => ExecuteAsync(input));
        return (runId, false);
    }

    private async Task ExecuteAsync(FlowRunInput input)
    {
        await using var scope = scopes.CreateAsyncScope();
        var sdb = scope.ServiceProvider.GetRequiredService<DccDbContext>();
        try
        {
            var work = scope.ServiceProvider.GetServices<IFlowRunWork>().FirstOrDefault(w => w.Kind == input.Kind)
                ?? throw new InvalidOperationException($"no runner for \"{input.Kind}\"");
            var result = await work.RunAsync(input, CancellationToken.None);
            await SqlJson.ExecuteAsync(sdb, """
                update flow_run set state = 'done', result = @r, log = @l, finished_at = now() where id = @id
                """, new { id = input.RunId, r = SqlJson.Jsonb(result), l = SqlJson.Jsonb(hub.Lines(input.RunId)) });
        }
        catch (Exception e)
        {
            var stopped = e is ClaudeRunException { Stopped: true };
            hub.PushLine(input.RunId, stopped ? "⏹ נעצר לבקשתך" : $"✕ שגיאה: {e.Message}");
            if (!stopped && e is not ClaudeRunException && e is not Application.Common.AppException) log.LogError(e, "flow run {RunId} ({Kind}) failed", input.RunId, input.Kind);
            try
            {
                await SqlJson.ExecuteAsync(sdb, """
                    update flow_run set state = @s, error = @e, log = @l, finished_at = now() where id = @id
                    """, new { id = input.RunId, s = stopped ? "stopped" : "error", e = stopped ? null : e.Message, l = SqlJson.Jsonb(hub.Lines(input.RunId)) });
            }
            catch (Exception inner) { log.LogError(inner, "flow run {RunId}: its end could not be written", input.RunId); }
        }
        finally
        {
            hub.Finish(input.RunId);
        }
    }

    private static readonly JsonObject Idle = new() { ["id"] = null, ["kind"] = null, ["state"] = "idle", ["lines"] = new JsonArray(), ["result"] = null, ["error"] = null };

    public static JsonObject IdleView() => (JsonObject)Idle.DeepClone();

    /// <summary>The latest run for a requirement — the live buffer while one runs, the row otherwise.</summary>
    public async Task<JsonObject?> RequirementViewAsync(Guid workitemId, CancellationToken ct)
    {
        if (hub.Live(workitemId, null) is { } live) return LiveView(live.Id, live.Buffer, withPhase: false);
        return await RowViewAsync("workitem_id = @id and task_id is null", workitemId, ct);
    }

    /// <summary>The latest implementation run of one task.</summary>
    public async Task<JsonObject?> TaskViewAsync(Guid taskId, CancellationToken ct)
    {
        if (hub.Live(Guid.Empty, taskId) is { } live) return LiveView(live.Id, live.Buffer, withPhase: true);
        return await RowViewAsync("task_id = @id", taskId, ct);
    }

    private JsonObject LiveView(Guid id, FlowRunHub.Buffer b, bool withPhase)
    {
        var o = new JsonObject
        {
            ["id"] = id.ToString(), ["kind"] = b.Kind, ["state"] = "running", ["lines"] = new JsonArray(hub.Lines(id).Select(l => (JsonNode?)l).ToArray()),
            ["result"] = null, ["error"] = null, ["startedAt"] = null, ["finishedAt"] = null,
        };
        if (withPhase) o["phase"] = b.Phase ?? "develop";
        return o;
    }

    private Task<JsonObject?> RowViewAsync(string where, Guid id, CancellationToken ct) =>
        SqlJson.QuerySingleAsync(db, $"""
            select id, kind, state, log as "lines", result, error, started_at as "startedAt", finished_at as "finishedAt"
            from flow_run where {where} order by started_at desc limit 1
            """, new { id }, ct);

    /// <summary>Stop the run live for a requirement — looked up by requirement, never a client-supplied run id.</summary>
    public async Task<bool?> StopForRequirementAsync(Guid workitemId, CancellationToken ct)
    {
        var view = await RequirementViewAsync(workitemId, ct);
        if (view?["state"]?.GetValue<string>() != "running" || view["id"] is null) return null;
        return hub.Stop(Guid.Parse(view["id"]!.GetValue<string>()));
    }

    public async Task<bool?> MessageForRequirementAsync(Guid workitemId, string text, CancellationToken ct)
    {
        var view = await RequirementViewAsync(workitemId, ct);
        if (view?["state"]?.GetValue<string>() != "running" || view["id"] is null) return null;
        return hub.SendMessage(Guid.Parse(view["id"]!.GetValue<string>()), text);
    }
}

/// <summary>
/// At start: a run the previous process left "running" can never finish — its process and transcript
/// died with it. It is closed as an error saying so. At stop: every live claude child is killed.
/// </summary>
public sealed class FlowRunLifecycle(IServiceScopeFactory scopes, FlowRunHub hub, ILogger<FlowRunLifecycle> log) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DccDbContext>();
        var n = await SqlJson.ExecuteAsync(db, """
            update flow_run set state = 'error', error = 'ה-API הופעל מחדש באמצע ההרצה — לא ידוע אם היא הושלמה. הריצו שוב.', finished_at = now()
            where state = 'running'
            """, null, ct);
        if (n > 0) log.LogWarning("flow runs: {Count} interrupted run(s) recovered after restart", n);
    }

    public Task StopAsync(CancellationToken ct)
    {
        var n = hub.StopAll();
        if (n > 0) log.LogWarning("flow runs: stopped {Count} running claude process(es) on shutdown", n);
        return Task.CompletedTask;
    }
}
