using System.Text.Json.Nodes;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>What a terminal listener receives: output (<c>Type</c> "output", <c>Data</c>) or a change of state (<c>Type</c> "state", <c>State</c>).</summary>
public sealed record TerminalMessage(string Type, string? Data = null, string? State = null);

/// <summary>
/// One terminal per onboarding run (session.ts): the real, interactive Claude Code in a pseudo-terminal, plus the
/// lines DCC itself prints (its git steps), in one stream the screen shows exactly as a terminal would. Kept in memory
/// (the last 2 MB) and mirrored to <c>&lt;runtime&gt;/terminal.log</c>, so a reconnect — or a restart — replays what was on
/// screen. States: none, live, ended, disconnected.
/// </summary>
public interface IOnboardingTerminal
{
    /// <summary>A line DCC itself prints into the run's terminal — dimmed, so it reads as "the system did this".</summary>
    void Line(Guid runId, string text);

    string State(Guid runId);

    /// <summary>What is on screen now and its state; disposing the result unsubscribes.</summary>
    (string Replay, string State, IDisposable Subscription) Subscribe(Guid runId, Action<TerminalMessage> listener);

    /// <summary>The person's keystrokes, straight to Claude. false when no session is live.</summary>
    bool Input(Guid runId, string data, Guid? userId);

    void Resize(Guid runId, int cols, int rows);

    /// <summary>Who last typed into the session — the actor for what the transcript shows next.</summary>
    Guid? LastInputUser(Guid runId);
}

/// <summary>The run a draft session belongs to.</summary>
public sealed record DraftCtx(Guid RepoId, Guid RunId, Guid ClientId, Guid TriggeredBy);

/// <summary>A refusal of the draft session, in a sentence for the person — the engine answers it as a 409.</summary>
public sealed class DraftRefused(string message) : Exception(message);

/// <summary>
/// The <c>/init</c> draft session (draft.ts) — one window inside the plan step: the real Claude Code in a terminal,
/// run in the isolated copy as a draft generator. Its cost goes to the ledger in slices; the person's answers and
/// commands become events. <c>session</c> is the run's <c>session</c> column (see <see cref="RunSessions.Of"/>).
/// </summary>
public interface IDraftSessions
{
    Task LaunchAsync(DraftCtx ctx, string workspacePath, JsonObject session, Guid by, bool resume, string? model, string? effort, CancellationToken ct);

    /// <summary>/exit first, killed after a few seconds; the spend since the last slice is recorded.</summary>
    Task StopAsync(DraftCtx ctx, Guid? by, CancellationToken ct);

    /// <summary>Types an instruction into the live session, only while it looks idle unless forced: <c>{ sent, confirmed }</c> or <c>{ sent:false, busy:true, reason }</c>.</summary>
    Task<JsonObject> SendAsync(DraftCtx ctx, JsonObject session, Guid by, string text, string? messageId, bool force, CancellationToken ct);

    /// <summary>After a restart: a session that was live is marked disconnected (reopened later with --resume). true when it was live.</summary>
    Task<bool> RecoverAsync(DraftCtx ctx, JsonObject session, CancellationToken ct);

    /// <summary>At shutdown: no claude.exe outlives the server.</summary>
    void KillAll();
}

/// <summary>The run's <c>session</c> column, read the way draft.ts read it.</summary>
public static class RunSessions
{
    /// <summary><c>{ state: "none", ...column }</c>.</summary>
    public static JsonObject Of(JsonNode? column)
    {
        var o = new JsonObject { ["state"] = "none" };
        if (column is JsonObject c) foreach (var (k, v) in c) o[k] = v?.DeepClone();
        return o;
    }

    private static double Num(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? d : 0;

    /// <summary>What earlier processes of the conversation spent plus the current one's counters.</summary>
    public static (double CostUsd, double InputTokens, double OutputTokens, double ApiDurationMs) Totals(JsonObject s) =>
        (Num(s["base"]?["costUsd"]) + Num(s["status"]?["costUsd"]), Num(s["base"]?["inputTokens"]) + Num(s["status"]?["inputTokens"]),
         Num(s["base"]?["outputTokens"]) + Num(s["status"]?["outputTokens"]), Num(s["base"]?["apiDurationMs"]) + Num(s["status"]?["apiDurationMs"]));

    public static string? ModelId(JsonObject s) =>
        s["status"]?["modelId"]?.GetValue<string>() ?? s["status"]?["model"]?.GetValue<string>() ?? s["model"]?.GetValue<string>();

    public static string? Effort(JsonObject s) => s["status"]?["effort"]?.GetValue<string>() ?? s["effort"]?.GetValue<string>();
}
