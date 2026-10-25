using System.Globalization;
using System.Text.Json.Nodes;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Policy;

namespace Dcc.Infrastructure.Claude;

/// <summary>A slice of the control centre: a month (the current one when absent) and any of client, person, capability, model, outcome, requirement.</summary>
public sealed record CenterFilter
{
    public string? Month { get; init; }
    public Guid? ClientId { get; init; }
    public Guid? UserId { get; init; }
    public string? Capability { get; init; }
    public string? Model { get; init; }
    public string? Outcome { get; init; }
    /// <summary>Only calls the policy escalated, or a person chose a stronger model for.</summary>
    public bool Escalated { get; init; }
    public Guid? WorkitemId { get; init; }
    public int? Limit { get; init; }
    public int? Offset { get; init; }
    /// <summary>The clients the person may see; null = all.</summary>
    public IReadOnlySet<Guid>? Allowed { get; init; }
}

/// <summary>
/// The control centre's reads (claude-center.ts): every number is a slice of <c>claude_call</c> (and, for the chat,
/// <c>conversation_message</c>) — never a separate count. An org-level view across clients, narrowed to what the
/// person may read.
/// </summary>
public sealed class ClaudeCenter(DccDbContext db, ModelPolicyStore policy)
{
    public const string Escalated = "(c.policy_rule like '%escalated%' or c.policy_rule like '%model overridden%')";
    /// <summary>The screen a conversation's topic belongs to — the same mapping the chat uses.</summary>
    public const string TopicScreen = "case v.topic_kind when 'wi' then 'requirement' when 'task' then 'task' when 'pr' then 'pull_request' when 'run' then 'onboarding' else 'dashboard' end";

