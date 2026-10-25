using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>A refusal of the onboarding engine, in a sentence for the person (runs.ts OnboardingError) — always a 409.</summary>
public sealed class OnboardingRefused(string message) : AppException(409, "onboarding_refused", message);

/// <summary>A repository as onboarding needs it — one that belongs to a client.</summary>
public sealed record OnboardingRepo(Guid Id, string Name, Guid ClientId, string? LocalPath, string? AdoRepoRef);

/// <summary>Who and what a run is, handed to every step (runs.ts Ctx).</summary>
public sealed record RunCtx(Guid RepoId, Guid RunId, Guid ClientId, string RepoName, Guid TriggeredBy)
{
    public DraftCtx Draft => new(RepoId, RunId, ClientId, TriggeredBy);
}

/// <summary>The run's diagnosis: the profile (snake_case, read by dotted path) and the facts a person marked as wrong.</summary>
public sealed record RunProfile(Guid Id, JsonObject Profile, List<ProfileCorrection> Corrections);

/// <summary>
/// A run as it is now: the whole run row and the whole step rows, camelCase, exactly as the screen reads them — and a
/// few typed reads over them.
/// </summary>
public sealed class LoadedRun(OnboardingRepo repo, JsonObject run, List<JsonObject> steps, RunCtx ctx)
{
    public OnboardingRepo Repo => repo;
    public JsonObject Run => run;
    public List<JsonObject> StepRows => steps;
    public RunCtx Ctx => ctx;

    public string Status => OnboardingJson.Str(run, "status") ?? "";
    public string Kind => OnboardingJson.Str(run, "kind") ?? "onboarding";
    public string? WorkspacePath => OnboardingJson.Str(run, "workspacePath");
    public string? BaselineSha => OnboardingJson.Str(run, "baselineSha");
    public string? BranchName => OnboardingJson.Str(run, "branchName");
    public string? DefaultBranch => OnboardingJson.Str(run, "defaultBranch");
    public string Level => Automation.Normalize(run["automation"]);

    /// <summary>Completed or Cancelled — nothing more happens in it.</summary>
    public bool Over => Status is Steps.Completed or Steps.Cancelled;

    public JsonObject? Step(string key) => steps.FirstOrDefault(s => OnboardingJson.Str(s, "stepKey") == key);
    public string? StepStatus(string key) => OnboardingJson.Str(Step(key), "status");
    public JsonNode? StepResult(string key) => Step(key)?["result"];
}

/// <summary>
/// The one way to write to <c>repo_ai_event</c> (events.ts appendRepoAiEvent) — the repository-scoped sibling of the
/// requirement's event log, with the same discipline: nothing else inserts into it. A run's events carry its id in the
/// payload (<c>runId</c>), which is how the run's screen reads them back.
/// </summary>
public sealed class RepoAiEvents(ITenantScope tenant)
{
    public Task AppendAsync(Guid clientId, Guid repoId, string type, JsonObject payload, Guid? actor, CancellationToken ct = default) =>
        tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d, """
            insert into repo_ai_event (client_id, repo_id, type, payload, actor_user_id) values (@c, @r, @t, @p, @a)
            """, new { c = clientId, r = repoId, t = type, p = SqlJson.Jsonb(payload), a = actor }, ct), ct);
}

/// <summary>
/// The onboarding tables (runs.ts: loading and writing). Every one of them but <c>marketplace_source</c> is tenant-scoped
/// and touched only inside <see cref="ITenantScope"/>; the repository and the people are org-wide rows. Rows the screen
/// reads whole come back as the old server's ORM returned them (<see cref="TableColumns"/>).
/// </summary>
public sealed class OnboardingStore(DccDbContext db, ITenantScope tenant, RepoAiEvents events)
{
    // ── loading ─────────────────────────────────────────────────────

