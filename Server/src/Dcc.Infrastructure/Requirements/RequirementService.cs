using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Clients;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Requirements;

/// <summary>
/// Requirements (WorkItems): create, read, edit, delete, assign, link repositories
/// and dependencies, the flow of a requirement's subtree, and the lists. Same
/// routes and JSON as the old server (crud.ts, flow.ts, dashboard.ts, server.ts).
/// Every change is an event on the timeline and refreshes the Context Brief.
/// </summary>
public sealed class RequirementService(DccDbContext db, ITenantScope tenant, IEventLogWriter events, BriefService brief, ClientService clients)
{
    public static readonly string[] Types = ["epic", "feature", "story", "bug", "task", "spike"];
    public static readonly string[] RequirementTypes = ["development", "research", "testing"];
    public static readonly string[] Priorities = ["low", "medium", "high", "critical"];
    public static readonly string[] Risks = ["low", "medium", "high"];
    public static readonly string[] Executors = ["human", "ai", "mixed"];
    public static readonly string[] Phases = ["intake", "shaping", "building", "review", "done", "archived"];

    /// <summary>Where a requirement lives: its client (read as the owner, outside any tenant — ids only).</summary>
    public async Task<(Guid Id, Guid ClientId, JsonObject Row)> LocateAsync(Guid id, CancellationToken ct)
    {
        var row = await SqlJson.QuerySingleAsync(db, """
            select id, key, client_id as "clientId", parent_id as "parentId", title from workitem where id = @id
            """, new { id }, ct) ?? throw AppException.NotFound("workitem");
        return (id, Guid.Parse(row["clientId"]!.GetValue<string>()), row);
    }

    public async Task<Guid?> ClientOfAsync(Guid id, CancellationToken ct) =>
        await SqlJson.ScalarAsync<Guid?>(db, "select client_id from workitem where id = @id", new { id }, ct);

    // ── create / read ────────────────────────────────────────────────

    public sealed record CreateRequest(Guid ClientId, Guid? ParentId, Guid? OwnerId, string? Key, string Title, string? Type, string? RequirementType,
        string? Priority, string? Risk, string? Executor, int? DueInDays, decimal? BudgetUsd, int? LinkedAdoId, string? AdoAreaPath);

    public async Task<JsonObject> CreateAsync(CreateRequest r, Guid actor, CancellationToken ct)
    {
        Check("type", r.Type, Types); Check("requirementType", r.RequirementType, RequirementTypes); Check("priority", r.Priority, Priorities);
        Check("risk", r.Risk, Risks); Check("executor", r.Executor, Executors);
        if (string.IsNullOrWhiteSpace(r.Title)) throw AppException.BadRequest("bad_request", "\"title\" is required.");
        var cols = await TableColumns.SelectAsync(db, "workitem", null, ct);
        // a requirement stays in DCC — nothing is pushed to TFS at intake
        return await tenant.RunAsync(r.ClientId, d => SqlJson.QuerySingleAsync(d, $"""
            insert into workitem (client_id, parent_id, owner_id, key, title, type, requirement_type, priority, risk, executor,
                                  budget_usd, due_date, linked_ado_id, ado_area_path)
            values (@c, @parent, @owner, @key, @title, @type::workitem_type, @rtype::requirement_type, @priority::priority, @risk::risk_level,
                    @executor::executor, @budget, case when @due::int is null then null else now() + make_interval(days => @due::int) end,
                    @ado, @area)
            returning {cols}
            """, new
        {
            c = r.ClientId, parent = r.ParentId, owner = r.OwnerId ?? actor, key = r.Key, title = r.Title, type = r.Type ?? "story",
            rtype = r.RequirementType ?? "development", priority = r.Priority ?? "medium", risk = r.Risk ?? "low", executor = r.Executor ?? "human",
            budget = r.BudgetUsd, due = r.DueInDays, ado = r.LinkedAdoId, area = r.AdoAreaPath,
        }, ct), ct) ?? throw new InvalidOperationException("insert returned nothing");
    }

