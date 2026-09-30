using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Domain.Tasks;
using Dcc.Infrastructure.Ado;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Requirements;

namespace Dcc.Infrastructure.Tasks;

/// <summary>
/// TASKS are what lives in TFS — a requirement is a DCC-only pre-stage and is never pushed here
/// (task-ado-sync.ts). On approval the tree is materialised top-down: each task becomes a work item
/// whose TYPE is the role it plays in the tree (task-types.ts), wired to its parent (Hierarchy-Reverse)
/// and its predecessors (Dependency-Reverse). A check never becomes its own work item — it is folded
/// into its task's Discussion as a checklist.
/// </summary>
public sealed class TaskAdoSync(DccDbContext db, ITenantScope tenant, TaskStore store, AdoClient ado, IEventLogWriter events, BriefService brief)
{
    private static int LevelOf(Guid id, Dictionary<Guid, TaskRow> byId, HashSet<Guid>? seen = null)
    {
        seen ??= [];
        if (!byId.TryGetValue(id, out var t) || t.ParentTaskId is not { } p || !seen.Add(id) || !byId.ContainsKey(p)) return 0;
        return LevelOf(p, byId, seen) + 1;
    }

    private Task Synced(Guid clientId, Guid workitemId, Guid actor, int adoId, Guid taskId, string operation, string url, CancellationToken ct) =>
        events.AppendAsync(new NewEvent
        {
            ClientId = clientId, WorkitemId = workitemId, Source = "ado", Type = "ado.synced", Actor = new UserActor(actor),
            Links = [new EventLink("ado_workitem", adoId.ToString()), new EventLink("task", taskId.ToString())],
            Payload = JsonSerializer.SerializeToElement(new { direction = "to_ado", adoId, operation, url }),
        }, ct);