    /// <summary>The repository — only one a client owns can be onboarded. Unknown, or nobody's: a 409 in words, as before.</summary>
    public async Task<OnboardingRepo> RepoAsync(Guid repoId, CancellationToken ct = default)
    {
        var r = await SqlJson.QuerySingleAsync(db, """
            select id, name, client_id as "clientId", local_path as "localPath", ado_repo_ref as "adoRepoRef" from repo where id = @id
            """, new { id = repoId }, ct) ?? throw new OnboardingRefused("הריפו לא נמצא");
        if (OnboardingJson.Str(r, "clientId") is not { } clientId) throw new OnboardingRefused("הטמעה אפשרית רק לריפו ששייך ללקוח");
        return new OnboardingRepo(repoId, OnboardingJson.Str(r, "name")!, Guid.Parse(clientId), OnboardingJson.Str(r, "localPath"), OnboardingJson.Str(r, "adoRepoRef"));
    }

    public async Task<LoadedRun> RunAsync(Guid repoId, Guid runId, CancellationToken ct = default)
    {
        var repo = await RepoAsync(repoId, ct);
        var (run, steps) = await tenant.RunAsync(repo.ClientId, async d =>
        {
            var row = await SqlJson.QuerySingleAsync(d, $"select {await TableColumns.SelectAsync(d, "repository_onboarding_run", null, ct)} from repository_onboarding_run where id = @id and repo_id = @repo",
                new { id = runId, repo = repoId }, ct);
            var stepRows = row is null ? new List<JsonObject>() : await SqlJson.QueryAsync(d, $"select {await TableColumns.SelectAsync(d, "repository_onboarding_step", null, ct)} from repository_onboarding_step where run_id = @id order by step_order",
                new { id = runId }, ct);
            return (row, stepRows);
        }, ct);
        if (run is null) throw new OnboardingRefused("ההרצה לא נמצאה");
        return new LoadedRun(repo, run, steps, new RunCtx(repoId, runId, repo.ClientId, repo.Name, Guid.Parse(OnboardingJson.Str(run, "triggeredBy")!)));
    }

    public async Task<RunProfile?> ProfileAsync(RunCtx ctx, CancellationToken ct = default)
    {
        var row = await tenant.RunAsync(ctx.ClientId, d => SqlJson.QuerySingleAsync(d, "select id, profile, corrections from repo_profile where run_id = @r limit 1", new { r = ctx.RunId }, ct), ct);
        if (row is null) return null;
        return new RunProfile(Guid.Parse(OnboardingJson.Str(row, "id")!), row["profile"] as JsonObject ?? [], OnboardingJson.From<List<ProfileCorrection>>(row["corrections"]) ?? []);
    }

    public async Task<RunProfile> RequireProfileAsync(RunCtx ctx, CancellationToken ct = default) =>
        await ProfileAsync(ctx, ct) ?? throw new OnboardingRefused("אין פרופיל — האבחון עוד לא רץ");

    /// <summary>The processes as the screen reads them (runs.ts loadProcesses): key, title, source, evidence, steps, trialTaskKey, impossible.</summary>
    public Task<List<JsonObject>> ProcessRowsAsync(RunCtx ctx, CancellationToken ct = default) =>
        tenant.RunAsync(ctx.ClientId, d => SqlJson.QueryAsync(d, """
            select key, title, source, evidence, steps, trial_task_key as "trialTaskKey", impossible
            from onboarding_process where run_id = @r order by created_at, id
            """, new { r = ctx.RunId }, ct), ct);

    public async Task<List<DiscoveredProcess>> ProcessesAsync(RunCtx ctx, CancellationToken ct = default) =>
        (await ProcessRowsAsync(ctx, ct)).Select(r => OnboardingJson.From<DiscoveredProcess>(r)!).ToList();

    /// <summary>The trial outcomes — the latest of a task in a phase is the one that counts (a rerun replaces), in the order the tasks first ran.</summary>
    public async Task<List<TrialOutcome>> TrialsAsync(RunCtx ctx, string? phase = null, CancellationToken ct = default)
    {
        var rows = await tenant.RunAsync(ctx.ClientId, d => SqlJson.QueryAsync(d, """
            select phase, task_key as "taskKey", title, passed, failure_kind as "failureKind", detail, cost_usd::float as "costUsd", call_id as "callId", judged_by as "judgedBy"
            from onboarding_trial where run_id = @r and (@p::text is null or phase = @p) order by created_at, id
            """, new { r = ctx.RunId, p = phase }, ct), ct);
        var order = new List<string>();
        var latest = new Dictionary<string, TrialOutcome>();
        foreach (var r in rows)
        {
            var key = $"{OnboardingJson.Str(r, "phase")}:{OnboardingJson.Str(r, "taskKey")}";
            if (!latest.ContainsKey(key)) order.Add(key);
            latest[key] = new TrialOutcome(OnboardingJson.Str(r, "taskKey")!, OnboardingJson.Str(r, "title")!, OnboardingJson.Str(r, "phase")!,
                r["passed"] is JsonValue p ? p.GetValue<bool>() : null, OnboardingJson.Str(r, "failureKind"), OnboardingJson.Str(r, "detail") ?? "",
                OnboardingJson.Num(r["costUsd"]), OnboardingJson.Str(r, "callId"), OnboardingJson.Str(r, "judgedBy") ?? "");
        }
        return order.Select(k => latest[k]).ToList();
    }

