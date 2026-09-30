using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Domain.Tasks;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Requirements;

namespace Dcc.Infrastructure.Tasks;

/// <summary>
/// The task tree as the screens draw it (flow.ts): one requirement's tree with its schedule — decided once
/// here so every view answers the same way — and every client's TFS side, each row with the status a
/// person reads. Also "I'm ready to build this" (start-build.ts).
/// </summary>
public sealed partial class TaskTreeService(DccDbContext db, ITenantScope tenant, TaskStore store, TaskFacts facts, IEventLogWriter events, BriefService brief)
{
    private static int Level(Guid id, IReadOnlyDictionary<Guid, Guid?> parentOf, HashSet<Guid>? seen = null)
    {
        seen ??= [];
        if (parentOf.GetValueOrDefault(id) is not { } p || !seen.Add(id) || !parentOf.ContainsKey(p)) return 0;
        return Level(p, parentOf, seen) + 1;
    }

    /// <summary>The proposed/approved tree of one requirement: hierarchy and dependency edges, groups, what each waits for, and its stage.</summary>
    public async Task<JsonObject> FlowForAsync(Guid clientId, Guid workitemId, CancellationToken ct)
    {
        var all = await store.OfRequirementAsync(clientId, workitemId, ct);
        var rows = all.Where(r => r.State != "dropped").ToList();
        if (rows.Count == 0) return new JsonObject { ["depth"] = 0, ["requirementRung"] = null, ["nodes"] = new JsonArray(), ["edges"] = new JsonArray() };
        var parentOf = rows.ToDictionary(r => r.Id, r => r.ParentTaskId);
        var depth = rows.Where(r => r.Kind != "check").Select(r => Level(r.Id, parentOf)).DefaultIfEmpty(0).Max() + 1;
        var ids = rows.Select(r => r.Id).ToArray();
        var deps = await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select task_id as "t", depends_on_task_id as "d", reason from task_dependency where task_id = any(@ids)
            """, new { ids }, ct), ct);

        var tasks = rows.Where(r => r.Kind != "check").ToList();
        var active = tasks.Where(n => n.Active).Select(n => n.Id).ToHashSet();
        var rel = new TaskRelations(rows.Select(r => r.Rel()).ToList(), deps.Select(x => new RelDep(x["t"]!.GetValue<string>(), x["d"]!.GetValue<string>())).ToList());
        var isGroup = tasks.ToDictionary(n => n.Id, n => rel.IsGroup(n.Id.ToString()));
        var dependsOn = tasks.ToDictionary(n => n.Id, n => isGroup[n.Id] ? [] : rel.EffectiveDeps(n.Id.ToString()).Select(d => Guid.Parse(d.Id)).Where(active.Contains).ToList());
        var stage = new Dictionary<Guid, int>();
        int StageOf(Guid id, HashSet<Guid> seen)
        {
            if (!dependsOn.ContainsKey(id) || isGroup[id] || seen.Contains(id)) return 0;
            if (stage.TryGetValue(id, out var s)) return s;
            seen.Add(id);
            var v = dependsOn[id].Count > 0 ? dependsOn[id].Max(d => StageOf(d, seen)) + 1 : 0;
            seen.Remove(id);
            return stage[id] = v;
        }
        foreach (var n in tasks) if (!isGroup[n.Id]) StageOf(n.Id, []);

        // The TFS type follows the role in the tree; one already in TFS keeps the type it was created with.
        var work = tasks.Where(n => n.Active).Select(n => new TaskTypes.Node(n.Id.ToString(), n.ParentTaskId?.ToString())).ToList();
        var types = TaskTypes.Structural(work);
        var statuses = await facts.StatusesAsync(clientId, workitemId, ct);
        JsonNode? S(Guid id) => statuses.TryGetValue(id, out var s) ? JsonSerializer.SerializeToNode(s, TaskFacts.Json) : null;

        var checksByParent = rows.Where(r => r.Kind == "check" && r.ParentTaskId is not null).GroupBy(r => r.ParentTaskId!.Value).ToDictionary(g => g.Key, g => g.OrderBy(c => c.Seq).ToList());
        var nodes = new JsonArray(tasks.Select(r => (JsonNode?)new JsonObject
        {
            ["id"] = r.Id.ToString(), ["seq"] = r.Seq, ["kind"] = r.Kind, ["intent"] = r.Intent, ["appetite"] = r.Appetite, ["state"] = r.State,
            ["adoType"] = r.LinkedAdoId is null ? types.GetValueOrDefault(r.Id.ToString()) ?? r.AdoType : r.AdoType,
            ["level"] = Level(r.Id, parentOf), ["parentTaskId"] = r.ParentTaskId?.ToString(), ["approved"] = r.Approved, ["active"] = r.Active,
            ["linkedAdoId"] = r.LinkedAdoId, ["adoUrl"] = r.AdoUrl, ["affectedPaths"] = Arr(r.AffectedPaths), ["compiledComponents"] = Arr(r.CompiledComponents),
            ["prompt"] = r.Prompt, ["origin"] = r.Origin, ["approvedAt"] = r.ApprovedAt, ["adoSyncedAt"] = r.AdoSyncedAt,
            ["checks"] = new JsonArray((checksByParent.GetValueOrDefault(r.Id) ?? []).Select(c => (JsonNode?)new JsonObject
            {
                ["id"] = c.Id.ToString(), ["seq"] = c.Seq, ["intent"] = c.Intent, ["state"] = c.State, ["checkKind"] = c.CheckKind, ["status"] = S(c.Id),
            }).ToArray()),
            ["isGroup"] = isGroup[r.Id], ["dependsOn"] = new JsonArray(dependsOn[r.Id].Select(d => (JsonNode?)d.ToString()).ToArray()),
            ["stage"] = stage.TryGetValue(r.Id, out var st) ? st : null, ["status"] = S(r.Id),
        }).ToArray());

        var edges = new JsonArray();
        foreach (var n in tasks.Where(n => n.ParentTaskId is { } p && active.Contains(p) && active.Contains(n.Id)))
            edges.Add(new JsonObject { ["from"] = n.ParentTaskId!.Value.ToString(), ["to"] = n.Id.ToString(), ["kind"] = "parent", ["reason"] = null });
        foreach (var d in deps)
        {
            var from = Guid.Parse(d["d"]!.GetValue<string>());
            var to = Guid.Parse(d["t"]!.GetValue<string>());
            if (active.Contains(from) && active.Contains(to))
                edges.Add(new JsonObject { ["from"] = from.ToString(), ["to"] = to.ToString(), ["kind"] = "depends", ["reason"] = d["reason"]?.DeepClone() });
        }
        var rung = TaskTypes.RequirementRungFor(work);
        return new JsonObject
        {
            ["depth"] = depth,
            ["requirementRung"] = rung is null ? null : new JsonObject { ["type"] = rung.Type, ["over"] = rung.Over, ["of"] = rung.Of },
            ["nodes"] = nodes, ["edges"] = edges,
        };
    }

    /// <summary>Every task of a client (not checks) across its requirements — a 1:1 mirror of its TFS side, depth-first per requirement, each with its status.</summary>
    public async Task<JsonObject> ClientTreeAsync(Guid clientId, CancellationToken ct)
    {
        var raw = await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select t.id, t.workitem_id as "requirementId", t.seq, t.kind, t.intent, t.appetite::text as "appetite", t.state::text as "state", t.ado_type as "adoType",
                   t.linked_ado_id as "linkedAdoId", t.ado_url as "adoUrl", t.ado_synced_at as "adoSyncedAt", t.approved_at as "approvedAt",
                   t.parent_task_id as "parentTaskId", t.active, w.key as "requirementKey", w.title as "requirementTitle"
            from task t join workitem w on w.id = t.workitem_id
            where t.client_id = @c and t.state <> 'dropped' order by w.created_at, t.seq
            """, new { c = clientId }, ct), ct);
        var parentOf = raw.ToDictionary(r => Guid.Parse(r["id"]!.GetValue<string>()), r => TaskFacts.Str(r, "parentTaskId") is { } p ? Guid.Parse(p) : (Guid?)null);
        var checksCount = new Dictionary<string, int>();
        var checksPosted = new Dictionary<string, int>();
        foreach (var r in raw.Where(r => TaskFacts.Str(r, "kind") == "check" && TaskFacts.Str(r, "parentTaskId") is not null))
        {
            var p = TaskFacts.Str(r, "parentTaskId")!;
            checksCount[p] = checksCount.GetValueOrDefault(p) + 1;
            if (r["linkedAdoId"] is not null) checksPosted[p] = checksPosted.GetValueOrDefault(p) + 1;
        }
        var all = raw.Where(r => TaskFacts.Str(r, "kind") != "check").Select(r =>
        {
            var id = TaskFacts.Str(r, "id")!;
            return new JsonObject
            {
                ["id"] = id, ["requirementId"] = r["requirementId"]?.DeepClone(), ["requirementKey"] = r["requirementKey"]?.DeepClone(), ["requirementTitle"] = r["requirementTitle"]?.DeepClone(),
                ["seq"] = r["seq"]?.DeepClone(), ["intent"] = r["intent"]?.DeepClone(), ["appetite"] = r["appetite"]?.DeepClone(), ["state"] = r["state"]?.DeepClone(),
                ["adoType"] = r["adoType"]?.DeepClone(), ["linkedAdoId"] = r["linkedAdoId"]?.DeepClone(), ["adoUrl"] = r["adoUrl"]?.DeepClone(), ["adoSyncedAt"] = r["adoSyncedAt"]?.DeepClone(),
                ["approved"] = r["approvedAt"] is not null, ["active"] = r["active"]?.DeepClone(), ["parentTaskId"] = r["parentTaskId"]?.DeepClone(),
                ["level"] = Level(Guid.Parse(id), parentOf), ["checksCount"] = checksCount.GetValueOrDefault(id), ["checksPosted"] = checksPosted.GetValueOrDefault(id),
            };
        }).ToList();
        var kids = new Dictionary<string, List<JsonObject>>();
        foreach (var t in all)
        {
            var p = TaskFacts.Str(t, "parentTaskId");
            var k = p is not null && parentOf.ContainsKey(Guid.Parse(p)) ? p : $"root:{TaskFacts.Str(t, "requirementId")}";
            if (!kids.TryGetValue(k, out var list)) kids[k] = list = [];
            list.Add(t);
        }
        var rows = new List<JsonObject>();
        void Walk(string key)
        {
            foreach (var t in (kids.GetValueOrDefault(key) ?? []).OrderBy(x => x["seq"]!.GetValue<int>()))
            {
                rows.Add(t);
                Walk(TaskFacts.Str(t, "id")!);
            }
        }
        foreach (var req in all.Select(t => TaskFacts.Str(t, "requirementId")!).Distinct()) Walk($"root:{req}");

        // Each row with the status a person reads — the same one the task screen shows.
        foreach (var reqId in rows.Select(r => TaskFacts.Str(r, "requirementId")!).Distinct().ToList())
        {
            var statuses = await facts.StatusesAsync(clientId, Guid.Parse(reqId), ct);
            foreach (var r in rows.Where(r => TaskFacts.Str(r, "requirementId") == reqId))
                r["status"] = statuses.TryGetValue(Guid.Parse(TaskFacts.Str(r, "id")!), out var s) ? JsonSerializer.SerializeToNode(s, TaskFacts.Json) : null;
        }
        return new JsonObject
        {
            ["rows"] = new JsonArray(rows.Select(r => (JsonNode?)r).ToArray()),
            ["inTfs"] = rows.Count(r => r["linkedAdoId"] is not null),
            ["pending"] = rows.Count(r => r["linkedAdoId"] is null && r["active"]?.GetValue<bool>() == true),
        };
    }

    /// <summary>Every client's tree in one list — the org-wide TFS mirror, narrowed to the clients the person may read.</summary>
    public async Task<JsonObject> AllAsync(IReadOnlySet<Guid>? allowed, CancellationToken ct)
    {
        var cs = await SqlJson.QueryAsync(db, "select id, name from client order by name", null, ct);
        var output = new JsonArray();
        int inTfs = 0, pending = 0;
        foreach (var c in cs)
        {
            var id = Guid.Parse(c["id"]!.GetValue<string>());
            if (allowed is not null && !allowed.Contains(id)) continue;
            var t = await ClientTreeAsync(id, ct);
            if (t["rows"]!.AsArray().Count == 0) continue;
            inTfs += t["inTfs"]!.GetValue<int>();
            pending += t["pending"]!.GetValue<int>();
            var o = new JsonObject { ["clientId"] = id.ToString(), ["clientName"] = c["name"]!.GetValue<string>() };
            foreach (var (k, v) in t) o[k] = v?.DeepClone();
            output.Add(o);
        }
        return new JsonObject { ["clients"] = output, ["inTfs"] = inTfs, ["pending"] = pending };
    }

    // ── "I'm ready to build this" (start-build.ts) ───────────────────

    [GeneratedRegex("[^a-z0-9]+")] private static partial Regex NonSlug();
    [GeneratedRegex(@"^[A-Z]{2,5}-\d+$")] private static partial Regex StableKey();

    /// <summary>
    /// A stable key if the requirement has none, the move to building, and what a Claude Code session needs to
    /// start: the branch name the hooks resolve, the repositories, and a warning when blocking gaps or blockers are open.
    /// </summary>
    public async Task<(JsonObject Result, bool Moved, int? LinkedAdoId)> StartBuildingAsync(Guid clientId, Guid workitemId, Guid actor, CancellationToken ct)
    {
        var nextWi = (await SqlJson.ScalarAsync<int?>(db, """
            select coalesce(max((substring(key from 'WI-([0-9]+)'))::int), 1000) from workitem where key ~ '^WI-[0-9]+$'
            """, null, ct) ?? 1000) + 1;
        var output = await tenant.RunAsync(clientId, async d =>
        {
            var wi = await SqlJson.QuerySingleAsync(d, """
                select key, title, phase::text as "phase", linked_ado_id as "linkedAdoId" from workitem where id = @w
                """, new { w = workitemId }, ct) ?? throw AppException.NotFound("requirement");
            var key = TaskFacts.Str(wi, "key");
            int? linked = wi["linkedAdoId"]?.GetValue<int>();
            if (key is null || !StableKey().IsMatch(key))
            {
                key = linked is { } l ? $"WI-{l}" : $"WI-{nextWi}";
                await SqlJson.ExecuteAsync(d, "update workitem set key = @k where id = @w", new { k = key, w = workitemId }, ct);
            }
            var gaps = await SqlJson.ScalarAsync<int>(d, "select count(*)::int from gap where workitem_id = @w and blocking and state in ('proposed','verified')", new { w = workitemId }, ct);
            var blockers = await SqlJson.ScalarAsync<int>(d, "select count(*)::int from blocker where workitem_id = @w and state = 'open'", new { w = workitemId }, ct);
            var repos = await SqlJson.QueryAsync(d, """
                select r.name, r.ado_repo_ref as "adoRepoRef", r.default_branch as "defaultBranch" from workitem_repo wr join repo r on r.id = wr.repo_id where wr.workitem_id = @w
                """, new { w = workitemId }, ct);
            if (repos.Count == 0)
                repos = await SqlJson.QueryAsync(d, """
                    select r.name, r.ado_repo_ref as "adoRepoRef", r.default_branch as "defaultBranch" from client_repo cr join repo r on r.id = cr.repo_id where cr.client_id = @c
                    """, new { c = clientId }, ct);
            var title = wi["title"]!.GetValue<string>();
            var slug = NonSlug().Replace(title.ToLowerInvariant(), "-").Trim('-');
            if (slug.Length > 40) slug = slug[..40];
            var branch = slug.Length > 0 ? $"task/{key}-{slug}" : $"task/{key}";
            var phase = wi["phase"]!.GetValue<string>();
            var moved = phase is "intake" or "shaping";
            var startedWithOpenBlocker = gaps + blockers > 0;
            if (moved)
            {
                await SqlJson.ExecuteAsync(d, "update workitem set phase = 'building', started_with_open_blocker = @b, updated_at = now() where id = @w", new { w = workitemId, b = startedWithOpenBlocker }, ct);
                await events.AppendAsync(new NewEvent
                {
                    ClientId = clientId, WorkitemId = workitemId, Source = "manual", Type = "status.changed", Actor = new UserActor(actor),
                    Payload = JsonSerializer.SerializeToElement(new { from = phase, to = "building", viaAdo = false }),
                }, ct);
            }
            return (new JsonObject
            {
                ["key"] = key, ["branch"] = branch, ["repos"] = new JsonArray(repos.Select(r => (JsonNode?)r).ToArray()),
                ["openBlockingGaps"] = gaps, ["openBlockers"] = blockers, ["startedWithOpenBlocker"] = startedWithOpenBlocker,
            }, moved, linked);
        }, ct);
        if (output.moved) await brief.RegenerateAsync(clientId, workitemId, ct);
        return output;
    }

    private static JsonArray Arr(IEnumerable<string> xs) => new(xs.Select(x => (JsonNode?)x).ToArray());
}
