using System.Text.Json.Nodes;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Requirements;

/// <summary>
/// The dashboard, the alerts, the budgets and the activity log (dashboard.ts). Reads across clients — an
/// org-level view — narrowed to the clients the person may see. AI spend is always a sum over the ledger,
/// month to date, never a cached column.
/// </summary>
public sealed class DashboardService(DccDbContext db)
{
    private const string MonthStart = "date_trunc('month', now())";

    private static object Scope(IReadOnlySet<Guid>? allowed) => new { all = allowed is null, ids = (allowed ?? new HashSet<Guid>()).ToArray() };

    private static double Round2(double v) => Math.Round(v * 100, MidpointRounding.AwayFromZero) / 100;
    private static int Pct(double a, double b) => b > 0 ? (int)Math.Round(a / b * 100, MidpointRounding.AwayFromZero) : 0;

    /// <summary>Four stat tiles, the recent top-level requirements, the recent requirements and the person's latest alerts.</summary>
    public async Task<JsonObject> DashboardAsync(Guid userId, IReadOnlySet<Guid>? allowed, CancellationToken ct)
    {
        var a = Scope(allowed);
        const string mine = "(@all or client_id = any(@ids))";
        var stats = (await SqlJson.QuerySingleAsync(db, $"""
            select
              (select count(*) from workitem where parent_id is null and phase not in ('done','archived') and {mine})::int as initiatives,
              (select count(*) from workitem where parent_id is null and created_at >= now() - interval '30 days' and {mine})::int as "initiativesDelta",
              (select count(*) from workitem where phase not in ('done','archived') and {mine})::int as "openItems",
              (select count(*) from workitem where created_at >= now() - interval '30 days' and {mine})::int as "itemsDelta",
              (select count(distinct workitem_id) from blocker where state = 'open' and {mine})::int as "blockedItems",
              (select coalesce(sum(cost_usd), 0) from claude_call where started_at >= {MonthStart} and {mine})::float as spent,
              (select coalesce(sum(monthly_usd), 0) from client_budget where {mine})::float as budget
            """, a, ct))!;
        var spent = stats["spent"]!.GetValue<double>();
        var budget = stats["budget"]!.GetValue<double>();

        var spend = (await SqlJson.QueryAsync(db, $"""
            select workitem_id as "w", coalesce(sum(cost_usd), 0)::float as spent from claude_call
            where workitem_id is not null and started_at >= {MonthStart} and {mine} group by workitem_id
            """, a, ct)).ToDictionary(r => r["w"]!.GetValue<string>(), r => r["spent"]!.GetValue<double>());

        var initiatives = await SqlJson.QueryAsync(db, """
            select w.id, w.title as name, w.type::text as type, w.phase::text as phase, w.priority::text as priority, w.budget_usd::float as "budgetUsd",
                   c.name as "clientName", c.id as "clientId", u.display_name as "ownerName",
                   (select count(*) from workitem k where k.parent_id = w.id)::int as children
            from workitem w join client c on c.id = w.client_id join users u on u.id = w.owner_id
            where w.parent_id is null and (@all or w.client_id = any(@ids))
            order by w.updated_at desc limit 4
            """, a, ct);
        foreach (var i in initiatives) i["aiCostUsd"] = Round2(spend.GetValueOrDefault(i["id"]!.GetValue<string>()));

        var recent = await SqlJson.QueryAsync(db, """
            select w.id, w.key, w.title, w.type::text as type, w.priority::text as priority,
                   (select w2.title from workitem w2 where w2.id = w.parent_id) as "parentTitle",
                   c.name as "clientName", u.display_name as "ownerName", w.updated_at as "updatedAt", w.budget_usd::float as "budgetUsd"
            from workitem w join client c on c.id = w.client_id join users u on u.id = w.owner_id
            where w.phase <> 'archived' and (@all or w.client_id = any(@ids))
            order by w.updated_at desc limit 6
            """, a, ct);
        var recentWorkItems = new JsonArray();
        foreach (var w in recent)
        {
            var used = spend.GetValueOrDefault(w["id"]!.GetValue<string>());
            double? cap = w["budgetUsd"] is JsonValue v && v.TryGetValue<double>(out var c) ? c : null;
            var trend = cap is double k && k > 0 && used > k * 0.8 ? "up" : cap is double k2 && k2 > 0 && used < k2 * 0.3 ? "down" : "flat";
            recentWorkItems.Add(new JsonObject
            {
                ["id"] = w["id"]!.DeepClone(), ["key"] = w["key"]?.DeepClone(), ["title"] = w["title"]!.DeepClone(), ["type"] = w["type"]!.DeepClone(),
                ["priority"] = w["priority"]!.DeepClone(), ["parentTitle"] = w["parentTitle"]?.DeepClone(), ["clientName"] = w["clientName"]!.DeepClone(),
                ["ownerName"] = w["ownerName"]!.DeepClone(), ["updatedAt"] = w["updatedAt"]!.DeepClone(),
                ["aiSpentUsd"] = Round2(used), ["aiBudgetUsd"] = cap, ["trend"] = trend,
            });
        }

        return new JsonObject
        {
            ["stats"] = new JsonObject
            {
                ["initiatives"] = stats["initiatives"]!.DeepClone(), ["initiativesDelta"] = stats["initiativesDelta"]!.DeepClone(),
                ["openItems"] = stats["openItems"]!.DeepClone(), ["itemsDelta"] = stats["itemsDelta"]!.DeepClone(),
                ["blockedItems"] = stats["blockedItems"]!.DeepClone(),
                ["aiCostUsd"] = Round2(spent), ["aiBudgetUsd"] = budget, ["aiBudgetPct"] = Pct(spent, budget),
            },
            ["initiatives"] = new JsonArray(initiatives.Select(x => (JsonNode?)x).ToArray()),
            ["recentWorkItems"] = recentWorkItems,
            ["alerts"] = new JsonArray((await AlertsAsync(userId, allowed, 4, ct)).Select(x => (JsonNode?)x).ToArray()),
        };
    }

