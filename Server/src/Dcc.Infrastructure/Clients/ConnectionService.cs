using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Audit;
using Dcc.Infrastructure.Ado;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Clients;

/// <summary>
/// A client's connections to Azure DevOps (cloud or on-prem Server): add, edit,
/// check live, remove; list them for the "reuse an existing connection" picker;
/// and list the projects a PAT can see, for the connect form.
///
/// A connection is transport, not reasoning: it holds the PAT (in the pilot,
/// directly; in production a Key Vault path) and never returns it.
/// </summary>
public sealed class ConnectionService(DccDbContext db, ITenantScope tenant, AdoClient ado, IAuditLog audit)
{
    /// <param name="allowed">Clients whose connections the caller may see; null = all.</param>
    public Task<List<JsonObject>> ListAsync(IReadOnlySet<Guid>? allowed, CancellationToken ct) =>
        SqlJson.QueryAsync(db, """
            select sc.id, sc.kind, sc.display_name as "displayName", sc.config, c.name as "clientName", c.id as "clientId",
                   sc.last_check_ok as "lastCheckOk"
            from service_connection sc join client c on c.id = sc.client_id
            where sc.revoked_at is null and (@all or c.id = any(@ids))
            """, new { all = allowed is null, ids = (allowed ?? new HashSet<Guid>()).ToArray() }, ct);

    /// <summary>The Azure DevOps projects this PAT can see. Accepts whatever was pasted as the URL.</summary>
    public async Task<JsonObject> ListProjectsAsync(string rawOrgUrl, string pat, CancellationToken ct)
    {
        var (orgUrl, _) = AdoUrl.Normalise(rawOrgUrl, "");
        var r = await ado.GetAsync(orgUrl, "projects?$top=500", pat, ct);
        if (!r.Ok) return new JsonObject { ["ok"] = false, ["orgUrl"] = orgUrl, ["projects"] = new JsonArray(), ["detail"] = r.Detail };
        var names = r.Body is { } b && b.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Select(p => p.TryGetProperty("name", out var n) ? n.GetString() : null).OfType<string>().Order(StringComparer.CurrentCulture).ToList()
            : [];
        return new JsonObject
        {
            ["ok"] = true, ["orgUrl"] = orgUrl,
            ["projects"] = new JsonArray(names.Select(n => (JsonNode?)n).ToArray()),
            ["detail"] = $"{names.Count} פרויקטים (api {r.ApiVersion})",
        };
    }

    /// <summary>
    /// Adds a connection — or, when a live one to the same org/project exists, updates
    /// its PAT rather than piling up rows on every retry — then checks it live.
    /// </summary>
    public async Task<JsonObject> AddAsync(Guid clientId, string rawOrgUrl, string? rawProject, string pat, Guid actor, CancellationToken ct)
    {
        var (orgUrl, project) = AdoUrl.Normalise(rawOrgUrl, rawProject ?? "");
        var displayName = DisplayName(orgUrl, project);
        var config = Config(orgUrl, project);

        var id = await tenant.RunAsync(clientId, async d =>
        {
            var existing = await SqlJson.ScalarAsync<Guid?>(d, """
                select id from service_connection
                where client_id = @c and kind = 'ado' and revoked_at is null
                  and config->>'orgUrl' = @org and coalesce(config->>'project', '') = @proj
                limit 1
                """, new { c = clientId, org = orgUrl, proj = project }, ct);
            if (existing is { } e)
            {
                await SqlJson.ExecuteAsync(d, "update service_connection set secret_ref = @pat, display_name = @name, config = @cfg where id = @id",
                    new { pat, name = displayName, cfg = SqlJson.Jsonb(config), id = e }, ct);
                return e;
            }
            return await SqlJson.ScalarAsync<Guid>(d, """
                insert into service_connection(client_id, kind, display_name, secret_ref, scope, config, created_by)
                values (@c, 'ado', @name, @pat, '["vso.work_write","vso.code"]'::jsonb, @cfg, @by)
                returning id
                """, new { c = clientId, name = displayName, pat, cfg = SqlJson.Jsonb(config), by = actor }, ct);
        }, ct);

        await audit.WriteAsync(new AuditEntry(actor, "connection.saved", "client", clientId.ToString(), After: new { connectionId = id, kind = "ado", orgUrl, project }), ct);
        var check = await CheckAsync(clientId, id, ct);
        return new JsonObject { ["id"] = id.ToString(), ["check"] = check };
    }

