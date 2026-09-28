using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Audit;
using Dcc.Infrastructure.Persistence;
using Npgsql;

namespace Dcc.Infrastructure.Clients;

/// <summary>
/// Clients and repositories: the lists, one client's page, onboarding a client,
/// editing and deleting, and which repositories a client uses. Same answers,
/// in the same JSON shape, as the old server (OldServer/packages/core/src:
/// clients.ts, crud.ts, admin.ts).
///
/// Queries that span clients (the lists) run as the owning role, outside a
/// tenant scope, and are filtered by what the caller may see; anything inside
/// one client runs in its <see cref="ITenantScope"/>, behind RLS.
/// </summary>
public sealed class ClientService(DccDbContext db, ITenantScope tenant, IAuditLog audit)
{
    /// <param name="allowed">The clients the caller may see; null = every client.</param>
    public Task<List<JsonObject>> ListClientsAsync(IReadOnlySet<Guid>? allowed, CancellationToken ct) =>
        SqlJson.QueryAsync(db, """
            select c.id, c.name,
              count(distinct w.id) filter (where w.parent_id is null)::int as "initiatives",
              count(distinct w.id)::int as "workitems",
              -- month-to-date, from the ledger: the one place cost is counted
              coalesce((select sum(cc.cost_usd) from claude_call cc where cc.client_id = c.id and cc.started_at >= date_trunc('month', now())), 0)::float as "spent",
              coalesce(max(b.monthly_usd), 0)::float as "budget"
            from client c
            left join workitem w on w.client_id = c.id
            left join client_budget b on b.client_id = c.id
            where c.archived_at is null and (@all or c.id = any(@ids))
            group by c.id
            order by c.name
            """, new { all = allowed is null, ids = (allowed ?? new HashSet<Guid>()).ToArray() }, ct);