    /// <summary>The component cards (runs.ts cardOf), in the order they were drawn.</summary>
    public async Task<List<Component>> CardsAsync(RunCtx ctx, CancellationToken ct = default)
    {
        var rows = await tenant.RunAsync(ctx.ClientId, d => SqlJson.QueryAsync(d, """
            select id, key, kind, family, title, why, what, source, source_ref as "sourceRef", "group", risk, context_tokens as "contextTokens",
                   verify_how as "verifyHow", status, params, files, validation, delta, questions, decided_by as "decidedBy", decided_at as "decidedAt", decline_reason as "declineReason"
            from onboarding_component where run_id = @r order by created_at, id
            """, new { r = ctx.RunId }, ct), ct);
        return rows.Select(CardOf).ToList();
    }

    private static Component CardOf(JsonObject r) => new()
    {
        Id = OnboardingJson.Str(r, "id"), Key = OnboardingJson.Str(r, "key")!, Kind = OnboardingJson.Str(r, "kind")!, Family = OnboardingJson.Str(r, "family")!,
        TitleHe = OnboardingJson.Str(r, "title")!, WhyHe = OnboardingJson.Str(r, "why")!, WhatHe = OnboardingJson.Str(r, "what")!, Source = OnboardingJson.Str(r, "source")!,
        SourceRef = OnboardingJson.Str(r, "sourceRef"), Group = OnboardingJson.Str(r, "group")!, Risk = OnboardingJson.Str(r, "risk")!,
        ContextTokens = r["contextTokens"] is JsonValue t ? t.GetValue<int>() : null, VerifyHowHe = OnboardingJson.Str(r, "verifyHow") ?? "",
        Status = OnboardingJson.Str(r, "status")!, Params = r["params"] is JsonObject p ? (JsonObject)p.DeepClone() : [],
        Files = OnboardingJson.From<List<string>>(r["files"]) ?? [], Validation = OnboardingJson.From<ComponentValidation>(r["validation"]),
        Delta = OnboardingJson.From<ComponentDelta>(r["delta"]), Questions = OnboardingJson.From<List<ClarifyingQuestion>>(r["questions"]) ?? [],
        DecidedBy = OnboardingJson.Str(r, "decidedBy"), DecidedAt = OnboardingJson.Str(r, "decidedAt"), DeclineReason = OnboardingJson.Str(r, "declineReason"),
    };

    /// <summary>The run's events (payload.runId), oldest first — whole rows, as the screen labels them by type and payload.</summary>
    public Task<List<JsonObject>> EventsAsync(RunCtx ctx, CancellationToken ct = default) =>
        tenant.RunAsync(ctx.ClientId, async d => await SqlJson.QueryAsync(d,
            $"select {await TableColumns.SelectAsync(d, "repo_ai_event", null, ct)} from repo_ai_event where repo_id = @repo and payload->>'runId' = @run order by occurred_at, id",
            new { repo = ctx.RepoId, run = ctx.RunId.ToString() }, ct), ct);

    /// <summary>The name and address a commit is made under (ai-assist.ts resolveCommitIdentity).</summary>
    public async Task<(string Name, string Email)> IdentityAsync(Guid userId, CancellationToken ct = default)
    {
        var u = await SqlJson.QuerySingleAsync(db, """select display_name as "name", email from users where id = @id""", new { id = userId }, ct);
        return u is null ? ("DCC", "dcc@local") : (OnboardingJson.Str(u, "name")!, OnboardingJson.Str(u, "email")!);
    }