    /// <summary>The requirement's page: the row, its files, repositories, gaps, blockers, tasks and the timeline.</summary>
    public async Task<JsonObject> DetailAsync(Guid id, CancellationToken ct)
    {
        var (_, clientId, _) = await LocateAsync(id, ct);
        var wiCols = await TableColumns.SelectAsync(db, "workitem", null, ct);
        var gapCols = await TableColumns.SelectAsync(db, "gap", null, ct);
        var blockerCols = await TableColumns.SelectAsync(db, "blocker", null, ct);
        var taskCols = await TableColumns.SelectAsync(db, "task", null, ct);
        var depCols = await TableColumns.SelectAsync(db, "task_dependency", null, ct);
        return await tenant.RunAsync(clientId, async d =>
        {
            var args = new { id };
            var wi = await SqlJson.QuerySingleAsync(d, $"select {wiCols} from workitem where id = @id", args, ct) ?? throw AppException.NotFound("workitem");
            return new JsonObject
            {
                ["workitem"] = wi,
                ["attachments"] = Arr(await AttachmentsAsync(d, id, ct)),
                ["repos"] = Arr(await ReposAsync(d, id, ct)),
                ["gaps"] = Arr(await SqlJson.QueryAsync(d, $"select {gapCols} from gap where workitem_id = @id order by blocking desc, created_at", args, ct)),
                ["blockers"] = Arr(await SqlJson.QueryAsync(d, $"select {blockerCols} from blocker where workitem_id = @id order by created_at desc", args, ct)),
                ["tasks"] = Arr(await SqlJson.QueryAsync(d, $"select {taskCols} from task where workitem_id = @id order by seq", args, ct)),
                ["taskDependencies"] = Arr(await SqlJson.QueryAsync(d, $"select {depCols} from task_dependency where task_id in (select id from task where workitem_id = @id)", args, ct)),
                ["events"] = Arr(await TimelineRowsAsync(d, id, ct)),
            };
        }, ct);
    }

    public async Task<JsonObject> TimelineAsync(Guid id, CancellationToken ct)
    {
        var (_, clientId, row) = await LocateAsync(id, ct);
        var rows = await tenant.RunAsync(clientId, d => TimelineRowsAsync(d, id, ct), ct);
        return new JsonObject { ["workitem"] = row, ["events"] = Arr(rows) };
    }

