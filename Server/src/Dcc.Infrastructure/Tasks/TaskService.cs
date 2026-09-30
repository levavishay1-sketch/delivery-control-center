using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Requirements;

namespace Dcc.Infrastructure.Tasks;

/// <summary>Thrown when a task is marked done while checks or dependencies are unresolved — answered 409 with which.</summary>
public sealed class ChecksNotPassed(string message, JsonArray unresolved) : Exception(message)
{
    public JsonArray Unresolved { get; } = unresolved;
}

/// <summary>
/// Tasks of a requirement (tasks.ts, bugs.ts, research-work.ts): propose, progress through the done gate,
/// set in or out of play (mirrored to TFS), the task's page, bug links, and the one tracking task of a
/// research or testing requirement.
/// </summary>
public sealed class TaskService(
    DccDbContext db, ITenantScope tenant, TaskStore store, TaskFacts facts, TaskRunService runs, TaskAdoSync adoSync,
    IEventLogWriter events, BriefService brief, RequirementService requirements)
{
    public static readonly string[] States = ["pending", "in_progress", "blocked", "failed_checks", "done", "dropped"];
    public static readonly string[] Appetites = ["small", "standard", "large"];

    public sealed record ProposedTask(string Intent, JsonArray Acceptance, string? Appetite, IReadOnlyList<int>? DependsOn, string? DependencyReason);

    private static string Dominant(IEnumerable<string?> xs)
    {
        var l = xs.ToList();
        return l.Contains("large") ? "large" : l.Contains("standard") ? "standard" : "small";
    }

    /// <summary>Registers tasks a person or a skill wrote — they land on the timeline and in the Context Brief.</summary>
    public async Task<JsonObject> ProposeAsync(Guid clientId, Guid workitemId, Guid actor, IReadOnlyList<ProposedTask> tasks, string? openspecChangeId, CancellationToken ct)
    {
        if (tasks.Count == 0) throw AppException.BadRequest("bad_request", "no tasks");
        var (ids, depCount) = await tenant.RunAsync(clientId, async d =>
        {
            if (await SqlJson.ScalarAsync<Guid?>(d, "select id from workitem where id = @w", new { w = workitemId }, ct) is null) throw AppException.NotFound("workitem");
            var startSeq = await SqlJson.ScalarAsync<int>(d, "select coalesce(max(seq), 0)::int from task where workitem_id = @w", new { w = workitemId }, ct);
            var ids = new List<Guid>();
            for (var i = 0; i < tasks.Count; i++)
                ids.Add(await SqlJson.ScalarAsync<Guid>(d, """
                    insert into task (client_id, workitem_id, seq, intent, acceptance, appetite, openspec_change_id)
                    values (@c, @w, @seq, @intent, @acc, @appetite::task_appetite, @os) returning id
                    """, new { c = clientId, w = workitemId, seq = startSeq + i + 1, intent = tasks[i].Intent, acc = SqlJson.Jsonb(tasks[i].Acceptance), appetite = tasks[i].Appetite ?? "standard", os = openspecChangeId }, ct));
            var n = 0;
            for (var i = 0; i < tasks.Count; i++)
                foreach (var dep in tasks[i].DependsOn ?? [])
                {
                    if (dep < 0 || dep >= ids.Count || dep == i) continue;
                    await SqlJson.ExecuteAsync(d, "insert into task_dependency (client_id, task_id, depends_on_task_id, reason) values (@c, @t, @dep, @r)",
                        new { c = clientId, t = ids[i], dep = ids[dep], r = tasks[i].DependencyReason }, ct);
                    n++;
                }
            return (ids, n);
        }, ct);
        await events.AppendAsync(new NewEvent
        {
            ClientId = clientId, WorkitemId = workitemId, Source = "claude_session", Type = "tasks.proposed",
            Actor = new DelegatedActor(actor, "skill:task-breakdown"), Links = ids.Select(id => new EventLink("task", id.ToString())).ToList(),
            Payload = JsonSerializer.SerializeToElement(new Dictionary<string, object?>
            {
                ["openspecChangeId"] = openspecChangeId, ["taskCount"] = ids.Count, ["dependencyCount"] = depCount, ["appetite"] = Dominant(tasks.Select(t => t.Appetite)),
            }.Where(kv => kv.Value is not null).ToDictionary()),
        }, ct);
        await brief.RegenerateAsync(clientId, workitemId, ct);
        return new JsonObject { ["taskIds"] = new JsonArray(ids.Select(i => (JsonNode?)i.ToString()).ToArray()), ["dependencyCount"] = depCount };
    }

    /// <summary>
    /// Moves a task. To done only when its checks passed and its dependencies are done — or a person overrides,
    /// which is recorded on the checks and, with a reason, as a decision. Reopening a done task with a reason is a decision too.
    /// </summary>
    public async Task<JsonObject> ProgressAsync(Guid clientId, Guid taskId, Guid actor, string mode, string to, bool overrideChecks, string? overrideReason, string? reopenReason, CancellationToken ct)
    {
        var t = await store.RequireAsync(clientId, taskId, ct);
        var depBlockers = to == "done" ? await facts.DoneBlockersAsync(clientId, t, ct) : [];
        var from = t.State;
        if (from == "done" && to != "done" && reopenReason?.Trim() is { Length: > 0 })
            await requirements.RecordDecisionAsync(clientId, t.WorkitemId, actor, "task_reopened", reopenReason, ct, [new EventLink("task", taskId.ToString())]);

        if (to == "done")
        {
            var unresolved = await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
                select id, seq, intent, check_result as "checkResult" from task
                where parent_task_id = @t and kind = 'check' and active and state <> 'dropped' and check_result is distinct from 'passed'
                """, new { t = taskId }, ct), ct);
            if ((unresolved.Count > 0 || depBlockers.Count > 0) && !overrideChecks)
            {
                var waiting = unresolved.Where(u => TaskFacts.Str(u, "checkResult") == "waiting").ToList();
                var notPassed = unresolved.Where(u => TaskFacts.Str(u, "checkResult") != "waiting").ToList();
                var parts = new List<string>();
                if (notPassed.Count > 0) parts.Add($"{notPassed.Count} בדיקות לא עברו: {string.Join(", ", notPassed.Select(u => $"#{u["seq"]}"))}");
                if (waiting.Count > 0) parts.Add($"{waiting.Count} בדיקות מחכות לתלות שעוד לא פותחה: {string.Join(", ", waiting.Select(u => $"#{u["seq"]}"))}");
                parts.AddRange(depBlockers);
                throw new ChecksNotPassed($"אי אפשר לסמן כהושלם — {string.Join("; ", parts)}",
                    new JsonArray(unresolved.Select(u => (JsonNode?)new JsonObject { ["id"] = u["id"]?.DeepClone(), ["seq"] = u["seq"]?.DeepClone(), ["intent"] = u["intent"]?.DeepClone(), ["checkResult"] = u["checkResult"]?.DeepClone() }).ToArray()));
            }
            if (depBlockers.Count > 0 && overrideChecks && unresolved.Count == 0 && overrideReason?.Trim() is { Length: > 0 })
                await requirements.RecordDecisionAsync(clientId, t.WorkitemId, actor, "task_closed_override", $"{overrideReason} (נסגרה למרות: {string.Join("; ", depBlockers)})", ct, [new EventLink("task", taskId.ToString())]);
            if (unresolved.Count > 0 && overrideChecks)
            {
                await store.ExecAsync(clientId, "update task set check_resolved_by = @by, check_resolved_at = now(), updated_at = now() where id = any(@ids)",
                    new { by = actor, ids = unresolved.Select(u => Guid.Parse(TaskFacts.Str(u, "id")!)).ToArray() }, ct);
                if (overrideReason?.Trim() is { Length: > 0 })
                    await requirements.RecordDecisionAsync(clientId, t.WorkitemId, actor, "task_closed_override", overrideReason, ct, [new EventLink("task", taskId.ToString())]);
            }
        }

        await store.ExecAsync(clientId, "update task set state = @s::task_state, updated_at = now() where id = @id", new { id = taskId, s = to }, ct);
        await events.AppendAsync(new NewEvent
        {
            ClientId = clientId, WorkitemId = t.WorkitemId, Source = mode == "delegated" ? "claude_session" : "manual", Type = "task.progressed",
            Actor = mode == "delegated" ? new DelegatedActor(actor, "session") : new UserActor(actor),
            Links = [new EventLink("task", taskId.ToString())],
            Payload = JsonSerializer.SerializeToElement(new { taskId, from, to, intent = t.Intent }),
        }, ct);
        await brief.RegenerateAsync(clientId, t.WorkitemId, ct);
        // The run it was closed on went through review — the task's steps draw it that way.
        if (to == "done") await runs.MarkLatestRunAsync(taskId, "closedAt", ct);
        return new JsonObject { ["taskId"] = taskId.ToString(), ["from"] = from, ["to"] = to };
    }

    /// <summary>
    /// A task or check in or out of play, keeping its history. Setting aside cascades to every descendant;
    /// bringing back touches only this row (a check's old result is cleared — it needs fresh verification).
    /// </summary>
    public async Task<JsonObject> SetActiveAsync(Guid clientId, Guid taskId, bool active, Guid actor, CancellationToken ct)
    {
        var row = await store.RequireAsync(clientId, taskId, ct);
        var descendants = await tenant.RunAsync(clientId, async d =>
        {
            await SqlJson.ExecuteAsync(d, active && row.Kind == "check"
                ? "update task set active = true, check_result = null, check_resolved_by = null, check_resolved_at = null, updated_at = now() where id = @id"
                : "update task set active = @a, updated_at = now() where id = @id", new { id = taskId, a = active }, ct);
            if (active) return 0;
            return await SqlJson.ExecuteAsync(d, """
                with recursive sub as (select id from task where parent_task_id = @id union all select t.id from task t join sub on t.parent_task_id = sub.id)
                update task set active = false, updated_at = now() where id in (select id from sub)
                """, new { id = taskId }, ct);
        }, ct);
        if (row.Kind == "check" && row.ParentTaskId is { } p) await store.SyncStateAfterChecksAsync(clientId, p, ct);
        if (row.Kind == "task" && row.LinkedAdoId is { } ado) await adoSync.SyncActiveAsync(clientId, ado, active, row.State, ct);
        var label = row.Kind == "check" ? "בדיקה" : "משימה";
        await store.NoteAsync(clientId, row.WorkitemId, taskId, new UserActor(actor), active
            ? $"{label} #{row.Seq} הופעלה מחדש{(row.Kind == "check" ? " — זקוקה לאימות חדש" : "")}."
            : $"{label} #{row.Seq} הושבתה{(descendants > 0 ? $" (וכן {descendants} תת-פריטים תחתיה)" : "")} — לא תופיע ב-Flow/תלויות, {(row.Kind == "task" && row.LinkedAdoId is not null ? "עודכנה ב-TFS ל-Removed, " : "")}ההיסטוריה נשארת.", ct);
        await brief.RegenerateAsync(clientId, row.WorkitemId, ct);
        return new JsonObject { ["active"] = active };
    }

    /// <summary>Is the linked work item "Removed" in TFS now? Then DCC follows, the same way a DCC-side toggle does.</summary>
    public async Task<JsonObject> CheckAdoRemovedAsync(Guid clientId, Guid taskId, Guid actor, CancellationToken ct)
    {
        var row = await store.GetAsync(clientId, taskId, ct);
        if (row?.LinkedAdoId is not { } ado || row.Kind == "check") return new JsonObject { ["checked"] = false, ["changed"] = false };
        var (ok, state) = await adoSync.ReadAdoStateAsync(clientId, ado, ct);
        if (!ok) return new JsonObject { ["checked"] = false, ["changed"] = false };
        if (state == "Removed" && row.Active)
        {
            await SetActiveAsync(clientId, taskId, false, actor, ct);
            return new JsonObject { ["checked"] = true, ["changed"] = true, ["adoState"] = state };
        }
        return new JsonObject { ["checked"] = true, ["changed"] = false, ["adoState"] = state };
    }

    public async Task<JsonObject> TasksForAsync(Guid clientId, Guid workitemId, CancellationToken ct)
    {
        var cols = await TableColumns.SelectAsync(db, "task", null, ct);
        var depCols = await TableColumns.SelectAsync(db, "task_dependency", null, ct);
        return await tenant.RunAsync(clientId, async d => new JsonObject
        {
            ["tasks"] = new JsonArray((await SqlJson.QueryAsync(d, $"select {cols} from task where workitem_id = @w order by seq", new { w = workitemId }, ct)).Select(x => (JsonNode?)x).ToArray()),
            ["dependencies"] = new JsonArray((await SqlJson.QueryAsync(d, $"select {depCols} from task_dependency where task_id in (select id from task where workitem_id = @w)", new { w = workitemId }, ct)).Select(x => (JsonNode?)x).ToArray()),
        }, ct);
    }

    // ── one task, with everything its screen needs ───────────────────

    public async Task<JsonObject> DetailAsync(Guid clientId, Guid taskId, CancellationToken ct)
    {
        var row = await store.RowJsonAsync(clientId, taskId, ct) ?? throw AppException.NotFound("task");
        var t = TaskRow.From(row);
        var rel = await store.RelationsAsync(clientId, t.WorkitemId, ct);
        var wi = await tenant.RunAsync(clientId, d => SqlJson.QuerySingleAsync(d, """
            select id, key, title, phase::text as "phase", client_id as "clientId" from workitem where id = @w
            """, new { w = t.WorkitemId }, ct), ct);
        JsonObject Slim(TaskRow r) => new()
        {
            ["id"] = r.Id.ToString(), ["seq"] = r.Seq, ["intent"] = r.Intent, ["adoType"] = r.AdoType, ["kind"] = r.Kind, ["state"] = r.State,
            ["linkedAdoId"] = r.LinkedAdoId, ["checkResult"] = r.CheckResult, ["checkResolvedBy"] = r.CheckResolvedBy?.ToString(), ["active"] = r.Active,
            ["approvedAt"] = r.ApprovedAt, ["checkKind"] = r.CheckKind,
        };
        var parent = t.ParentTaskId is { } pid && rel.ById.GetValueOrDefault(pid) is { } p
            ? new JsonObject { ["id"] = p.Id.ToString(), ["seq"] = p.Seq, ["intent"] = p.Intent, ["adoType"] = p.AdoType } : null;
        var children = rel.Rows.Where(r => r.ParentTaskId == taskId && r.State != "dropped").OrderBy(r => r.Seq).Select(Slim);
        var blockedBy = rel.EffectiveDeps(taskId).OrderBy(d => d.Row.Seq).Select(d =>
        {
            var o = Slim(d.Row);
            o["parentTaskId"] = d.Row.ParentTaskId?.ToString();
            if (d.Via is { } via) o["via"] = new JsonObject { ["through"] = via.Through, ["seq"] = via.Seq };
            return o;
        });
        var blocks = rel.WaitingOn(taskId).OrderBy(r => r.Seq).Select(r => { var o = Slim(r); o["parentTaskId"] = r.ParentTaskId?.ToString(); return o; });
        var repos = await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select r.id, r.name, r.ado_repo_ref as "adoRepoRef" from workitem_repo wr join repo r on r.id = wr.repo_id where wr.workitem_id = @w
            """, new { w = t.WorkitemId }, ct), ct);
        return new JsonObject
        {
            ["task"] = row,
            ["requirement"] = wi ?? new JsonObject { ["id"] = t.WorkitemId.ToString(), ["key"] = null, ["title"] = "", ["phase"] = "", ["clientId"] = clientId.ToString() },
            ["parent"] = parent,
            ["children"] = new JsonArray(children.Select(x => (JsonNode?)x).ToArray()),
            ["blockedBy"] = new JsonArray(blockedBy.Select(x => (JsonNode?)x).ToArray()),
            ["blocks"] = new JsonArray(blocks.Select(x => (JsonNode?)x).ToArray()),
            ["isGroup"] = rel.IsGroup(taskId),
            ["repos"] = new JsonArray(repos.Select(x => (JsonNode?)x).ToArray()),
        };
    }

    /// <summary>The task's page: its detail, its status and its checks', every row's status, the steps, the development in place, the check outcomes, the runs.</summary>
    public async Task<JsonObject> PageAsync(Guid clientId, Guid taskId, CancellationToken ct)
    {
        var detail = await DetailAsync(clientId, taskId, ct);
        var t = TaskRow.From(detail["task"]!.AsObject());
        var f = await facts.ForRequirementAsync(clientId, t.WorkitemId, ct);
        var statuses = f.ByTask.ToDictionary(kv => kv.Key, kv => Domain.Tasks.TaskStatuses.Of(kv.Value));
        var statusMap = TaskFacts.StatusMap(statuses);
        var checkStatuses = new JsonObject();
        foreach (var c in f.Rel.Rows.Where(c => c.ParentTaskId == taskId && c.Kind == "check")) checkStatuses[c.Id.ToString()] = statusMap[c.Id.ToString()]?.DeepClone();
        detail["status"] = statusMap[taskId.ToString()]?.DeepClone();
        detail["checkStatuses"] = checkStatuses;
        detail["statuses"] = statusMap;
        detail["developed"] = f.OwnDevelopment.Contains(taskId);
        detail["subtasks"] = JsonSerializer.SerializeToNode(f.ByTask.GetValueOrDefault(taskId)?.Subtasks ?? [], TaskFacts.Json);
        detail["development"] = await runs.LatestDevelopmentAsync(taskId, ct);
        detail["checkOutcomes"] = await facts.CheckOutcomesAsync(clientId, taskId, ct);
        detail["flow"] = JsonSerializer.SerializeToNode(await facts.FlowOfAsync(clientId, t, ct), TaskFacts.Json);
        detail["history"] = await runs.HistoryAsync(taskId, ct);
        return detail;
    }

    // ── bugs linked to tasks (bugs.ts) ───────────────────────────────

    public async Task<JsonObject> LinkBugAsync(Guid clientId, Guid bugId, Guid taskId, CancellationToken ct)
    {
        await tenant.RunAsync(clientId, async d =>
        {
            var type = await SqlJson.ScalarAsync<string>(d, "select type::text from workitem where id = @b", new { b = bugId }, ct) ?? throw AppException.NotFound("requirement");
            if (type != "bug") throw AppException.Conflict("bug_refused", "אפשר לקשר משימה רק לדרישה מסוג Bug");
            if (await SqlJson.ScalarAsync<Guid?>(d, "select id from task where id = @t", new { t = taskId }, ct) is null) throw AppException.NotFound("task");
            return await SqlJson.ExecuteAsync(d, "insert into bug_task_link (client_id, bug_id, task_id) values (@c, @b, @t) on conflict do nothing", new { c = clientId, b = bugId, t = taskId }, ct);
        }, ct);
        return new JsonObject { ["linked"] = true };
    }

    public async Task<JsonObject> UnlinkBugAsync(Guid clientId, Guid bugId, Guid taskId, CancellationToken ct)
    {
        await store.ExecAsync(clientId, "delete from bug_task_link where bug_id = @b and task_id = @t", new { b = bugId, t = taskId }, ct);
        return new JsonObject { ["unlinked"] = true };
    }

    public Task<List<JsonObject>> BugLinkedTasksAsync(Guid clientId, Guid bugId, CancellationToken ct) =>
        tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select t.id, t.intent, t.workitem_id as "requirementId", w.title as "requirementTitle"
            from bug_task_link l join task t on t.id = l.task_id join workitem w on w.id = t.workitem_id where l.bug_id = @b
            """, new { b = bugId }, ct), ct);

    /// <summary>Every active check a Bug's linked tasks carry, deduped by wording — not the three every task gets.</summary>
    public async Task<List<(string Intent, string? Prompt)>> InheritedChecksForBugAsync(Guid clientId, Guid bugId, CancellationToken ct)
    {
        var linked = (await BugLinkedTasksAsync(clientId, bugId, ct)).Select(l => Guid.Parse(TaskFacts.Str(l, "id")!)).ToArray();
        if (linked.Length == 0) return [];
        var checks = await store.WhereAsync(clientId, "kind = 'check' and active and check_kind is null and parent_task_id = any(@ids)", new { ids = linked }, ct);
        var seen = new HashSet<string>();
        return checks.Where(c => seen.Add(c.Intent)).Select(c => (c.Intent, c.Prompt)).ToList();
    }

    /// <summary>Search a client's tasks — the bug-link picker (title and the requirement it belongs to).</summary>
    public Task<List<JsonObject>> SearchAsync(Guid clientId, string? q, CancellationToken ct) =>
        tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select t.id, t.intent, t.workitem_id as "requirementId", w.title as "requirementTitle"
            from task t join workitem w on w.id = t.workitem_id
            where @term = '' or t.intent ilike '%' || @term || '%' or w.title ilike '%' || @term || '%'
            limit 25
            """, new { term = (q ?? "").Trim() }, ct), ct);

    // ── research and testing requirements (research-work.ts) ─────────

    /// <summary>ONE tracking task for a research/testing requirement — created, approved and put in TFS at once. Never a second.</summary>
    public async Task<JsonObject> StartResearchAsync(Guid clientId, Guid workitemId, Guid actor, CancellationToken ct)
    {
        var wi = await tenant.RunAsync(clientId, d => SqlJson.QuerySingleAsync(d, """select title, requirement_type::text as "type" from workitem where id = @w""", new { w = workitemId }, ct), ct)
            ?? throw AppException.NotFound("requirement");
        if (wi["type"]!.GetValue<string>() == "development") throw AppException.Conflict("research_refused", "פעולה זו רק לדרישות תחקור/בדיקות");
        if ((await store.WhereAsync(clientId, "workitem_id = @w and parent_task_id is null", new { w = workitemId }, ct)).Count > 0)
            throw AppException.Conflict("research_refused", "כבר קיימת משימת מעקב לדרישה הזו");
        var id = await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<Guid>(d, """
            insert into task (client_id, workitem_id, seq, kind, intent, appetite, origin, state, ado_type)
            values (@c, @w, 1, 'task', @intent, 'standard', 'human', 'pending', 'Task') returning id
            """, new { c = clientId, w = workitemId, intent = wi["title"]!.GetValue<string>() }, ct), ct);
        var r = await runs.ApproveAsync(clientId, id, actor, null, null, null, ct);
        if (r["approved"]?.GetValue<bool>() != true) throw AppException.Conflict("research_refused", "יצירת המשימה נכשלה");
        var o = new JsonObject { ["taskId"] = id.ToString(), ["materialized"] = r["materialized"] is not null };
        if (r["materializeError"] is { } err) o["materializeError"] = err.DeepClone();
        return o;
    }

    /// <summary>Closes a research/testing requirement: the conclusion becomes its final note, the tracking task done, then the requirement.</summary>
    public async Task<JsonObject> FinishResearchAsync(Guid clientId, Guid workitemId, Guid actor, string conclusion, CancellationToken ct)
    {
        conclusion = conclusion.Trim();
        if (conclusion.Length == 0) throw AppException.BadRequest("bad_request", "צריך לכתוב מסקנות לפני סיום");
        var type = await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<string>(d, "select requirement_type::text from workitem where id = @w", new { w = workitemId }, ct), ct)
            ?? throw AppException.NotFound("requirement");
        var label = type == "testing" ? "תוצאת בדיקה" : "מסקנות תחקור";
        await events.AppendAsync(new NewEvent
        {
            ClientId = clientId, WorkitemId = workitemId, Source = "manual", Type = "note.added", Actor = new UserActor(actor),
            Payload = JsonSerializer.SerializeToElement(new { body = $"{label}: {conclusion}" }),
        }, ct);
        var tracking = (await store.WhereAsync(clientId, "workitem_id = @w and parent_task_id is null", new { w = workitemId }, ct)).FirstOrDefault();
        if (tracking is not null && tracking.State != "done") await ProgressAsync(clientId, tracking.Id, actor, "interactive", "done", false, null, null, ct);
        await requirements.UpdateAsync(workitemId, JsonSerializer.SerializeToElement(new { phase = "done" }), actor, ct);
        await brief.RegenerateAsync(clientId, workitemId, ct);
        return new JsonObject { ["finished"] = true };
    }
}