    /// <summary>A guest never runs anything on the server's machine, whatever role they hold.</summary>
    public async Task<bool> IsGuestAsync(Guid userId, CancellationToken ct = default) =>
        await SqlJson.ScalarAsync<string>(db, "select kind from users where id = @id", new { id = userId }, ct) == "guest";

    // ── writing ─────────────────────────────────────────────────────

    /// <summary>One event of the run: its id first in the payload, always.</summary>
    public Task EventAsync(RunCtx ctx, string type, JsonObject payload, Guid? actor)
    {
        var full = new JsonObject { ["runId"] = ctx.RunId.ToString() };
        foreach (var (k, v) in payload) full[k] = v?.DeepClone();
        return events.AppendAsync(ctx.ClientId, ctx.RepoId, type, full, actor);
    }

    /// <summary>Sets columns of the run row (column name → value; a <see cref="SqlJson.JsonbValue"/> for jsonb).</summary>
    public Task PatchRunAsync(RunCtx ctx, Dictionary<string, object?> set)
    {
        var sql = $"update repository_onboarding_run set {Assignments(set, out var args)} where id = @id";
        args["id"] = ctx.RunId;
        return tenant.RunAsync(ctx.ClientId, d => SqlJson.ExecuteAsync(d, sql, args));
    }

    /// <summary>Sets columns of one step row; <c>updated_at</c> moves with every change.</summary>
    public Task PatchStepAsync(RunCtx ctx, string key, Dictionary<string, object?> set)
    {
        var sql = $"update repository_onboarding_step set {Assignments(set, out var args)}, updated_at = now() where run_id = @run and step_key = @key";
        args["run"] = ctx.RunId;
        args["key"] = key;
        return tenant.RunAsync(ctx.ClientId, d => SqlJson.ExecuteAsync(d, sql, args));
    }

    /// <summary>
    /// Keys of the plan step's result set in one statement, the rest left as they are — so a scan and a replan never
    /// write back each other's stale copy (a jsonb merge, never a read-modify-write).
    /// </summary>
    public Task MergePlanResultAsync(RunCtx ctx, JsonObject patch) =>
        tenant.RunAsync(ctx.ClientId, d => SqlJson.ExecuteAsync(d, """
            update repository_onboarding_step set result = coalesce(result, '{}'::jsonb) || @p, updated_at = now() where run_id = @run and step_key = 'plan'
            """, new { p = SqlJson.Jsonb(patch), run = ctx.RunId }));

    public Task UpdateCardAsync(RunCtx ctx, string cardId, Dictionary<string, object?> set)
    {
        var sql = $"update onboarding_component set {Assignments(set, out var args)}, updated_at = now() where id = @id";
        args["id"] = Guid.Parse(cardId);
        return tenant.RunAsync(ctx.ClientId, d => SqlJson.ExecuteAsync(d, sql, args));
    }

