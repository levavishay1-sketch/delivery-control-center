using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Requirements;

/// <summary>
/// The active-edit map and the Reviewer flow (contention.ts; architecture §7, §9). Overlap is a warning, not a gate;
/// the Reviewer is a hat worn before a person's approval, not instead of it. A touch is recorded only on a repository
/// the client owns or has linked — the wall between clients holds on shared repositories too.
/// </summary>
public sealed class ContentionService(DccDbContext db, ITenantScope tenant, IEventLogWriter events, BriefService brief)
{
    private static async Task<Guid> RepoAsync(DccDbContext d, Guid clientId, string repoName, CancellationToken ct) =>
        await SqlJson.ScalarAsync<Guid?>(d, """
            select r.id from repo r
            where r.name = @n and (r.client_id = @c or exists (select 1 from client_repo cr where cr.repo_id = r.id and cr.client_id = @c))
            limit 1
            """, new { n = repoName, c = clientId }, ct)
        ?? throw new AppException(404, "not_found", $"המאגר {repoName} לא נמצא אצל הלקוח הזה");

    /// <summary>Files a requirement's work is touching — and which other active requirements touch the same ones.</summary>
    public Task<JsonObject> RecordTouchesAsync(Guid clientId, Guid workitemId, string repoName, string? branch, IReadOnlyList<string> paths, string kind, CancellationToken ct) =>
        tenant.RunAsync(clientId, async d =>
        {
            var repoId = await RepoAsync(d, clientId, repoName, ct);
            foreach (var path in paths)
                await SqlJson.ExecuteAsync(d, """
                    insert into workitem_file_touch (client_id, workitem_id, repo_id, path, branch, kind)
                    values (@c, @w, @r, @p, @b, @k)
                    on conflict (workitem_id, repo_id, path) do update set last_touched_at = now(), branch = excluded.branch, kind = excluded.kind, released_at = null
                    """, new { c = clientId, w = workitemId, r = repoId, p = path, b = branch, k = kind }, ct);
            var overlaps = await SqlJson.QueryAsync(d, """
                select t.path, t.workitem_id as "otherWorkitem", w.key as "otherKey", w.title as "otherTitle", t.branch as "otherBranch"
                from workitem_file_touch t join workitem w on w.id = t.workitem_id
                where t.repo_id = @r and t.path = any(@paths) and t.workitem_id <> @w and t.released_at is null
                """, new { r = repoId, paths = paths.ToArray(), w = workitemId }, ct);
            return new JsonObject { ["repoId"] = repoId.ToString(), ["overlaps"] = new JsonArray(overlaps.Select(x => (JsonNode?)x).ToArray()) };
        }, ct);

    public async Task<JsonObject> ReleaseAsync(Guid clientId, Guid workitemId, CancellationToken ct)
    {
        await tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d, "update workitem_file_touch set released_at = now() where workitem_id = @w and released_at is null", new { w = workitemId }, ct), ct);
        return new JsonObject { ["released"] = true };
    }

    /// <summary>A repository's contention view: each path, and the active requirements touching it.</summary>
    public Task<JsonArray> ContentionAsync(Guid clientId, string repoName, CancellationToken ct) =>
        tenant.RunAsync(clientId, async d =>
        {
            var repoId = await RepoAsync(d, clientId, repoName, ct);
            var rows = await SqlJson.QueryAsync(d, """
                select t.path, t.workitem_id as "id", w.key, w.title, t.branch, t.kind
                from workitem_file_touch t join workitem w on w.id = t.workitem_id
                where t.repo_id = @r and t.released_at is null order by t.path
                """, new { r = repoId }, ct);
            return new JsonArray(rows.GroupBy(r => r["path"]!.GetValue<string>()).Select(g => (JsonNode?)new JsonObject
            {
                ["path"] = g.Key, ["contended"] = g.Count() > 1,
                ["workitems"] = new JsonArray(g.Select(i => (JsonNode?)new JsonObject
                {
                    ["id"] = i["id"]!.DeepClone(), ["key"] = i["key"]?.DeepClone(), ["title"] = i["title"]!.DeepClone(), ["branch"] = i["branch"]?.DeepClone(), ["kind"] = i["kind"]!.DeepClone(),
                }).ToArray()),
            }).ToArray());
        }, ct);

    public sealed record Finding(string File, int? Line, string Severity, string Note);

    /// <summary>The Reviewer's verdict on a requirement's change, recorded with its findings, and a line on the timeline.</summary>
    public async Task<JsonObject> RecordReviewAsync(Guid clientId, Guid workitemId, Guid userId, string? prRef, string verdict, IReadOnlyList<Finding> findings, IReadOnlyList<string> overlapFocus, CancellationToken ct)
    {
        var cols = await TableColumns.SelectAsync(db, "review", null, ct);
        var findingsJson = JsonSerializer.Serialize(findings.Select(f =>
        {
            var o = new JsonObject { ["file"] = f.File };
            if (f.Line is { } l) o["line"] = l;
            o["severity"] = f.Severity;
            o["note"] = f.Note;
            return o;
        }));
        var row = await tenant.RunAsync(clientId, async d =>
        {
            var inserted = (await SqlJson.QuerySingleAsync(d, $"""
                insert into review (client_id, workitem_id, pr_ref, verdict, findings, overlap_focus, by_user_id)
                values (@c, @w, @pr, @v, @f::jsonb, @o::jsonb, @u) returning {cols}
                """, new { c = clientId, w = workitemId, pr = prRef, v = verdict, f = findingsJson, o = JsonSerializer.Serialize(overlapFocus), u = userId }, ct))!;
            var links = new List<EventLink> { new("task", inserted["id"]!.GetValue<string>()) };
            if (prRef is not null) links.Add(new EventLink("pull_request", prRef));
            await events.AppendAsync(new NewEvent
            {
                ClientId = clientId, WorkitemId = workitemId, Source = "claude_session", Type = "review.completed",
                Actor = new DelegatedActor(userId, "agent:reviewer"), Links = links,
                Payload = JsonSerializer.SerializeToElement(new { verdict, findingCount = findings.Count, blockingCount = findings.Count(f => f.Severity == "block"), overlapFocus }),
            }, ct);
            return inserted;
        }, ct);
        await brief.RegenerateAsync(clientId, workitemId, ct);
        return row;
    }
}
