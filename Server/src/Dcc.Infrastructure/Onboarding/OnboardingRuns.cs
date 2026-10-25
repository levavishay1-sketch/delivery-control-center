using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Application.Common;
using Dcc.Domain.Onboarding;
using Dcc.Domain.Prompts;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Policy;
using Dcc.Infrastructure.Prompts;
using Dcc.Infrastructure.Repos;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// The per-run guards that live in memory, as the old server's module-level sets did: one step starting at a time
/// (held only while a step STARTS — the work runs after it), and the plan's own lock, shared by the scan of the
/// <c>/init</c> draft and the start of the build, which both change the plan's cards from the draft.
/// </summary>
public sealed class OnboardingLocks
{
    private readonly ConcurrentDictionary<Guid, byte> _step = new();
    private readonly ConcurrentDictionary<Guid, byte> _plan = new();

    public bool TryStep(Guid runId) => _step.TryAdd(runId, 0);
    public void EndStep(Guid runId) => _step.TryRemove(runId, out _);
    public bool PlanBusy(Guid runId) => _plan.ContainsKey(runId);
    public bool TryPlan(Guid runId) => _plan.TryAdd(runId, 0);
    public void EndPlan(Guid runId) => _plan.TryRemove(runId, out _);
}

/// <summary>
/// One model call of a run (runs.ts CallOpts). A lean call carries the whole prompt as its system prompt — no CLI
/// preamble — and answers in one turn without thinking unless <see cref="Think"/>; <see cref="LeanTools"/> and
/// <see cref="AddDirs"/> are what it may read.
/// </summary>
internal sealed record CallOpts(string Capability, string Label, string StepKey, Guid By, string? Cwd)
{
    public bool Lean { get; init; }
    public string? Tools { get; init; }
    public bool Commands { get; init; }
    public int? MaxTurns { get; init; }
    public int? TimeoutMs { get; init; }
    public string? LeanTools { get; init; }
    public IReadOnlyList<string>? AddDirs { get; init; }
    public bool Think { get; init; }
}