    /// <summary>
    /// The run's cards become exactly <paramref name="cards"/>: a card no longer drawn is deleted; a card a person has
    /// already decided keeps its decision (status, who, when, why, the answers to its questions) whatever the new draw
    /// says (runs.ts upsertCards with keepDecisions). A new card is stamped with the clock, so the order it was drawn in
    /// is the order it is read back in.
    /// </summary>
    public async Task UpsertCardsAsync(RunCtx ctx, IReadOnlyList<Component> cards)
    {
        var existing = await CardsAsync(ctx);
        await tenant.RunAsync(ctx.ClientId, async d =>
        {
            await SqlJson.ExecuteAsync(d, "delete from onboarding_component where run_id = @r and key <> all(@keys)", new { r = ctx.RunId, keys = cards.Select(c => c.Key).ToArray() });
            foreach (var c in cards)
            {
                var prev = existing.FirstOrDefault(e => e.Key == c.Key);
                var decided = prev is not null && prev.Status != ComponentStatuses.Proposed && prev.DecidedBy is not null;
                var values = new Dictionary<string, object?>
                {
                    ["kind"] = c.Kind, ["family"] = c.Family, ["title"] = c.TitleHe, ["why"] = c.WhyHe, ["what"] = c.WhatHe, ["source"] = c.Source,
                    ["source_ref"] = c.SourceRef, ["\"group\""] = c.Group, ["risk"] = c.Risk, ["context_tokens"] = c.ContextTokens, ["verify_how"] = c.VerifyHowHe,
                    ["status"] = decided ? prev!.Status : c.Status, ["params"] = SqlJson.Jsonb(c.Params), ["files"] = SqlJson.Jsonb(c.Files),
                    ["validation"] = c.Validation is null ? null : SqlJson.Jsonb(c.Validation), ["delta"] = c.Delta is null ? null : SqlJson.Jsonb(c.Delta),
                    ["questions"] = SqlJson.Jsonb(decided ? prev!.Questions : c.Questions),
                    ["decided_by"] = Uuid(decided ? prev!.DecidedBy : c.DecidedBy), ["decided_at"] = Time(decided ? prev!.DecidedAt : c.DecidedAt),
                    ["decline_reason"] = decided ? prev!.DeclineReason : c.DeclineReason,
                };
                if (prev is not null)
                {
                    var sql = $"update onboarding_component set {Assignments(values, out var args)}, updated_at = now() where id = @id";
                    args["id"] = Guid.Parse(prev.Id!);
                    await SqlJson.ExecuteAsync(d, sql, args);
                    continue;
                }
                var cols = new List<string> { "run_id", "client_id", "key" };
                var vals = new List<string> { "@run", "@client", "@key" };
                var insert = new Dictionary<string, object?> { ["run"] = ctx.RunId, ["client"] = ctx.ClientId, ["key"] = c.Key };
                var i = 0;
                foreach (var (col, v) in values)
                {
                    cols.Add(col);
                    vals.Add($"@v{i}");
                    insert[$"v{i++}"] = v;
                }
                await SqlJson.ExecuteAsync(d, $"insert into onboarding_component ({string.Join(", ", cols)}, created_at, updated_at) values ({string.Join(", ", vals)}, clock_timestamp(), now())", insert);
            }
            return 0;
        });
    }

    /// <summary>The processes of a run, replacing what was there (a rerun of the step maps them again).</summary>
    public Task ReplaceProcessesAsync(RunCtx ctx, IReadOnlyList<DiscoveredProcess> processes, bool deleteFirst) =>
        tenant.RunAsync(ctx.ClientId, async d =>
        {
            if (deleteFirst) await SqlJson.ExecuteAsync(d, "delete from onboarding_process where run_id = @r", new { r = ctx.RunId });
            foreach (var p in processes)
                await SqlJson.ExecuteAsync(d, """
                    insert into onboarding_process (run_id, client_id, key, title, source, evidence, steps, trial_task_key, impossible, created_at)
                    values (@r, @c, @k, @t, @s, @e, @st, @tk, @im, clock_timestamp())
                    """, new { r = ctx.RunId, c = ctx.ClientId, k = p.Key, t = p.Title, s = p.Source, e = SqlJson.Jsonb(p.Evidence), st = SqlJson.Jsonb(p.Steps), tk = p.TrialTaskKey, im = p.Impossible });
            return 0;
        });

    /// <summary>
    /// The diagnosis written: a rerun of the step replaces the profile of the run (the corrections a person made stay —
    /// they are about facts, not about one reading of them); the first one inserts it with none. Its id.
    /// </summary>
    public async Task<Guid> SaveProfileAsync(RunCtx ctx, Guid? id, JsonObject profile, string? baselineSha)
    {
        if (id is { } existing)
        {
            await tenant.RunAsync(ctx.ClientId, d => SqlJson.ExecuteAsync(d, "update repo_profile set profile = @p, baseline_sha = @b where id = @id",
                new { id = existing, p = SqlJson.Jsonb(profile), b = baselineSha }));
            return existing;
        }
        return await tenant.RunAsync(ctx.ClientId, d => SqlJson.ScalarAsync<Guid>(d, """
            insert into repo_profile (repo_id, client_id, run_id, baseline_sha, profile, corrections) values (@repo, @c, @run, @b, @p, '[]'::jsonb) returning id
            """, new { repo = ctx.RepoId, c = ctx.ClientId, run = ctx.RunId, b = baselineSha, p = SqlJson.Jsonb(profile) }));
    }