    /// <summary>The person's own alerts, newest first.</summary>
    public async Task<List<JsonObject>> AlertsAsync(Guid userId, IReadOnlySet<Guid>? allowed, int limit, CancellationToken ct)
    {
        var cols = await TableColumns.SelectAsync(db, "notification", null, ct);
        return await SqlJson.QueryAsync(db, $"""
            select {cols} from notification where for_user_id = @u and (@all or client_id = any(@ids)) order by created_at desc limit @limit
            """, new { u = userId, all = allowed is null, ids = (allowed ?? new HashSet<Guid>()).ToArray(), limit }, ct);
    }

    /// <summary>Each client's monthly budget and what the ledger says it spent this month.</summary>
    public async Task<List<JsonObject>> BudgetsAsync(IReadOnlySet<Guid>? allowed, CancellationToken ct)
    {
        var rows = await SqlJson.QueryAsync(db, $"""
            select b.client_id as "clientId", c.name as "clientName", b.monthly_usd::float as "monthlyUsd",
                   coalesce((select sum(cc.cost_usd) from claude_call cc where cc.client_id = b.client_id and cc.started_at >= {MonthStart}), 0)::float as spent
            from client_budget b join client c on c.id = b.client_id
            where (@all or b.client_id = any(@ids)) order by c.name
            """, Scope(allowed), ct);
        return rows.Select(r =>
        {
            var monthly = r["monthlyUsd"]!.GetValue<double>();
            var spentUsd = Round2(r["spent"]!.GetValue<double>());
            return new JsonObject
            {
                ["clientId"] = r["clientId"]!.DeepClone(), ["clientName"] = r["clientName"]!.DeepClone(),
                ["monthlyUsd"] = monthly, ["spentUsd"] = spentUsd, ["pct"] = Pct(spentUsd, monthly),
            };
        }).ToList();
    }

    /// <summary>The activity log: every event, newest first, 25 to a page, filtered by who acted, the type and a time range.</summary>
    public async Task<JsonObject> ActivityAsync(string? actorKind, string? type, DateTimeOffset? from, DateTimeOffset? to, int page, CancellationToken ct)
    {
        page = Math.Max(1, page);
        const int pageSize = 25;
        var rows = await SqlJson.QueryAsync(db, """
            select e.id, e.occurred_at as "occurredAt", e.type, e.source::text as source, e.actor, e.payload, e.workitem_id as "workitemId",
                   w.key as "wiKey", w.title as "wiTitle", c.name as "clientName"
            from event_log e left join workitem w on w.id = e.workitem_id left join client c on c.id = e.client_id
            where (@type::text is null or e.type = @type) and (@from::timestamptz is null or e.occurred_at >= @from)
              and (@to::timestamptz is null or e.occurred_at <= @to) and (@actor::text is null or e.actor->>'kind' = @actor)
            order by e.occurred_at desc limit @limit offset @offset
            """, new { type, from = from?.UtcDateTime, to = to?.UtcDateTime, actor = actorKind, limit = pageSize + 1, offset = (page - 1) * pageSize }, ct);
        return new JsonObject
        {
            ["page"] = page, ["hasNext"] = rows.Count > pageSize,
            ["rows"] = new JsonArray(rows.Take(pageSize).Select(x => (JsonNode?)x).ToArray()),
        };
    }

    /// <summary>
    /// The requirement a Claude Code session or a git action belongs to — from the branch name's WI-nnnn convention,
    /// or a key given outright. Null when nothing matches: the caller routes to the unassigned bucket, never guesses.
    /// </summary>
    public static string? KeyFromBranch(string branch) =>
        System.Text.RegularExpressions.Regex.Match(branch, @"(?:^|/)([A-Z]{2,5}-\d+)(?:-|$)") is { Success: true } m ? m.Groups[1].Value : null;

    public Task<JsonObject?> ResolveAsync(ITenantScope tenant, Guid clientId, string? branch, string? key, CancellationToken ct)
    {
        var k = key ?? (branch is not null ? KeyFromBranch(branch) : null);
        if (k is null) return Task.FromResult<JsonObject?>(null);
        return tenant.RunAsync(clientId, d => SqlJson.QuerySingleAsync(d, """
            select id as "workitemId", key, title from workitem where key = @k limit 1
            """, new { k }, ct), ct);
    }
}
