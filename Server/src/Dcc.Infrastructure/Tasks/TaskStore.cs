using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Domain.Tasks;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Repos;

namespace Dcc.Infrastructure.Tasks;

/// <summary>One row of <c>task</c>, typed — what the task logic decides by. The API answers with the whole row as JSON.</summary>
public sealed record TaskRow
{
    public required Guid Id { get; init; }
    public required Guid ClientId { get; init; }
    public required Guid WorkitemId { get; init; }
    public required int Seq { get; init; }
    public required string Kind { get; init; }
    public required string Intent { get; init; }
    public required string Appetite { get; init; }
    public required string State { get; init; }
    public string? CheckResult { get; init; }
    public string? CheckKind { get; init; }
    public string? CheckCause { get; init; }
    public Guid? CheckResolvedBy { get; init; }
    public string Origin { get; init; } = "human";
    public string? ApprovedAt { get; init; }
    public Guid? ApprovedBy { get; init; }
    public string? Prompt { get; init; }
    public IReadOnlyList<string> AffectedPaths { get; init; } = [];
    public IReadOnlyList<string> CompiledComponents { get; init; } = [];
    public bool Active { get; init; } = true;
    public bool WasDone { get; init; }
    public bool DevelopedManually { get; init; }
    public string? Branch { get; init; }
    public Guid? BaseTaskId { get; init; }
    public string? BaseBranch { get; init; }
    public string? BaseSha { get; init; }
    public IReadOnlyList<Guid> BuiltWithout { get; init; } = [];
    public Guid? ParentTaskId { get; init; }
    public string? AdoType { get; init; }
    public int? LinkedAdoId { get; init; }
    public string? AdoUrl { get; init; }
    public string? AdoSyncedAt { get; init; }

    public bool Approved => ApprovedAt is not null;
    public bool InPlay => Active && State != "dropped";

    public static TaskRow From(JsonObject o)
    {
        static string? S(JsonObject o, string k) => o[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
        static Guid? G(JsonObject o, string k) => S(o, k) is { } s ? Guid.Parse(s) : null;
        static List<string> L(JsonObject o, string k) => (o[k] as JsonArray)?.Select(x => x?.ToString() ?? "").Where(x => x.Length > 0).ToList() ?? [];
        return new TaskRow
        {
            Id = G(o, "id")!.Value, ClientId = G(o, "clientId")!.Value, WorkitemId = G(o, "workitemId")!.Value,
            Seq = o["seq"]!.GetValue<int>(), Kind = S(o, "kind") ?? "task", Intent = S(o, "intent") ?? "", Appetite = S(o, "appetite") ?? "standard",
            State = S(o, "state") ?? "pending", CheckResult = S(o, "checkResult"), CheckKind = S(o, "checkKind"), CheckCause = S(o, "checkCause"),
            CheckResolvedBy = G(o, "checkResolvedBy"), Origin = S(o, "origin") ?? "human", ApprovedAt = S(o, "approvedAt"), ApprovedBy = G(o, "approvedBy"),
            Prompt = S(o, "prompt"), AffectedPaths = L(o, "affectedPaths"), CompiledComponents = L(o, "compiledComponents"),
            Active = o["active"]?.GetValue<bool>() ?? true, WasDone = o["wasDone"]?.GetValue<bool>() ?? false,
            DevelopedManually = o["developedManually"]?.GetValue<bool>() ?? false, Branch = S(o, "branch"),
            BaseTaskId = G(o, "baseTaskId"), BaseBranch = S(o, "baseBranch"), BaseSha = S(o, "baseSha"),
            BuiltWithout = L(o, "builtWithout").Select(Guid.Parse).ToList(), ParentTaskId = G(o, "parentTaskId"),
            AdoType = S(o, "adoType"), LinkedAdoId = o["linkedAdoId"]?.GetValue<int>(), AdoUrl = S(o, "adoUrl"), AdoSyncedAt = S(o, "adoSyncedAt"),
        };
    }

    public RelRow Rel() => new(Id.ToString(), Seq, Kind, ParentTaskId?.ToString(), Active, State);
}

/// <summary>The relations of one requirement's rows (task-relations.ts), with the rows themselves.</summary>
public sealed record Relations(List<TaskRow> Rows, Dictionary<Guid, TaskRow> ById, TaskRelations Rel)
{
    public bool IsGroup(Guid id) => Rel.IsGroup(id.ToString());
    public List<TaskRow> SubtasksOf(Guid id) => Rel.SubtasksOf(id.ToString()).Select(r => ById[Guid.Parse(r.Id)]).ToList();
    public List<(TaskRow Row, DepVia? Via)> EffectiveDeps(Guid id) => Rel.EffectiveDeps(id.ToString()).Select(d => (ById[Guid.Parse(d.Id)], d.Via)).ToList();
    public List<TaskRow> WaitingOn(Guid id) => Rel.WaitingOn(id.ToString()).Select(x => ById[Guid.Parse(x)]).ToList();
}

/// <summary>
/// Reads of tasks shared by every task service, always inside the tenant's scope — and the timeline note
/// that almost every task action leaves.
/// </summary>
public sealed class TaskStore(DccDbContext db, ITenantScope tenant, IEventLogWriter events, RepoCheckouts checkouts)
{
    private string? _cols;