    public static (DateTime From, DateTime To, string Month) Period(string? month)
    {
        var now = DateTime.Now;
        var m = month is { Length: 7 } && DateTime.TryParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out _) ? month : now.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        var from = DateTime.ParseExact(m + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture);
        return (DateTime.SpecifyKind(from, DateTimeKind.Local).ToUniversalTime(), DateTime.SpecifyKind(from.AddMonths(1), DateTimeKind.Local).ToUniversalTime(), m);
    }

    private static (string Sql, Dictionary<string, object?> Args) Where(CenterFilter f, (DateTime From, DateTime To, string) p)
    {
        var parts = new List<string> { "c.started_at >= @from and c.started_at < @to" };
        var args = new Dictionary<string, object?> { ["from"] = p.From, ["to"] = p.To };
        if (f.ClientId is { } c) { parts.Add("c.client_id = @client"); args["client"] = c; }
        if (f.Allowed is { } allowed) { parts.Add("c.client_id = any(@allowed)"); args["allowed"] = allowed.ToArray(); }
        if (f.UserId is { } u) { parts.Add("c.user_id = @user"); args["user"] = u; }
        if (f.Capability is { Length: > 0 } cap) { parts.Add("c.capability = @cap"); args["cap"] = cap; }
        if (f.Model is { Length: > 0 } model) { parts.Add("c.model_used = @model"); args["model"] = model; }
        if (f.Outcome is { Length: > 0 } outcome) { parts.Add("c.outcome = @outcome"); args["outcome"] = outcome; }
        if (f.WorkitemId is { } w) { parts.Add("c.workitem_id = @wi"); args["wi"] = w; }
        if (f.Escalated) parts.Add(Escalated);
        return (string.Join(" and ", parts), args);
    }

    private static int Pct(double a, double b) => b > 0 ? (int)Math.Round(a / b * 100, MidpointRounding.AwayFromZero) : 0;

    public async Task<JsonObject> OverviewAsync(CenterFilter f, CancellationToken ct)
    {
        var p = Period(f.Month);
        var (w, args) = Where(f, p);
        var t = (await SqlJson.QuerySingleAsync(db, $"""
            select coalesce(sum(cost_usd),0)::float as usd, count(*)::int as calls,
              coalesce(sum(input_tokens),0)::float as input, coalesce(sum(cache_read_tokens),0)::float as "cacheRead",
              coalesce(sum(cache_write_tokens),0)::float as "cacheWrite", coalesce(sum(output_tokens),0)::float as output,
              count(*) filter (where outcome = 'error')::int as errors, count(*) filter (where outcome = 'timeout')::int as timeouts,
              count(*) filter (where {Escalated})::int as escalated, count(*) filter (where policy_rule like '%overridden by user%')::int as manual,
              count(*) filter (where unanswered)::int as unanswered, count(*) filter (where outcome = 'refused')::int as capped
            from claude_call c where {w}
            """, args, ct))!;
        async Task<JsonArray> Bars(string key, string label, string join = "")
        {
            var rows = await SqlJson.QueryAsync(db, $"""
                select {key} as key, {label} as label, coalesce(sum(c.cost_usd),0)::float as usd, count(*)::int as calls
                from claude_call c {join} where {w} group by {key}, {label} order by usd desc
                """, args, ct);
            return new JsonArray(rows.Select(r => (JsonNode?)new JsonObject
            {
                ["key"] = r["key"]?.ToString() ?? "", ["label"] = r["label"]?.ToString() ?? "", ["usd"] = r["usd"]!.GetValue<double>(), ["calls"] = r["calls"]!.GetValue<int>(),
            }).ToArray());
        }
        var byClient = await Bars("c.client_id::text", "cl.name", "join client cl on cl.id = c.client_id");
        var byCapability = await Bars("c.capability", "c.capability");
        var byModel = await Bars("coalesce(c.model_used, c.model_requested, '?')", "coalesce(c.model_used, c.model_requested, '?')");
        var byScreen = await Bars("coalesce(c.screen, c.entity_kind)", "coalesce(c.screen, c.entity_kind)");
        var byUser = await Bars("c.user_id::text", "u.display_name", "join users u on u.id = c.user_id");
        foreach (var u in byUser.OfType<JsonObject>()) { u["questions"] = 0; u["withoutModelPct"] = 0; u["unhelpfulPct"] = 0; }

        // The chat's own numbers: questions answered, answered with no model, answers that did not help.
        var margs = new Dictionary<string, object?> { ["from"] = p.From, ["to"] = p.To, ["client"] = f.ClientId, ["allowed"] = f.Allowed?.ToArray() };
        const string mw = "m.created_at >= @from and m.created_at < @to and m.role = 'assistant' and (@client::uuid is null or m.client_id = @client) and (@allowed::uuid[] is null or m.client_id = any(@allowed))";
        var chat = (await SqlJson.QuerySingleAsync(db, $"""
            select count(*)::int as answers, count(*) filter (where source = 'system')::int as system,
              count(*) filter (where helpful = false)::int as unhelpful, count(*) filter (where helpful = false and helpful_source = 'reasked')::int as reasked
            from conversation_message m where {mw}
            """, margs, ct))!;
        var chatCalls = (await SqlJson.QuerySingleAsync(db, $"""
            select count(*)::int as n, coalesce(sum(cost_usd),0)::float as usd,
              coalesce(avg(input_tokens + cache_read_tokens + cache_write_tokens), 0)::float as "perTurn"
            from claude_call c where {w} and c.capability = 'chat'
            """, args, ct))!;
        var rollovers = (await SqlJson.QuerySingleAsync(db, $"select count(*)::int as n, coalesce(sum(cost_usd),0)::float as usd from claude_call c where {w} and c.capability = 'conversation_summary'", args, ct))!;
        var archived = await SqlJson.ScalarAsync<int>(db, "select count(*)::int from conversation where status = 'archived' and (@client::uuid is null or client_id = @client) and (@allowed::uuid[] is null or client_id = any(@allowed))", margs, ct);
        var screens = await SqlJson.QueryAsync(db, $"""
            select {TopicScreen} as screen, count(*)::int as answers, count(*) filter (where m.source = 'system')::int as system,
              count(*) filter (where m.helpful = false)::int as unhelpful
            from conversation_message m join conversation v on v.id = m.conversation_id where {mw}
            group by 1 order by answers desc
            """, margs, ct);
        var escalation = await SqlJson.QueryAsync(db, $"""
            select c.capability, count(*)::int as total, count(*) filter (where {Escalated})::int as escalated
            from claude_call c where {w} group by c.capability having count(*) filter (where {Escalated}) > 0 order by 3 desc
            """, args, ct);
        var budget = await SqlJson.ScalarAsync<double>(db, "select coalesce(sum(monthly_usd),0)::float from client_budget where (@client::uuid is null or client_id = @client)", new { client = f.ClientId }, ct);

        double D(JsonObject o, string k) => o[k]!.GetValue<double>();
        int N(JsonObject o, string k) => o[k]!.GetValue<int>();
        var answers = N(chat, "answers");
        var inputAll = D(t, "input") + D(t, "cacheRead") + D(t, "cacheWrite");
        return new JsonObject
        {
            ["month"] = p.Month,
            ["tiles"] = new JsonObject
            {
                ["costUsd"] = D(t, "usd"), ["calls"] = N(t, "calls"), ["budgetPct"] = budget > 0 ? Pct(D(t, "usd"), budget) : null,
                ["questions"] = answers, ["answeredWithoutModel"] = N(chat, "system"), ["answeredWithoutModelPct"] = Pct(N(chat, "system"), answers),
                ["unhelpful"] = N(chat, "unhelpful"), ["unhelpfulPct"] = Pct(N(chat, "unhelpful"), answers), ["reasked"] = N(chat, "reasked"),
                ["errors"] = N(t, "errors"), ["timeouts"] = N(t, "timeouts"), ["escalated"] = N(t, "escalated"), ["unanswered"] = N(t, "unanswered"),
            },
            ["byClient"] = byClient, ["byCapability"] = byCapability, ["byModel"] = byModel, ["byScreen"] = byScreen, ["byUser"] = byUser,
            ["policy"] = new JsonObject
            {
                ["version"] = policy.Version, ["defaults"] = N(t, "calls") - N(t, "escalated"),
                ["escalated"] = Math.Max(0, N(t, "escalated") - N(t, "manual")), ["manual"] = N(t, "manual"), ["capped"] = N(t, "capped"),
            },
            ["tokens"] = new JsonObject
            {
                ["input"] = D(t, "input"), ["cacheRead"] = D(t, "cacheRead"), ["cacheWrite"] = D(t, "cacheWrite"), ["output"] = D(t, "output"), ["cacheSharePct"] = Pct(D(t, "cacheRead"), inputAll),
            },
            ["chat"] = new JsonObject
            {
                ["calls"] = N(chatCalls, "n"), ["costPerQuestionUsd"] = answers > 0 ? D(chatCalls, "usd") / answers : null,
                ["tokensPerTurn"] = N(chatCalls, "n") > 0 ? (int)Math.Round(D(chatCalls, "perTurn")) : null,
                ["rollovers"] = N(rollovers, "n"), ["rolloverCostUsd"] = D(rollovers, "usd"), ["archived"] = archived,
            },
            ["chatByScreen"] = new JsonArray(screens.Select(r => (JsonNode?)new JsonObject
            {
                ["screen"] = r["screen"]!.GetValue<string>(), ["questions"] = N(r, "answers"), ["withoutModel"] = N(r, "system"), ["withoutModelPct"] = Pct(N(r, "system"), N(r, "answers")),
                ["unhelpful"] = N(r, "unhelpful"), ["unhelpfulPct"] = Pct(N(r, "unhelpful"), N(r, "answers")),
            }).ToArray()),
            ["escalationByCapability"] = new JsonArray(escalation.Select(r => (JsonNode?)new JsonObject
            {
                ["capability"] = r["capability"]!.GetValue<string>(), ["escalated"] = N(r, "escalated"), ["total"] = N(r, "total"), ["pct"] = Pct(N(r, "escalated"), N(r, "total")),
            }).ToArray()),
        };
    }

    private const string CallView = """
        select c.id, c.started_at as "startedAt", c.finished_at as "finishedAt", c.duration_ms as "durationMs",
          c.client_id as "clientId", cl.name as "clientName", c.user_id as "userId", u.display_name as "userName",
          c.entity_kind as "entityKind", c.entity_id as "entityId", c.workitem_id as "workitemId", (select title from workitem where id = c.workitem_id) as "workitemTitle",
          c.screen, c.capability, c.trigger, c.label, c.conversation_id as "conversationId", c.message_id as "messageId", c.parent_call_id as "parentCallId",
          c.model_requested as "modelRequested", c.model_used as "modelUsed", c.effort, c.policy_version as "policyVersion", c.policy_rule as "policyRule",
          c.num_turns as "numTurns", c.input_tokens as "inputTokens", c.cache_read_tokens as "cacheReadTokens", c.cache_write_tokens as "cacheWriteTokens",
          c.output_tokens as "outputTokens", c.cost_usd::float as "costUsd", c.price_list_version as "priceListVersion", c.outcome, c.error_text as "errorText",
          c.unanswered, c.source_ref as "sourceRef", c.meta
        from claude_call c join client cl on cl.id = c.client_id join users u on u.id = c.user_id
        """;

    public async Task<JsonObject> CallsAsync(CenterFilter f, CancellationToken ct)
    {
        var p = Period(f.Month);
        var (w, args) = Where(f, p);
        args["limit"] = Math.Clamp(f.Limit ?? 50, 1, 500);
        args["offset"] = Math.Max(f.Offset ?? 0, 0);
        var rows = await SqlJson.QueryAsync(db, $"{CallView} where {w} order by c.started_at desc limit @limit offset @offset", args, ct);
        var total = await SqlJson.ScalarAsync<int>(db, $"select count(*)::int from claude_call c where {w}", args, ct);
        return new JsonObject { ["rows"] = new JsonArray(rows.Select(r => (JsonNode?)r).ToArray()), ["total"] = total, ["month"] = p.Month };
    }

    public Task<JsonObject?> CallAsync(Guid id, CancellationToken ct) => SqlJson.QuerySingleAsync(db, $"{CallView} where c.id = @id", new { id }, ct);

    /// <summary>The calls behind one entity (a requirement, a run, a conversation) — every screen's cost detail.</summary>
    public Task<List<JsonObject>> ForEntityAsync(Guid clientId, Guid? workitemId, (string Kind, string Id)? entity, Guid? conversationId, CancellationToken ct) =>
        SqlJson.QueryAsync(db, $"""
            {CallView} where c.client_id = @c and (@w::uuid is null or c.workitem_id = @w)
              and (@ek::text is null or (c.entity_kind = @ek and c.entity_id = @eid)) and (@conv::uuid is null or c.conversation_id = @conv)
            order by c.started_at desc limit 500
            """, new { c = clientId, w = workitemId, ek = entity?.Kind, eid = entity?.Id, conv = conversationId }, ct);
}