    public async Task<JsonObject> ClientDetailAsync(Guid clientId, CancellationToken ct)
    {
        var client = await SqlJson.QuerySingleAsync(db, """
            select id, name, created_at as "createdAt", archived_at as "archivedAt", connector_type::text as "connectorType",
                   ado_project_ref as "adoProjectRef", chat_retention_days as "chatRetentionDays"
            from client where id = @id
            """, new { id = clientId }, ct) ?? throw AppException.NotFound("client");

        // the client's requirement forest — every WorkItem, with its parent
        var requirements = await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select w.id, w.key, w.title, w.type::text as "type", w.phase::text as "phase", w.priority::text as "priority", w.risk::text as "risk",
                   w.parent_id as "parentId", u.display_name as "ownerName", w.budget_usd as "budgetUsd", w.due_date as "dueDate",
                   w.progress_pct as "progressPct", w.updated_at as "updatedAt",
                   (select count(*) from blocker b where b.workitem_id = w.id and b.state = 'open')::int as "openBlockers"
            from workitem w join users u on u.id = w.owner_id
            where w.client_id = @id
            order by w.created_at
            """, new { id = clientId }, ct), ct);

        var repos = await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select r.id, r.name, r.ado_repo_ref as "adoRepoRef", cr.added_at as "addedAt"
            from client_repo cr join repo r on r.id = cr.repo_id
            where cr.client_id = @id
            """, new { id = clientId }, ct), ct);

        var connections = await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select id, kind, display_name as "displayName", config, last_checked_at as "lastCheckedAt",
                   last_check_ok as "lastCheckOk", revoked_at as "revokedAt"
            from service_connection where client_id = @id
            """, new { id = clientId }, ct), ct);

        return new JsonObject { ["client"] = client, ["requirements"] = Arr(requirements), ["repos"] = Arr(repos), ["connections"] = Arr(connections) };
    }

    public sealed record UpdateClientRequest(string? Name, string? ConnectorType, string? AdoProjectRef, bool AdoProjectRefSet);

    public async Task<JsonObject> UpdateClientAsync(Guid clientId, UpdateClientRequest req, Guid actor, CancellationToken ct)
    {
        var sets = new List<string>();
        var args = new Dictionary<string, object?> { ["id"] = clientId };
        if (req.Name is not null)
        {
            if (req.Name.Trim().Length == 0) throw AppException.BadRequest("bad_name", "שם הלקוח ריק.");
            sets.Add("name = @name"); args["name"] = req.Name;
        }
        if (req.ConnectorType is not null)
        {
            if (req.ConnectorType is not ("manual" or "ado" or "github" or "jira" or "dcc")) throw AppException.BadRequest("bad_connector", "connectorType לא מוכר.");
            sets.Add("connector_type = @ct::connector_type"); args["ct"] = req.ConnectorType;
        }
        if (req.AdoProjectRefSet) { sets.Add("ado_project_ref = @ref"); args["ref"] = req.AdoProjectRef; }
        if (sets.Count == 0) return new JsonObject { ["updated"] = false };

        await SqlJson.ExecuteAsync(db, $"update client set {string.Join(", ", sets)} where id = @id", args, ct);
        await audit.WriteAsync(new AuditEntry(actor, "client.updated", "client", clientId.ToString(), After: new { req.Name, req.ConnectorType, adoProjectRef = req.AdoProjectRefSet ? req.AdoProjectRef : null }), ct);
        return new JsonObject { ["updated"] = true };
    }

    /// <summary>
    /// Deletes a client and everything under it — all of it or none of it.
    /// Refused while it still has requirements. Its own repositories go with it;
    /// one another client also uses stays, as a shared repository. When history
    /// that must be kept (event log, ledger) points at the client, the row stays,
    /// hidden (<c>archived_at</c>), and its name is free again.
    /// </summary>
    public async Task<JsonObject> DeleteClientAsync(Guid clientId, Guid actor, CancellationToken ct)
    {
        // client_repo is behind RLS: other clients' links are visible only from here, as the owner.
        var sharedRepos = (await SqlJson.QueryAsync(db, """
            select r.id from repo r
            where r.client_id = @id and exists (select 1 from client_repo cr where cr.repo_id = r.id and cr.client_id <> @id)
            """, new { id = clientId }, ct)).Select(r => Guid.Parse(r["id"]!.GetValue<string>())).ToArray();

        var archived = await tenant.RunAsync(clientId, async d =>
        {
            var n = await SqlJson.ScalarAsync<int>(d, "select count(*)::int from workitem where client_id = @id", new { id = clientId }, ct);
            if (n > 0) throw AppException.Conflict("client_has_requirements", $"ללקוח יש עדיין {n} דרישות. צריך למחוק אותן קודם, ורק אז את הלקוח.");
            await SqlJson.ExecuteAsync(d, "delete from client_repo where client_id = @id", new { id = clientId }, ct);
            await SqlJson.ExecuteAsync(d, "delete from service_connection where client_id = @id", new { id = clientId }, ct);
            await SqlJson.ExecuteAsync(d, "delete from client_budget where client_id = @id", new { id = clientId }, ct);
            await SqlJson.ExecuteAsync(d, "update repo set client_id = null where id = any(@ids)", new { ids = sharedRepos }, ct);
            await SqlJson.ExecuteAsync(d, "delete from repo where client_id = @id", new { id = clientId }, ct);
            await SqlJson.ExecuteAsync(d, "savepoint del_client", null, ct);
            try
            {
                await SqlJson.ExecuteAsync(d, "delete from client where id = @id", new { id = clientId }, ct);
                return false;
            }
            catch (PostgresException e) when (e.SqlState is PostgresErrorCodes.ForeignKeyViolation or PostgresErrorCodes.RestrictViolation)
            {
                await SqlJson.ExecuteAsync(d, "rollback to savepoint del_client", null, ct);
                await SqlJson.ExecuteAsync(d, "update client set archived_at = now() where id = @id", new { id = clientId }, ct);
                return true;
            }
        }, ct);

        await audit.WriteAsync(new AuditEntry(actor, archived ? "client.archived" : "client.deleted", "client", clientId.ToString()), ct);
        return new JsonObject { ["deleted"] = true };
    }

    public sealed record SetupRepo(string Name, string? GitUrl, string? AdoRepoRef, bool? OrgShared);
    public sealed record SetupRequirement(string? Key, string Title, string? Type, string? Priority, string? Risk, string? Executor, int? DueInDays);
    public sealed record SetupClientRequest(string ClientName, SetupRepo? Repo, SetupRequirement? FirstRequirement);

    /// <summary>
    /// Onboards a client: the client, its AI budget, an optional repository and an
    /// optional first requirement. There is no "project": a client owns a forest
    /// of requirements. Reuses a live client of the same name.
    /// </summary>
    public async Task<JsonObject> SetupClientAsync(SetupClientRequest req, Guid actor, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.ClientName)) throw AppException.BadRequest("bad_name", "שם הלקוח ריק.");
        var clientId = await SqlJson.ScalarAsync<Guid?>(db, "select id from client where name = @n and archived_at is null limit 1", new { n = req.ClientName }, ct)
                       ?? (await SqlJson.ScalarAsync<Guid>(db, "insert into client(name) values (@n) returning id", new { n = req.ClientName }, ct));
        await tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d,
            "insert into client_budget(client_id, monthly_usd) values (@id, 300) on conflict do nothing", new { id = clientId }, ct), ct);

        var result = new JsonObject { ["clientId"] = clientId.ToString() };
        if (req.Repo is { } r)
        {
            var repoId = await SqlJson.ScalarAsync<Guid?>(db, "select id from repo where name = @n limit 1", new { n = r.Name }, ct)
                         ?? await SqlJson.ScalarAsync<Guid>(db, "insert into repo(name, client_id, ado_repo_ref) values (@n, @c, @ref) returning id",
                             new { n = r.Name, c = r.OrgShared == true ? (Guid?)null : clientId, @ref = r.AdoRepoRef ?? r.GitUrl }, ct);
            await tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d,
                "insert into client_repo(client_id, repo_id, added_by) values (@c, @r, @by) on conflict do nothing",
                new { c = clientId, r = repoId, by = actor }, ct), ct);
            result["repoId"] = repoId.ToString();
        }
        if (req.FirstRequirement is { } fr)
        {
            var wi = await tenant.RunAsync(clientId, d => SqlJson.QuerySingleAsync(d, """
                insert into workitem(client_id, owner_id, key, title, type, priority, risk, executor, due_date, phase)
                values (@c, @o, @key, @title, @type::workitem_type, @priority::priority, @risk::risk_level, @executor::executor,
                        case when @due::int is null then null else now() + make_interval(days => @due::int) end, 'intake')
                returning id, key
                """, new
            {
                c = clientId, o = actor, key = fr.Key, title = fr.Title, type = fr.Type ?? "story", priority = fr.Priority ?? "medium",
                risk = fr.Risk ?? "low", executor = fr.Executor ?? "human", due = fr.DueInDays,
            }, ct), ct);
            result["workitemId"] = wi!["id"]!.GetValue<string>();
            if (wi["key"] is { } k) result["workitemKey"] = k.GetValue<string>();
        }
        await audit.WriteAsync(new AuditEntry(actor, "client.setup", "client", clientId.ToString(), After: new { req.ClientName, repo = req.Repo?.Name, firstRequirement = req.FirstRequirement?.Title }), ct);
        return result;
    }

    // ── repositories ─────────────────────────────────────────────────

    /// <summary>
    /// Every repository, for pickers, with the client it belongs to (if any).
    /// <paramref name="allowed"/>: the clients the caller may see; null = all. Otherwise only
    /// repositories owned by, or linked to, one of those clients — and shared ones.
    /// </summary>
    public Task<List<JsonObject>> ListReposAsync(IReadOnlySet<Guid>? allowed, CancellationToken ct) =>
        SqlJson.QueryAsync(db, """
            select r.id, r.name, r.ado_repo_ref as "adoRepoRef", r.client_id as "clientId", c.name as "clientName",
                   (select count(*) from client_repo cr where cr.repo_id = r.id)::int as "linkedClients"
            from repo r left join client c on c.id = r.client_id
            where @all or r.client_id = any(@ids) or r.client_id is null
               or exists (select 1 from client_repo cr where cr.repo_id = r.id and cr.client_id = any(@ids))
            order by r.name
            """, new { all = allowed is null, ids = (allowed ?? new HashSet<Guid>()).ToArray() }, ct);

    public sealed record LinkRepoRequest(Guid? RepoId, string? Name, string? GitUrl, string? AdoRepoRef);

    /// <summary>An explicit, recorded link between a client and a repository (created by name when new).</summary>
    public async Task<JsonObject> LinkRepoAsync(Guid clientId, LinkRepoRequest req, Guid actor, CancellationToken ct)
    {
        const string cols = """id, client_id as "clientId", name, ado_repo_ref as "adoRepoRef", default_branch as "defaultBranch", last_indexed_at as "lastIndexedAt", created_at as "createdAt", local_path as "localPath" """;
        JsonObject? repo = null;
        if (req.RepoId is { } id)
            repo = await SqlJson.QuerySingleAsync(db, $"select {cols} from repo where id = @id", new { id }, ct);
        else if (!string.IsNullOrWhiteSpace(req.Name))
            repo = await SqlJson.QuerySingleAsync(db, $"select {cols} from repo where name = @n limit 1", new { n = req.Name }, ct)
                   ?? await SqlJson.QuerySingleAsync(db, $"insert into repo(name, client_id, ado_repo_ref) values (@n, @c, @ref) returning {cols}",
                       new { n = req.Name, c = clientId, @ref = req.AdoRepoRef ?? req.GitUrl }, ct);
        if (repo is null) throw req.RepoId is null ? AppException.BadRequest("repo_required", "repoId or name is required") : AppException.NotFound("repo");

        var repoId = Guid.Parse(repo["id"]!.GetValue<string>());
        await tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d,
            "insert into client_repo(client_id, repo_id, added_by) values (@c, @r, @by) on conflict do nothing",
            new { c = clientId, r = repoId, by = actor }, ct), ct);
        await audit.WriteAsync(new AuditEntry(actor, "client.repo_linked", "client", clientId.ToString(), After: new { repoId, name = repo["name"]?.GetValue<string>() }), ct);
        return repo;
    }

    /// <summary>Detaches a repository from a client; the repository and its other links stay.</summary>
    public async Task<JsonObject> UnlinkRepoAsync(Guid clientId, Guid repoId, Guid actor, CancellationToken ct)
    {
        await tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d, "delete from client_repo where client_id = @c and repo_id = @r", new { c = clientId, r = repoId }, ct), ct);
        await audit.WriteAsync(new AuditEntry(actor, "client.repo_unlinked", "client", clientId.ToString(), Before: new { repoId }), ct);
        return new JsonObject { ["unlinked"] = true };
    }

    public sealed record UpdateRepoRequest(string? Name, string? AdoRepoRef, bool AdoRepoRefSet, string? DefaultBranch, string? LocalPath, bool LocalPathSet);

    public async Task<JsonObject> UpdateRepoAsync(Guid repoId, UpdateRepoRequest req, Guid actor, CancellationToken ct)
    {
        var sets = new List<string>();
        var args = new Dictionary<string, object?> { ["id"] = repoId };
        if (req.Name is not null) { sets.Add("name = @name"); args["name"] = req.Name; }
        if (req.AdoRepoRefSet) { sets.Add("ado_repo_ref = @ref"); args["ref"] = req.AdoRepoRef; }
        if (req.DefaultBranch is not null) { sets.Add("default_branch = @branch"); args["branch"] = req.DefaultBranch; }
        if (req.LocalPathSet) { sets.Add("local_path = @path"); args["path"] = string.IsNullOrEmpty(req.LocalPath) ? null : req.LocalPath; }
        if (sets.Count == 0) return new JsonObject { ["updated"] = false };
        await SqlJson.ExecuteAsync(db, $"update repo set {string.Join(", ", sets)} where id = @id", args, ct);
        await audit.WriteAsync(new AuditEntry(actor, "repo.updated", "repo", repoId.ToString(), After: new { req.Name, req.DefaultBranch }), ct);
        return new JsonObject { ["updated"] = true };
    }

    /// <summary>Deletes a repository everywhere (its client and requirement links cascade).</summary>
    public async Task<JsonObject> DeleteRepoAsync(Guid repoId, Guid actor, CancellationToken ct)
    {
        await SqlJson.ExecuteAsync(db, "delete from repo where id = @id", new { id = repoId }, ct);
        await audit.WriteAsync(new AuditEntry(actor, "repo.deleted", "repo", repoId.ToString()), ct);
        return new JsonObject { ["deleted"] = true };
    }

    /// <summary>The client a repository belongs to (null for a shared one) — to scope a permission check.</summary>
    public Task<Guid?> RepoOwnerAsync(Guid repoId, CancellationToken ct) =>
        SqlJson.ScalarAsync<Guid?>(db, "select client_id from repo where id = @id", new { id = repoId }, ct);

    private static JsonArray Arr(List<JsonObject> rows) => new(rows.Select(r => (JsonNode?)r).ToArray());
}
