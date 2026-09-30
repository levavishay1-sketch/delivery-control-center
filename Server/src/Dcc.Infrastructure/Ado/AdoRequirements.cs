using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Ado;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Requirements;

namespace Dcc.Infrastructure.Ado;

/// <summary>
/// A requirement and Azure DevOps (import-ado.ts, ado-sync.ts). Requirements are DCC's own pre-stage and
/// are not pushed to TFS as a matter of course — the TASKS are the TFS side. What is left here: bringing work
/// items IN from a CSV export, and mirroring a requirement that is already linked to a work item (its title,
/// and its state when building starts).
/// </summary>
public sealed class AdoRequirements(DccDbContext db, ITenantScope tenant, AdoClient ado, IEventLogWriter events, BriefService brief)
{
    /// <summary>
    /// Work items from a Boards CSV export become requirements, keeping the ADO id (key "ADO-&lt;id&gt;"), type,
    /// state and area path. Nothing is pushed back — the items are already there. Re-importing skips what exists.
    /// </summary>
    public async Task<JsonObject> ImportCsvAsync(Guid clientId, string csv, Guid actor, CancellationToken ct)
    {
        var rows = AdoMap.ParseCsv(csv);
        if (rows.Count < 2) throw AppException.BadRequest("bad_csv", "ה-CSV ריק או ללא שורת כותרות");
        var header = rows[0].Select(h => h.Trim().ToLowerInvariant()).ToList();
        int Col(string name) => header.IndexOf(name);
        int cType = Col("work item type"), cId = Col("id"), cTitle = Col("title"), cAssignee = Col("assigned to"), cState = Col("state"),
            cArea = Col("area path"), cTags = Col("tags"), cDesc = Col("description");
        if (cId < 0 || cTitle < 0) throw AppException.BadRequest("bad_csv", "ה-CSV חייב לכלול לפחות עמודות \"ID\" ו-\"Title\"");
        string At(List<string> r, int c) => c >= 0 && c < r.Count ? r[c].Trim() : "";

        var existing = (await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, "select key from workitem where client_id = @c and key like 'ADO-%'", new { c = clientId }, ct), ct))
            .Select(r => r["key"]!.GetValue<string>()).ToHashSet();
        var items = new JsonArray();
        int created = 0, skipped = 0;
        var parsed = rows.Skip(1).ToList();
        foreach (var r in parsed)
        {
            var digits = new string(At(r, cId).Where(char.IsDigit).ToArray());
            var adoId = int.TryParse(digits, out var n) ? n : 0;
            var title = At(r, cTitle);
            if (adoId == 0 || title.Length == 0) { skipped++; items.Add(Item(adoId, title, "skipped-bad")); continue; }
            var key = $"ADO-{adoId}";
            if (existing.Contains(key)) { skipped++; items.Add(Item(adoId, title, "skipped-exists")); continue; }
            var rawType = At(r, cType);
            var rawState = At(r, cState);
            var area = At(r, cArea);
            // linkedAdoId stays empty: the item lives in the project the CSV came from; the key records that origin.
            var id = await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<Guid>(d, """
                insert into workitem (client_id, owner_id, title, type, phase, key, ado_area_path)
                values (@c, @o, @t, @type::workitem_type, @phase::workitem_phase, @k, @area) returning id
                """, new { c = clientId, o = actor, t = title, type = AdoMap.MapType(rawType), phase = AdoMap.MapState(rawState), k = key, area = area.Length > 0 ? area : null }, ct), ct);
            existing.Add(key);
            var provenance = string.Join(" · ", new[]
            {
                $"מיובא מ-Azure DevOps · work item #{adoId}",
                rawType.Length > 0 ? $"סוג מקורי: {rawType}" : "",
                rawState.Length > 0 ? $"סטטוס מקורי: {rawState}" : "",
                area.Length > 0 ? $"Area: {area}" : "",
                At(r, cAssignee) is { Length: > 0 } a ? $"שויך ל: {a}" : "",
                At(r, cTags) is { Length: > 0 } tg ? $"תגיות: {tg}" : "",
            }.Where(x => x.Length > 0));
            await Note(clientId, id, actor, provenance, ct);
            if (AdoMap.HtmlToText(At(r, cDesc)) is { Length: > 0 } desc) await Note(clientId, id, actor, $"תיאור מ-ADO:\n{desc}", ct);
            await brief.RegenerateAsync(clientId, id, ct);
            created++;
            items.Add(Item(adoId, title, "created"));
        }
        return new JsonObject { ["total"] = parsed.Count, ["created"] = created, ["skipped"] = skipped, ["items"] = items };
    }

    private static JsonObject Item(int adoId, string title, string status) => new() { ["adoId"] = adoId, ["title"] = title, ["status"] = status };

    private Task Note(Guid clientId, Guid workitemId, Guid actor, string body, CancellationToken ct) =>
        events.AppendAsync(new NewEvent
        {
            ClientId = clientId, WorkitemId = workitemId, Source = "ado", Type = "note.added", Actor = new UserActor(actor),
            Payload = JsonSerializer.SerializeToElement(new { body }),
        }, ct);

    /// <summary>
    /// Mirror a requirement to its work item: linked → its title, then its state (a rejected transition is not an
    /// error); not linked → create one under its parent's item. Every write leaves an ado.synced event.
    /// </summary>
    public async Task<JsonObject> SyncAsync(Guid clientId, Guid workitemId, Guid actor, CancellationToken ct)
    {
        var conn = await AdoConnections.ActiveAsync(tenant, clientId, ct) ?? throw AppException.Conflict("ado_refused", "ללקוח אין חיבור Azure DevOps פעיל");
        if (conn.Project.Length == 0) throw AppException.Conflict("ado_refused", "החיבור הוא ברמת collection בלבד — צריך פרויקט כדי לסנכרן");
        var clientArea = await SqlJson.ScalarAsync<string>(db, "select ado_project_ref from client where id = @c", new { c = clientId }, ct);
        var wi = await tenant.RunAsync(clientId, d => SqlJson.QuerySingleAsync(d, """
            select id, key, title, type::text as "type", phase::text as "phase", parent_id as "parentId", linked_ado_id as "linkedAdoId", ado_area_path as "adoAreaPath"
            from workitem where id = @w
            """, new { w = workitemId }, ct), ct) ?? throw AppException.NotFound("requirement");
        string? S(string k) => wi[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
        var adoType = AdoMap.DccTypeToAdo.GetValueOrDefault(S("type") ?? "", "Task");
        // Only an AreaPath under the connected project — a path from a CSV import is not a node here (TF401347).
        var wantedArea = S("adoAreaPath") is { Length: > 0 } wa ? wa : clientArea ?? "";
        var areaPath = wantedArea.Length > 0 && wantedArea.StartsWith(conn.Project, StringComparison.OrdinalIgnoreCase) ? wantedArea : conn.Project;
        int? parentAdoId = S("parentId") is { } pid
            ? await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<int?>(d, "select linked_ado_id from workitem where id = @p", new { p = Guid.Parse(pid) }, ct), ct) : null;

        if (wi["linkedAdoId"]?.GetValue<int>() is { } linked)
        {
            var res = await ado.SendAsync(conn.ProjectBase, $"wit/workitems/{linked}", HttpMethod.Patch, new[] { new { op = "add", path = "/fields/System.Title", value = S("title") } }, conn.Pat, ct: ct);
            if (!res.Ok) throw AppException.Conflict("ado_refused", $"עדכון ב-ADO נכשל: {res.Detail}");
            if (AdoMap.PhaseToAdoState.GetValueOrDefault(S("phase") ?? "") is { } want)
                await ado.SendAsync(conn.ProjectBase, $"wit/workitems/{linked}", HttpMethod.Patch, new[] { new { op = "add", path = "/fields/System.State", value = want } }, conn.Pat, ct: ct);
            var url = Html(res.Body) ?? conn.WorkItemUrl(linked);
            await tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d, "update workitem set ado_url = @u where id = @w", new { u = url, w = workitemId }, ct), ct);
            await SyncedAsync(clientId, workitemId, actor, linked, "update_state", url, ct);
            await brief.RegenerateAsync(clientId, workitemId, ct);
            return new JsonObject { ["adoId"] = linked, ["url"] = url, ["created"] = false };
        }

        var desc = S("key") is { } key && key.StartsWith("ADO-", StringComparison.Ordinal)
            ? $"נוצר מ-DCC · יובא במקור מ-{key}{(wantedArea.Length > 0 && wantedArea != areaPath ? $" (area מקורי: {wantedArea})" : "")}"
            : $"נוצר מ-DCC · requirement {workitemId}";
        var patch = new List<object>
        {
            new { op = "add", path = "/fields/System.Title", value = S("title") },
            new { op = "add", path = "/fields/System.AreaPath", value = areaPath },
            new { op = "add", path = "/fields/System.Description", value = desc },
        };
        if (parentAdoId is { } p) patch.Add(new { op = "add", path = "/relations/-", value = new { rel = "System.LinkTypes.Hierarchy-Reverse", url = $"{conn.OrgUrl}/_apis/wit/workItems/{p}" } });
        var created = await ado.SendAsync(conn.ProjectBase, $"wit/workitems/{Uri.EscapeDataString("$" + adoType)}", HttpMethod.Post, patch, conn.Pat, ct: ct);
        if (!created.Ok || created.Body is not { } body) throw AppException.Conflict("ado_refused", $"יצירה ב-ADO נכשלה ({adoType}): {created.Detail}");
        var adoId = body.GetProperty("id").GetInt32();
        var itemUrl = Html(body) ?? conn.WorkItemUrl(adoId);
        await tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d, "update workitem set linked_ado_id = @a, ado_url = @u, ado_area_path = @area, updated_at = now() where id = @w",
            new { a = adoId, u = itemUrl, area = areaPath, w = workitemId }, ct), ct);
        await SyncedAsync(clientId, workitemId, actor, adoId, parentAdoId is not null ? "create_link" : "create_workitem", itemUrl, ct);
        await brief.RegenerateAsync(clientId, workitemId, ct);
        return new JsonObject { ["adoId"] = adoId, ["url"] = itemUrl, ["created"] = true };
    }

    private static string? Html(JsonElement? body) =>
        body is { } b && b.TryGetProperty("_links", out var l) && l.TryGetProperty("html", out var h) && h.TryGetProperty("href", out var href) && href.GetString() is { Length: > 0 } s ? s : null;

    private Task SyncedAsync(Guid clientId, Guid workitemId, Guid actor, int adoId, string operation, string url, CancellationToken ct) =>
        events.AppendAsync(new NewEvent
        {
            ClientId = clientId, WorkitemId = workitemId, Source = "ado", Type = "ado.synced", Actor = new UserActor(actor),
            Links = [new EventLink("ado_workitem", adoId.ToString())],
            Payload = JsonSerializer.SerializeToElement(new { direction = "to_ado", adoId, operation, url }),
        }, ct);
}