    private async Task<string> ColsAsync(CancellationToken ct) => _cols ??= await TableColumns.SelectAsync(db, "task", null, ct);

    /// <summary>Which client and requirement own a task — read as the owner, ids only, before any tenant-scoped read.</summary>
    public async Task<(Guid ClientId, Guid WorkitemId)?> LocateAsync(Guid taskId, CancellationToken ct)
    {
        var row = await SqlJson.QuerySingleAsync(db, """select client_id as "c", workitem_id as "w" from task where id = @id""", new { id = taskId }, ct);
        return row is null ? null : (Guid.Parse(row["c"]!.GetValue<string>()), Guid.Parse(row["w"]!.GetValue<string>()));
    }

    public async Task<JsonObject?> RowJsonAsync(Guid clientId, Guid taskId, CancellationToken ct)
    {
        var cols = await ColsAsync(ct);
        return await tenant.RunAsync(clientId, d => SqlJson.QuerySingleAsync(d, $"select {cols} from task where id = @id", new { id = taskId }, ct), ct);
    }

    public async Task<TaskRow?> GetAsync(Guid clientId, Guid taskId, CancellationToken ct) =>
        await RowJsonAsync(clientId, taskId, ct) is { } o ? TaskRow.From(o) : null;

    public async Task<TaskRow> RequireAsync(Guid clientId, Guid taskId, CancellationToken ct) =>
        await GetAsync(clientId, taskId, ct) ?? throw new AppException(404, "not_found", "משימה לא נמצאה");