/// <summary>
/// The onboarding run (runs.ts; <c>openspec/changes/repository-coach</c>): seven steps, the same for every repository,
/// whose result is different for each. Every transition is persisted and written to <c>repo_ai_event</c>; the steps
/// that cost money or write outside the copy wait for a person, by the run's automation level. The code decides stage
/// transitions, what to install and pass/fail wherever it can check; a model only does what code cannot — trial tasks,
/// authoring, the open search, the reviewer's questions.
///
/// A long step runs after the request answered, in a DI scope of its own (the request's is about to end), and a
/// failure there marks the step failed — its button runs it again. A failed run does not move by itself.
/// </summary>
public sealed partial class OnboardingRuns(
    OnboardingStore store, MarketplaceStore marketplace, OnboardingData data, OnboardingWorkspace workspace, Deliverer deliverer,
    OnboardingLocks locks, IOnboardingTerminal terminal, IDraftSessions drafts, ClaudeRunner claude, PromptService prompts,
    ModelRouter router, ModelPolicyStore policy, ClaudeCenter center, DccDbContext db, ITenantScope tenant, IServiceScopeFactory scopes,
    ILogger<OnboardingRuns> log) : ICoachRunStarter
{
    private const string LiveRunExists = "כבר יש הרצה פעילה לריפו הזה — סיימו או בטלו אותה קודם";

    private static string? Str(JsonNode? o, string key) => OnboardingJson.Str(o, key);
    private static string Slice(string s, int n) => OnboardingJson.Slice(s, n);
    private static JsonNode? Node<T>(T value) => OnboardingJson.Node(value);
    private static string Now() => ComponentVerifier.IsoNow();
    private static string Title(string key) => Steps.Definition(key)?.TitleHe ?? key;

    /// <summary>JavaScript's <c>toLowerCase()</c>: İ (U+0130) becomes "i" and a combining dot, where .NET leaves it as it is.</summary>
    private static string JsLower(string s) => s.Replace(((char)0x130).ToString(), "i" + (char)0x307, StringComparison.Ordinal).ToLowerInvariant();

    /// <summary><c>KIND_HE[kind]</c> — "undefined" for a kind it does not name, as a template literal printed it.</summary>
    private static string KindHe(string kind) => Components.KindHe.TryGetValue(kind, out var he) ? he : "undefined";

    // ── background work ─────────────────────────────────────────────

    /// <summary>
    /// The old server's <c>void (async () =&gt; …)()</c>: the work goes on after the request answered, in a fresh scope
    /// and without the request's context, and its failure is recorded by <paramref name="onError"/> — never lost.
    /// </summary>
    private void Background(Func<OnboardingRuns, Task> work, Func<OnboardingRuns, Exception, Task>? onError, Action? andFinally = null)
    {
        using (ExecutionContext.SuppressFlow())
            _ = Task.Run(async () =>
            {
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    var engine = scope.ServiceProvider.GetRequiredService<OnboardingRuns>();
                    try { await work(engine); }
                    catch (Exception e) when (onError is not null)
                    {
                        if (e is not AppException and not ClaudeRunException and not InvalidOperationException) log.LogError(e, "onboarding: a step failed unexpectedly");
                        await onError(engine, e);
                    }
                }
                catch (Exception e) { log.LogError(e, "onboarding: background work failed, and its failure could not be recorded"); }
                finally { andFinally?.Invoke(); }
            });
    }

    // ── the step lifecycle ──────────────────────────────────────────

    private async Task StartStepAsync(RunCtx ctx, string key, Guid actor, bool automated)
    {
        await store.PatchStepAsync(ctx, key, new() { ["status"] = Steps.Running, ["started_at"] = DateTimeOffset.UtcNow, ["completed_at"] = null, ["errors"] = SqlJson.Jsonb(new JsonArray()) });
        await store.PatchRunAsync(ctx, new() { ["status"] = Steps.Running, ["current_step_key"] = key });
        await store.EventAsync(ctx, "onboarding.step.started", new() { ["stepKey"] = key, ["automated"] = automated }, actor);
        terminal.Line(ctx.RunId, $"── {Title(key)} ──");
    }

    private async Task WaitStepAsync(RunCtx ctx, string key, JsonNode result, Guid? actor, string why)
    {
        await store.PatchStepAsync(ctx, key, new() { ["status"] = Steps.WaitingForUser, ["result"] = SqlJson.Jsonb(result) });
        await store.PatchRunAsync(ctx, new() { ["status"] = Steps.WaitingForUser, ["current_step_key"] = key });
        await store.EventAsync(ctx, "onboarding.step.waiting", new() { ["stepKey"] = key, ["why"] = why }, actor);
        terminal.Line(ctx.RunId, $"⏸ {why}");
    }

    /// <summary>The step is done; the run moves to the first step not yet completed — or is over.</summary>
    private async Task CompleteStepAsync(RunCtx ctx, string key, JsonNode result, Guid? actor)
    {
        await store.PatchStepAsync(ctx, key, new() { ["status"] = Steps.Completed, ["completed_at"] = DateTimeOffset.UtcNow, ["result"] = SqlJson.Jsonb(result) });
        var loaded = await store.RunAsync(ctx.RepoId, ctx.RunId);
        var next = loaded.StepRows.FirstOrDefault(s => Str(s, "status") != Steps.Completed);
        await store.PatchRunAsync(ctx, next is not null
            ? new() { ["status"] = Str(next, "status") == Steps.WaitingForUser ? Steps.WaitingForUser : Steps.Running, ["current_step_key"] = Str(next, "stepKey") }
            : new() { ["status"] = Steps.Completed, ["current_step_key"] = null, ["completed_at"] = DateTimeOffset.UtcNow });
        await store.EventAsync(ctx, "onboarding.step.completed", new() { ["stepKey"] = key }, actor);
        if (next is null)
        {
            await store.EventAsync(ctx, "onboarding.run.completed", [], actor);
            terminal.Line(ctx.RunId, "✓ ההרצה הושלמה");
        }
    }

    internal async Task FailStepAsync(RunCtx ctx, string key, Exception error, Guid? actor)
    {
        var message = error.Message;
        await store.PatchStepAsync(ctx, key, new() { ["status"] = Steps.Failed, ["completed_at"] = DateTimeOffset.UtcNow, ["errors"] = SqlJson.Jsonb(new JsonArray(message)) });
        await store.PatchRunAsync(ctx, new() { ["status"] = Steps.Failed, ["current_step_key"] = key });
        await store.EventAsync(ctx, "onboarding.step.failed", new() { ["stepKey"] = key, ["error"] = Slice(message, 500) }, actor);
        terminal.Line(ctx.RunId, $"✗ {Title(key)}: {message}");
    }

    /// <summary>Runs the next pending step by itself, when its start needs nobody. A step that waits (the interview, the trial's cost, the plan, the delivery) stops here.</summary>
    private async Task AdvanceAsync(RunCtx ctx, Guid by)
    {
        var loaded = await store.RunAsync(ctx.RepoId, ctx.RunId);
        if (loaded.Over || loaded.Status == Steps.Failed) return;
        var next = loaded.StepRows.FirstOrDefault(s => Str(s, "status") != Steps.Completed);
        if (next is null || Str(next, "status") != Steps.Pending || Str(next, "stepKey") is not { } key || !Steps.IsKey(key)) return;
        await RunStepAsync(ctx.RepoId, ctx.RunId, key, by, automated: true);
    }

    // ── the Claude calls of a run ───────────────────────────────────

    [GeneratedRegex("[^A-Za-z0-9_]")] private static partial Regex NonWord();

    /// <summary>One instruction from the library, rendered, sent — and a ledger row with the step it belongs to.</summary>
    private async Task<(string Text, double CostUsd, Guid? CallId)> CallModelAsync(RunCtx ctx, string promptKey, Dictionary<string, object?> vars, CallOpts o)
    {
        var body = PromptContract.Render((await prompts.RequireAsync(promptKey, CancellationToken.None)).Body, vars);
        var ledger = new LedgerContext
        {
            ClientId = ctx.ClientId, UserId = o.By, Capability = o.Capability, Trigger = "button", Entity = ("onboarding_run", ctx.RunId.ToString()),
            Screen = "onboarding", Label = o.Label, Meta = new JsonObject { ["stepKey"] = o.StepKey, ["promptKey"] = promptKey },
        };
        ClaudeResult res;
        if (o.Lean)
        {
            var dir = workspace.RuntimeDir(ctx.RunId);
            Directory.CreateDirectory(dir);
            var sys = Path.Combine(dir, $"{NonWord().Replace(promptKey, "_")}-{Guid.NewGuid().ToString()[..8]}.txt");
            await File.WriteAllTextAsync(sys, body, new UTF8Encoding(false));
            res = await claude.RunRawAsync(dir, "Answer now, exactly in the format the instructions require.", new ClaudeCall
            {
                Ledger = ledger, MaxTurns = o.MaxTurns ?? 1, TimeoutMs = o.TimeoutMs ?? 180_000,
                Env = o.Think ? new Dictionary<string, string>() : new Dictionary<string, string> { ["MAX_THINKING_TOKENS"] = "0" },
                Lean = new LeanOptions(sys, o.LeanTools, AddDirs: o.AddDirs),
            });
        }
        else
        {
            res = await claude.RunRawAsync(o.Cwd ?? workspace.RuntimeDir(ctx.RunId), body, new ClaudeCall
            {
                Ledger = ledger, MaxTurns = o.MaxTurns ?? 40, TimeoutMs = o.TimeoutMs ?? 480_000, Commands = o.Commands, Tools = o.Tools,
            });
        }
        return (res.Text, (double)(res.Meta.CostUsd ?? 0), res.CallId);
    }

    /// <summary>The one JSON object in a model's answer — from its first "{" to its last "}", read as JSON.parse reads it.</summary>
    private static JsonObject ParseObject(string text)
    {
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');
        if (start < 0 || end < start) throw new JsonException("no JSON object in the answer");
        return ComponentVerifier.ParseJson(text[start..(end + 1)]) as JsonObject ?? throw new JsonException("the answer is not a JSON object");
    }

    // ── starting a run ──────────────────────────────────────────────

    /// <summary>
    /// The level a person asked for, as normalizeAutomation read it: anything but an object with a known level — a bare
    /// string, a list — is the default (a JsonValue or JsonArray would throw on <c>["level"]</c>, a 500 instead).
    /// </summary>
    private static string LevelOf(JsonNode? raw) => Automation.Normalize(raw as JsonObject);

    /// <summary>Whether the repository has a run that is not over — one per repository.</summary>
    private Task<bool> HasLiveRunAsync(OnboardingRepo r) =>
        tenant.RunAsync(r.ClientId, async d => await SqlJson.ScalarAsync<int>(d,
            "select count(*)::int from repository_onboarding_run where repo_id = @r and status = any(@s)", new { r = r.Id, s = Steps.LiveRunStatuses.ToArray() }) > 0);

    /// <summary>
    /// A new run — the run row and its seven steps in one transaction (a coach run also takes its approved proposals) —
    /// and its first step started. A second live run is refused; a race between two starts meets the database's
    /// one-live-run index and is refused the same way.
    /// </summary>
    public async Task<JsonObject> StartAsync(Guid repoId, Guid by, JsonNode? automation = null, string? kind = null, IReadOnlyList<Guid>? proposalIds = null)
    {
        var r = await store.RepoAsync(repoId);
        if (await HasLiveRunAsync(r)) throw new OnboardingRefused(LiveRunExists);
        var level = LevelOf(automation);
        var runKind = kind == "coach" ? "coach" : "onboarding";
        var runId = Guid.NewGuid();
        try
        {
            await tenant.RunAsync(r.ClientId, async d =>
            {
                await SqlJson.ExecuteAsync(d, """
                    insert into repository_onboarding_run (id, repo_id, client_id, kind, status, current_step_key, automation, session, triggered_by)
                    values (@id, @repo, @client, @kind, 'Pending', @step, @automation, @session, @by)
                    """, new
                {
                    id = runId, repo = repoId, client = r.ClientId, kind = runKind, step = Steps.All[0].Key,
                    automation = SqlJson.Jsonb(Automation.ToJson(level)), session = SqlJson.Jsonb(new JsonObject { ["state"] = "none" }), by,
                });
                foreach (var s in Steps.All)
                    await SqlJson.ExecuteAsync(d, "insert into repository_onboarding_step (run_id, client_id, step_key, step_order) values (@run, @client, @key, @order)",
                        new { run = runId, client = r.ClientId, key = s.Key, order = s.Order });
                if (runKind == "coach" && proposalIds is { Count: > 0 })
                    await SqlJson.ExecuteAsync(d, "update repo_coach_proposal set run_id = @run, status = 'approved' where id = any(@ids) and repo_id = @repo",
                        new { run = runId, ids = proposalIds.ToArray(), repo = repoId });
                return 0;
            });
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw new OnboardingRefused(LiveRunExists);
        }
        var ctx = new RunCtx(repoId, runId, r.ClientId, r.Name, by);
        await store.EventAsync(ctx, "onboarding.run.started", new() { ["level"] = level, ["kind"] = runKind, ["proposals"] = OnboardingJson.Arr((proposalIds ?? []).Select(p => p.ToString())) }, by);
        terminal.Line(runId, $"DCC · {(runKind == "coach" ? "המאמן" : "הטמעת AI")} · {r.Name} · הרצה {runId.ToString()[..8]} · מדרגה: {level}");
        await AdvanceAsync(ctx, by);
        return new JsonObject { ["runId"] = runId.ToString() };
    }

    /// <summary>The coach's door: an approved proposal opens a run of kind coach, at the default level, carrying that proposal.</summary>
    public async Task<Guid> StartCoachRunAsync(Guid repoId, Guid userId, IReadOnlyList<Guid> proposalIds, CancellationToken ct) =>
        Guid.Parse((await StartAsync(repoId, userId, null, "coach", proposalIds))["runId"]!.GetValue<string>());

    // ── running a step ──────────────────────────────────────────────

    /// <summary>A step can start when it is pending (or failed — that is "run it again") and every step before it is completed.</summary>
    private static bool Runnable(LoadedRun run, string key)
    {
        var s = run.Step(key);
        if (s is null || Str(s, "status") is not (Steps.Pending or Steps.Failed)) return false;
        var order = s["stepOrder"]!.GetValue<int>();
        return run.StepRows.Where(x => x["stepOrder"]!.GetValue<int>() < order).All(x => Str(x, "status") == Steps.Completed);
    }

    public async Task<JsonObject> RunStepAsync(Guid repoId, Guid runId, string key, Guid by, bool automated = false)
    {
        if (!Steps.IsKey(key)) throw new OnboardingRefused("צעד לא מוכר");
        if (!locks.TryStep(runId)) throw new OnboardingRefused("פעולה אחרת בהרצה הזו עדיין מתבצעת");
        RunCtx ctx;
        try
        {
            var loaded = await store.RunAsync(repoId, runId);
            ctx = loaded.Ctx;
            if (loaded.Over) throw new OnboardingRefused("ההרצה הסתיימה");
            if (!Runnable(loaded, key)) throw new OnboardingRefused("הצעד הזה עוד לא זמין — הצעדים שלפניו צריכים להסתיים קודם");
            await StartStepAsync(ctx, key, by, automated);
        }
        finally
        {
            locks.EndStep(runId);
        }
        // The work itself runs after the lock is released: a long step must not block the screen's reads or a cancel.
        Background(engine => engine.StepBodyAsync(ctx, key, by), (engine, e) => engine.FailStepAsync(ctx, key, e, by));
        return new JsonObject { ["started"] = key };
    }

    private async Task StepBodyAsync(RunCtx ctx, string key, Guid by)
    {
        var run = await store.RunAsync(ctx.RepoId, ctx.RunId);
        switch (key)
        {
            case "connect": await ConnectAsync(ctx, run, by); break;
            case "diagnose": await DiagnoseAsync(ctx, run, by); break;
            case "processes": await ProcessesPhase1Async(ctx, run, by); break;
            case "trial": await GateTrialAsync(ctx, run, by); break;
            case "plan": await PlanAsync(ctx, run, by); break;
            case "build": await BuildAsync(ctx, run, by); break;
            case "deliver":
                await WaitStepAsync(ctx, "deliver", new JsonObject { ["files"] = OnboardingJson.Arr(await DeliverableFilesAsync(ctx)) }, by, "המסירה ממתינה ללחיצה — שום דבר לא יוצא מהמחשב לפני כן");
                break;
        }
    }

    // ── 0. connect ──────────────────────────────────────────────────

    private async Task ConnectAsync(RunCtx ctx, LoadedRun run, Guid by)
    {
        var r = await store.RepoAsync(ctx.RepoId);
        void Log(string line) => terminal.Line(ctx.RunId, line);
        // The developer's own folder when the repository has one, DCC's own clone otherwise.
        var ws = await workspace.EnsureAsync(new RepoRef(r.Id, r.Name, r.LocalPath, r.AdoRepoRef), ctx.RunId, Log);
        var fileCount = await OnboardingWorkspace.TrackedFileCountAsync(ws.Dir);
        var existing = OnboardingWorkspace.ExistingSetupOf(ws.Dir);
        Log($"baseline {Slice(ws.BaselineSha, 7)} on {ws.DefaultBranch ?? "HEAD"} · {OnboardingJson.Grouped(fileCount)} files · branch {ws.Branch}");
        await store.PatchRunAsync(ctx, new() { ["workspace_path"] = ws.Dir, ["baseline_sha"] = ws.BaselineSha, ["branch_name"] = ws.Branch, ["default_branch"] = ws.DefaultBranch });
        var result = new JsonObject
        {
            ["branch"] = ws.Branch, ["baselineSha"] = ws.BaselineSha, ["defaultBranch"] = ws.DefaultBranch, ["baseFrom"] = ws.BaseFrom,
            ["fileCount"] = fileCount, ["existing"] = Node(existing), ["level"] = run.Level,
        };
        await CompleteStepAsync(ctx, "connect", result, by);
        await AdvanceAsync(ctx, by);
    }

    // ── 1. diagnose — no model, free ────────────────────────────────

    private async Task DiagnoseAsync(RunCtx ctx, LoadedRun run, Guid by)
    {
        if (run.WorkspacePath is not { } dir) throw new OnboardingRefused("אין עותק מבודד — החיבור לא רץ");
        var t0 = Stopwatch.StartNew();
        var profile = await RepositoryDiagnosis.DiagnoseAsync(dir, ctx.RepoName, log: l => terminal.Line(ctx.RunId, l));
        var prev = await store.ProfileAsync(ctx);
        var corrections = prev?.Corrections ?? [];
        var id = await store.SaveProfileAsync(ctx, prev?.Id, profile, run.BaselineSha);
        var facts = OnboardingProfile.Facts(profile, corrections);
        foreach (var f in facts) terminal.Line(ctx.RunId, $"{f.LabelHe}: {f.ValueHe}");
        var durationMs = t0.ElapsedMilliseconds;
        var languages = new JsonArray((profile["languages"] as JsonArray ?? []).Take(3).Select(l => (l as JsonObject)?["language"]?.DeepClone()).ToArray());
        await store.EventAsync(ctx, "onboarding.profile.written", new() { ["facts"] = facts.Count, ["languages"] = languages, ["durationMs"] = durationMs }, by);
        await CompleteStepAsync(ctx, "diagnose", new JsonObject { ["profileId"] = id.ToString(), ["facts"] = facts.Count, ["durationMs"] = durationMs, ["corrections"] = corrections.Count }, by);
        await AdvanceAsync(ctx, by);
    }

    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_./ -]*\z")] private static partial Regex FactPath();

    /// <summary>"זה לא נכון" on a fact of the profile: recorded, and the plan (when it already waits) is drawn again without the rules that read that fact.</summary>
    public async Task<JsonObject> CorrectProfileFactAsync(Guid repoId, Guid runId, Guid by, string path, string? note, bool undo)
    {
        var loaded = await store.RunAsync(repoId, runId);
        if (loaded.Over) throw new OnboardingRefused("ההרצה הסתיימה");
        var ctx = loaded.Ctx;
        var p = await store.RequireProfileAsync(ctx);
        var pathKey = ComponentVerifier.JsTrim(path);
        if (pathKey.Length == 0 || !FactPath().IsMatch(pathKey)) throw new OnboardingRefused("עובדה לא מוכרת");
        var corrections = p.Corrections.Where(c => c.Path != pathKey).ToList();
        if (!undo) corrections.Add(new ProfileCorrection(pathKey, NonEmpty(note), by.ToString(), Now()));
        await store.SetCorrectionsAsync(ctx, p.Id, corrections);
        await store.EventAsync(ctx, "onboarding.profile.corrected", new() { ["path"] = pathKey, ["note"] = note, ["undo"] = undo }, by);
        if (loaded.StepStatus("plan") == Steps.WaitingForUser) await ReplanAsync(ctx, by, "corrected");
        return new JsonObject { ["corrections"] = Node(corrections) };
    }

    /// <summary><c>x?.trim() || null</c>.</summary>
    private static string? NonEmpty(string? s) => s is not null && ComponentVerifier.JsTrim(s) is { Length: > 0 } t ? t : null;

    // ── 2. processes: the interview, then the model ─────────────────

    private async Task ProcessesPhase1Async(RunCtx ctx, LoadedRun run, Guid by)
    {
        var p = await store.RequireProfileAsync(ctx);
        if (run.Kind == "coach")
        {
            await ReuseFromPreviousRunAsync(ctx, by);
            return;
        }
        var questions = Processes.InterviewFor(p.Profile, data.Interview);
        var evidence = ProcessEvidenceReader.Gather(p.Profile, run.WorkspacePath);
        var waiting = new JsonObject
        {
            ["questions"] = Node(questions),
            ["evidence"] = new JsonArray(evidence.Select(e => (JsonNode?)new JsonObject { ["source"] = e.Source, ["title"] = e.Title, ["lines"] = e.Lines.Count }).ToArray()),
        };
        await WaitStepAsync(ctx, "processes", waiting, by, questions.Count > 0 ? $"{questions.Count} שאלות קצרות — כל אחת עם ברירת מחדל" : "אין שאלות; לחצו להמשיך לפירוק התהליכים");
    }

    /// <summary>The person answered (or continued with the defaults): the model breaks the processes into steps, the code decides each step.</summary>
    public async Task<JsonObject> AnswerInterviewAsync(Guid repoId, Guid runId, Guid by, IReadOnlyDictionary<string, string> answers)
    {
        var loaded = await store.RunAsync(repoId, runId);
        var ctx = loaded.Ctx;
        var s = loaded.Step("processes");
        if (Str(s, "status") != Steps.WaitingForUser) throw new OnboardingRefused("הראיון לא ממתין לתשובות");
        var waiting = s!["result"] as JsonObject ?? new JsonObject { ["questions"] = new JsonArray() };
        var questions = OnboardingJson.From<List<InterviewQuestion>>(waiting["questions"]) ?? [];
        var resolved = Processes.ResolveAnswers(questions, answers);
        var next = (JsonObject)waiting.DeepClone();
        next["answers"] = Node(resolved);
        await store.PatchStepAsync(ctx, "processes", new() { ["status"] = Steps.Running, ["result"] = SqlJson.Jsonb(next) });
        await store.PatchRunAsync(ctx, new() { ["status"] = Steps.Running });
        await store.EventAsync(ctx, "onboarding.interview.answered", new()
        {
            ["answered"] = resolved.Count(a => !a.Assumed), ["assumed"] = resolved.Count(a => a.Assumed), ["answers"] = Node(resolved),
        }, by);
        var dir = loaded.WorkspacePath;
        Background(engine => engine.ProcessesPhase2Async(ctx, dir, by, questions, resolved), (engine, e) => engine.FailStepAsync(ctx, "processes", e, by));
        return new JsonObject { ["answers"] = Node(resolved) };
    }

    [GeneratedRegex("(?<![A-Za-z0-9_])(build|release|publish|deploy|package)(?![A-Za-z0-9_])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex BuildLike();

    private async Task ProcessesPhase2Async(RunCtx ctx, string? workspacePath, Guid by, List<InterviewQuestion> questions, List<InterviewAnswer> answers)
    {
        var p = await store.RequireProfileAsync(ctx);
        var evidence = ProcessEvidenceReader.Gather(p.Profile, workspacePath);
        var processes = new List<DiscoveredProcess>();
        double costUsd = 0;
        try
        {
            var res = await CallModelAsync(ctx, "onboarding.processes", new()
            {
                ["REPO_NAME"] = ctx.RepoName, ["PROFILE"] = OnboardingProfile.Summary(p.Profile), ["EVIDENCE"] = Processes.RenderEvidence(evidence),
                ["INTERVIEW"] = Processes.RenderInterview(questions, answers),
            }, new CallOpts("onboarding_processes", "פירוק התהליכים לצעדים", "processes", by, workspacePath) { MaxTurns = 30, TimeoutMs = 480_000 });
            costUsd = res.CostUsd;
            processes = Processes.Parse(res.Text);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            terminal.Line(ctx.RunId, $"הקריאה למודל נכשלה ({Slice(e.Message, 120)}) — התהליכים נגזרים מהראיות בלבד");
        }
        if (processes.Count == 0) processes = Processes.FromEvidence(p.Profile);
        // A process that needs a build cannot be exercised where the build cannot run.
        if (ComponentVerifier.Truthy((p.Profile["windows_build"] as JsonObject)?["windows_only_build"]) && answers.FirstOrDefault(a => a.Key == "runner")?.Value != "yes")
            processes = processes.Select(pr => BuildLike().IsMatch(pr.Title) ? pr with { Impossible = "ה-build רץ רק ב-Windows ואין מריץ מחובר" } : pr).ToList();
        await store.ReplaceProcessesAsync(ctx, processes, deleteFirst: true);
        var allSteps = processes.SelectMany(pr => pr.Steps).ToList();
        foreach (var pr in processes) terminal.Line(ctx.RunId, $"תהליך: {pr.Title} — {string.Join("; ", pr.Steps.Select(st => $"{st.Title} → {st.Decision}"))}");
        var result = new JsonObject
        {
            ["processes"] = processes.Count, ["steps"] = allSteps.Count, ["agents"] = allSteps.Count(st => st.Decision == "agent"), ["skills"] = allSteps.Count(st => st.Decision == "skill"),
            ["questions"] = questions.Count, ["answered"] = answers.Count(a => !a.Assumed), ["assumed"] = answers.Count(a => a.Assumed), ["costUsd"] = costUsd,
        };
        await store.EventAsync(ctx, "onboarding.processes.mapped", result, by);
        var stored = (JsonObject)result.DeepClone();
        stored["questions"] = Node(questions);
        stored["answers"] = Node(answers);
        await CompleteStepAsync(ctx, "processes", stored, by);
        await AdvanceAsync(ctx, by);
    }

    /// <summary>A coach run reuses the last finished run's processes and trials: the diagnosis is free and runs again, the rest does not need to.</summary>
    private async Task ReuseFromPreviousRunAsync(RunCtx ctx, Guid by)
    {
        var prevId = await tenant.RunAsync(ctx.ClientId, d => SqlJson.ScalarAsync<Guid?>(d, """
            select id from repository_onboarding_run where repo_id = @r and status = 'Completed' and kind = 'onboarding' order by completed_at desc limit 1
            """, new { r = ctx.RepoId }));
        if (prevId is { } prev)
        {
            var src = ctx with { RunId = prev };
            var processes = await store.ProcessesAsync(src);
            var trials = await store.TrialsAsync(src, "baseline");
            await store.ReplaceProcessesAsync(ctx, processes, deleteFirst: false);
            foreach (var t in trials) await store.InsertTrialAsync(ctx, t with { Phase = "baseline", CallId = null }, "(reused)", "");
        }
        var reused = new JsonObject { ["reused"] = prevId is not null, ["from"] = prevId?.ToString() };
        await CompleteStepAsync(ctx, "processes", reused, by);
        await CompleteStepAsync(ctx, "trial", reused.DeepClone(), by);
        await AdvanceAsync(ctx, by);
    }

    // ── 3. the trial run ────────────────────────────────────────────

    private double TrialEstimate(IReadOnlyList<TrialTask> tasks)
    {
        var total = 0.0;
        foreach (var _ in tasks) total += router.EstimateUsd(policy.Recommend("onboarding_trial").Model, 45_000, 1_500) ?? 0.25;
        return total + tasks.Count(t => t.Judge.Kind == "model") * (router.EstimateUsd(policy.Recommend("onboarding_judge").Model, 2_500, 200) ?? 0.01);
    }

    private async Task GateTrialAsync(RunCtx ctx, LoadedRun run, Guid by)
    {
        if (run.Kind == "coach")
        {
            await CompleteStepAsync(ctx, "trial", new JsonObject { ["reused"] = true }, by);
            await AdvanceAsync(ctx, by);
            return;
        }
        var p = await store.RequireProfileAsync(ctx);
        var tasks = Trials.TasksFor(p.Profile, data.TrialTemplates, await store.ProcessesAsync(ctx));
        var estimate = OnboardingJson.Round(TrialEstimate(tasks) * 100) / 100;
        if (run.Level == Automation.ReversibleAuto)
        {
            await TrialPhaseAsync(ctx, run.WorkspacePath, by, "baseline", tasks);
            return;
        }
        var waiting = new JsonObject
        {
            ["tasks"] = new JsonArray(tasks.Select(t => (JsonNode?)new JsonObject { ["key"] = t.Key, ["title_he"] = t.TitleHe, ["judge"] = t.Judge.Kind }).ToArray()),
            ["estimateUsd"] = estimate,
        };
        await WaitStepAsync(ctx, "trial", waiting, by, $"ריצת הניסיון ממתינה לאישור על העלות (~${estimate.ToString("0.00", CultureInfo.InvariantCulture)})");
    }

    public async Task<JsonObject> ApproveTrialAsync(Guid repoId, Guid runId, Guid by)
    {
        var loaded = await store.RunAsync(repoId, runId);
        var ctx = loaded.Ctx;
        if (loaded.StepStatus("trial") != Steps.WaitingForUser) throw new OnboardingRefused("ריצת הניסיון לא ממתינה לאישור");
        await store.PatchStepAsync(ctx, "trial", new() { ["status"] = Steps.Running });
        await store.PatchRunAsync(ctx, new() { ["status"] = Steps.Running });
        await store.EventAsync(ctx, "onboarding.trial.approved", [], by);
        var p = await store.RequireProfileAsync(ctx);
        var tasks = Trials.TasksFor(p.Profile, data.TrialTemplates, await store.ProcessesAsync(ctx));
        var dir = loaded.WorkspacePath;
        Background(engine => engine.TrialPhaseAsync(ctx, dir, by, "baseline", tasks), (engine, e) => engine.FailStepAsync(ctx, "trial", e, by));
        return new JsonObject { ["approved"] = true };
    }

    /// <summary>
    /// The trial tasks, one after another, with no component (baseline) or with the built set (after): the code judges
    /// where it can, a different model where it cannot; a task that did not finish is "cannot verify", never a pass.
    /// </summary>
    private async Task<List<TrialOutcome>> TrialPhaseAsync(RunCtx ctx, string? workspacePath, Guid by, string phase, IReadOnlyList<TrialTask> tasks)
    {
        if (workspacePath is not { } dir) throw new OnboardingRefused("אין עותק מבודד");
        var when = phase == "baseline" ? "לפני" : "אחרי";
        var stepKey = phase == "baseline" ? "trial" : "build";
        var outcomes = new List<TrialOutcome>();
        foreach (var task in tasks)
        {
            terminal.Line(ctx.RunId, $"ניסיון ({when}): {task.TitleHe}");
            var answer = "";
            double costUsd = 0;
            string? callId = null;
            TrialVerdict verdict;
            var judgedBy = "code";
            try
            {
                var res = await CallModelAsync(ctx, "onboarding.trial", new() { ["TASK"] = task.Prompt },
                    new CallOpts("onboarding_trial", $"ניסיון {when}: {task.TitleHe}", stepKey, by, dir) { Commands = true, MaxTurns = 30, TimeoutMs = 420_000 });
                answer = res.Text;
                costUsd += res.CostUsd;
                callId = res.CallId?.ToString();
                if (Trials.JudgeByCode(task, answer) is { } byCode) verdict = byCode;
                else
                {
                    var facts = task.Judge.Kind == "model" ? task.Judge.Facts ?? [] : OnboardingProfile.FactsForJudge((await store.RequireProfileAsync(ctx)).Profile);
                    var j = await CallModelAsync(ctx, "onboarding.judge", new()
                    {
                        ["TASK"] = task.Prompt, ["FACTS"] = string.Join("\n", facts.Select(f => $"- {f}")), ["ANSWER"] = Slice(answer, 12_000),
                    }, new CallOpts("onboarding_judge", $"שופט: {task.TitleHe}", stepKey, by, dir) { Lean = true, TimeoutMs = 120_000 });
                    costUsd += j.CostUsd;
                    verdict = Trials.ParseJudge(j.Text);
                    judgedBy = policy.Recommend("onboarding_judge").Model;
                }
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                verdict = new TrialVerdict(false, FailureKinds.CannotVerify, $"המשימה לא הסתיימה: {Slice(e.Message, 160)}");
            }
            var outcome = new TrialOutcome(task.Key, task.TitleHe, phase, verdict.Passed, verdict.FailureKind, verdict.Detail, costUsd, callId, judgedBy);
            outcomes.Add(outcome);
            await store.InsertTrialAsync(ctx, outcome, task.Prompt, answer);
            await store.EventAsync(ctx, "onboarding.trial.task", new()
            {
                ["phase"] = phase, ["taskKey"] = task.Key, ["title"] = task.TitleHe, ["passed"] = verdict.Passed, ["failureKind"] = verdict.FailureKind,
                ["detail"] = Slice(verdict.Detail, 300), ["costUsd"] = costUsd, ["judgedBy"] = judgedBy,
            }, by);
            var mark = verdict.Passed == true ? "✓ עבר"
                : verdict.Passed == false ? $"✗ נכשל — {(verdict.FailureKind is { } k ? Trials.FailureHe.GetValueOrDefault(k, "undefined") : "")}"
                : "? לא נשפט";
            terminal.Line(ctx.RunId, $"  {mark}: {verdict.Detail}");
        }
        if (phase == "baseline")
        {
            var result = new JsonObject
            {
                ["phase"] = phase, ["tasks"] = outcomes.Count, ["passed"] = outcomes.Count(o => o.Passed == true), ["costUsd"] = outcomes.Sum(o => o.CostUsd),
                ["byKind"] = Node(Trials.ByKind(outcomes)),
            };
            await CompleteStepAsync(ctx, "trial", result, by);
            await AdvanceAsync(ctx, by);
        }
        return outcomes;
    }

    // ── 4. the plan: cards from every source ────────────────────────

    private sealed record MarketSeeds(List<ComponentSeed> Seeds, int Found, int Remembered, bool Searched, string? Skipped, double CostUsd);

    private async Task<MarketSeeds> MarketplaceSeedsAsync(RunCtx ctx, LoadedRun run, Guid by, JsonObject profile)
    {
        var tags = Rules.StackTags(profile);
        var remembered = await marketplace.RememberedForAsync(tags);
        var toSearch = MarketplaceSources.TagsToSearch(tags, remembered);
        var searched = false;
        string? skipped = null;
        var found = 0;
        double costUsd = 0;
        var sources = new List<RememberedSource>(remembered);
        if (run.Level == Automation.Locked) skipped = "המדרגה נעולה — חיפוש פתוח ברשת לא רץ בלי אישור";
        else if (toSearch.Count == 0) skipped = "כל תגיות הסטאק כבר מוכרות מהזיכרון";
        else
        {
            try
            {
                var known = string.Join("; ", remembered.Select(r => $"{r.Name} ({r.Kind}) {r.Url}")) is { Length: > 0 } k ? k : "(nothing yet)";
                var runtime = workspace.RuntimeDir(ctx.RunId);
                Directory.CreateDirectory(runtime);
                var res = await CallModelAsync(ctx, "onboarding.marketplace", new()
                {
                    ["STACK"] = string.Join(", ", toSearch), ["PROFILE_SUMMARY"] = OnboardingProfile.Summary(profile), ["KNOWN"] = known,
                }, new CallOpts("onboarding_marketplace", $"חיפוש רכיבים מוכנים: {string.Join(", ", toSearch.Take(4))}", "plan", by, runtime) { Tools = "WebSearch,WebFetch", MaxTurns = 30, TimeoutMs = 600_000 });
                costUsd = res.CostUsd;
                searched = true;
                foreach (var s in MarketplaceSources.ParseSources(res.Text))
                {
                    // Only an MCP's page is fetched (its tool descriptions are what the injection check reads) — and only a public http(s) one.
                    var page = s.Kind == "mcp" ? await PageFetcher.FetchAsync(s.Url) : null;
                    var (trust, checks) = MarketplaceSources.CheckTrust(s, page);
                    var haystack = JsLower(string.Join(" ", s.Tags) + s.Name + (s.Description ?? ""));
                    var row = await marketplace.RememberSourceAsync(s with { Tags = s.Tags.Concat(toSearch.Where(t => haystack.Contains(t.Split('-')[0], StringComparison.Ordinal))).Distinct().ToList() }, trust, checks);
                    if (!sources.Any(x => x.Id == row.Id)) sources.Add(row);
                    found++;
                    await store.EventAsync(ctx, "onboarding.marketplace.found", new()
                    {
                        ["kind"] = s.Kind, ["name"] = s.Name, ["url"] = s.Url, ["publisher"] = s.Publisher, ["trust"] = trust, ["suspicious"] = checks.Suspicious.Count,
                    }, by);
                    terminal.Line(ctx.RunId, $"  מקור: {s.Name} ({s.Kind}) — {trust}{(checks.Suspicious.Count > 0 ? " ⚠ תיאורים חשודים" : "")}");
                }
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                skipped = $"החיפוש נכשל: {Slice(e.Message, 120)}";
                terminal.Line(ctx.RunId, skipped);
            }
        }
        var seeds = new List<ComponentSeed>();
        foreach (var r in sources)
        {
            var matched = r.Tags.Where(tags.Contains).ToList();
            if (matched.Count == 0) continue;
            seeds.Add(MarketplaceSources.SeedFromSource(r, r.Description ?? "", matched));
        }
        return new MarketSeeds(seeds, found, remembered.Count, searched, skipped, costUsd);
    }

    private sealed record ReviewerResult(List<ComponentSeed> Seeds, List<(string Key, string Why)> Redundant, double CostUsd);

    private static readonly HashSet<string> ReviewerKinds = ["rule", "hook", "permission", "skill", "agent", "mcp", "plugin", "lsp", "scaffold", "doc", "script"];

    /// <summary><c>(x ?? [])</c> where the old server then called an array's method on it: anything else threw.</summary>
    private static JsonArray ListOf(JsonNode? n) => n switch
    {
        null => [],
        JsonArray a => a,
        _ => throw new InvalidOperationException("the answer's list is not a list"),
    };

    private async Task<ReviewerResult?> ReviewerSeedsAsync(RunCtx ctx, LoadedRun run, Guid by, JsonObject profile, List<DiscoveredProcess> processes, List<TrialOutcome> trials, List<ComponentSeed> seeds)
    {
        try
        {
            var res = await CallModelAsync(ctx, "onboarding.review", new()
            {
                ["REPO_NAME"] = ctx.RepoName, ["PROFILE_SUMMARY"] = OnboardingProfile.Summary(profile), ["PROCESSES"] = Processes.RenderProcesses(processes), ["TRIALS"] = Trials.Render(trials),
                ["COMPONENTS"] = string.Join("\n", seeds.Select(s => $"- [{s.Key}] {s.Kind} · {s.TitleHe} — {s.WhyHe}{(s.NotRecommended ? " (not recommended here)" : "")}")),
            }, new CallOpts("onboarding_review", "הסוקר: מה חסר ומה מיותר", "plan", by, run.WorkspacePath) { Lean = true, TimeoutMs = 240_000 });
            var o = ParseObject(res.Text);
            var output = new List<ComponentSeed>();
            var i = 0;
            foreach (var m in ListOf(o["missing"]).OfType<JsonObject>().Where(m => ComponentVerifier.Truthy(m["title"]) && ReviewerKinds.Contains(ComponentVerifier.JsString(m["kind"]))).Take(6))
            {
                var kind = ComponentVerifier.JsString(m["kind"]);
                var parameters = new JsonObject();
                if (kind == "skill") parameters["template"] = "process-skill";
                else if (kind == "agent") parameters["template"] = "process-agent";
                if (kind == "rule") parameters["text"] = ComponentVerifier.JsString(m["title"]);
                parameters["fromReviewer"] = true;
                output.Add(new ComponentSeed
                {
                    Key = $"reviewer_{++i}_{kind}", Kind = kind, Family = Components.FamilyOf(kind),
                    Risk = kind == "mcp" ? "external" : kind is "rule" or "doc" or "permission" ? "reversible" : "significant",
                    Source = "reviewer", SourceRef = "onboarding.review", TitleHe = Slice(ComponentVerifier.JsString(m["title"]), 120),
                    WhyHe = $"הסוקר: {Slice(m["why"] is { } why ? ComponentVerifier.JsString(why) : "", 400)}",
                    WhatHe = $"{KindHe(kind)} שהסוקר הצביע עליו כחסר; נבנה כמו כל רכיב אם יאושר.", VerifyHowHe = "לפי הסוג, כמו כל רכיב.", Params = parameters,
                });
            }
            var redundant = ListOf(o["redundant"]).OfType<JsonObject>().Where(r => ComponentVerifier.Truthy(r["key"]))
                .Select(r => (ComponentVerifier.JsString(r["key"]), r["why"] is { } w ? ComponentVerifier.JsString(w) : "")).ToList();
            return new ReviewerResult(output, redundant, res.CostUsd);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            terminal.Line(ctx.RunId, $"הסוקר לא ענה ({Slice(e.Message, 100)})");
            return null;
        }
    }

    private static JsonObject ByGroup(IReadOnlyList<Component> cards) => new()
    {
        ["auto"] = cards.Count(c => c.Group == "auto"), ["approval"] = cards.Count(c => c.Group == "approval"), ["not_recommended"] = cards.Count(c => c.Group == "not_recommended"),
    };

    private static JsonArray Suppressions(IEnumerable<RuleSuppression> s) =>
        new(s.Select(x => (JsonNode?)new JsonObject { ["rule"] = x.Rule, ["fact"] = x.Fact }).ToArray());

    private async Task PlanAsync(RunCtx ctx, LoadedRun run, Guid by)
    {
        var p = await store.RequireProfileAsync(ctx);
        var level = run.Level;
        var processes = await store.ProcessesAsync(ctx);
        var trials = await store.TrialsAsync(ctx, "baseline");
        double costUsd = 0;
        List<ComponentSeed> seeds;
        var rules = new RulesOutcome([], [], 0);
        var market = new MarketSeeds([], 0, 0, false, null, 0);
        ReviewerResult? review = null;
        if (run.Kind == "coach") seeds = await CoachSeedsAsync(ctx);
        else
        {
            rules = Rules.Apply(p.Profile, p.Corrections, data.Rules);
            foreach (var f in rules.Fired) terminal.Line(ctx.RunId, $"כלל {f.Rule}: {f.ReasonHe}");
            foreach (var s in rules.Suppressed) terminal.Line(ctx.RunId, $"כלל {s.Rule} לא הופעל — סימנת את \"{s.Fact}\" כלא נכון");
            var fromRules = rules.Fired.SelectMany(f => f.Components).ToList();
            var fromProcesses = Components.SeedsFromProcesses(processes);
            var fromTrials = Components.SeedsFromTrials(trials, [.. fromRules, .. fromProcesses]);
            market = await MarketplaceSeedsAsync(ctx, run, by, p.Profile);
            costUsd += market.CostUsd;
            seeds = Components.MergeSeeds(fromRules, fromProcesses, fromTrials, market.Seeds);
            review = await ReviewerSeedsAsync(ctx, run, by, p.Profile, processes, trials, seeds);
            if (review is not null)
            {
                costUsd += review.CostUsd;
                seeds = Components.MergeSeeds(seeds, review.Seeds);
            }
        }
        var cards = seeds.Select(s => Components.CardFromSeed(s, level)).ToList();
        if (run.Kind == "coach") foreach (var c in cards) if (c.Status == ComponentStatuses.Proposed) c.Status = ComponentStatuses.Approved;
        foreach (var (key, why) in review?.Redundant ?? [])
            if (cards.FirstOrDefault(x => x.Key == key) is { } c) c.WhyHe = $"{c.WhyHe} הסוקר: ייתכן שמיותר — {why}";
        await store.UpsertCardsAsync(ctx, cards);
        var byGroup = ByGroup(cards);
        var marketJson = new JsonObject { ["searched"] = market.Searched, ["found"] = market.Found, ["remembered"] = market.Remembered, ["skipped"] = market.Skipped };
        var reviewerJson = review is null ? null : new JsonObject { ["missing"] = review.Seeds.Count, ["redundant"] = review.Redundant.Count };
        var rulesFired = OnboardingJson.Arr(rules.Fired.Select(f => f.Rule));
        var result = new JsonObject
        {
            ["rulesFired"] = rulesFired.DeepClone(), ["rulesSuppressed"] = Suppressions(rules.Suppressed), ["components"] = cards.Count, ["byGroup"] = byGroup.DeepClone(),
            ["marketplace"] = marketJson.DeepClone(), ["reviewer"] = reviewerJson?.DeepClone(), ["costUsd"] = costUsd,
            ["firings"] = Rules.FiringsJson(rules.Fired), ["suppressed"] = Node(rules.Suppressed),
            ["redundant"] = new JsonArray((review?.Redundant ?? []).Select(r => (JsonNode?)new JsonObject { ["key"] = r.Key, ["why"] = r.Why }).ToArray()),
        };
        await store.EventAsync(ctx, "onboarding.plan.drawn", new()
        {
            ["rulesFired"] = rulesFired, ["components"] = cards.Count, ["byGroup"] = byGroup, ["marketplace"] = marketJson, ["reviewer"] = reviewerJson,
        }, by);
        if (run.Kind == "coach")
        {
            await CompleteStepAsync(ctx, "plan", result, by);
            await AdvanceAsync(ctx, by);
            return;
        }
        await WaitStepAsync(ctx, "plan", result, by,
            $"{byGroup["approval"]} כרטיסים מחכים לאישורך, {byGroup["auto"]} ייעשו וידווחו, {byGroup["not_recommended"]} לא מומלצים כאן");
    }

    /// <summary>After a correction while the plan waits: the rules run again; decisions already taken on cards that still exist are kept.</summary>
    private async Task ReplanAsync(RunCtx ctx, Guid by, string why)
    {
        var loaded = await store.RunAsync(ctx.RepoId, ctx.RunId);
        if (loaded.StepStatus("plan") != Steps.WaitingForUser) return;
        var p = await store.RequireProfileAsync(ctx);
        var rules = Rules.Apply(p.Profile, p.Corrections, data.Rules);
        var existing = await store.CardsAsync(ctx);
        var cards = rules.Fired.SelectMany(f => f.Components).Select(s => Components.CardFromSeed(s, loaded.Level)).Concat(existing.Where(c => c.Source != "rule")).ToList();
        await store.UpsertCardsAsync(ctx, cards);
        await store.MergePlanResultAsync(ctx, new JsonObject
        {
            ["rulesFired"] = OnboardingJson.Arr(rules.Fired.Select(f => f.Rule)), ["rulesSuppressed"] = Suppressions(rules.Suppressed),
            ["firings"] = Rules.FiringsJson(rules.Fired), ["suppressed"] = Node(rules.Suppressed), ["components"] = cards.Count, ["byGroup"] = ByGroup(cards),
        });
        await store.EventAsync(ctx, "onboarding.plan.redrawn", new()
        {
            ["why"] = why, ["rulesFired"] = OnboardingJson.Arr(rules.Fired.Select(f => f.Rule)), ["suppressed"] = Node(rules.Suppressed),
        }, by);
    }

    /// <summary>The seeds of a coach run: the approved proposals' components.</summary>
    private async Task<List<ComponentSeed>> CoachSeedsAsync(RunCtx ctx)
    {
        var rows = await tenant.RunAsync(ctx.ClientId, d => SqlJson.QueryAsync(d, """
            select id, component_key as "componentKey", title, why, evidence from repo_coach_proposal where run_id = @r
            """, new { r = ctx.RunId }));
        return rows.Select(r =>
        {
            var id = Str(r, "id")!;
            if ((r["evidence"] as JsonObject)?["seed"] is JsonObject seed)
            {
                var s = SeedFromJson(seed);
                s.Source = "coach";
                s.SourceRef = id;
                return s;
            }
            return new ComponentSeed
            {
                Key = Slice(Str(r, "componentKey") ?? $"coach_{id[..8]}", 60), Kind = "rule", Family = "knowledge", Risk = "reversible", Source = "coach", SourceRef = id,
                TitleHe = Str(r, "title")!, WhyHe = Str(r, "why")!, WhatHe = "שורת הנחיה מהצעת המאמן.", VerifyHowHe = "נטענת בכל סשן.", Params = new JsonObject { ["text"] = Str(r, "title") },
            };
        }).ToList();
    }

    /// <summary>A seed as the old server wrote it into a coach proposal's evidence (title_he, why_he, …).</summary>
    internal static ComponentSeed SeedFromJson(JsonObject o) => new()
    {
        Key = Str(o, "key") ?? "", Kind = Str(o, "kind") ?? "", Family = Str(o, "family") ?? "", TitleHe = Str(o, "title_he") ?? "", WhyHe = Str(o, "why_he") ?? "",
        WhatHe = Str(o, "what_he") ?? "", Source = Str(o, "source") ?? "", SourceRef = Str(o, "sourceRef"), Risk = Str(o, "risk") ?? "reversible",
        VerifyHowHe = Str(o, "verifyHow_he") ?? "", Params = o["params"] is JsonObject p ? (JsonObject)p.DeepClone() : [],
        ContextTokens = o["contextTokens"] is JsonValue t && t.TryGetValue<double>(out var n) ? (int)n : null,
        Questions = OnboardingJson.From<List<ClarifyingQuestion>>(o["questions"]), NotRecommended = ComponentVerifier.IsTrue(o["notRecommended"]),
    };

    // ── decisions on the cards ──────────────────────────────────────

    private async Task<LoadedRun> PlanWaitingAsync(Guid repoId, Guid runId, string refusal)
    {
        var loaded = await store.RunAsync(repoId, runId);
        if (loaded.Over) throw new OnboardingRefused("ההרצה הסתיימה");
        if (loaded.StepStatus("plan") != Steps.WaitingForUser) throw new OnboardingRefused(refusal);
        return loaded;
    }

    public async Task<JsonObject> DecideComponentAsync(Guid repoId, Guid runId, Guid by, string key, string decision, string? reason, IReadOnlyDictionary<string, string>? answers)
    {
        var loaded = await PlanWaitingAsync(repoId, runId, "התוכנית לא ממתינה להחלטות");
        var ctx = loaded.Ctx;
        var cards = await store.CardsAsync(ctx);
        var c = cards.FirstOrDefault(x => x.Key == key) ?? throw new OnboardingRefused("הכרטיס לא נמצא");
        if (c.Kind == "report") throw new OnboardingRefused("דיווח לא מאשרים ולא דוחים — הוא מידע");
        var questions = c.Questions.Select(q => q with { Answer = answers is not null && answers.TryGetValue(q.Key, out var a) && NonEmpty(a) is { } t ? t : q.Answer }).ToList();
        var status = decision switch
        {
            "approve" => ComponentStatuses.Approved,
            "decline" => ComponentStatuses.Declined,
            "defer" => ComponentStatuses.Deferred,
            _ => ComponentStatuses.Proposed,
        };
        var undo = decision == "undo";
        await store.UpdateCardAsync(ctx, c.Id!, new()
        {
            ["status"] = status, ["questions"] = SqlJson.Jsonb(questions), ["decided_by"] = undo ? null : by, ["decided_at"] = undo ? null : DateTimeOffset.UtcNow,
            ["decline_reason"] = decision == "decline" ? NonEmpty(reason) : null,
        });
        await store.EventAsync(ctx, "onboarding.card.decided", new() { ["key"] = c.Key, ["title"] = c.TitleHe, ["decision"] = decision, ["reason"] = reason }, by);
        return new JsonObject { ["key"] = c.Key, ["status"] = status };
    }

    /// <summary>Approve as a set: every card still waiting (or the named keys). A question only a person decides — the scan's "ask": a permission, a policy — is never answered as part of a set.</summary>
    public async Task<JsonObject> DecideComponentSetAsync(Guid repoId, Guid runId, Guid by, string decision, IReadOnlyList<string>? keys, string? reason)
    {
        var loaded = await PlanWaitingAsync(repoId, runId, "התוכנית לא ממתינה להחלטות");
        var ctx = loaded.Ctx;
        var cards = (await store.CardsAsync(ctx)).Where(c => c.Status == ComponentStatuses.Proposed && c.Kind != "report"
            && (keys is not null ? keys.Contains(c.Key) : !ComponentVerifier.IsString(c.Params["decision"], "ask"))).ToList();
        var status = decision == "approve" ? ComponentStatuses.Approved : ComponentStatuses.Declined;
        foreach (var c in cards)
            await store.UpdateCardAsync(ctx, c.Id!, new()
            {
                ["status"] = status, ["decided_by"] = by, ["decided_at"] = DateTimeOffset.UtcNow, ["decline_reason"] = decision == "decline" ? NonEmpty(reason) : null,
            });
        await store.EventAsync(ctx, "onboarding.cards.decided_set", new() { ["decision"] = decision, ["keys"] = OnboardingJson.Arr(cards.Select(c => c.Key)) }, by);
        return new JsonObject { ["decided"] = cards.Count };
    }

    private static string Base36(long n)
    {
        const string digits = "0123456789abcdefghijklmnopqrstuvwxyz";
        var sb = new StringBuilder();
        do { sb.Insert(0, digits[(int)(n % 36)]); n /= 36; } while (n > 0);
        return sb.ToString();
    }

    /// <summary>"תכין skill לתהליך X" — a person's request becomes a card with at most three questions, built and verified like every other card.</summary>
    public async Task<JsonObject> RequestComponentAsync(Guid repoId, Guid runId, Guid by, string request)
    {
        var loaded = await PlanWaitingAsync(repoId, runId, "בקשה לרכיב אפשרית כשהתוכנית פתוחה לאישור");
        var ctx = loaded.Ctx;
        var text = ComponentVerifier.JsTrim(request);
        if (text.Length == 0) throw new OnboardingRefused("כתבו מה הרכיב צריך לעשות");
        var p = await store.RequireProfileAsync(ctx);
        var processes = await store.ProcessesAsync(ctx);
        var res = await CallModelAsync(ctx, "onboarding.request", new()
        {
            ["REPO_NAME"] = ctx.RepoName, ["REQUEST"] = Slice(text, 2000), ["PROFILE_SUMMARY"] = OnboardingProfile.Summary(p.Profile), ["PROCESSES"] = Processes.RenderProcesses(processes),
        }, new CallOpts("onboarding_processes", $"בקשה לרכיב: {Slice(text, 60)}", "plan", by, loaded.WorkspacePath) { Lean = true, TimeoutMs = 120_000 });
        JsonObject o = [];
        try { o = ParseObject(res.Text); }
        catch (JsonException) { /* handled below: the defaults */ }
        var kind = new[] { "skill", "agent", "hook", "rule", "doc", "mcp" }.FirstOrDefault(k => ComponentVerifier.IsString(o["kind"], k)) ?? "skill";
        var title = Slice(o["title"] is { } t ? ComponentVerifier.JsString(t) : Slice(text, 80), 120);
        // An answer whose questions are not a list asks none (the old server threw there, a 500).
        var questions = (o["questions"] as JsonArray ?? []).OfType<JsonObject>().Where(q => ComponentVerifier.Truthy(q["question_he"])).Take(3)
            .Select((q, i) => new ClarifyingQuestion(Slice(q["key"] is { } k ? ComponentVerifier.JsString(k) : $"q{i + 1}", 40), Slice(ComponentVerifier.JsString(q["question_he"]), 300),
                Slice(q["default"] is { } d ? ComponentVerifier.JsString(d) : "", 200), null)).ToList();
        var what = Slice(o["what"] is { } w ? ComponentVerifier.JsString(w) : "", 400);
        var parameters = new JsonObject();
        if (kind == "skill") parameters["template"] = "process-skill";
        else if (kind == "agent") parameters["template"] = "process-agent";
        if (kind == "rule") parameters["text"] = title;
        parameters["request"] = text;
        parameters["what"] = o["what"]?.DeepClone() ?? "";
        parameters["stepTitle"] = title;
        var seed = new ComponentSeed
        {
            Key = $"user_{Base36(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())}_{kind}", Kind = kind, Family = Components.FamilyOf(kind),
            Risk = kind == "mcp" ? "external" : kind is "rule" or "doc" ? "reversible" : "significant", Source = "user", SourceRef = by.ToString(),
            TitleHe = title, WhyHe = $"ביקשת: \"{Slice(text, 300)}\"", WhatHe = what.Length > 0 ? what : $"{KindHe(kind)} לפי הבקשה.",
            VerifyHowHe = "נבנה ומאומת כמו כל רכיב; אתה מחליט אם עזר.", Params = parameters, Questions = questions,
        };
        var card = Components.CardFromSeed(seed, loaded.Level);
        card.Group = "approval";
        card.Status = ComponentStatuses.Proposed;
        var existing = await store.CardsAsync(ctx);
        await store.UpsertCardsAsync(ctx, [.. existing, card]);
        await store.EventAsync(ctx, "onboarding.card.requested", new() { ["key"] = card.Key, ["kind"] = kind, ["title"] = title, ["questions"] = questions.Count, ["costUsd"] = res.CostUsd }, by);
        return new JsonObject { ["key"] = card.Key, ["kind"] = kind, ["title"] = title, ["questions"] = Node(questions) };
    }

    // ── cancel, automation ──────────────────────────────────────────

    public async Task<JsonObject> CancelAsync(Guid repoId, Guid runId, Guid by)
    {
        var loaded = await store.RunAsync(repoId, runId);
        if (loaded.Over) throw new OnboardingRefused("ההרצה כבר הסתיימה");
        var ctx = loaded.Ctx;
        if (terminal.State(runId) == "live") await drafts.StopAsync(ctx.Draft, by, CancellationToken.None);
        foreach (var s in loaded.StepRows)
            if (Str(s, "status") != Steps.Completed) await store.PatchStepAsync(ctx, Str(s, "stepKey")!, new() { ["status"] = Steps.Cancelled });
        await store.PatchRunAsync(ctx, new() { ["status"] = Steps.Cancelled, ["cancelled_at"] = DateTimeOffset.UtcNow, ["cancelled_by"] = by });
        await store.EventAsync(ctx, "onboarding.run.cancelled", [], by);
        terminal.Line(runId, "ההרצה בוטלה. העותק המבודד והענף נשארים כמו שהם.");
        return new JsonObject { ["cancelled"] = true };
    }

    /// <summary>The level for what is still ahead: a step already done keeps what it did (cards already drawn keep their group).</summary>
    public async Task<JsonObject> UpdateAutomationAsync(Guid repoId, Guid runId, JsonNode? raw, Guid by)
    {
        var loaded = await store.RunAsync(repoId, runId);
        if (loaded.Over) throw new OnboardingRefused("ההרצה הסתיימה");
        var level = LevelOf(raw);
        await store.PatchRunAsync(loaded.Ctx, new() { ["automation"] = SqlJson.Jsonb(Automation.ToJson(level)) });
        await store.EventAsync(loaded.Ctx, "onboarding.automation.updated", new() { ["level"] = level }, by);
        return Automation.ToJson(level);
    }

    // ── the /init draft session inside the plan step ────────────────

    /// <summary>
    /// The real Claude Code in a terminal, in the isolated copy — a window inside the plan step, and only while the plan
    /// waits for decisions (the old server also let it open once the processes were done, during the trial, the build
    /// or the delivery, which the screen never offered).
    /// </summary>
    public async Task<JsonObject> StartDraftSessionAsync(Guid repoId, Guid runId, Guid by, bool resume, string? model, string? effort)
    {
        var loaded = await store.RunAsync(repoId, runId);
        if (loaded.Over) throw new OnboardingRefused("ההרצה הסתיימה");
        if (loaded.StepStatus("plan") != Steps.WaitingForUser) throw new OnboardingRefused("טיוטת /init נפתחת כשהתוכנית פתוחה לאישור");
        if (loaded.WorkspacePath is not { } dir) throw new OnboardingRefused("אין עותק מבודד — החיבור עוד לא רץ");
        try { await drafts.LaunchAsync(loaded.Ctx.Draft, dir, RunSessions.Of(loaded.Run["session"]), by, resume, model, effort, CancellationToken.None); }
        catch (DraftRefused e) { throw new OnboardingRefused(e.Message); }
        return new JsonObject { ["started"] = true };
    }

    /// <summary>An instruction typed into the live draft session, as the person who sent it (the chat's send_to_session).</summary>
    public async Task<JsonObject> SendToSessionAsync(Guid repoId, Guid runId, Guid by, string text, string? messageId = null, bool force = false)
    {
        var loaded = await store.RunAsync(repoId, runId);
        try { return await drafts.SendAsync(loaded.Ctx.Draft, RunSessions.Of(loaded.Run["session"]), by, text, messageId, force, CancellationToken.None); }
        catch (DraftRefused e) { throw new OnboardingRefused(e.Message); }
    }
}
