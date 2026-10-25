using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Repos;
using Microsoft.Extensions.Logging;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// What the dossier screen reads (runs.ts): the whole run in one view, polled every few seconds while it runs; the
/// run's history; a changed file before and after; the step catalogue shown before a run exists. And the restart:
/// what was mid-flight when the server stopped is marked so, and waits for a person's click.
/// </summary>
public sealed partial class OnboardingRuns
{
    private JsonObject Recommended()
    {
        var r = policy.Recommend("onboarding_init");
        return new JsonObject { ["draft"] = new JsonObject { ["model"] = r.Model, ["effort"] = r.Effort } };
    }

    /// <summary>The steps, the automation levels and the draft session's model — what the pre-start page shows before a run exists.</summary>
    public JsonObject StepCatalogue() =>
        new() { ["steps"] = Node(Steps.All), ["levels"] = OnboardingJson.Arr(Automation.Levels), ["recommended"] = Recommended() };

    /// <summary>The repository's runs, newest first.</summary>
    public async Task<JsonArray> ListAsync(Guid repoId) =>
        new((await store.RunsOfAsync(await store.RepoAsync(repoId))).Select(r => (JsonNode?)r).ToArray());

    /// <summary>The newest run in a line, or null when the repository never had one.</summary>
    public async Task<JsonObject?> LatestAsync(Guid repoId)
    {
        var latest = (await store.RunsOfAsync(await store.RepoAsync(repoId))).FirstOrDefault();
        return latest is null ? null : new JsonObject
        {
            ["runId"] = latest["id"]?.DeepClone(), ["kind"] = latest["kind"]?.DeepClone(), ["status"] = latest["status"]?.DeepClone(),
            ["currentStepKey"] = latest["currentStepKey"]?.DeepClone(), ["completedAt"] = latest["completedAt"]?.DeepClone(),
        };
    }

    /// <summary>A file the run changed: before (the baseline in git) and after (the copy on disk).</summary>
    public async Task<FileVersions> FileVersionsAsync(Guid repoId, Guid runId, string path)
    {
        var run = await store.RunAsync(repoId, runId);
        if (string.IsNullOrEmpty(run.WorkspacePath) || string.IsNullOrEmpty(run.BaselineSha)) throw new OnboardingRefused("אין עותק מבודד עדיין");
        return await RunChanges.FileVersionsAsync(run.WorkspacePath, run.BaselineSha, path);
    }

    /// <summary>Every file the run changed against its baseline — none before the copy exists.</summary>
    public async Task<JsonObject> ChangedFilesAsync(Guid repoId, Guid runId)
    {
        var run = await store.RunAsync(repoId, runId);
        if (string.IsNullOrEmpty(run.WorkspacePath) || string.IsNullOrEmpty(run.BaselineSha)) return new JsonObject { ["files"] = new JsonArray() };
        return new JsonObject { ["files"] = Node(await RunChanges.ChangedFilesAsync(run.WorkspacePath, run.BaselineSha)) };
    }

    /// <summary>For the terminal socket (runs.ts authorizeOnboardingTerminal): the run must exist and belong to the repository — its client, or the engine's 409.</summary>
    public async Task<Guid> TerminalClientAsync(Guid repoId, Guid runId) => (await store.RunAsync(repoId, runId)).Ctx.ClientId;