    public async Task<List<TaskRow>> WhereAsync(Guid clientId, string where, object args, CancellationToken ct, string order = "seq")
    {
        var cols = await ColsAsync(ct);
        var rows = await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, $"select {cols} from task where {where} order by {order}", args, ct), ct);
        return rows.Select(TaskRow.From).ToList();
    }

    public Task<List<TaskRow>> OfRequirementAsync(Guid clientId, Guid workitemId, CancellationToken ct) =>
        WhereAsync(clientId, "workitem_id = @w", new { w = workitemId }, ct);

    /// <summary>A task's own checks that are in play, in order.</summary>
    public Task<List<TaskRow>> ChecksOfAsync(Guid clientId, Guid taskId, CancellationToken ct) =>
        WhereAsync(clientId, "parent_task_id = @t and kind = 'check' and active and state <> 'dropped'", new { t = taskId }, ct);

    public async Task<Relations> RelationsAsync(Guid clientId, Guid workitemId, CancellationToken ct)
    {
        var rows = await OfRequirementAsync(clientId, workitemId, ct);
        var ids = rows.Select(r => r.Id).ToArray();
        var deps = ids.Length == 0 ? [] : await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select task_id as "t", depends_on_task_id as "d" from task_dependency where task_id = any(@ids)
            """, new { ids }, ct), ct);
        var rel = new TaskRelations(rows.Select(r => r.Rel()).ToList(), deps.Select(x => new RelDep(x["t"]!.GetValue<string>(), x["d"]!.GetValue<string>())).ToList());
        return new Relations(rows, rows.ToDictionary(r => r.Id), rel);
    }

    public Task<string?> RequirementKeyAsync(Guid clientId, Guid workitemId, CancellationToken ct) =>
        tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<string>(d, "select key from workitem where id = @w", new { w = workitemId }, ct), ct);

    /// <summary>The requirement's repository — the one linked to it, else the client's first.</summary>
    public Task<RepoRef?> FirstRepoAsync(Guid clientId, Guid workitemId, CancellationToken ct) =>
        tenant.RunAsync(clientId, async d =>
        {
            var row = await SqlJson.QuerySingleAsync(d, """
                select r.id, r.name, r.local_path as "localPath", r.ado_repo_ref as "adoRepoRef"
                from workitem_repo wr join repo r on r.id = wr.repo_id where wr.workitem_id = @w limit 1
                """, new { w = workitemId }, ct)
                ?? await SqlJson.QuerySingleAsync(d, """
                select r.id, r.name, r.local_path as "localPath", r.ado_repo_ref as "adoRepoRef"
                from client_repo cr join repo r on r.id = cr.repo_id where cr.client_id = @c limit 1
                """, new { c = clientId }, ct);
            return row is null ? null : new RepoRef(Guid.Parse(row["id"]!.GetValue<string>()), row["name"]!.GetValue<string>(),
                row["localPath"]?.GetValue<string>(), row["adoRepoRef"]?.GetValue<string>());
        }, ct);

    /// <summary>DCC's own copy of the requirement's repository if it is there — never the user's folder, never cloned here.</summary>
    public async Task<string?> ExistingCloneAsync(Guid clientId, Guid workitemId, CancellationToken ct) =>
        await FirstRepoAsync(clientId, workitemId, ct) is { } r ? checkouts.Existing(r with { LocalPath = null }) : null;

    public string BranchOf(string? reqKey, TaskRow t) => TaskBranches.BranchOf(reqKey, t.Seq, t.Intent, t.Branch);

    /// <summary>A note on the requirement's timeline, linked to the task.</summary>
    public Task NoteAsync(Guid clientId, Guid workitemId, Guid taskId, EventActor actor, string body, CancellationToken ct, string source = "manual") =>
        events.AppendAsync(new NewEvent
        {
            ClientId = clientId, WorkitemId = workitemId, Source = source, Type = "note.added", Actor = actor,
            Links = [new EventLink("task", taskId.ToString())], Payload = JsonSerializer.SerializeToElement(new { body }),
        }, ct);

    /// <summary>
    /// Re-evaluates a task's stored state from its active checks after anything that changed them — a check's
    /// toggle, or a check finishing (its write touches only its own row). The rule: <see cref="TaskStatuses.StoredStateAfterChecks"/>.
    /// </summary>
    public Task SyncStateAfterChecksAsync(Guid clientId, Guid parentTaskId, CancellationToken ct) =>
        tenant.RunAsync(clientId, async d =>
        {
            var parent = await SqlJson.QuerySingleAsync(d, """select kind, state::text as "state", was_done as "wasDone" from task where id = @id""", new { id = parentTaskId }, ct);
            if (parent is null || parent["kind"]!.GetValue<string>() == "check") return 0;
            var failed = await SqlJson.ScalarAsync<int>(d, """
                select count(*)::int from task where parent_task_id = @id and kind = 'check' and active and state <> 'dropped' and check_result = 'failed'
                """, new { id = parentTaskId }, ct);
            if (TaskStatuses.StoredStateAfterChecks(parent["state"]!.GetValue<string>(), parent["wasDone"]!.GetValue<bool>(), failed) is not { } next) return 0;
            return await SqlJson.ExecuteAsync(d, "update task set state = @s::task_state, was_done = @w, updated_at = now() where id = @id",
                new { id = parentTaskId, s = next.State, w = next.WasDone }, ct);
        }, ct);

    /// <summary>A real name and email for a commit made in a person's name (identity is always a person) — never throws.</summary>
    public async Task<(string Name, string Email)> CommitIdentityAsync(Guid userId, CancellationToken ct)
    {
        var u = await SqlJson.QuerySingleAsync(db, """select display_name as "name", email from users where id = @id""", new { id = userId }, ct);
        return u is null ? ("DCC", "dcc@local") : (u["name"]!.GetValue<string>(), u["email"]!.GetValue<string>());
    }

    public Task<int> ExecAsync(Guid clientId, string sql, object args, CancellationToken ct) =>
        tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d, sql, args, ct), ct);

    /// <summary>The task's development runs (kind implement), newest first unless said otherwise. flow_run carries no RLS; ids are checked by the caller.</summary>
    public Task<List<JsonObject>> ImplementRunsAsync(string where, object args, CancellationToken ct, string order = "started_at desc") =>
        SqlJson.QueryAsync(db, $"""
            select id, task_id as "taskId", state, result, error, log, started_at as "startedAt", finished_at as "finishedAt"
            from flow_run where kind = 'implement' and {where} order by {order}
            """, args, ct);
}
