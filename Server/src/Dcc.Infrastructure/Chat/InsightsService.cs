using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Glossary;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Policy;
using Dcc.Infrastructure.Prompts;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Dcc.Infrastructure.Chat;

/// <summary>
/// Conclusions (insights.ts, claude-in-dcc §9.3–§9.4): a question that repeats on a screen is a gap in the product,
/// not in Claude. The clustering is SQL and costs nothing; the model is asked, on a click, only to word a finding and
/// a recommendation for the clusters above the threshold — one recorded call. "Open an improvement task" creates a
/// requirement on the internal client. The other lists are slices of the ledger and the conversations.
/// </summary>
public sealed class InsightsService(DccDbContext db, ITenantScope tenant, ClaudeRunner claude, GlossaryService glossary, ModelPolicyStore policy,
    ModelRouter router, PromptService prompts, InternalClient internalClient, IEventLogWriter events, Microsoft.Extensions.Options.IOptions<ChatOptions> chatOptions)
{
    private const string Screen = "case v.topic_kind when 'wi' then 'requirement' when 'task' then 'task' when 'pr' then 'pull_request' when 'run' then 'onboarding' else 'dashboard' end";
    /// <summary>The question with case, punctuation and spacing normalised — the same as the chat's "asked again".</summary>
    private const string Key = """trim(regexp_replace(regexp_replace(lower(m.text), '[?!.,"''״׳()]', ' ', 'g'), '\s+', ' ', 'g'))""";

    private static readonly Dictionary<string, string> ScreenHe = new()
    {
        ["requirement"] = "דרישה", ["task"] = "משימה", ["pull_request"] = "בקשת מיזוג", ["onboarding"] = "הטמעת מאגר", ["dashboard"] = "לוח בקרה", ["claude"] = "מרכז הבקרה של קלוד", ["budgets"] = "תקציבים",
    };

    private JsonObject? ConceptOf(string screen, string question) =>
        glossary.Match(screen, question) is { } m ? new JsonObject { ["key"] = m.Entry["key"]!.DeepClone(), ["title"] = m.Entry["title"]!.DeepClone(), ["explain"] = m.Entry["explain"]!.DeepClone() } : null;

    public async Task<List<JsonObject>> ClustersAsync(string? month, Guid? clientId, IReadOnlySet<Guid>? allowed, CancellationToken ct)
    {
        var p = ClaudeCenter.Period(month);
        var threshold = policy.Chat().InsightsMinRepeats;
        var args = new { from = p.From, to = p.To, c = clientId, allowed = allowed?.ToArray() };
        var rows = await SqlJson.QueryAsync(db, $"""
            select v.client_id as "clientId", cl.name as "clientName", {Screen} as screen, {Key} as key, count(*)::int as count,
              min(m.created_at) as first, max(m.created_at) as last, min(m.text) as sample
            from conversation_message m join conversation v on v.id = m.conversation_id join client cl on cl.id = v.client_id
            where m.role = 'user' and m.created_at >= @from and m.created_at < @to and (@c::uuid is null or v.client_id = @c) and (@allowed::uuid[] is null or v.client_id = any(@allowed))
            group by v.client_id, cl.name, 3, 4 having count(*) >= 2 order by count(*) desc, max(m.created_at) desc limit 200
            """, args, ct);
        var known = await SqlJson.QueryAsync(db, """
            select i.id, i.client_id as "clientId", cl.name as "clientName", i.screen, i.question_key as "questionKey", i.sample_question as "sampleQuestion", i.count,
              i.first_asked_at as "firstAskedAt", i.last_asked_at as "lastAskedAt", i.finding, i.recommendation, i.status, i.workitem_id as "workitemId",
              i.created_at as "createdAt", i.updated_at as "updatedAt"
            from claude_insight i join client cl on cl.id = i.client_id where (@c::uuid is null or i.client_id = @c) and (@allowed::uuid[] is null or i.client_id = any(@allowed))
            """, args, ct);
        string K(string c, string s, string k) => $"{c}|{s}|{k}";
        var byKey = known.ToDictionary(k => K(k["clientId"]!.GetValue<string>(), k["screen"]!.GetValue<string>(), k["questionKey"]!.GetValue<string>()));
        var seen = new HashSet<string>();
        var o = new List<JsonObject>();
        foreach (var r in rows)
        {
            var key = K(r["clientId"]!.GetValue<string>(), r["screen"]!.GetValue<string>(), r["key"]!.GetValue<string>());
            seen.Add(key);
            var k = byKey.GetValueOrDefault(key);
            var count = r["count"]!.GetValue<int>();
            o.Add(new JsonObject
            {
                ["id"] = k?["id"]?.DeepClone(), ["clientId"] = r["clientId"]!.DeepClone(), ["clientName"] = r["clientName"]!.DeepClone(), ["screen"] = r["screen"]!.DeepClone(),
                ["questionKey"] = r["key"]!.DeepClone(), ["sampleQuestion"] = r["sample"]!.DeepClone(), ["count"] = count,
                ["firstAskedAt"] = r["first"]!.DeepClone(), ["lastAskedAt"] = r["last"]!.DeepClone(), ["aboveThreshold"] = count >= threshold,
                ["finding"] = k?["finding"]?.DeepClone(), ["recommendation"] = k?["recommendation"]?.DeepClone(), ["status"] = k?["status"]?.DeepClone() ?? "new",
                ["workitemId"] = k?["workitemId"]?.DeepClone(), ["analysedCount"] = k?["count"]?.DeepClone(), ["analysedAt"] = k?["updatedAt"]?.DeepClone(),
                ["concept"] = ConceptOf(r["screen"]!.GetValue<string>(), r["sample"]!.GetValue<string>()),
            });
        }
        // A conclusion from an earlier month stays visible until it is dealt with.
        foreach (var k in known)
        {
            var key = K(k["clientId"]!.GetValue<string>(), k["screen"]!.GetValue<string>(), k["questionKey"]!.GetValue<string>());
            if (seen.Contains(key) || k["status"]!.GetValue<string>() == "dismissed") continue;
            var count = k["count"]!.GetValue<int>();
            o.Add(new JsonObject
            {
                ["id"] = k["id"]!.DeepClone(), ["clientId"] = k["clientId"]!.DeepClone(), ["clientName"] = k["clientName"]!.DeepClone(), ["screen"] = k["screen"]!.DeepClone(),
                ["questionKey"] = k["questionKey"]!.DeepClone(), ["sampleQuestion"] = k["sampleQuestion"]!.DeepClone(), ["count"] = count,
                ["firstAskedAt"] = (k["firstAskedAt"] ?? k["createdAt"])!.DeepClone(), ["lastAskedAt"] = (k["lastAskedAt"] ?? k["updatedAt"])!.DeepClone(),
                ["aboveThreshold"] = count >= threshold, ["finding"] = k["finding"]?.DeepClone(), ["recommendation"] = k["recommendation"]?.DeepClone(),
                ["status"] = k["status"]!.DeepClone(), ["workitemId"] = k["workitemId"]?.DeepClone(), ["analysedCount"] = count, ["analysedAt"] = k["updatedAt"]!.DeepClone(),
                ["concept"] = ConceptOf(k["screen"]!.GetValue<string>(), k["sampleQuestion"]!.GetValue<string>()),
            });
        }
        return o;
    }

    private Task<List<JsonObject>> CallRowsAsync(string where, object args, CancellationToken ct) =>
        SqlJson.QueryAsync(db, $"""
            select c.id, c.started_at as "startedAt", cl.name as "clientName", u.display_name as "userName", c.screen, c.capability, c.label,
              c.model_used as "modelUsed", c.policy_rule as "policyRule", c.cost_usd::float as "costUsd", c.outcome, c.error_text as "errorText",
              c.conversation_id as "conversationId", c.workitem_id as "workitemId"
            from claude_call c join client cl on cl.id = c.client_id join users u on u.id = c.user_id
            where c.started_at >= @from and c.started_at < @to and (@c::uuid is null or c.client_id = @c) and (@allowed::uuid[] is null or c.client_id = any(@allowed)) and {where}
            order by c.started_at desc limit 50
            """, args, ct);

    public async Task<JsonObject> ViewAsync(string? month, Guid? clientId, IReadOnlySet<Guid>? allowed, CancellationToken ct)
    {
        var p = ClaudeCenter.Period(month);
        var args = new { from = p.From, to = p.To, c = clientId, allowed = allowed?.ToArray() };
        var (model, _, effort) = policy.Recommend("usage_insights");
        var unhelpful = await SqlJson.QueryAsync(db, $"""
            select m.id, m.created_at as "createdAt", cl.name as "clientName", {Screen} as screen,
              (select u.text from conversation_message u where u.conversation_id = m.conversation_id and u.role = 'user' and u.created_at <= m.created_at order by u.created_at desc limit 1) as question,
              left(m.text, 240) as answer, m.helpful_note as note, m.helpful_source as source, m.conversation_id as "conversationId"
            from conversation_message m join conversation v on v.id = m.conversation_id join client cl on cl.id = v.client_id
            where m.helpful = false and m.created_at >= @from and m.created_at < @to and (@c::uuid is null or v.client_id = @c) and (@allowed::uuid[] is null or v.client_id = any(@allowed))
            order by m.created_at desc limit 50
            """, args, ct);
        return new JsonObject
        {
            ["month"] = p.Month, ["threshold"] = policy.Chat().InsightsMinRepeats,
            ["estimate"] = new JsonObject { ["model"] = model, ["effort"] = effort, ["usd"] = router.EstimateUsd(model, 3_000, 1_200) },
            ["clusters"] = Arr(await ClustersAsync(month, clientId, allowed, ct)),
            ["unanswered"] = Arr(await CallRowsAsync("c.unanswered", args, ct)),
            ["unhelpful"] = Arr(unhelpful),
            ["failed"] = Arr(await CallRowsAsync("c.outcome in ('error','timeout','refused')", args, ct)),
            ["escalated"] = Arr(await CallRowsAsync(ClaudeCenter.Escalated, args, ct)),
        };
    }

    private static JsonArray Arr(IEnumerable<JsonObject> xs) => new(xs.Select(x => (JsonNode?)x).ToArray());

    /// <summary>"ניתוח שאלות": one recorded usage_insights call for every cluster above the threshold with no finding yet, or that grew since.</summary>
    public async Task<JsonObject> AnalyseAsync(string? month, Guid? clientId, Guid actor, IReadOnlySet<Guid>? allowed, CancellationToken ct)
    {
        var all = await ClustersAsync(month, clientId, allowed, ct);
        var due = all.Where(c => c["aboveThreshold"]!.GetValue<bool>() && c["status"]!.GetValue<string>() != "dismissed"
            && (c["analysedCount"] is null || c["analysedCount"]!.GetValue<int>() != c["count"]!.GetValue<int>() || c["finding"] is null)).Take(20).ToList();
        if (due.Count == 0) return new JsonObject { ["analysed"] = 0, ["callId"] = null, ["costUsd"] = null, ["clusters"] = Arr(all) };

        var ledgerClient = clientId ?? await internalClient.IdAsync(ct);
        var dir = Path.Combine(chatOptions.Value.Dir, "_insights");
        var sys = ChatService.EnsureSystemFile(dir, "system.txt", (await prompts.RequireAsync("insights.clusters", ct)).Body);
        var items = due.Select((c, i) =>
        {
            var g = glossary.For(c["screen"]!.GetValue<string>());
            return new
            {
                n = i + 1, screen = c["screen"]!.GetValue<string>(), screenIs = g?["about"]?.GetValue<string>() ?? "",
                screenShows = string.Join(", ", (g?["entries"] as JsonArray ?? []).Select(e => e?["title"]?.GetValue<string>())), question = c["sampleQuestion"]!.GetValue<string>(),
                timesAsked = c["count"]!.GetValue<int>(),
            };
        }).ToList();
        var res = await claude.RunRawAsync(dir, JsonSerializer.Serialize(items, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }), new ClaudeCall
        {
            Ledger = new LedgerContext { ClientId = ledgerClient, UserId = actor, Capability = "usage_insights", Trigger = "insights", Screen = "claude", Label = $"ניתוח שאלות · {items.Count} שאלות חוזרות" },
            MaxTurns = 2, TimeoutMs = 180_000, Env = new Dictionary<string, string> { ["MAX_THINKING_TOKENS"] = "0" }, Lean = new LeanOptions(sys),
        }, ct);
        var parsed = ParseArray(res.Text);
        var analysed = 0;
        foreach (var it in items)
        {
            var c = due[it.n - 1];
            var a = parsed.FirstOrDefault(x => x["n"] is JsonValue v && v.TryGetValue<double>(out var n) && (int)n == it.n);
            var finding = a?["finding"]?.GetValue<string>()?.Trim() ?? "";
            if (finding.Length == 0) continue;
            var rec = a?["recommendation"]?.GetValue<string>()?.Trim() is { Length: > 0 } r ? r : null;
            var cid = Guid.Parse(c["clientId"]!.GetValue<string>());
            await tenant.RunAsync(cid, d => c["id"] is { } existing
                ? SqlJson.ExecuteAsync(d, """
                    update claude_insight set count = @n, first_asked_at = @first::timestamptz, last_asked_at = @last::timestamptz, finding = @f, recommendation = @r, analysed_call_id = @call, updated_at = now() where id = @id
                    """, new { id = Guid.Parse(existing.GetValue<string>()), n = c["count"]!.GetValue<int>(), first = c["firstAskedAt"]!.GetValue<string>(), last = c["lastAskedAt"]!.GetValue<string>(), f = finding, r = rec, call = res.CallId }, ct)
                : SqlJson.ExecuteAsync(d, """
                    insert into claude_insight (client_id, screen, question_key, sample_question, count, first_asked_at, last_asked_at, finding, recommendation, analysed_call_id, created_by)
                    values (@c, @s, @k, @q, @n, @first::timestamptz, @last::timestamptz, @f, @r, @call, @by)
                    """, new
                {
                    c = cid, s = c["screen"]!.GetValue<string>(), k = c["questionKey"]!.GetValue<string>(), q = c["sampleQuestion"]!.GetValue<string>(), n = c["count"]!.GetValue<int>(),
                    first = c["firstAskedAt"]!.GetValue<string>(), last = c["lastAskedAt"]!.GetValue<string>(), f = finding, r = rec, call = res.CallId, by = actor,
                }, ct), ct);
            analysed++;
        }
        return new JsonObject
        {
            ["analysed"] = analysed, ["callId"] = res.CallId?.ToString(), ["costUsd"] = res.Meta.CostUsd is { } usd ? (double)usd : null,
            ["clusters"] = Arr(await ClustersAsync(month, clientId, allowed, ct)),
        };
    }

    private static List<JsonObject> ParseArray(string text)
    {
        var m = System.Text.RegularExpressions.Regex.Match(text, @"```(?:json)?\s*([\s\S]*?)```");
        var body = (m.Success ? m.Groups[1].Value : text).Trim();
        var start = body.IndexOf('[');
        var end = body.LastIndexOf(']');
        if (start < 0 || end < start) return [];
        try { return (JsonNode.Parse(body[start..(end + 1)]) as JsonArray)?.OfType<JsonObject>().ToList() ?? []; }
        catch (JsonException) { return []; }
    }

    private async Task<JsonObject> RowAsync(Guid id, CancellationToken ct) =>
        await SqlJson.QuerySingleAsync(db, """
            select id, client_id as "clientId", screen, sample_question as "sampleQuestion", count, finding, recommendation, workitem_id as "workitemId" from claude_insight where id = @id
            """, new { id }, ct) ?? throw new ChatRefused("המסקנה לא נמצאה");

    /// <summary>"פתח משימת שיפור": a requirement on the internal client, carrying the finding and the recommendation as its first note.</summary>
    public async Task<(JsonObject Result, bool Created)> OpenTaskAsync(Guid insightId, Guid actor, CancellationToken ct)
    {
        var row = await RowAsync(insightId, ct);
        if (row["workitemId"]?.GetValue<string>() is { } existing) return (new JsonObject { ["workitemId"] = existing, ["created"] = false }, false);
        if (row["finding"] is null) throw new ChatRefused("קודם מריצים ניתוח — משימה נפתחת מממצא, לא משאלה בלבד");
        var clientId = await internalClient.IdAsync(ct);
        var screen = row["screen"]!.GetValue<string>();
        var screenHe = ScreenHe.GetValueOrDefault(screen, screen);
        var sample = row["sampleQuestion"]!.GetValue<string>();
        var wi = await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<Guid>(d, """
            insert into workitem (client_id, owner_id, title, type, requirement_type, priority, risk, executor)
            values (@c, @o, @t, 'story', 'development', 'medium', 'low', 'human') returning id
            """, new { c = clientId, o = actor, t = $"שיפור מסך {screenHe}: \"{(sample.Length > 70 ? sample[..70] : sample)}\"" }, ct), ct);
        var body = string.Join("\n", new[]
        {
            "משימת שיפור שנפתחה ממרכז הבקרה של קלוד (מסקנות): שאלה שחוזרת היא פער במסך, לא בקלוד.",
            $"מסך: {screenHe}", $"השאלה חזרה {row["count"]} פעמים: \"{sample}\"", $"ממצא: {row["finding"]}",
            row["recommendation"]?.GetValue<string>() is { } r ? $"המלצה: {r}" : "",
        }.Where(x => x.Length > 0));
        await events.AppendAsync(new NewEvent
        {
            ClientId = clientId, WorkitemId = wi, Source = "manual", Type = "note.added", Actor = new UserActor(actor), Payload = JsonSerializer.SerializeToElement(new { body }),
        }, ct);
        await tenant.RunAsync(Guid.Parse(row["clientId"]!.GetValue<string>()), d => SqlJson.ExecuteAsync(d,
            "update claude_insight set status = 'task_opened', workitem_id = @w, updated_at = now() where id = @id", new { id = insightId, w = wi }, ct), ct);
        return (new JsonObject { ["workitemId"] = wi.ToString(), ["created"] = true }, true);
    }

    /// <summary>"לא רלוונטי": still counted, not analysed or listed again.</summary>
    public async Task<JsonObject> DismissAsync(Guid insightId, CancellationToken ct)
    {
        var row = await RowAsync(insightId, ct);
        await tenant.RunAsync(Guid.Parse(row["clientId"]!.GetValue<string>()), d => SqlJson.ExecuteAsync(d,
            "update claude_insight set status = 'dismissed', updated_at = now() where id = @id", new { id = insightId }, ct), ct);
        return new JsonObject { ["status"] = "dismissed" };
    }
}

/// <summary>The daily retention pass — shortly after start, then every day, inside the API process.</summary>
public sealed class ChatRetention(IServiceScopeFactory scopes, ILogger<ChatRetention> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(30), stop); } catch (OperationCanceledException) { return; }
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var r = await scope.ServiceProvider.GetRequiredService<ChatService>().ArchiveExpiredAsync(stop);
                if (r["archived"]!.GetValue<int>() > 0) log.LogInformation("retention: {Archived} conversation(s) archived, {Messages} message(s) blanked", r["archived"], r["messages"]);
            }
            catch (Exception e) when (e is not OperationCanceledException) { log.LogError(e, "retention: the daily pass failed"); }
            try { await Task.Delay(TimeSpan.FromDays(1), stop); } catch (OperationCanceledException) { return; }
        }
    }
}