    public async Task<JsonObject> UpdateAsync(Guid clientId, Guid connectionId, string? orgUrl, string? project, string? pat, Guid actor, CancellationToken ct)
    {
        await tenant.RunAsync(clientId, async d =>
        {
            var row = await SqlJson.QuerySingleAsync(d, "select config from service_connection where id = @id", new { id = connectionId }, ct)
                      ?? throw AppException.NotFound("connection");
            var cfg = row["config"] as JsonObject;
            var merged = AdoUrl.Normalise(orgUrl ?? cfg?["orgUrl"]?.GetValue<string>() ?? "", project ?? cfg?["project"]?.GetValue<string>() ?? "");
            await SqlJson.ExecuteAsync(d, """
                update service_connection set config = @cfg, display_name = @name, secret_ref = coalesce(@pat, secret_ref) where id = @id
                """, new { cfg = SqlJson.Jsonb(Config(merged.OrgUrl, merged.Project)), name = DisplayName(merged.OrgUrl, merged.Project), pat = string.IsNullOrEmpty(pat) ? null : pat, id = connectionId }, ct);
            return 0;
        }, ct);
        await audit.WriteAsync(new AuditEntry(actor, "connection.updated", "client", clientId.ToString(), After: new { connectionId, orgUrl, project, patChanged = !string.IsNullOrEmpty(pat) }), ct);
        return new JsonObject { ["updated"] = true };
    }

    /// <summary>Removes a connection (pure transport configuration — nothing depends on the row).</summary>
    public async Task<JsonObject> DeleteAsync(Guid clientId, Guid connectionId, Guid actor, CancellationToken ct)
    {
        await tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d, "delete from service_connection where id = @id", new { id = connectionId }, ct), ct);
        await audit.WriteAsync(new AuditEntry(actor, "connection.deleted", "client", clientId.ToString(), Before: new { connectionId }), ct);
        return new JsonObject { ["deleted"] = true };
    }

    /// <summary>
    /// A live check against the Azure DevOps REST API. When the project is not found
    /// and the URL itself seems to end with a project, retries with that segment moved
    /// out — and fixes the stored URL when that works. The outcome is stored on the row.
    /// </summary>
    public async Task<JsonObject> CheckAsync(Guid clientId, Guid connectionId, CancellationToken ct)
    {
        var conn = await tenant.RunAsync(clientId, d => SqlJson.QuerySingleAsync(d,
            "select config, secret_ref as \"secret\" from service_connection where id = @id", new { id = connectionId }, ct), ct)
            ?? throw AppException.NotFound("connection");
        var cfg = conn["config"] as JsonObject;
        var orgUrl = (cfg?["orgUrl"]?.GetValue<string>() ?? "").TrimEnd('/');
        var proj = cfg?["project"]?.GetValue<string>() ?? "";
        var pat = conn["secret"]!.GetValue<string>();

        var r = proj.Length > 0
            ? await ado.GetAsync(orgUrl, $"projects/{Uri.EscapeDataString(proj)}", pat, ct)
            : await ado.GetAsync(orgUrl, "projects?$top=1", pat, ct);

        bool ok = r.Ok;
        string detail;
        if (r.Ok)
        {
            detail = proj.Length > 0 ? $"הפרויקט \"{proj}\" נגיש (api {r.ApiVersion})" : $"ה-collection נגיש (api {r.ApiVersion})";
        }
        else if (r.Status == 404 && proj.Length > 0)
        {
            // maybe the project was left inside the URL — retry with the last segment moved out
            var cut = orgUrl.LastIndexOf('/');
            var head = cut > "https://".Length ? orgUrl[..cut] : null;
            var tail = cut > 0 ? Uri.UnescapeDataString(orgUrl[(cut + 1)..]) : "";
            if (head is not null && !tail.Equals(proj, StringComparison.OrdinalIgnoreCase))
            {
                var alt = await ado.GetAsync(head, $"projects/{Uri.EscapeDataString(proj)}", pat, ct);
                if (alt.Ok)
                {
                    detail = $"הפרויקט \"{proj}\" נגיש (api {alt.ApiVersion}) — תיקנתי את ה-Organization URL ל-{head}";
                    await Store(clientId, connectionId, detail, Config(head, proj), ct);
                    return new JsonObject { ["ok"] = true, ["detail"] = detail };
                }
            }
            detail = $"404 — לא נמצא הפרויקט \"{proj}\" תחת {orgUrl}. ודא ש-Organization URL הוא ה-org/collection בלבד ושם הפרויקט מדויק (או בחר מהרשימה).";
        }
        else
        {
            detail = r.Detail;
        }

        await Store(clientId, connectionId, ok ? detail : $"FAILED — {detail}", null, ct);
        return new JsonObject { ["ok"] = ok, ["detail"] = detail };
    }

    private Task Store(Guid clientId, Guid connectionId, string outcome, Dictionary<string, string>? newConfig, CancellationToken ct) =>
        tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d, """
            update service_connection set last_checked_at = now(), last_check_ok = @ok, config = coalesce(@cfg, config) where id = @id
            """, new { ok = outcome, cfg = newConfig is null ? null : SqlJson.Jsonb(newConfig), id = connectionId }, ct), ct);

    private static string DisplayName(string orgUrl, string project) =>
        project.Length > 0 ? $"Azure DevOps — {project}" : $"Azure DevOps — {System.Text.RegularExpressions.Regex.Replace(orgUrl, "^https?://", "")}";

    private static Dictionary<string, string> Config(string orgUrl, string project) =>
        project.Length > 0 ? new() { ["orgUrl"] = orgUrl, ["project"] = project } : new() { ["orgUrl"] = orgUrl };
}
