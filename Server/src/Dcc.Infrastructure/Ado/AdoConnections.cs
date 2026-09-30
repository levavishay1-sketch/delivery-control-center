using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Ado;

/// <summary>A client's active Azure DevOps connection: where, and the PAT (never shown).</summary>
public sealed record AdoConn(Guid Id, string Pat, string OrgUrl, string Project)
{
    /// <summary>Work-item routes are project-scoped: {collection}/{project}/_apis/wit/…</summary>
    public string ProjectBase => $"{OrgUrl}/{Uri.EscapeDataString(Project)}";

    /// <summary>The human-facing URL of a work item on this server.</summary>
    public string WorkItemUrl(int adoId) => AdoConnections.WorkItemUrl(OrgUrl, Project, adoId);
}

public static class AdoConnections
{
    /// <summary>The client's newest connection that is not revoked, or null.</summary>
    public static Task<AdoConn?> ActiveAsync(ITenantScope tenant, Guid clientId, CancellationToken ct) =>
        tenant.RunAsync(clientId, async d =>
        {
            var c = await SqlJson.QuerySingleAsync(d, """
                select id, secret_ref as "pat", config from service_connection
                where client_id = @c and kind = 'ado' and revoked_at is null order by created_at desc limit 1
                """, new { c = clientId }, ct);
            if (c is null) return null;
            return new AdoConn(Guid.Parse(c["id"]!.GetValue<string>()), c["pat"]!.GetValue<string>(),
                (c["config"]?["orgUrl"]?.GetValue<string>() ?? "").TrimEnd('/'), c["config"]?["project"]?.GetValue<string>() ?? "");
        }, ct);

    public static string WorkItemUrl(string orgUrl, string project, int adoId) =>
        $"{orgUrl.TrimEnd('/')}/{Uri.EscapeDataString(project)}/_workitems/edit/{adoId}";
}