    /// <summary>Events with no WorkItem yet — the client's unassigned inbox.</summary>
    public async Task<List<JsonObject>> InboxAsync(Guid clientId, CancellationToken ct)
    {
        var cols = await TableColumns.SelectAsync(db, "event_log", null, ct);
        return await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, $"select {cols} from event_log where workitem_id is null order by recorded_at desc limit 100", null, ct), ct);
    }

    private async Task<List<JsonObject>> TimelineRowsAsync(DccDbContext d, Guid id, CancellationToken ct)
    {
        var cols = await TableColumns.SelectAsync(db, "event_log", null, ct);
        return await SqlJson.QueryAsync(d, $"select {cols} from event_log where workitem_id = @id order by occurred_at desc limit 200", new { id }, ct);
    }

    public static Task<List<JsonObject>> AttachmentsAsync(DccDbContext d, Guid workitemId, CancellationToken ct) =>
        SqlJson.QueryAsync(d, """
            select id, name, ado_url as "adoUrl", size_bytes as "sizeBytes", source, created_at as "createdAt",
                   content is not null as "stored", coalesce(length(extracted_text), 0)::int as "textChars", extract_error as "extractError"
            from attachment where workitem_id = @w order by created_at
            """, new { w = workitemId }, ct);

    private static Task<List<JsonObject>> ReposAsync(DccDbContext d, Guid workitemId, CancellationToken ct) =>
        SqlJson.QueryAsync(d, """
            select r.id, r.name, r.ado_repo_ref as "adoRepoRef", wr.link_kind as "linkKind", wr.added_at as "addedAt"
            from workitem_repo wr join repo r on r.id = wr.repo_id
            where wr.workitem_id = @w order by r.name
            """, new { w = workitemId }, ct);

    // ── edit / delete ────────────────────────────────────────────────

    private static readonly (string Field, string Column, string Cast)[] Fields =
    [
        ("title", "title", ""), ("type", "type", "::workitem_type"), ("requirementType", "requirement_type", "::requirement_type"),
        ("priority", "priority", "::priority"), ("risk", "risk", "::risk_level"), ("executor", "executor", "::executor"),
        ("budgetUsd", "budget_usd", "::numeric"), ("dueDate", "due_date", "::timestamptz"), ("parentId", "parent_id", "::uuid"),
        ("adoAreaPath", "ado_area_path", ""), ("phase", "phase", "::workitem_phase"), ("key", "key", ""),
    ];

    /// <summary>
    /// Edits the fields that are present, records which changed, and — when the edit
    /// reopens a done or archived requirement and a reason is given — records the decision.
    /// </summary>
    public async Task<JsonObject> UpdateAsync(Guid id, JsonElement patch, Guid actor, CancellationToken ct)
    {
        var (_, clientId, _) = await LocateAsync(id, ct);
        ValidatePatch(patch);
        var cols = await TableColumns.SelectAsync(db, "workitem", null, ct);
        var reopenReason = patch.TryGetProperty("reopenReason", out var rr) && rr.ValueKind == JsonValueKind.String ? rr.GetString() : null;

        var after = await tenant.RunAsync(clientId, async d =>
        {
            var before = await SqlJson.QuerySingleAsync(d, $"select {cols} from workitem where id = @id", new { id }, ct) ?? throw AppException.NotFound("requirement");
            if (patch.TryGetProperty("parentId", out var pid) && pid.ValueKind == JsonValueKind.String && pid.GetString() == id.ToString())
                throw AppException.BadRequest("bad_parent", "a requirement cannot be its own parent");

            var sets = new List<string> { "updated_at = now()" };
            var args = new Dictionary<string, object?> { ["id"] = id };
            var changed = new List<string>();
            foreach (var (field, column, cast) in Fields)
            {
                if (!patch.TryGetProperty(field, out var raw)) continue;
                var value = Normalise(field, raw);
                if (Same(field, before[field], value)) continue;
                sets.Add($"{column} = @{field}{cast}");
                args[field] = value;
                changed.Add(field);
            }
            if (changed.Count == 0) return before;

            var row = await SqlJson.QuerySingleAsync(d, $"update workitem set {string.Join(", ", sets)} where id = @id returning {cols}", args, ct);
            await events.AppendAsync(new NewEvent
            {
                ClientId = clientId, WorkitemId = id, Source = "manual", Type = "requirement.updated", Actor = new UserActor(actor),
                Payload = JsonSerializer.SerializeToElement(new { summary = $"עודכנו שדות: {string.Join(", ", changed)}", fields = changed }),
            }, ct);

            var wasClosed = before["phase"]?.GetValue<string>() is "done" or "archived";
            var reopened = wasClosed && changed.Contains("phase") && row!["phase"]?.GetValue<string>() is not ("done" or "archived");
            if (reopened && !string.IsNullOrWhiteSpace(reopenReason))
                await RecordDecisionAsync(clientId, id, actor, "requirement_reopened", reopenReason!, ct);
            return row!;
        }, ct);
        await brief.RegenerateAsync(clientId, id, ct);
        return after;
    }

    /// <summary>Deletes a requirement. Its sub-requirements must be moved or deleted first; its events detach, history stays.</summary>
    public async Task<JsonObject> DeleteAsync(Guid id, CancellationToken ct)
    {
        var (_, clientId, _) = await LocateAsync(id, ct);
        await tenant.RunAsync(clientId, async d =>
        {
            var kids = await SqlJson.ScalarAsync<int>(d, "select count(*)::int from workitem where parent_id = @id", new { id }, ct);
            if (kids > 0) throw AppException.Conflict("has_children", $"לדרישה יש {kids} דרישות משנה — צריך למחוק או להעביר אותן קודם.");
            return await SqlJson.ExecuteAsync(d, "delete from workitem where id = @id", new { id }, ct);
        }, ct);
        return new JsonObject { ["deleted"] = true };
    }

    public async Task<JsonObject> AssignAsync(Guid id, Guid ownerId, CancellationToken ct)
    {
        var (_, clientId, _) = await LocateAsync(id, ct);
        if (await SqlJson.ScalarAsync<Guid?>(db, "select id from users where id = @u and disabled_at is null", new { u = ownerId }, ct) is null)
            throw AppException.NotFound("user");
        await tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d, "update workitem set owner_id = @o, updated_at = now() where id = @id", new { o = ownerId, id }, ct), ct);
        return new JsonObject { ["assigned"] = true, ["ownerId"] = ownerId.ToString() };
    }

    public async Task<JsonObject> AdoLinkAsync(Guid id, int linkedAdoId, CancellationToken ct)
    {
        var (_, clientId, _) = await LocateAsync(id, ct);
        var cols = await TableColumns.SelectAsync(db, "workitem", null, ct);
        return await tenant.RunAsync(clientId, d => SqlJson.QuerySingleAsync(d,
            $"update workitem set linked_ado_id = @ado, updated_at = now() where id = @id returning {cols}", new { ado = linkedAdoId, id }, ct), ct) ?? throw AppException.NotFound("workitem");
    }

    // ── repositories and dependencies ────────────────────────────────

    /// <summary>Links a repository to a requirement (and to its client, too — a requirement's repository is the client's).</summary>
    public async Task<JsonObject> LinkRepoAsync(Guid id, Guid? repoId, string? name, string? gitUrl, string? linkKind, Guid actor, CancellationToken ct)
    {
        var (_, clientId, _) = await LocateAsync(id, ct);
        if (linkKind is not null and not ("declared" or "auto")) throw AppException.BadRequest("bad_request", "linkKind must be declared or auto.");
        if (repoId is null && !string.IsNullOrWhiteSpace(name))
            repoId = Guid.Parse((await clients.LinkRepoAsync(clientId, new ClientService.LinkRepoRequest(null, name, gitUrl, null), actor, ct))["id"]!.GetValue<string>());
        if (repoId is null) throw AppException.BadRequest("repo_required", "repoId or name required");
        var repoName = await SqlJson.ScalarAsync<string>(db, "select name from repo where id = @r", new { r = repoId }, ct) ?? throw AppException.NotFound("repo");

        await tenant.RunAsync(clientId, async d =>
        {
            await SqlJson.ExecuteAsync(d, """
                insert into workitem_repo (client_id, workitem_id, repo_id, link_kind, added_by) values (@c, @w, @r, @k, @by) on conflict do nothing
                """, new { c = clientId, w = id, r = repoId, k = linkKind ?? "declared", by = actor }, ct);
            await SqlJson.ExecuteAsync(d, "insert into client_repo (client_id, repo_id, added_by) values (@c, @r, @by) on conflict do nothing",
                new { c = clientId, r = repoId, by = actor }, ct);
            await events.AppendAsync(new NewEvent
            {
                ClientId = clientId, WorkitemId = id, Source = "manual", Type = "repo.linked", Actor = new UserActor(actor),
                Payload = JsonSerializer.SerializeToElement(new { repoName, linkKind = linkKind ?? "declared" }),
            }, ct);
            return 0;
        }, ct);
        await brief.RegenerateAsync(clientId, id, ct);
        return new JsonObject { ["linked"] = true };
    }

    public async Task<JsonObject> UnlinkRepoAsync(Guid id, Guid repoId, Guid actor, CancellationToken ct)
    {
        var (_, clientId, _) = await LocateAsync(id, ct);
        var repoName = await SqlJson.ScalarAsync<string>(db, "select name from repo where id = @r", new { r = repoId }, ct);
        await tenant.RunAsync(clientId, async d =>
        {
            await SqlJson.ExecuteAsync(d, "delete from workitem_repo where workitem_id = @w and repo_id = @r", new { w = id, r = repoId }, ct);
            await events.AppendAsync(new NewEvent
            {
                ClientId = clientId, WorkitemId = id, Source = "manual", Type = "repo.unlinked", Actor = new UserActor(actor),
                Payload = JsonSerializer.SerializeToElement(new { repoName = repoName ?? repoId.ToString() }),
            }, ct);
            return 0;
        }, ct);
        await brief.RegenerateAsync(clientId, id, ct);
        return new JsonObject { ["unlinked"] = true };
    }

    public async Task LinkDependencyAsync(Guid id, Guid dependsOn, string? kind, string? reason, Guid actor, CancellationToken ct, Guid? originGapId = null)
    {
        if (id == dependsOn) throw AppException.BadRequest("bad_dependency", "a WorkItem cannot depend on itself");
        if (kind is not null and not ("predecessor" or "parent" or "related")) throw AppException.BadRequest("bad_request", "kind must be predecessor, parent or related.");
        var (_, clientId, _) = await LocateAsync(id, ct);
        await tenant.RunAsync(clientId, async d =>
        {
            await SqlJson.ExecuteAsync(d, """
                insert into workitem_dependency (client_id, workitem_id, depends_on_workitem_id, kind, reason, origin_gap_id)
                values (@c, @w, @dep, @kind, @reason, @gap) on conflict do nothing
                """, new { c = clientId, w = id, dep = dependsOn, kind = kind ?? "predecessor", reason, gap = originGapId }, ct);
            await events.AppendAsync(new NewEvent
            {
                ClientId = clientId, WorkitemId = id, Source = "manual", Type = "status.changed", Actor = new UserActor(actor),
                Links = [new EventLink("ado_workitem", dependsOn.ToString())],
                Payload = JsonSerializer.SerializeToElement(new { from = "no dependency", to = $"depends on {dependsOn}", viaAdo = false }),
            }, ct);
            return 0;
        }, ct);
        await brief.RegenerateAsync(clientId, id, ct);
    }

    public async Task<JsonObject> DeleteDependencyAsync(Guid id, Guid dependsOn, CancellationToken ct)
    {
        var (_, clientId, _) = await LocateAsync(id, ct);
        await tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d,
            "delete from workitem_dependency where workitem_id = @w and depends_on_workitem_id = @dep", new { w = id, dep = dependsOn }, ct), ct);
        await brief.RegenerateAsync(clientId, id, ct);
        return new JsonObject { ["deleted"] = true };
    }

    /// <summary>Nodes and edges for the Flow view rooted at one requirement: its subtree, their dependencies, what was spun off.</summary>
    public async Task<JsonObject> FlowAsync(Guid rootId, CancellationToken ct)
    {
        var (_, clientId, _) = await LocateAsync(rootId, ct);
        return await tenant.RunAsync(clientId, async d =>
        {
            var nodes = await SqlJson.QueryAsync(d, """
                with recursive tree as (
                  select id from workitem where id = @root
                  union all
                  select w.id from workitem w join tree t on w.parent_id = t.id
                )
                select w.id, w.key, w.title, w.phase::text as "phase", w.type::text as "type", w.parent_id as "parentId",
                  (select count(*) from gap g where g.workitem_id = w.id and g.blocking and g.state in ('proposed','verified'))::int as "openBlockingGaps",
                  (select count(*) from blocker b where b.workitem_id = w.id and b.state = 'open')::int as "openBlockers",
                  w.linked_ado_id as "linkedAdoId", w.ado_url as "adoUrl"
                from workitem w where w.id in (select id from tree) and w.phase <> 'archived'
                """, new { root = rootId }, ct);
            if (nodes.Count == 0) return new JsonObject { ["nodes"] = new JsonArray(), ["edges"] = new JsonArray() };
            var ids = nodes.Select(n => Guid.Parse(n["id"]!.GetValue<string>())).ToArray();
            var idSet = ids.ToHashSet();

            var edges = new JsonArray();
            foreach (var n in nodes)
                if (n["parentId"]?.GetValue<string>() is { } p && idSet.Contains(Guid.Parse(p)))
                    edges.Add(new JsonObject { ["from"] = p, ["to"] = n["id"]!.GetValue<string>(), ["kind"] = "parent", ["reason"] = null, ["adoSynced"] = false });
            foreach (var dep in await SqlJson.QueryAsync(d, """
                select workitem_id as "from", depends_on_workitem_id as "to", kind, reason, ado_link_synced_at is not null as "adoSynced"
                from workitem_dependency where workitem_id = any(@ids)
                """, new { ids }, ct))
                edges.Add(dep);
            foreach (var s in await SqlJson.QueryAsync(d, """
                select workitem_id as "from", spun_off_to as "to", 'spun_off' as "kind", description as "reason", false as "adoSynced"
                from gap where spun_off_to is not null and workitem_id = any(@ids)
                """, new { ids }, ct))
                edges.Add(s);
            return new JsonObject { ["nodes"] = Arr(nodes), ["edges"] = edges };
        }, ct);
    }

    // ── the lists ────────────────────────────────────────────────────

    public Task<List<JsonObject>> ListAllAsync(IReadOnlySet<Guid>? allowed, CancellationToken ct) =>
        SqlJson.QueryAsync(db, """
            select w.id, w.key, w.title, w.type::text as "type", w.phase::text as "phase", w.priority::text as "priority", w.risk::text as "risk",
                   w.parent_id as "parentId", (select w2.title from workitem w2 where w2.id = w.parent_id) as "parentTitle",
                   w.updated_at as "updatedAt", c.name as "clientName", u.display_name as "ownerName",
                   (select count(*) from blocker b where b.workitem_id = w.id and b.state = 'open')::int as "openBlockers"
            from workitem w join client c on c.id = w.client_id join users u on u.id = w.owner_id
            where @all or w.client_id = any(@ids)
            order by w.updated_at desc limit 200
            """, new { all = allowed is null, ids = (allowed ?? new HashSet<Guid>()).ToArray() }, ct);

    public Task<List<JsonObject>> ListInitiativesAsync(IReadOnlySet<Guid>? allowed, CancellationToken ct) =>
        SqlJson.QueryAsync(db, """
            select w.id, w.title as "name", w.type::text as "type", w.phase::text as "phase", w.priority::text as "priority",
                   w.budget_usd as "budgetUsd", c.name as "clientName", c.id as "clientId",
                   (select count(*) from workitem w2 where w2.parent_id = w.id)::int as "items", w.updated_at as "updatedAt"
            from workitem w join client c on c.id = w.client_id
            where w.parent_id is null and (@all or w.client_id = any(@ids))
            order by w.title
            """, new { all = allowed is null, ids = (allowed ?? new HashSet<Guid>()).ToArray() }, ct);

    // ── decisions ────────────────────────────────────────────────────

    /// <summary>The WHY behind a course-changing decision — its own event type, so history can pull decisions out without guessing.</summary>
    public Task<StoredEvent> RecordDecisionAsync(Guid clientId, Guid workitemId, Guid actor, string trigger, string reason, CancellationToken ct,
        IReadOnlyList<EventLink>? links = null) =>
        events.AppendAsync(new NewEvent
        {
            ClientId = clientId, WorkitemId = workitemId, Source = "manual", Type = "decision.made", Actor = new UserActor(actor),
            Links = links ?? [], Payload = JsonSerializer.SerializeToElement(new { trigger, reason = reason.Trim() }),
        }, ct);

    // ── helpers ──────────────────────────────────────────────────────

    private static void ValidatePatch(JsonElement p)
    {
        if (p.ValueKind != JsonValueKind.Object) throw AppException.BadRequest("bad_request", "The body must be an object.");
        void Enum(string f, string[] values)
        {
            if (p.TryGetProperty(f, out var v) && (v.ValueKind != JsonValueKind.String || !values.Contains(v.GetString())))
                throw AppException.BadRequest("bad_request", $"\"{f}\" must be one of {string.Join(", ", values)}.");
        }
        Enum("type", Types); Enum("requirementType", RequirementTypes); Enum("priority", Priorities); Enum("risk", Risks);
        Enum("executor", Executors); Enum("phase", Phases);
        if (p.TryGetProperty("title", out var t) && (t.ValueKind != JsonValueKind.String || t.GetString()!.Length == 0))
            throw AppException.BadRequest("bad_request", "\"title\" cannot be empty.");
        if (p.TryGetProperty("parentId", out var pid) && pid.ValueKind is not (JsonValueKind.Null or JsonValueKind.String))
            throw AppException.BadRequest("bad_request", "\"parentId\" must be an id or null.");
        if (p.TryGetProperty("parentId", out pid) && pid.ValueKind == JsonValueKind.String && !Guid.TryParse(pid.GetString(), out _))
            throw AppException.BadRequest("bad_request", "\"parentId\" must be an id or null.");
    }

    /// <summary>The value as the database will hold it — the old server's normalisation.</summary>
    private static object? Normalise(string field, JsonElement raw)
    {
        if (raw.ValueKind == JsonValueKind.Null) return null;
        return field switch
        {
            "budgetUsd" => raw.ValueKind == JsonValueKind.Number ? raw.GetRawText() : raw.GetString() is { Length: > 0 } s ? s : null,
            "dueDate" => raw.ValueKind == JsonValueKind.String && raw.GetString() is { Length: > 0 } s
                ? DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal).ToString("o") : null,
            "parentId" or "adoAreaPath" or "key" => raw.GetString() is { Length: > 0 } s ? s : null,
            _ => raw.ValueKind == JsonValueKind.String ? raw.GetString() : raw.GetRawText(),
        };
    }

    private static bool Same(string field, JsonNode? current, object? value)
    {
        var cur = current is JsonValue v && v.TryGetValue<string>(out var s) ? s : current?.ToJsonString();
        if (field == "dueDate")
        {
            if (cur is null && value is null) return true;
            if (cur is null || value is null) return false;
            return DateTimeOffset.Parse(cur, CultureInfo.InvariantCulture) == DateTimeOffset.Parse((string)value, CultureInfo.InvariantCulture);
        }
        if (field == "budgetUsd" && cur is not null && value is string b && decimal.TryParse(cur, CultureInfo.InvariantCulture, out var c1) && decimal.TryParse(b, CultureInfo.InvariantCulture, out var c2))
            return c1 == c2;
        return (cur ?? "") == (value?.ToString() ?? "");
    }

    private static void Check(string field, string? value, string[] allowed)
    {
        if (value is not null && !allowed.Contains(value)) throw AppException.BadRequest("bad_request", $"\"{field}\" must be one of {string.Join(", ", allowed)}.");
    }

    private static JsonArray Arr(List<JsonObject> rows) => new(rows.Select(r => (JsonNode?)r).ToArray());
}