    /// <summary>The repository the run belongs to — what an action on the "run" topic needs, the chat knowing only the run.</summary>
    public Task<Guid?> RepoOfAsync(Guid clientId, Guid runId) =>
        tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<Guid?>(d, "select repo_id from repository_onboarding_run where id = @id", new { id = runId }));

    /// <summary>The readiness card: what the run has, what it misses, and what cannot be verified here.</summary>
    private async Task<Readiness> ReadinessOfAsync(RunCtx ctx, LoadedRun run, IReadOnlyList<Component> cards)
    {
        var p = await store.ProfileAsync(ctx);
        var processes = await store.ProcessesAsync(ctx);
        var trials = await store.TrialsAsync(ctx);
        var plan = run.StepResult("plan") as JsonObject ?? [];
        var build = run.StepResult("build") as JsonObject ?? [];
        var answers = OnboardingJson.From<List<InterviewAnswer>>((run.StepResult("processes") as JsonObject)?["answers"]);
        return Components.Readiness(new ReadinessInput(
            cards, processes, trials, OnboardingJson.From<TrialDelta>(build["delta"]),
            cards.Count(c => c.Source == "reviewer" && c.Status == ComponentStatuses.Proposed),
            OnboardingJson.From<List<RuleSuppression>>(plan["suppressed"]) ?? [], [],
            ComponentVerifier.Truthy((p?.Profile["windows_build"] as JsonObject)?["windows_only_build"]),
            answers?.Any(a => a.Key == "runner" && a.Value == "yes") ?? false));
    }

    private static double Num(JsonNode? n) => OnboardingJson.Num(n);

    /// <summary>
    /// The run as the dossier shows it: the run and its steps whole, the profile, the interview, the processes, the trial
    /// outcomes, the cards, the plan, readiness (once the plan exists), the build, the delivery, the events, the code map
    /// and the cost — every model call of the run by its step, plus what a live draft session spent since its last
    /// ledger slice. A session stored as live with no terminal behind it (the server restarted) reads "disconnected".
    /// </summary>
    public async Task<JsonObject> ViewAsync(Guid repoId, Guid runId)
    {
        var loaded = await store.RunAsync(repoId, runId);
        var ctx = loaded.Ctx;
        var events = await store.EventsAsync(ctx);
        var session = RunSessions.Of(loaded.Run["session"]);
        var stored = Str(session, "state");
        session["state"] = terminal.State(runId) == "live" ? "live" : stored == "live" ? "disconnected" : session["state"]?.DeepClone();
        var p = await store.ProfileAsync(ctx);
        var processes = await store.ProcessRowsAsync(ctx);
        var trials = await store.TrialsAsync(ctx);
        var cards = await store.CardsAsync(ctx);
        var interview = loaded.StepResult("processes") as JsonObject;
        var buildStep = loaded.Step("build");
        var deliverStep = loaded.Step("deliver");
        var build = buildStep?["result"];
        var baseline = trials.Where(t => t.Phase == "baseline").ToList();
        var after = trials.Where(t => t.Phase == "after").ToList();
        var deliver = deliverStep?["result"] as JsonObject;

        JsonNode? codeMap = null;
        if (loaded.WorkspacePath is { Length: > 0 } dir)
        {
            try
            {
                var map = await CodeMapReader.ForWorkspaceAsync(dir, new CodeMapInput(Branch: loaded.BranchName, BaselineSha: loaded.BaselineSha,
                    PrUrl: Str(deliver, "prUrl"), PrNumber: deliver?["prNumber"] is JsonValue n && n.TryGetValue<int>(out var number) ? number : null));
                codeMap = JsonSerializer.SerializeToNode(map, JsonSerializerOptions.Web);
            }
            catch (Exception e) when (e is not OperationCanceledException) { codeMap = null; }
        }

        // Cost: the ledger rows of this run (every model call carries its step), plus what the live draft session spent since its last slice.
        var calls = await center.ForEntityAsync(ctx.ClientId, null, ("onboarding_run", runId.ToString()), null, CancellationToken.None);
        bool Chat(JsonObject c) => Str(c, "trigger") is "chat" or "rollover";
        var runCalls = calls.Where(c => !Chat(c)).ToList();
        var chatCalls = calls.Where(Chat).ToList();
        var totals = RunSessions.Totals(session);
        var liveUsd = Math.Max(0, totals.CostUsd - Num(session["ledgerCursor"]?["costUsd"]));
        var byStep = new List<(string StepKey, double CostUsd, int Calls)>();
        void Add(string key, double usd, int count)
        {
            var i = byStep.FindIndex(x => x.StepKey == key);
            if (i < 0) byStep.Add((key, usd, count));
            else byStep[i] = (key, byStep[i].CostUsd + usd, byStep[i].Calls + count);
        }
        foreach (var c in runCalls) Add(c["meta"] is JsonObject meta && meta["stepKey"] is { } k ? ComponentVerifier.JsString(k) : "plan", Num(c["costUsd"]), 1);
        if (liveUsd > 0) Add("plan", liveUsd, 0);

        var planStatus = loaded.StepStatus("plan");
        var readiness = planStatus is Steps.WaitingForUser or Steps.Completed ? await ReadinessOfAsync(ctx, loaded, cards) : null;
        var run = (JsonObject)loaded.Run.DeepClone();
        run["session"] = session;
        return new JsonObject
        {
            ["repo"] = new JsonObject { ["id"] = loaded.Repo.Id.ToString(), ["name"] = loaded.Repo.Name },
            ["run"] = run,
            ["steps"] = new JsonArray(loaded.StepRows.Select(s => (JsonNode?)s.DeepClone()).ToArray()),
            ["definitions"] = Node(Steps.All),
            ["automation"] = Automation.ToJson(loaded.Level),
            ["levels"] = OnboardingJson.Arr(Automation.Levels),
            ["profile"] = p is null ? null : new JsonObject
            {
                ["id"] = p.Id.ToString(), ["facts"] = Node(OnboardingProfile.Facts(p.Profile, p.Corrections)), ["corrections"] = Node(p.Corrections),
                ["summary"] = OnboardingProfile.Summary(p.Profile), ["tags"] = OnboardingJson.Arr(Rules.StackTags(p.Profile)), ["raw"] = p.Profile.DeepClone(),
            },
            ["interview"] = new JsonObject { ["questions"] = interview?["questions"]?.DeepClone() ?? new JsonArray(), ["answers"] = interview?["answers"]?.DeepClone() ?? new JsonArray() },
            ["processes"] = new JsonArray(processes.Select(r => (JsonNode?)r).ToArray()),
            ["trials"] = new JsonObject
            {
                ["baseline"] = Node(baseline), ["after"] = Node(after),
                ["delta"] = build?["delta"] is { } stored2 ? stored2.DeepClone() : Node(Trials.Delta(baseline, after)),
                ["waiting"] = loaded.StepStatus("trial") == Steps.WaitingForUser ? loaded.StepResult("trial")?.DeepClone() : null,
            },
            ["components"] = Node(cards),
            ["plan"] = loaded.StepResult("plan")?.DeepClone(),
            ["readiness"] = Node(readiness),
            ["build"] = build?.DeepClone(),
            ["deliver"] = Str(deliverStep, "status") == Steps.Completed ? deliver?.DeepClone() : null,
            ["events"] = new JsonArray(events.Select(e => (JsonNode?)e).ToArray()),
            ["codeMap"] = codeMap,
            ["cost"] = new JsonObject
            {
                ["totalCostUsd"] = runCalls.Sum(c => Num(c["costUsd"])) + liveUsd, ["liveUsd"] = liveUsd, ["calls"] = runCalls.Count,
                ["inputTokens"] = runCalls.Sum(c => Num(c["inputTokens"])), ["outputTokens"] = runCalls.Sum(c => Num(c["outputTokens"])),
                ["chat"] = chatCalls.Count > 0 ? new JsonObject { ["costUsd"] = chatCalls.Sum(c => Num(c["costUsd"])), ["calls"] = chatCalls.Count } : null,
                ["byStep"] = new JsonArray(byStep.Select(b => (JsonNode?)new JsonObject { ["stepKey"] = b.StepKey, ["costUsd"] = b.CostUsd, ["calls"] = b.Calls }).ToArray()),
                ["rows"] = new JsonArray(calls.Select(c => (JsonNode?)c).ToArray()),
            },
            ["recommended"] = Recommended(),
            ["coach"] = new JsonObject { ["openProposals"] = await store.OpenProposalsAsync(ctx) },
        };
    }

    // ── restart ─────────────────────────────────────────────────────

    /// <summary>
    /// After a restart: a step that was mid-flight is marked failed (its button runs it again — nothing spends money
    /// without a click); a scan of the draft that was running says it stopped; a draft session that was live is marked
    /// disconnected (reopened later from the same conversation). The live runs of every client are found as the owning
    /// role; each is written inside its own client's scope.
    /// </summary>
    public async Task<int> RecoverAsync(CancellationToken ct = default)
    {
        var live = await SqlJson.QueryAsync(db, """
            select id, repo_id as "repoId", client_id as "clientId", triggered_by as "triggeredBy", session from repository_onboarding_run where status = any(@s)
            """, new { s = Steps.LiveRunStatuses.ToArray() }, ct);
        var touched = 0;
        foreach (var run in live)
        {
            var ctx = new RunCtx(Guid.Parse(Str(run, "repoId")!), Guid.Parse(Str(run, "id")!), Guid.Parse(Str(run, "clientId")!), "", Guid.Parse(Str(run, "triggeredBy")!));
            try
            {
                var steps = await tenant.RunAsync(ctx.ClientId, d => SqlJson.QueryAsync(d,
                    """select step_key as "stepKey", status, result from repository_onboarding_step where run_id = @r order by step_order""", new { r = ctx.RunId }, ct), ct);
                foreach (var s in steps.Where(s => Str(s, "status") == Steps.Running))
                {
                    await FailStepAsync(ctx, Str(s, "stepKey")!, new InvalidOperationException("הצעד הופסק כשהשרת הופעל מחדש — הריצו אותו שוב"), null);
                    touched++;
                }
                var plan = steps.FirstOrDefault(s => Str(s, "stepKey") == "plan");
                if (Str(plan, "status") == Steps.WaitingForUser && Str(plan?["result"]?["initScan"], "state") == "running")
                {
                    await FailInitScanAsync(ctx, null, "הסריקה הופסקה כשהשרת הופעל מחדש — אפשר לסרוק שוב", "api_restart");
                    touched++;
                }
                if (await drafts.RecoverAsync(ctx.Draft, RunSessions.Of(run["session"]), ct)) touched++;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogError(e, "onboarding: run {RunId} could not be recovered after the restart", ctx.RunId);
            }
        }
        return touched;
    }
}