    public async Task<JsonObject> MaterializeAsync(Guid clientId, Guid workitemId, Guid actor, CancellationToken ct)
    {
        var conn = await AdoConnections.ActiveAsync(tenant, clientId, ct) ?? throw AppException.Conflict("ado_refused", "ללקוח אין חיבור Azure DevOps פעיל");
        if (conn.Project.Length == 0) throw AppException.Conflict("ado_refused", "החיבור הוא ברמת collection בלבד — צריך פרויקט כדי להקים משימות");
        var wantedArea = await SqlJson.ScalarAsync<string>(db, "select ado_project_ref from client where id = @c", new { c = clientId }, ct) ?? "";
        var areaPath = wantedArea.Length > 0 && wantedArea.StartsWith(conn.Project, StringComparison.OrdinalIgnoreCase) ? wantedArea : conn.Project;

        var req = await tenant.RunAsync(clientId, d => SqlJson.QuerySingleAsync(d, "select key, title from workitem where id = @w", new { w = workitemId }, ct), ct);
        var reqKey = req?["key"]?.GetValue<string>();
        var reqTitle = req?["title"]?.GetValue<string>() ?? "";
        var rows = await store.WhereAsync(clientId, "workitem_id = @w and approved_at is not null and state <> 'dropped'", new { w = workitemId }, ct);
        if (rows.Count == 0) throw AppException.Conflict("ado_refused", "אין משימות מאושרות להקמה");
        var ids = rows.Select(r => r.Id).ToArray();
        var deps = await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select task_id as "t", depends_on_task_id as "d" from task_dependency where task_id = any(@ids)
            """, new { ids }, ct), ct);

        var byId = rows.ToDictionary(r => r.Id);
        var tasksOnly = rows.Where(r => r.Kind != "check").ToList();
        var ordered = tasksOnly.OrderBy(r => LevelOf(r.Id, byId)).ThenBy(r => r.Seq).ToList();
        var types = TaskTypes.Structural(tasksOnly.Select(r => new TaskTypes.Node(r.Id.ToString(), r.ParentTaskId?.ToString())).ToList());
        int created = 0, skipped = 0, links = 0, checksPosted = 0;
        var items = new JsonArray();
        var adoIdOf = rows.Where(r => r.LinkedAdoId is not null).ToDictionary(r => r.Id, r => r.LinkedAdoId!.Value);
        var adoUrlOf = rows.Where(r => r.LinkedAdoId is not null && r.AdoUrl is not null).ToDictionary(r => r.Id, r => r.AdoUrl!);

        foreach (var t in ordered)
        {
            if (t.LinkedAdoId is not null) { skipped++; continue; }
            var adoType = types.GetValueOrDefault(t.Id.ToString()) ?? t.AdoType ?? "Task";
            int? parentAdoId = t.ParentTaskId is { } p && adoIdOf.TryGetValue(p, out var pa) ? pa : null;
            var desc = new List<string> { $"נוצר מ-DCC · דרישה {reqKey ?? workitemId.ToString()}: {reqTitle}", $"appetite: {t.Appetite}" };
            if (t.AffectedPaths.Count > 0) desc.Add($"קבצים צפויים: {string.Join(", ", t.AffectedPaths)}");
            var patch = new List<object>
            {
                new { op = "add", path = "/fields/System.Title", value = t.Intent.Length > 250 ? t.Intent[..250] : t.Intent },
                new { op = "add", path = "/fields/System.AreaPath", value = areaPath },
                new { op = "add", path = "/fields/System.Description", value = string.Join("<br>", desc) },
            };
            if (parentAdoId is { } pid)
                patch.Add(new { op = "add", path = "/relations/-", value = new { rel = "System.LinkTypes.Hierarchy-Reverse", url = $"{conn.OrgUrl}/_apis/wit/workItems/{pid}" } });
            var r = await ado.SendAsync(conn.ProjectBase, $"wit/workitems/{Uri.EscapeDataString("$" + adoType)}", HttpMethod.Post, patch, conn.Pat, ct: ct);
            if (!r.Ok || r.Body is not { } body) throw AppException.Conflict("ado_refused", $"הקמת \"{(t.Intent.Length > 40 ? t.Intent[..40] : t.Intent)}\" כ-{adoType} נכשלה: {r.Detail}");
            var adoId = body.GetProperty("id").GetInt32();
            var url = body.TryGetProperty("_links", out var l) && l.TryGetProperty("html", out var h) && h.TryGetProperty("href", out var href) && href.GetString() is { Length: > 0 } hs
                ? hs : conn.WorkItemUrl(adoId);
            adoIdOf[t.Id] = adoId;
            adoUrlOf[t.Id] = url;
            await store.ExecAsync(clientId, "update task set linked_ado_id = @a, ado_url = @u, ado_type = @ty, ado_synced_at = now(), updated_at = now() where id = @id",
                new { a = adoId, u = url, ty = adoType, id = t.Id }, ct);
            await Synced(clientId, workitemId, actor, adoId, t.Id, parentAdoId is not null ? "create_link" : "create_workitem", url, ct);
            created++;
            items.Add(new JsonObject { ["taskId"] = t.Id.ToString(), ["seq"] = t.Seq, ["adoId"] = adoId, ["adoType"] = adoType, ["url"] = url });
        }

        // predecessor links between the created items (ordering, not hierarchy)
        foreach (var d in deps)
        {
            if (!adoIdOf.TryGetValue(Guid.Parse(d["t"]!.GetValue<string>()), out var from) || !adoIdOf.TryGetValue(Guid.Parse(d["d"]!.GetValue<string>()), out var to) || from == to) continue;
            var r = await ado.SendAsync(conn.ProjectBase, $"wit/workitems/{from}", HttpMethod.Patch,
                new[] { new { op = "add", path = "/relations/-", value = new { rel = "System.LinkTypes.Dependency-Reverse", url = $"{conn.OrgUrl}/_apis/wit/workItems/{to}" } } }, conn.Pat, ct: ct);
            if (r.Ok) links++;
        }

        // A check never gets its own work item: approved, unposted ones are folded into their task's Discussion.
        foreach (var group in rows.Where(c => c.Kind == "check" && c.LinkedAdoId is null && c.ParentTaskId is not null).GroupBy(c => c.ParentTaskId!.Value))
        {
            if (!adoIdOf.TryGetValue(group.Key, out var parentAdoId)) continue;
            var lines = new List<string> { "רשימת בדיקה להשלמת המשימה (מ-DCC):" };
            lines.AddRange(group.OrderBy(c => c.Seq).Select(c => $"☐ {c.Intent}{(c.Prompt is { } pr && pr != c.Intent ? $" — {pr}" : "")}"));
            var r = await ado.SendAsync(conn.ProjectBase, $"wit/workitems/{parentAdoId}", HttpMethod.Patch,
                new[] { new { op = "add", path = "/fields/System.History", value = string.Join("<br>", lines) } }, conn.Pat, ct: ct);
            if (!r.Ok) continue; // best-effort — the checklist shows in DCC either way
            var parentUrl = adoUrlOf.GetValueOrDefault(group.Key) ?? conn.WorkItemUrl(parentAdoId);
            foreach (var c in group)
            {
                await store.ExecAsync(clientId, "update task set linked_ado_id = @a, ado_url = @u, ado_synced_at = now(), updated_at = now() where id = @id",
                    new { a = parentAdoId, u = parentUrl, id = c.Id }, ct);
                await Synced(clientId, workitemId, actor, parentAdoId, c.Id, "reconcile", parentUrl, ct);
                checksPosted++;
            }
        }

        await brief.RegenerateAsync(clientId, workitemId, ct);
        var detail = $"הוקמו {created} משימות ב-TFS · {links} קישורי תלות"
            + (checksPosted > 0 ? $" · {checksPosted} בדיקות תועדו ב-Discussion" : "")
            + (skipped > 0 ? $" · {skipped} כבר היו מסונכרנות" : "");
        return new JsonObject { ["created"] = created, ["skipped"] = skipped, ["links"] = links, ["checksPosted"] = checksPosted, ["items"] = items, ["detail"] = detail };
    }

    /// <summary>
    /// Edit a task's content at any state. The person says whether the scope changed; when it is in TFS
    /// already, the title is mirrored there and the note says so.
    /// </summary>
    public async Task<JsonObject> EditAsync(Guid clientId, Guid taskId, Guid actor, string? intent, string? prompt, string? appetite, bool scopeChanged, CancellationToken ct)
    {
        var before = await store.RequireAsync(clientId, taskId, ct);
        var sets = new List<string> { "updated_at = now()" };
        var args = new Dictionary<string, object?> { ["id"] = taskId };
        string? newIntent = null;
        if (intent is not null && intent.Trim().Length > 0) { sets.Add("intent = @intent"); args["intent"] = newIntent = intent.Trim(); }
        if (appetite is not null) { sets.Add("appetite = @appetite::task_appetite"); args["appetite"] = appetite; }
        if (prompt is not null) { sets.Add("prompt = @prompt"); args["prompt"] = prompt.Trim().Length > 0 ? prompt.Trim() : null; }
        if (sets.Count == 1) return new JsonObject { ["updated"] = false, ["adoSynced"] = false };
        await store.ExecAsync(clientId, $"update task set {string.Join(", ", sets)} where id = @id", args, ct);

        var adoSynced = false;
        if (before.LinkedAdoId is { } adoId && before.Kind != "check" && newIntent is not null && newIntent != before.Intent
            && await AdoConnections.ActiveAsync(tenant, clientId, ct) is { Project.Length: > 0 } conn)
        {
            var r = await ado.SendAsync(conn.ProjectBase, $"wit/workitems/{adoId}", HttpMethod.Patch,
                new[] { new { op = "add", path = "/fields/System.Title", value = newIntent.Length > 250 ? newIntent[..250] : newIntent } }, conn.Pat, ct: ct);
            adoSynced = r.Ok;
        }
        var lines = new List<string>
        {
            $"✎ משימה #{before.Seq} נערכה על ידי משתמש.",
            scopeChanged ? "⚠ סומן כשינוי בהיקף העבודה — מומלץ לבדוק מחדש תלויות/בדיקות תחת המשימה." : "עדכון ניסוח/תוכן בלבד, ללא שינוי בהיקף.",
        };
        if (adoSynced) lines.Add("כותרת ה-work item ב-TFS סונכרנה בהתאם.");
        await store.NoteAsync(clientId, before.WorkitemId, taskId, new UserActor(actor), string.Join("\n", lines), ct);
        await brief.RegenerateAsync(clientId, before.WorkitemId, ct);
        return new JsonObject { ["updated"] = true, ["adoSynced"] = adoSynced };
    }

    /// <summary>The light edit (wording and size only), with no note — the old shape of the call.</summary>
    public async Task<JsonObject> UpdateAsync(Guid clientId, Guid taskId, string? intent, string? appetite, CancellationToken ct)
    {
        if (intent is null && appetite is null) return new JsonObject { ["updated"] = false };
        var wi = await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<Guid?>(d, """
            update task set intent = coalesce(@intent, intent), appetite = coalesce(@appetite::task_appetite, appetite) where id = @id returning workitem_id
            """, new { id = taskId, intent, appetite }, ct), ct);
        if (wi is { } w) await brief.RegenerateAsync(clientId, w, ct);
        return new JsonObject { ["updated"] = true };
    }

    /// <summary>Best-effort mirror of an active/inactive toggle to the work item's System.State ("Removed" when set aside). Never throws.</summary>
    public async Task SyncActiveAsync(Guid clientId, int linkedAdoId, bool active, string dccState, CancellationToken ct)
    {
        try
        {
            if (await AdoConnections.ActiveAsync(tenant, clientId, ct) is not { Project.Length: > 0 } conn) return;
            var want = active ? Domain.Ado.AdoMap.TaskStateToAdoState.GetValueOrDefault(dccState, "New") : "Removed";
            await ado.SendAsync(conn.ProjectBase, $"wit/workitems/{linkedAdoId}", HttpMethod.Patch,
                new[] { new { op = "add", path = "/fields/System.State", value = want } }, conn.Pat, ct: ct);
        }
        catch (Exception e) when (e is not OperationCanceledException) { /* DCC's own toggle already committed */ }
    }

    /// <summary>Is the linked work item "Removed" in TFS now? Then DCC follows. The "someone looked" trigger — no poller.</summary>
    public async Task<(bool Checked, string? AdoState)> ReadAdoStateAsync(Guid clientId, int linkedAdoId, CancellationToken ct)
    {
        if (await AdoConnections.ActiveAsync(tenant, clientId, ct) is not { Project.Length: > 0 } conn) return (false, null);
        var r = await ado.GetAsync(conn.ProjectBase, $"wit/workitems/{linkedAdoId}", conn.Pat, ct);
        if (!r.Ok || r.Body is not { } b) return (false, null);
        var state = b.TryGetProperty("fields", out var f) && f.TryGetProperty("System.State", out var s) ? s.ToString() : "";
        return (true, state);
    }

    /// <summary>Posts a line to a work item's Discussion — best-effort.</summary>
    public async Task<bool> HistoryNoteAsync(AdoConn conn, int adoId, string text, CancellationToken ct) =>
        (await ado.SendAsync(conn.ProjectBase, $"wit/workitems/{adoId}", HttpMethod.Patch,
            new[] { new { op = "add", path = "/fields/System.History", value = text } }, conn.Pat, ct: ct)).Ok;

    public Task<AdoConn?> ConnectionAsync(Guid clientId, CancellationToken ct) => AdoConnections.ActiveAsync(tenant, clientId, ct);
}