    public Task SetCorrectionsAsync(RunCtx ctx, Guid profileId, IReadOnlyList<ProfileCorrection> corrections) =>
        tenant.RunAsync(ctx.ClientId, d => SqlJson.ExecuteAsync(d, "update repo_profile set corrections = @c where id = @id",
            new { id = profileId, c = SqlJson.Jsonb(corrections) }));

    /// <summary>The coach's proposals still waiting on the repository — the dossier opens the coach's panel when there are any.</summary>
    public Task<int> OpenProposalsAsync(RunCtx ctx) =>
        tenant.RunAsync(ctx.ClientId, d => SqlJson.ScalarAsync<int>(d,
            "select count(*)::int from repo_coach_proposal where repo_id = @r and status = 'proposed'", new { r = ctx.RepoId }));

    /// <summary>The repository's runs, newest first — the dossier's history.</summary>
    public Task<List<JsonObject>> RunsOfAsync(OnboardingRepo repo) =>
        tenant.RunAsync(repo.ClientId, d => SqlJson.QueryAsync(d, """
            select id, kind, status, current_step_key as "currentStepKey", started_at as "startedAt", completed_at as "completedAt", branch_name as "branchName"
            from repository_onboarding_run where repo_id = @r order by started_at desc, created_at desc, id
            """, new { r = repo.Id }));

    public Task InsertTrialAsync(RunCtx ctx, TrialOutcome o, string prompt, string answer) =>
        tenant.RunAsync(ctx.ClientId, d => SqlJson.ExecuteAsync(d, """
            insert into onboarding_trial (run_id, client_id, phase, task_key, title, prompt, passed, failure_kind, detail, answer, judged_by, cost_usd, call_id, created_at)
            values (@r, @c, @ph, @k, @t, @pr, @pa, @fk, @de, @an, @jb, @cost, @call, clock_timestamp())
            """, new
        {
            r = ctx.RunId, c = ctx.ClientId, ph = o.Phase, k = o.TaskKey, t = o.TitleHe, pr = prompt, pa = o.Passed, fk = o.FailureKind, de = o.Detail,
            an = OnboardingJson.Slice(answer, 20_000), jb = o.JudgedBy, cost = (decimal)o.CostUsd, call = o.CallId is { } id ? Guid.Parse(id) : (Guid?)null,
        }));

    // ── SQL plumbing ────────────────────────────────────────────────

    private static string Assignments(Dictionary<string, object?> set, out Dictionary<string, object?> args)
    {
        args = [];
        var parts = new List<string>();
        var i = 0;
        foreach (var (col, v) in set)
        {
            parts.Add($"{col} = @s{i}");
            args[$"s{i++}"] = v;
        }
        return string.Join(", ", parts);
    }

    private static Guid? Uuid(string? s) => s is { Length: > 0 } && Guid.TryParse(s, out var g) ? g : null;

    private static DateTimeOffset? Time(string? iso) =>
        iso is { Length: > 0 } && DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var t) ? t : null;
}

/// <summary>JSON the way the old server read and wrote it, for the run engine.</summary>
internal static class OnboardingJson
{
    /// <summary>Records the screen reads are written with their own names (JsonPropertyName); anything else camelCase, as the API writes it.</summary>
    public static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public static string? Str(JsonNode? o, string key) => ComponentVerifier.AsString((o as JsonObject)?[key]);

    public static double Num(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? d : 0;

    public static JsonNode? Node<T>(T value) => JsonSerializer.SerializeToNode(value, Web);

    public static T? From<T>(JsonNode? n) => n is null ? default : n.Deserialize<T>(Web);

    public static JsonArray Arr(IEnumerable<string> items) => new(items.Select(i => (JsonNode?)i).ToArray());

    /// <summary>JavaScript's <c>s.slice(0, n)</c>.</summary>
    public static string Slice(string s, int n) => s.Length <= n ? s : s[..n];

    public static string Iso(DateTimeOffset t) => t.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary>JavaScript's <c>Math.round</c>: halves toward +∞.</summary>
    public static double Round(double x) => Math.Floor(x + 0.5);

    /// <summary><c>n.toLocaleString("en-US")</c> for a whole number.</summary>
    public static string Grouped(long n) => n.ToString("N0", CultureInfo.InvariantCulture);

    /// <summary>The message of a failure, as <c>(e as Error).message</c> read it.</summary>
    public static string Message(Exception e) => e.Message;
}
