using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Application.Common;
using Dcc.Domain.Chat;
using Dcc.Domain.Prompts;
using Dcc.Infrastructure.Actions;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Glossary;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Policy;
using Dcc.Infrastructure.Prompts;
using Dcc.Infrastructure.Repos;
using Dcc.Infrastructure.Requirements;
using Dcc.Infrastructure.Tasks;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.Chat;

/// <summary>Bound from <c>Chat</c>.</summary>
public sealed class ChatOptions
{
    public const string Section = "Chat";

    /// <summary>Where each conversation's CLI session and prompt files live.</summary>
    public string Dir { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dcc-chat");
}

/// <summary>A refusal of the chat, in the person's words — answered 409.</summary>
public sealed class ChatRefused(string message) : AppException(409, "chat_refused", message);

public sealed record ResolvedTopic(string Key, string Kind, string? Id, string Title, Guid ClientId, Guid? WorkitemId, string Screen)
{
    public JsonObject Json() => new()
    {
        ["key"] = Key, ["kind"] = Kind, ["id"] = Id, ["title"] = Title, ["clientId"] = ClientId.ToString(), ["workitemId"] = WorkitemId?.ToString(), ["screen"] = Screen,
    };
}

/// <summary>What the screen hands the chat: its name, its facts, its suggestions, the actions it allows, the place on the map.</summary>
public sealed record ScreenContext(string? Screen, JsonObject? Facts, IReadOnlyList<string>? Suggestions, IReadOnlyList<string>? Actions, string? Place);

/// <summary>
/// The one chat (chat/index.ts, claude-in-dcc §4–§7): one conversation per (client, topic, person); step zero answers
/// from the screen's glossary and facts with no model; only what that cannot answer reaches the model — a CLI session
/// per conversation, told only what changed since the last question; a long or cold conversation rolls over into a
/// new one. Every model call is a ledger row.
/// </summary>
public sealed partial class ChatService(
    DccDbContext db, ITenantScope tenant, ClaudeRunner claude, GlossaryService glossary, PromptService prompts, ModelPolicyStore policy,
    InternalClient internalClient, ActionRegistry actions, IServiceProvider services, RepoCheckouts checkouts, TaskStore store, IOptions<ChatOptions> options)
{
    public const string UnansweredMark = "[אין לי את זה במסך]";
    private static readonly ConcurrentDictionary<Guid, byte> Busy = new();

    public string ChatDir(Guid conversationId) => Path.Combine(options.Value.Dir, conversationId.ToString());

    public void DeleteChatSession(Guid conversationId)
    {
        try { if (Directory.Exists(ChatDir(conversationId))) Directory.Delete(ChatDir(conversationId), recursive: true); } catch (IOException) { }
    }

    /// <summary>Write a prompt file only when its text differs — the CLI reads it on every call.</summary>
    public static string EnsureSystemFile(string dir, string name, string text)
    {
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, name);
        string? current = null;
        try { current = File.Exists(file) ? File.ReadAllText(file) : null; } catch (IOException) { }
        if (current != text) File.WriteAllText(file, text, new UTF8Encoding(false));
        return file;
    }

    private static string Hash(string s) => Convert.ToHexStringLower(SHA1.HashData(Encoding.UTF8.GetBytes(s)));

    // ── topics ───────────────────────────────────────────────────────

    public async Task<ResolvedTopic> ResolveAsync(string kind, string? id, ScreenContext ctx, CancellationToken ct)
    {
        switch (kind)
        {
            case "wi":
            case "gaps":
            {
                if (!Guid.TryParse(id, out var wid)) throw new ChatRefused("חסר מזהה דרישה");
                var w = await SqlJson.QuerySingleAsync(db, """select id, key, title, client_id as "clientId" from workitem where id = @id""", new { id = wid }, ct) ?? throw new ChatRefused("הדרישה לא נמצאה");
                var key = w["key"]?.GetValue<string>();
                var title = w["title"]!.GetValue<string>();
                var client = Guid.Parse(w["clientId"]!.GetValue<string>());
                return kind == "wi"
                    ? new ResolvedTopic($"wi:{wid}", "wi", wid.ToString(), $"{(key is not null ? $"{key} · " : "")}{title}", client, wid, ctx.Screen ?? "requirement")
                    : new ResolvedTopic($"gaps:{wid}", "gaps", wid.ToString(), $"הפערים של {title}", client, wid, "requirement");
            }
            case "task":
            {
                if (!Guid.TryParse(id, out var tid)) throw new ChatRefused("חסר מזהה משימה");
                var t = await SqlJson.QuerySingleAsync(db, """select id, seq, intent, client_id as "clientId", workitem_id as "workitemId" from task where id = @id""", new { id = tid }, ct)
                    ?? throw new ChatRefused("המשימה לא נמצאה");
                var intent = t["intent"]!.GetValue<string>();
                return new ResolvedTopic($"task:{tid}", "task", tid.ToString(), $"משימה #{t["seq"]}: {(intent.Length > 60 ? intent[..60] : intent)}",
                    Guid.Parse(t["clientId"]!.GetValue<string>()), Guid.Parse(t["workitemId"]!.GetValue<string>()), ctx.Screen ?? "task");
            }
            case "pr":
            {
                var parts = (id ?? "").Split('/');
                if (parts.Length != 2 || !Guid.TryParse(parts[0], out var repoId) || parts[1].Length == 0) throw new ChatRefused("חסר מזהה בקשת מיזוג");
                var r = await SqlJson.QuerySingleAsync(db, """select id, name, client_id as "clientId" from repo where id = @id""", new { id = repoId }, ct) ?? throw new ChatRefused("המאגר לא נמצא");
                var client = r["clientId"]?.GetValue<string>() is { } c ? Guid.Parse(c) : await internalClient.IdAsync(ct);
                return new ResolvedTopic($"pr:{repoId}/{parts[1]}", "pr", $"{repoId}/{parts[1]}", $"בקשת מיזוג #{parts[1]} · {r["name"]}", client, null, ctx.Screen ?? "pull_request");
            }
            case "run":
            {
                if (!Guid.TryParse(id, out var runId)) throw new ChatRefused("חסר מזהה הרצה");
                var run = await SqlJson.QuerySingleAsync(db, """
                    select r.id, r.client_id as "clientId", p.name as "repoName" from repository_onboarding_run r join repo p on p.id = r.repo_id where r.id = @id
                    """, new { id = runId }, ct) ?? throw new ChatRefused("ההרצה לא נמצאה");
                return new ResolvedTopic($"run:{runId}", "run", runId.ToString(), $"הטמעת {run["repoName"]}", Guid.Parse(run["clientId"]!.GetValue<string>()), null, ctx.Screen ?? "onboarding");
            }
            default:
                return new ResolvedTopic("app", "app", null, "המערכת", await internalClient.IdAsync(ct), null, ctx.Screen ?? "dashboard");
        }
    }

    // ── conversations ────────────────────────────────────────────────

    private async Task<int> RetentionDaysAsync(Guid clientId, CancellationToken ct) =>
        await SqlJson.ScalarAsync<int?>(db, "select chat_retention_days from client where id = @c", new { c = clientId }, ct) ?? policy.Chat().RetentionDays;

    private async Task<JsonObject?> ActiveAsync(Guid clientId, string topicKey, Guid userId, CancellationToken ct) =>
        await tenant.RunAsync(clientId, d => SqlJson.QuerySingleAsync(d, """
            select id, client_id as "clientId", cli_session_id as "cliSessionId", cli_baseline as "cliBaseline", context_hash as "contextHash", last_message_at as "lastMessageAt"
            from conversation where client_id = @c and topic_key = @k and created_by = @u and status = 'active' order by created_at desc limit 1
            """, new { c = clientId, k = topicKey, u = userId }, ct), ct);

    private async Task<JsonObject> CreateAsync(ResolvedTopic t, Guid userId, Guid? continuedFrom, CancellationToken ct)
    {
        var days = await RetentionDaysAsync(t.ClientId, ct);
        await tenant.RunAsync(t.ClientId, d => SqlJson.ExecuteAsync(d, """
            insert into conversation (client_id, topic_key, topic_kind, topic_id, topic_title, created_by, cli_session_id, retain_until, continued_from)
            values (@c, @k, @kind, @id, @title, @u, @session, now() + make_interval(days => @days), @from)
            """, new { c = t.ClientId, k = t.Key, kind = t.Kind, id = t.Id, title = t.Title, u = userId, session = Guid.NewGuid().ToString(), days, from = continuedFrom }, ct), ct);
        return (await ActiveAsync(t.ClientId, t.Key, userId, ct))!;
    }

    private static Guid IdOf(JsonObject c) => Guid.Parse(c["id"]!.GetValue<string>());
    private static Guid ClientOf(JsonObject c) => Guid.Parse(c["clientId"]!.GetValue<string>());
    private static JsonObject BaselineOf(JsonObject c) => c["cliBaseline"] as JsonObject ?? [];

    private Task PatchAsync(JsonObject c, string set, object args, CancellationToken ct) =>
        tenant.RunAsync(ClientOf(c), d => SqlJson.ExecuteAsync(d, $"update conversation set {set} where id = @id", Merge(args, IdOf(c)), ct), ct);

    private static Dictionary<string, object?> Merge(object args, Guid id)
    {
        var o = args.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(args));
        o["id"] = id;
        return o;
    }

    private const string MessageCols = """
        m.id, m.conversation_id as "conversationId", m.role, m.kind, m.text, m.source, m.call_id as "callId", m.payload, m.helpful, m.helpful_source as "helpfulSource", m.created_at as "createdAt",
        c.model_used as "cModelUsed", c.model_requested as "cModelRequested", c.effort as "cEffort", c.input_tokens as "cIn", c.output_tokens as "cOut", c.cache_read_tokens as "cCache", c.cost_usd::float as "cUsd"
        """;

    private async Task<JsonObject> AddMessageAsync(JsonObject c, string role, string kind, string source, string text, JsonObject? payload, Guid? callId, CancellationToken ct)
    {
        var clientId = ClientOf(c);
        var days = await RetentionDaysAsync(clientId, ct);
        return await tenant.RunAsync(clientId, async d =>
        {
            var id = await SqlJson.ScalarAsync<Guid>(d, """
                insert into conversation_message (conversation_id, client_id, role, kind, source, text, payload, call_id) values (@conv, @c, @role, @kind, @src, @text, @p, @call) returning id
                """, new { conv = IdOf(c), c = clientId, role, kind, src = source, text, p = SqlJson.Jsonb(payload ?? []), call = callId }, ct);
            await SqlJson.ExecuteAsync(d, "update conversation set last_message_at = now(), retain_until = now() + make_interval(days => @days) where id = @id", new { id = IdOf(c), days }, ct);
            return (await MessagesWhereAsync(d, "m.id = @mid", new { mid = id }, ct))[0];
        }, ct);
    }

    private async Task<List<JsonObject>> MessagesWhereAsync(DccDbContext d, string where, object args, CancellationToken ct)
    {
        var rows = await SqlJson.QueryAsync(d, $"select {MessageCols} from conversation_message m left join claude_call c on c.id = m.call_id where {where} order by m.created_at", args, ct);
        return rows.Select(ToMessage).ToList();
    }

    public Task<List<JsonObject>> MessagesAsync(Guid clientId, Guid conversationId, CancellationToken ct) =>
        tenant.RunAsync(clientId, d => MessagesWhereAsync(d, "m.conversation_id = @conv", new { conv = conversationId }, ct), ct);

    /// <summary>A message as the dock shows it — a proposal card with its wording as the registry has it now.</summary>
    private JsonObject ToMessage(JsonObject r)
    {
        var payload = r["payload"] as JsonObject ?? [];
        if (r["kind"]?.GetValue<string>() == "proposal" && payload["key"]?.GetValue<string>() is { } key && actions.Get(key) is { } def)
        {
            payload = (JsonObject)payload.DeepClone();
            if (def.ApproveLabel is { } al) payload["approveLabel"] = al;
            if (def.CostNote is { } cn) payload["costNote"] = cn;
        }
        var hasCall = r["callId"] is not null && r["cUsd"] is not null;
        return new JsonObject
        {
            ["id"] = r["id"]?.DeepClone(), ["conversationId"] = r["conversationId"]?.DeepClone(), ["role"] = r["role"]?.DeepClone(), ["kind"] = r["kind"]?.DeepClone(),
            ["text"] = r["text"]?.DeepClone(), ["source"] = r["source"]?.DeepClone(), ["callId"] = r["callId"]?.DeepClone(), ["payload"] = payload.DeepClone(),
            ["helpful"] = r["helpful"]?.DeepClone(), ["helpfulSource"] = r["helpfulSource"]?.DeepClone(), ["createdAt"] = r["createdAt"]?.DeepClone(),
            ["cost"] = hasCall ? new JsonObject
            {
                ["model"] = (r["cModelUsed"] ?? r["cModelRequested"])?.DeepClone(), ["effort"] = r["cEffort"]?.DeepClone(), ["inputTokens"] = r["cIn"]?.DeepClone(),
                ["outputTokens"] = r["cOut"]?.DeepClone(), ["cacheReadTokens"] = r["cCache"]?.DeepClone(), ["costUsd"] = r["cUsd"]?.DeepClone(),
            } : null,
        };
    }

    // ── suggestions: from the screen, never a model ──────────────────

    private List<string> Suggestions(string? screen, ScreenContext ctx, string? kind = null)
    {
        if (kind == "gaps") return [.. GapsPrompt.Suggestions];
        var o = new List<string> { "מה המסך הזה מציג?" };
        o.AddRange(ctx.Suggestions ?? []);
        foreach (var e in (glossary.For(screen)?["entries"] as JsonArray ?? []).OfType<JsonObject>().Where(e => e["kind"]?.GetValue<string>() == "button").Take(2))
            o.Add($"מה \"{e["title"]}\" עושה?");
        return o.Distinct().Take(6).ToList();
    }

    private static JsonArray Arr(IEnumerable<string> xs) => new(xs.Select(x => (JsonNode?)x).ToArray());
    private static JsonArray Arr(IEnumerable<JsonObject> xs) => new(xs.Select(x => (JsonNode?)x).ToArray());

    public async Task<JsonObject> OpenAsync(string kind, string? id, Guid userId, ScreenContext ctx, CancellationToken ct)
    {
        var topic = await ResolveAsync(kind, id, ctx, ct);
        var conv = await ActiveAsync(topic.ClientId, topic.Key, userId, ct);
        return new JsonObject
        {
            ["topic"] = topic.Json(),
            ["conversation"] = conv is not null ? await ViewAsync(IdOf(conv), ct) : null,
            ["messages"] = conv is not null ? Arr(await MessagesAsync(topic.ClientId, IdOf(conv), ct)) : new JsonArray(),
            ["glossary"] = glossary.For(topic.Screen),
            ["suggestions"] = Arr(Suggestions(topic.Screen, ctx, topic.Kind)),
        };
    }

    // ── step zero: the screen answers, no model ──────────────────────

    private sealed record FactTemplate(Regex Re, string[] Keys, Func<JsonNode, string, string> Say);

    private static string ListOf(JsonArray a) => string.Join("\n", a.Select(x => $"- {(x is JsonValue v && v.TryGetValue<string>(out var s) ? s : x?.ToJsonString())}"));

    private static readonly FactTemplate[] Templates =
    [
        new(new Regex("שלב הבא|מה עכשיו|איך ממשיכים|מה חסר|מה צריך לעשות"), ["nextStep", "השלב הבא"], (v, _) => Plain(v)),
        new(new Regex("כמה עלה|כמה עלתה|עלות|כמה הוצאנו|כמה שילמנו"), ["aiCostUsd", "עלות"],
            (v, _) => v is JsonValue n && n.TryGetValue<double>(out var usd) ? $"עלות ה-AI עד עכשיו: ${usd.ToString("0.00", CultureInfo.InvariantCulture)}." : Plain(v)),
        new(new Regex("מי אחראי|מי הבעלים|מי מטפל|של מי"), ["owner", "אחראי"], (v, _) => $"האחראי: {Plain(v)}."),
        new(new Regex("מה הסטטוס|באיזה שלב|מה המצב|איפה זה עומד|מה השלב"), ["status", "phase", "סטטוס", "שלב"], (v, _) => $"המצב: {Plain(v)}."),
        new(new Regex("פערים פתוחים|כמה פערים|אילו פערים|איזה פערים"), ["openGaps", "פערים פתוחים"],
            (v, _) => v is JsonArray a ? (a.Count > 0 ? $"{a.Count} פערים פתוחים:\n{ListOf(a)}" : "אין פערים פתוחים.") : Plain(v)),
        new(new Regex("(אילו|איזה|באילו|באיזה|איפה|מה).{0,20}(קבצים|קובץ|מקומות).{0,25}(מתנגש|התנגשות|התנגשו|קונפליקט)|איפה.{0,12}(התנגשות|קונפליקט)|(קבצים|קובץ).{0,12}(מתנגש|בהתנגשות|בקונפליקט)"),
            ["הקבצים בקונפליקט", "קבצים חשודים בקונפליקט"],
            (v, key) => v is JsonArray a && a.Count > 0
                ? $"{(key.Contains("חשודים") ? "אלה הקבצים ששני הצדדים שינו — הקונפליקט באחד מהם או יותר, ואין ודאות באיזה:" : $"{(a.Count == 1 ? "קובץ אחד בקונפליקט" : $"{a.Count} קבצים בקונפליקט")}:")}\n{ListOf(a)}"
                : Plain(v)),
        new(new Regex("חוסם|חסום"), ["blocker", "חוסם"], (v, _) => IsEmpty(v) ? "אין חוסם פתוח." : $"חוסם פתוח: {Plain(v)}"),
    ];

    private static string Plain(JsonNode v) => v is JsonValue s && s.TryGetValue<string>(out var t) ? t : v is JsonArray a ? string.Join(",", a.Select(x => x?.ToString())) : v.ToJsonString();
    private static bool IsEmpty(JsonNode? v) => v is null || (v is JsonValue s && ((s.TryGetValue<string>(out var t) && t.Length == 0) || (s.TryGetValue<bool>(out var b) && !b)));

    private (string Text, JsonObject Payload)? StepZero(string? screen, JsonObject facts, string question)
    {
        var g = glossary.For(screen);
        if (g is not null && GlossaryMatching.AsksAboutScreen(question)) return (g["about"]!.GetValue<string>(), new JsonObject { ["from"] = "glossary", ["key"] = "about" });
        // A question about the state of THIS record is answered by the screen's facts before a glossary term can catch it.
        foreach (var t in Templates)
        {
            if (!t.Re.IsMatch(question)) continue;
            foreach (var k in t.Keys)
            {
                var v = facts[k];
                if (v is null || (v is JsonValue s && s.TryGetValue<string>(out var str) && str.Length == 0)) continue;
                return (t.Say(v, k), new JsonObject { ["from"] = "facts", ["key"] = k });
            }
        }
        if (glossary.Match(screen, question) is { Certainty: "certain" } m) return (GlossaryMatching.Answer(m), new JsonObject { ["from"] = "glossary", ["key"] = m.Entry["key"]!.GetValue<string>() });
        return null;
    }

    // ── what the model is told ───────────────────────────────────────

    private async Task<(string Text, string Hash)> SystemAsync(CancellationToken ct)
    {
        var text = PromptContract.Render((await prompts.RequireAsync("chat.system", ct)).Body, new Dictionary<string, object?> { ["UNANSWERED_MARK"] = UnansweredMark });
        return (text, Hash(text));
    }

    private static string RenderActions(IReadOnlyList<ActionDef> defs) => defs.Count == 0 ? "" :
        string.Join("\n", new[] { "פעולות שאפשר להציע מהמסך הזה (רק אלה):" }.Concat(defs.Select(d =>
            $"- {d.Key} — \"{d.Title}\"{(d.Params.Count > 0 ? $" · פרמטרים: {string.Join("; ", d.Params.Select(p => $"{p.Name}{(p.Required ? " (חובה)" : "")}: {p.Explain}"))}" : " · בלי פרמטרים")}")));

    private static string RenderFacts(JsonObject facts)
    {
        var lines = new List<string>();
        foreach (var (k, v) in facts)
        {
            if (v is null || (v is JsonValue s && s.TryGetValue<string>(out var str) && str.Length == 0)) continue;
            var val = v switch
            {
                JsonArray a => a.Count > 0 ? string.Concat(a.Select(x => $"\n  - {(x is JsonValue xv && xv.TryGetValue<string>(out var xs) ? xs : x?.ToJsonString())}")) : "(אין)",
                JsonObject o => o.ToJsonString(),
                _ => Plain(v),
            };
            lines.Add($"- {k}: {val}");
        }
        return string.Join("\n", lines);
    }

    private static string RenderGlossary(JsonObject? g) => g is null ? "" :
        string.Join("\n", new[] { $"המסך: {g["about"]}", "מילון המסך:" }.Concat(g["entries"]!.AsArray().OfType<JsonObject>()
            .Select(e => $"- {e["title"]}: {e["explain"]}{(e["press"]?.GetValue<string>() is { Length: > 0 } p ? $" (בלחיצה: {p})" : "")}")));

    // ── the model call ───────────────────────────────────────────────

    private async Task<(ClaudeResult Res, bool Fresh)> CallModelAsync(JsonObject c, ResolvedTopic topic, Guid userId, string system, string next, string full, string question, int? expectedInput, decimal baselineUsd, CancellationToken ct)
    {
        var dir = ChatDir(IdOf(c));
        var sys = EnsureSystemFile(dir, "system.txt", system);
        var b = BaselineOf(c);
        var started = b["started"]?.GetValue<bool>() == true;
        Task<ClaudeResult> Run(Guid sessionId, bool resume, string p) => claude.RunRawAsync(dir, p, new ClaudeCall
        {
            Ledger = new LedgerContext
            {
                ClientId = ClientOf(c), UserId = userId, Capability = "chat", Trigger = "chat", Entity = ("conversation", IdOf(c).ToString()), WorkitemId = topic.WorkitemId,
                Screen = topic.Screen, Label = question.Length > 80 ? question[..80] : question, ConversationId = IdOf(c),
                Baseline = (baselineUsd, 0, 0), ExpectedInputTokens = expectedInput, Unanswered = t => t.Contains(UnansweredMark),
            },
            MaxTurns = 3, TimeoutMs = 120_000, Env = new Dictionary<string, string> { ["MAX_THINKING_TOKENS"] = "0" },
            Lean = new LeanOptions(sys, Session: (sessionId, resume)),
        }, ct);
        var session = Guid.TryParse(c["cliSessionId"]?.GetValue<string>(), out var s) ? s : Guid.NewGuid();
        try
        {
            return (await Run(session, started, started ? next : full), false);
        }
        catch (ClaudeRunException e) when (started && SessionGone().IsMatch(e.Message))
        {
            // The CLI's session file is gone: a new session, told everything again.
            var fresh = Guid.NewGuid();
            b["costUsd"] = 0;
            b["started"] = false;
            await PatchAsync(c, "cli_session_id = @s, cli_baseline = @b", new { s = fresh.ToString(), b = SqlJson.Jsonb(b) }, ct);
            return (await Run(fresh, false, full), true);
        }
    }

    [GeneratedRegex("no conversation|not found|session", RegexOptions.IgnoreCase)] private static partial Regex SessionGone();

    /// <summary>Why this conversation must continue in a new one, or null.</summary>
    private string? RolloverReason(JsonObject c, string systemHash)
    {
        var pol = policy.Chat();
        var b = BaselineOf(c);
        var started = b["started"]?.GetValue<bool>() == true;
        if ((b["lastInputTokens"]?.GetValue<double>() ?? 0) >= pol.RolloverInputTokens) return $"השיחה התארכה מעבר ל-{pol.RolloverInputTokens.ToString("N0", CultureInfo.InvariantCulture)} טוקנים";
        var last = DateTimeOffset.Parse(c["lastMessageAt"]!.GetValue<string>(), CultureInfo.InvariantCulture);
        if (started && DateTimeOffset.UtcNow - last > TimeSpan.FromDays(pol.RolloverColdDays)) return $"שקט של יותר מ-{pol.RolloverColdDays} ימים";
        if (started && b["systemHash"]?.GetValue<string>() != systemHash) return "כללי הצ'אט התעדכנו";
        return null;
    }

    private async Task<JsonObject> RollOverAsync(JsonObject c, ResolvedTopic topic, Guid userId, string why, string system, CancellationToken ct)
    {
        var b = BaselineOf(c);
        var summary = "";
        if (b["started"]?.GetValue<bool>() == true && Guid.TryParse(c["cliSessionId"]?.GetValue<string>(), out var session))
        {
            var dir = ChatDir(IdOf(c));
            var sys = EnsureSystemFile(dir, "system.txt", system);
            try
            {
                var ask = (await prompts.RequireAsync("chat.rollover_summary", ct)).Body;
                var r = await claude.RunRawAsync(dir, ask, new ClaudeCall
                {
                    Ledger = new LedgerContext
                    {
                        ClientId = ClientOf(c), UserId = userId, Capability = "conversation_summary", Trigger = "rollover", Entity = ("conversation", IdOf(c).ToString()),
                        WorkitemId = topic.WorkitemId, Screen = topic.Screen, Label = $"סיכום לגלגול · {why}", ConversationId = IdOf(c),
                        Baseline = ((decimal)(b["costUsd"]?.GetValue<double>() ?? 0), 0, 0),
                    },
                    MaxTurns = 2, TimeoutMs = 90_000, Env = new Dictionary<string, string> { ["MAX_THINKING_TOKENS"] = "0" }, Lean = new LeanOptions(sys, Session: (session, true)),
                }, ct);
                summary = r.Text.Trim();
            }
            catch (Exception e) when (e is ClaudeRunException or AppException) { summary = ""; }
        }
        await PatchAsync(c, "status = 'rolled'", new { }, ct);
        var next = await CreateAsync(topic, userId, IdOf(c), ct);
        await PatchAsync(c, "continues_as = @n", new { n = IdOf(next) }, ct);
        await AddMessageAsync(next, "system", "system_note", "system",
            summary.Length > 0 ? $"השיחה הקודמת התגלגלה להמשך ({why}). סיכום:\n{summary}" : $"השיחה הקודמת התגלגלה להמשך ({why}).",
            new JsonObject { ["from"] = "rollover", ["continuedFrom"] = IdOf(c).ToString() }, null, ct);
        return (await ActiveAsync(topic.ClientId, topic.Key, userId, ct))!;
    }

    // ── ask ──────────────────────────────────────────────────────────

    [GeneratedRegex(@"[?!.,""'״׳()]")] private static partial Regex QPunct();
    [GeneratedRegex(@"\s+")] private static partial Regex QSpace();
    private static string NormQ(string s) => QSpace().Replace(QPunct().Replace(s.ToLowerInvariant(), " "), " ").Trim();

    private static DateTimeOffset At(JsonObject m) => DateTimeOffset.Parse(m["createdAt"]!.GetValue<string>(), CultureInfo.InvariantCulture);

    public async Task<JsonObject> AskAsync(string kind, string? id, Guid userId, string question, ScreenContext ctx, CancellationToken ct)
    {
        question = question.Trim();
        if (question.Length == 0) throw new ChatRefused("כתבו שאלה");
        var topic = await ResolveAsync(kind, id, ctx, ct);
        var conv = await ActiveAsync(topic.ClientId, topic.Key, userId, ct) ?? await CreateAsync(topic, userId, null, ct);
        var convId = IdOf(conv);
        if (!Busy.TryAdd(convId, 0)) throw new ChatRefused("קלוד עדיין עונה על השאלה הקודמת");
        try
        {
            if (topic.Kind == "gaps") return await AskGapsAsync(conv, topic, userId, question, ct);
            var facts = (JsonObject)(ctx.Facts?.DeepClone() ?? new JsonObject());
            var transcriptCursor = BaselineOf(conv)["transcriptCursor"]?.GetValue<int>();
            if (topic.Kind == "run" && topic.Id is { } runId && services.GetService(typeof(IChatRunFacts)) is IChatRunFacts extra)
            {
                var (more, cursor) = await extra.RunFactsAsync(Guid.Parse(runId), transcriptCursor ?? 0, ct);
                foreach (var (k, v) in more) facts[k] = v?.DeepClone();
                transcriptCursor = cursor;
            }

            var previous = await MessagesAsync(topic.ClientId, convId, ct);
            // Asked again right after the chat moved the person for this very question: one hop, not a re-ask.
            var lastGoto = previous.LastOrDefault(m => m["kind"]?.GetValue<string>() == "navigate");
            var justNavigated = lastGoto is not null && NormQ(lastGoto["payload"]?["question"]?.ToString() ?? "") == NormQ(question) && DateTimeOffset.UtcNow - At(lastGoto) < TimeSpan.FromMinutes(2);
            // "Did this help" without a click: the same question again within a minute.
            var lastUser = previous.LastOrDefault(m => m["role"]?.GetValue<string>() == "user");
            var lastAnswer = previous.LastOrDefault(m => m["role"]?.GetValue<string>() == "assistant" && m["kind"]?.GetValue<string>() == "answer");
            if (!justNavigated && lastUser is not null && lastAnswer is not null && NormQ(lastUser["text"]!.GetValue<string>()) == NormQ(question)
                && DateTimeOffset.UtcNow - At(lastUser) < TimeSpan.FromMinutes(1) && lastAnswer["helpful"] is null)
                await tenant.RunAsync(topic.ClientId, d => SqlJson.ExecuteAsync(d, "update conversation_message set helpful = false, helpful_source = 'reasked' where id = @id",
                    new { id = Guid.Parse(lastAnswer["id"]!.GetValue<string>()) }, ct), ct);

            var userMsg = justNavigated ? null : await AddMessageAsync(conv, "user", "answer", "system", question, null, null, ct);
            var asked = userMsg is not null ? new List<JsonObject> { userMsg } : [];

            if (StepZero(topic.Screen, facts, question) is { } zero)
            {
                var a0 = await AddMessageAsync(conv, "assistant", "answer", "system", zero.Text, zero.Payload, null, ct);
                return new JsonObject
                {
                    ["conversation"] = await ViewAsync(convId, ct), ["messages"] = Arr(asked.Append(a0)), ["rolledOver"] = false,
                    ["suggestions"] = Arr(Suggestions(topic.Screen, ctx)),
                };
            }

            var rolledOver = false;
            var system = await SystemAsync(ct);
            if (RolloverReason(conv, system.Hash) is { } why)
            {
                conv = await RollOverAsync(conv, topic, userId, why, system.Text, ct);
                rolledOver = true;
                // the question moves with the person into the continuation
                if (userMsg is not null)
                    await tenant.RunAsync(topic.ClientId, d => SqlJson.ExecuteAsync(d, "update conversation_message set conversation_id = @c where id = @id",
                        new { c = IdOf(conv), id = Guid.Parse(userMsg["id"]!.GetValue<string>()) }, ct), ct);
            }

            var b = BaselineOf(conv);
            var g = glossary.For(topic.Screen);
            var defs = actions.For(topic.Kind, ctx.Actions).ToList();
            var places = justNavigated ? [] : ChatPlaces.For(topic, ctx.Place);
            var contextText = string.Join("\n\n", new[] { RenderGlossary(g), ChatPlaces.Render(places), RenderActions(defs), facts.Count > 0 ? $"העובדות על המסך עכשיו:\n{RenderFacts(facts)}" : "" }.Where(x => x.Length > 0));
            var contextHash = Hash(contextText);
            var opening = new List<string> { $"השיחה על: {topic.Title}." };
            if (rolledOver && (await MessagesAsync(topic.ClientId, IdOf(conv), ct)).FirstOrDefault(m => m["kind"]?.GetValue<string>() == "system_note") is { } note)
                opening.Add(note["text"]!.GetValue<string>());
            var contextPart = contextText.Length > 0 ? $"הקשר המסך:\n{contextText}" : "";
            var ask = $"השאלה: {question}";
            var full = string.Join("\n\n", opening.Append(contextPart).Append(ask).Where(x => x.Length > 0));
            var next = string.Join("\n\n", new[] { contextHash != conv["contextHash"]?.GetValue<string>() ? contextPart : "", ask }.Where(x => x.Length > 0));

            int? lastInput = b["lastInputTokens"] is JsonValue li && li.TryGetValue<double>(out var lid) ? (int)lid : null;
            var (res, fresh) = await CallModelAsync(conv, topic, userId, system.Text, next, full, question, lastInput, (decimal)(b["costUsd"]?.GetValue<double>() ?? 0), ct);
            var unanswered = res.Text.Contains(UnansweredMark);
            var parsed = ChatBlocks.Parse(res.Text.Replace(UnansweredMark, ""));
            // A move is made only to a place that was offered; a key the model invented moves nobody.
            var going = parsed.Goto is { } gt ? places.FirstOrDefault(p => p.Def.Key == gt.Key) : null;
            var stray = parsed.Goto is not null && going is null;
            var text = parsed.Text.Length > 0 ? parsed.Text
                : parsed.Actions.Count > 0 ? "הנה מה שאפשר לעשות:"
                : parsed.NeedsCode is not null ? "על זה אין תשובה במסך — צריך לקרוא בקוד."
                : going is not null ? ""
                : stray ? "אין לי את זה במסך הזה, ולא הצלחתי לעבור למסך שבו זה נמצא." : "(אין תשובה)";
            var a = text.Length > 0
                ? await AddMessageAsync(conv, "assistant", "answer", "model", text, unanswered || stray ? new JsonObject { ["unanswered"] = true } : [], res.CallId, ct)
                : null;

            var cards = new List<JsonObject>();
            if (going is not null)
                cards.Add(await AddMessageAsync(conv, "assistant", "navigate", "model", parsed.Goto!.Value.Reason is { Length: > 0 } reason ? reason : $"עובר אל \"{going.Def.Title}\" כדי לענות.",
                    new JsonObject { ["key"] = going.Def.Key, ["title"] = going.Def.Title, ["route"] = going.Route, ["screen"] = going.Def.Screen, ["question"] = question }, a is null ? res.CallId : null, ct));
            cards.AddRange(await ProposalCardsAsync(conv, topic, userId, parsed.Actions, defs, ct));
            if (parsed.NeedsCode is { } needs)
                cards.Add(await AddMessageAsync(conv, "assistant", "declared_cost", "model", needs, new JsonObject
                {
                    ["reason"] = needs, ["question"] = question, ["askedCallId"] = res.CallId?.ToString(), ["estimate"] = CodeReadEstimate(),
                    ["reads"] = CodeReads(topic.Kind), ["status"] = "proposed",
                }, null, ct));
            // The conversation's size is everything the model read this turn (fresh input plus the cache buckets).
            int? contextSize = res.Meta.InputTokens is null ? lastInput : (res.Meta.InputTokens ?? 0) + (res.Meta.CacheReadTokens ?? 0) + (res.Meta.CacheWriteTokens ?? 0);
            var nb = fresh ? new JsonObject() : (JsonObject)b.DeepClone();
            nb["costUsd"] = res.Meta.CostUsd is { } usd ? (double)usd : fresh ? 0 : b["costUsd"]?.GetValue<double>() ?? 0;
            nb["lastInputTokens"] = contextSize;
            nb["started"] = true;
            nb["systemHash"] = system.Hash;
            nb["transcriptCursor"] = transcriptCursor;
            await PatchAsync(conv, "context_hash = @h, cli_baseline = @b", new { h = contextHash, b = SqlJson.Jsonb(nb) }, ct);
            return new JsonObject
            {
                ["conversation"] = await ViewAsync(IdOf(conv), ct),
                ["messages"] = Arr(asked.Concat(a is not null ? [a] : []).Concat(cards)),
                ["rolledOver"] = rolledOver, ["suggestions"] = Arr(Suggestions(topic.Screen, ctx)),
            };
        }
        finally
        {
            Busy.TryRemove(convId, out _);
        }
    }

    /// <summary>The cards under an answer: each proposal validated against the registry — exists, on this topic, allowed for this person — or a refusal saying why.</summary>
    private async Task<List<JsonObject>> ProposalCardsAsync(JsonObject conv, ResolvedTopic topic, Guid userId, IReadOnlyList<ParsedAction> proposed, IReadOnlyList<ActionDef> defs, CancellationToken ct)
    {
        var cards = new List<JsonObject>();
        foreach (var action in proposed)
        {
            var def = defs.FirstOrDefault(d => d.Key == action.Key);
            // Only the parameters the action declares reach it.
            var p = new JsonObject();
            foreach (var (k, v) in action.Params) if (def is null || def.Params.Any(x => x.Name == k)) p[k] = v?.DeepClone();
            var entity = def is not null ? EntityOf(topic) : null;
            if (def is null || entity is null)
            {
                cards.Add(await AddMessageAsync(conv, "assistant", "refusal", "system", $"לא אפשרי מכאן: הפעולה \"{action.Key}\" לא קיימת במסך הזה.",
                    new JsonObject { ["key"] = action.Key, ["reason"] = $"הפעולה \"{action.Key}\" אינה מהפעולות של המסך הזה. מה שאפשר מכאן: {(defs.Count > 0 ? string.Join(", ", defs.Select(d => d.Title)) : "כלום")}." }, null, ct));
                continue;
            }
            if (await def.RefusalAsync(userId, entity, p, ct) is { } why)
            {
                cards.Add(await AddMessageAsync(conv, "assistant", "refusal", "system", $"לא אפשרי מכאן: {why}", new JsonObject { ["key"] = def.Key, ["reason"] = why }, null, ct));
                continue;
            }
            var estimate = await def.EstimateAsync(p, entity, ct);
            cards.Add(await AddMessageAsync(conv, "assistant", "proposal", "model", def.Title, new JsonObject
            {
                ["key"] = def.Key, ["title"] = def.Title, ["describe"] = await def.DescribeAsync(p, entity, ct), ["params"] = p, ["consequential"] = def.Consequential,
                ["estimate"] = estimate is null ? null : JsonSerializer.SerializeToNode(estimate, TaskFacts.Json), ["status"] = "proposed",
            }, null, ct));
        }
        return cards;
    }

    public static ActionEntity? EntityOf(ResolvedTopic t) => t.Kind switch
    {
        "wi" or "gaps" when t.WorkitemId is { } w => new ActionEntity(t.Kind, w, t.ClientId, w),
        "task" when Guid.TryParse(t.Id, out var id) => new ActionEntity("task", id, t.ClientId, t.WorkitemId),
        // An onboarding run: its actions find the repository from the run themselves.
        "run" when Guid.TryParse(t.Id, out var rid) => new ActionEntity("run", rid, t.ClientId, null),
        _ => null,
    };

    // ── the gaps conversation: a second opinion, read against the code ─

    private async Task<JsonObject> AskGapsAsync(JsonObject conv, ResolvedTopic topic, Guid userId, string question, CancellationToken ct)
    {
        var previous = await MessagesAsync(topic.ClientId, IdOf(conv), ct);
        var userMsg = await AddMessageAsync(conv, "user", "answer", "system", question, null, null, ct);
        var (facts, repoDir) = await GapsContextAsync(topic.ClientId, topic.WorkitemId!.Value, ct);
        var work = ChatDir(IdOf(conv));
        var sys = EnsureSystemFile(work, "gaps-system.txt", (await prompts.RequireAsync("gaps.conversation", ct)).Body);
        var transcript = GapsPrompt.Transcript(previous.Select(m => new TranscriptMessage(m["role"]!.GetValue<string>(), m["kind"]!.GetValue<string>(), m["text"]!.GetValue<string>(), m["payload"] as JsonObject ?? [])).ToList());
        var prompt = string.Join("\n\n", facts, transcript, $"ההודעה החדשה של האדם:\n{question}");
        var res = await claude.RunRawAsync(repoDir ?? work, prompt, new ClaudeCall
        {
            Ledger = new LedgerContext
            {
                ClientId = topic.ClientId, UserId = userId, Capability = "chat_code_read", Trigger = "chat", Entity = ("conversation", IdOf(conv).ToString()),
                WorkitemId = topic.WorkitemId, Screen = topic.Screen, Label = question.Length > 80 ? question[..80] : question, ConversationId = IdOf(conv),
            },
            MaxTurns = repoDir is not null ? 14 : 2, TimeoutMs = 300_000,
            Lean = repoDir is not null ? new LeanOptions(sys, "Read,Grep,Glob", AddDirs: [repoDir]) : new LeanOptions(sys),
        }, ct);
        var parsed = ChatBlocks.Parse(res.Text);
        // The final message may be only the blocks when the model wrote its reply before reading files.
        var text = parsed.Text.Length > 0 ? parsed.Text : ChatBlocks.Parse(res.AssistantText).Text is { Length: > 0 } along ? along : parsed.Actions.Count > 0 ? "הנה מה שאני מציע:" : "(אין תשובה)";
        var a = await AddMessageAsync(conv, "assistant", "answer", "model", text, new JsonObject { ["from"] = repoDir is not null ? "gaps_code" : "gaps" }, res.CallId, ct);
        var cards = await ProposalCardsAsync(conv, topic, userId, parsed.Actions, actions.For("gaps").ToList(), ct);
        return new JsonObject
        {
            ["conversation"] = await ViewAsync(IdOf(conv), ct), ["messages"] = Arr(new[] { userMsg, a }.Concat(cards)), ["rolledOver"] = false, ["suggestions"] = Arr(GapsPrompt.Suggestions),
        };
    }

    /// <summary>What a gaps turn reads, fresh every turn, and where it runs — the repository's own copy when there is one.</summary>
    private async Task<(string Text, string? RepoDir)> GapsContextAsync(Guid clientId, Guid workitemId, CancellationToken ct)
    {
        var ai = (RequirementAiService)services.GetService(typeof(RequirementAiService))!;
        var req = await ai.LoadTextAsync(clientId, workitemId, ct);
        var gaps = await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select id, description, why, impact_if_wrong as "impact", options, who_answers as "who", blocking, state::text as "state", answer from gap where workitem_id = @w order by created_at
            """, new { w = workitemId }, ct), ct);
        var r = await store.FirstRepoAsync(clientId, workitemId, ct);
        var repoDir = r is not null ? checkouts.Existing(r) : null;
        // No local copy yet: answer from the text now, and fetch it in the background so the next turn has the code.
        if (r is not null && repoDir is null) _ = Task.Run(() => checkouts.CheckoutAsync(r));
        var text = GapsPrompt.Context(new GapsContextInput(req.Title, req.RequirementType, r is not null ? (r.Name, repoDir is not null) : null, req.Notes, req.Files,
            gaps.Select(g => new GapLike(g["id"]!.GetValue<string>(), g["description"]!.GetValue<string>(), g["why"]?.GetValue<string>(), g["impact"]?.GetValue<string>(),
                (g["options"] as JsonArray)?.Select(x => x?.ToString() ?? "").ToList() ?? [], g["who"]?.GetValue<string>() ?? "team", g["blocking"]!.GetValue<bool>(),
                g["state"]!.GetValue<string>(), g["answer"]?.GetValue<string>())).ToList(), req.Detail));
        return (text, repoDir);
    }

    // ── "did this help" ──────────────────────────────────────────────

    public async Task<JsonObject> MarkHelpfulAsync(Guid messageId, Guid userId, bool helpful, string? note, CancellationToken ct)
    {
        var m = await SqlJson.QuerySingleAsync(db, """
            select m.client_id as "clientId", v.created_by as "createdBy" from conversation_message m join conversation v on v.id = m.conversation_id where m.id = @id
            """, new { id = messageId }, ct) ?? throw new ChatRefused("ההודעה לא נמצאה");
        if (m["createdBy"]!.GetValue<string>() != userId.ToString()) throw new ChatRefused("רק מי ששאל יכול לסמן");
        await tenant.RunAsync(Guid.Parse(m["clientId"]!.GetValue<string>()), d => SqlJson.ExecuteAsync(d,
            "update conversation_message set helpful = @h, helpful_source = 'person', helpful_note = @n where id = @id", new { id = messageId, h = helpful, n = note }, ct), ct);
        return new JsonObject { ["helpful"] = helpful };
    }

    // ── reads for the control centre ─────────────────────────────────

    private async Task<JsonObject?> ViewAsync(Guid id, CancellationToken ct) => (await ListAsync(id, null, null, null, 1, null, ct)).FirstOrDefault();

    public Task<List<JsonObject>> ListAsync(Guid? id, Guid? clientId, Guid? userId, string? topicKey, int? limit, IReadOnlySet<Guid>? allowed, CancellationToken ct) =>
        SqlJson.QueryAsync(db, """
            select v.id, v.client_id as "clientId", cl.name as "clientName", v.topic_key as "topicKey", v.topic_kind as "topicKind", v.topic_id as "topicId", v.topic_title as "topicTitle",
              v.status, v.continued_from as "continuedFrom", v.continues_as as "continuesAs", v.created_by as "createdBy", u.display_name as "createdByName",
              v.last_message_at as "lastMessageAt", v.created_at as "createdAt", v.retain_until as "retainUntil",
              (select count(*) from conversation_message m where m.conversation_id = v.id)::int as "messageCount",
              coalesce((select sum(cc.cost_usd) from claude_call cc where cc.conversation_id = v.id), 0)::float as "costUsd",
              (select count(*) from claude_call cc where cc.conversation_id = v.id)::int as "calls",
              left((select m.text from conversation_message m where m.conversation_id = v.id and m.role <> 'system' order by m.created_at desc limit 1), 120) as "lastText"
            from conversation v join client cl on cl.id = v.client_id join users u on u.id = v.created_by
            where (@id::uuid is null or v.id = @id) and (@c::uuid is null or v.client_id = @c) and (@u::uuid is null or v.created_by = @u)
              and (@k::text is null or v.topic_key = @k) and (@allowed::uuid[] is null or v.client_id = any(@allowed))
            order by v.last_message_at desc limit @limit
            """, new { id, c = clientId, u = userId, k = topicKey, limit = Math.Min(limit ?? 100, 500), allowed = allowed?.ToArray() }, ct);

    private static readonly Dictionary<string, string> ScreenOfKind = new() { ["wi"] = "requirement", ["gaps"] = "requirement", ["task"] = "task", ["pr"] = "pull_request", ["run"] = "onboarding", ["app"] = "dashboard" };

    public async Task<JsonObject?> GetAsync(Guid id, CancellationToken ct)
    {
        var v = await ViewAsync(id, ct);
        if (v is null) return null;
        var kind = v["topicKind"]!.GetValue<string>();
        var screen = ScreenOfKind.GetValueOrDefault(kind, "dashboard");
        return new JsonObject
        {
            ["conversation"] = v, ["messages"] = Arr(await MessagesAsync(Guid.Parse(v["clientId"]!.GetValue<string>()), id, ct)),
            ["topic"] = new JsonObject { ["kind"] = kind, ["id"] = v["topicId"]?.DeepClone() },
            ["suggestions"] = Arr(Suggestions(screen, new ScreenContext(null, null, null, null, null), kind)), ["glossary"] = glossary.For(screen),
        };
    }

    // ── retention ────────────────────────────────────────────────────

    public const string ArchivedText = "התוכן נמחק לפי תקופת השמירה";

    /// <summary>A conversation past its period loses its text and its CLI session, and stays as a row with its cost. The ledger is never touched.</summary>
    public async Task<JsonObject> ArchiveExpiredAsync(CancellationToken ct)
    {
        var due = await SqlJson.QueryAsync(db, "select id, client_id as \"clientId\" from conversation where status <> 'archived' and retain_until < now()", null, ct);
        var messages = 0;
        foreach (var c in due)
        {
            var id = IdOf(c);
            messages += await tenant.RunAsync(ClientOf(c), async d =>
            {
                var n = await SqlJson.ExecuteAsync(d, "update conversation_message set text = @t, payload = '{}'::jsonb, helpful_note = null where conversation_id = @id", new { id, t = ArchivedText }, ct);
                await SqlJson.ExecuteAsync(d, "update conversation set status = 'archived', context_hash = null, cli_session_id = null, cli_baseline = '{}'::jsonb where id = @id", new { id }, ct);
                return n;
            }, ct);
            DeleteChatSession(id);
        }
        return new JsonObject { ["archived"] = due.Count, ["messages"] = messages };
    }

    // ── the code reading a card declares ─────────────────────────────

    /// <summary>What a reading on this topic will open, said on the card before the person approves it.</summary>
    public static string CodeReads(string topic) => topic switch
    {
        "pr" => "קריאה בלבד: השינוי עצמו — ה-diff של הבקשה והקבצים ששונו כפי שהם אחריו, מהגיט־האוסט",
        "task" => "קריאה בלבד, בעותק המקומי של המאגר, וה-diff של מה שהמשימה עצמה שינתה",
        "run" => "קריאה בלבד, בעותק המבודד של ההרצה: השינויים שנעשו בו מול נקודת ההתחלה, והמאגר עצמו",
        _ => "קריאה בלבד, בעותק המקומי של המאגר",
    };

    private JsonObject CodeReadEstimate()
    {
        var (model, _, effort) = policy.Recommend("chat_code_read");
        return new JsonObject { ["model"] = model, ["effort"] = effort, ["usdMin"] = 0.05, ["usdMax"] = 0.4 };
    }

    // ── cards: run, cancel, preview; the code question ───────────────

    private async Task<(JsonObject M, JsonObject C)> LoadCardAsync(Guid messageId, Guid userId, string kind, CancellationToken ct)
    {
        var m = await SqlJson.QuerySingleAsync(db, """
            select id, conversation_id as "conversationId", client_id as "clientId", kind, text, payload, call_id as "callId" from conversation_message where id = @id
            """, new { id = messageId }, ct);
        if (m is null || m["kind"]?.GetValue<string>() != kind) throw new ChatRefused("ההודעה לא נמצאה");
        var c = await SqlJson.QuerySingleAsync(db, """
            select id, client_id as "clientId", topic_kind as "topicKind", topic_id as "topicId", created_by as "createdBy" from conversation where id = @id
            """, new { id = Guid.Parse(m["conversationId"]!.GetValue<string>()) }, ct) ?? throw new ChatRefused("השיחה לא נמצאה");
        if (c["createdBy"]!.GetValue<string>() != userId.ToString()) throw new ChatRefused("רק מי שקיבל את ההצעה יכול לאשר אותה");
        return (m, c);
    }

    private async Task<JsonObject> SetPayloadAsync(JsonObject m, JsonObject payload, CancellationToken ct)
    {
        var id = Guid.Parse(m["id"]!.GetValue<string>());
        return await tenant.RunAsync(Guid.Parse(m["clientId"]!.GetValue<string>()), async d =>
        {
            await SqlJson.ExecuteAsync(d, "update conversation_message set payload = @p where id = @id", new { id, p = SqlJson.Jsonb(payload) }, ct);
            return (await MessagesWhereAsync(d, "m.id = @mid", new { mid = id }, ct))[0];
        }, ct);
    }

    public async Task<JsonObject> RunProposalAsync(Guid messageId, Guid userId, CancellationToken ct)
    {
        var (m, c) = await LoadCardAsync(messageId, userId, "proposal", ct);
        var p = (JsonObject)m["payload"]!.DeepClone();
        var status = p["status"]?.GetValue<string>();
        if (status != "proposed") throw new ChatRefused(status == "done" ? "ההצעה כבר בוצעה" : status == "cancelled" ? "ההצעה בוטלה" : "ההצעה רצה");
        var topic = await ResolveAsync(c["topicKind"]!.GetValue<string>(), c["topicId"]?.GetValue<string>(), new ScreenContext(null, null, null, null, null), ct);
        var entity = EntityOf(topic) ?? throw new ChatRefused("לפעולה הזו אין על מה לרוץ");
        p["status"] = "running";
        await SetPayloadAsync(m, p, ct);
        try
        {
            var result = await actions.RunAsync(p["key"]!.GetValue<string>(), p["params"] as JsonObject ?? [], entity, userId, "chat", ct);
            p["status"] = "done";
            p["result"] = result?.DeepClone();
            p["ranAt"] = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
            p["recorded"] = "ביומן הדרישה ובמרכז הבקרה, בשמכם";
            return new JsonObject { ["message"] = await SetPayloadAsync(m, p, ct) };
        }
        catch (ActionRefused e)
        {
            p["status"] = "proposed";
            p["error"] = e.Message;
            await SetPayloadAsync(m, p, ct);
            throw new ChatRefused(e.Message);
        }
        catch (Exception e) when (e is AppException or ClaudeRunException)
        {
            p["status"] = "failed";
            p["error"] = e.Message;
            return new JsonObject { ["message"] = await SetPayloadAsync(m, p, ct) };
        }
    }

    public async Task<JsonObject> CancelCardAsync(Guid messageId, Guid userId, string kind, CancellationToken ct)
    {
        var (m, _) = await LoadCardAsync(messageId, userId, kind, ct);
        var p = (JsonObject)m["payload"]!.DeepClone();
        if (p["status"]?.GetValue<string>() != "proposed") throw new ChatRefused(kind == "proposal" ? "ההצעה כבר לא ממתינה" : "השאלה כבר לא ממתינה");
        p["status"] = "cancelled";
        return new JsonObject { ["message"] = await SetPayloadAsync(m, p, ct) };
    }

    public async Task<JsonObject> ProposalPreviewAsync(Guid messageId, Guid userId, CancellationToken ct)
    {
        var (m, c) = await LoadCardAsync(messageId, userId, "proposal", ct);
        var p = m["payload"] as JsonObject ?? [];
        var def = actions.Get(p["key"]?.GetValue<string>() ?? "");
        var topic = await ResolveAsync(c["topicKind"]!.GetValue<string>(), c["topicId"]?.GetValue<string>(), new ScreenContext(null, null, null, null, null), ct);
        var entity = EntityOf(topic) ?? throw new ChatRefused("לפעולה הזו אין על מה לרוץ");
        var preview = def is null ? null : await def.PreviewAsync(p["params"] as JsonObject ?? [], entity, ct);
        return preview is { } pr
            ? new JsonObject { ["prompt"] = pr.Prompt, ["promptHe"] = pr.PromptHe }
            : new JsonObject { ["prompt"] = "(no prompt — this action does not call a model)", ["promptHe"] = "(אין פרומפט — הפעולה הזו לא קוראת למודל)" };
    }

    /// <summary>The expensive question: read the code, after the person said yes — a separate, recorded call on the topic's code.</summary>
    public async Task<JsonObject> RunCodeQuestionAsync(Guid messageId, Guid userId, CancellationToken ct)
    {
        var (m, c) = await LoadCardAsync(messageId, userId, "declared_cost", ct);
        var p = (JsonObject)m["payload"]!.DeepClone();
        if (p["status"]?.GetValue<string>() != "proposed") throw new ChatRefused("השאלה כבר לא ממתינה");
        var topic = await ResolveAsync(c["topicKind"]!.GetValue<string>(), c["topicId"]?.GetValue<string>(), new ScreenContext(null, null, null, null, null), ct);
        var convId = Guid.Parse(c["id"]!.GetValue<string>());
        string? dir;
        var holds = "";
        var systemKey = "chat.code_read.repo";
        var extraDirs = new List<string>();
        if (topic.Kind is "wi" or "task" && topic.WorkitemId is { } wid)
        {
            var r = await store.FirstRepoAsync(topic.ClientId, wid, ct);
            dir = r is not null ? checkouts.Existing(r) : null;
            if (dir is null) throw new ChatRefused(r is not null ? $"אין עותק מקומי של {r.Name} — הריצו קודם בחינת בשלות, שמביאה אותו" : "לדרישה הזו אין מאגר מקושר — אין קוד לקרוא");
            // A task: besides the repository, what the task itself changed — on disk, since the reading tools have no git.
            if (topic.Kind == "task" && Guid.TryParse(topic.Id, out var taskId))
            {
                var code = (TaskCodeService)services.GetService(typeof(TaskCodeService))!;
                if (await code.ChangesForReadingAsync(topic.ClientId, taskId, ct) is { Files.Count: > 0 } t)
                {
                    var changeDir = Path.Combine(ChatDir(convId), "change");
                    Directory.CreateDirectory(changeDir);
                    var diffFile = Path.Combine(changeDir, "task-changes.diff");
                    await File.WriteAllTextAsync(diffFile, t.Diff, ct);
                    extraDirs.Add(changeDir);
                    holds = $"המשימה שינתה {t.Files.Count} קבצים בענף `{t.Branch}`: {string.Join("; ", t.Files.Select(f => $"{f["status"]} {f["path"]} (+{f["additions"]} −{f["deletions"]})"))}.\n"
                        + $"ה-diff שלהם ב-`{diffFile}`{(t.Cut ? " (קוצר — קראו את הקובץ עצמו)" : "")}.";
                }
            }
        }
        else if (((IEnumerable<IChatCodeSource>?)services.GetService(typeof(IEnumerable<IChatCodeSource>)))?.FirstOrDefault(s => s.Kind == topic.Kind) is { } extra)
        {
            // Fetched before the card says "running": when the host refuses, the card stays as it was and the person is told why.
            var place = await extra.CodeForReadingAsync(topic, ChatDir(convId), ct);
            (dir, holds, systemKey) = (place.Dir, place.Holds, place.SystemKey);
            extraDirs.AddRange(place.ExtraDirs);
        }
        else throw new ChatRefused("קריאה בקוד אפשרית רק משיחה על דרישה, על משימה, על בקשת מיזוג או על הטמעת מאגר");

        p["status"] = "running";
        await SetPayloadAsync(m, p, ct);
        var sys = EnsureSystemFile(ChatDir(convId), "code-system.txt", (await prompts.RequireAsync(systemKey, ct)).Body);
        var question = p["question"]?.GetValue<string>() ?? "";
        try
        {
            var res = await claude.RunRawAsync(dir!, string.Join("\n\n", new[] { $"השאלה: {question}", $"מה שצריך לבדוק: {p["reason"]}", holds }.Where(x => x.Length > 0)), new ClaudeCall
            {
                Ledger = new LedgerContext
                {
                    ClientId = topic.ClientId, UserId = userId, Capability = "chat_code_read", Trigger = "chat", Entity = ("conversation", convId.ToString()),
                    WorkitemId = topic.WorkitemId, Screen = topic.Screen, Label = question.Length > 80 ? question[..80] : question, ConversationId = convId,
                    MessageId = messageId, ParentCallId = Guid.TryParse(p["askedCallId"]?.GetValue<string>(), out var pc) ? pc : null,
                },
                MaxTurns = 10, TimeoutMs = 240_000, Env = new Dictionary<string, string> { ["MAX_THINKING_TOKENS"] = "0" },
                Lean = new LeanOptions(sys, "Read,Grep,Glob", AddDirs: [dir!, .. extraDirs]),
            }, ct);
            var convRow = new JsonObject { ["id"] = convId.ToString(), ["clientId"] = topic.ClientId.ToString() };
            var answer = await AddMessageAsync(convRow, "assistant", "answer", "model", res.Text.Trim() is { Length: > 0 } tx ? tx : "(אין תשובה)", new JsonObject { ["from"] = "code" }, res.CallId, ct);
            p["status"] = "done";
            return new JsonObject { ["message"] = await SetPayloadAsync(m, p, ct), ["answer"] = answer };
        }
        catch (Exception e) when (e is ClaudeRunException or AppException)
        {
            p["status"] = "failed";
            p["error"] = e.Message.Length > 300 ? e.Message[..300] : e.Message;
            var message = await SetPayloadAsync(m, p, ct);
            var failed = (JsonObject)message.DeepClone();
            failed["id"] = $"{messageId}-failed";
            failed["role"] = "assistant"; failed["kind"] = "answer"; failed["source"] = "system";
            failed["text"] = $"הקריאה בקוד נכשלה: {(e.Message.Length > 200 ? e.Message[..200] : e.Message)}";
            failed["payload"] = new JsonObject();
            failed["cost"] = null;
            return new JsonObject { ["message"] = message, ["answer"] = failed };
        }
    }
}

/// <summary>What an onboarding run adds to the chat's facts each turn: what happened in the run since the last question (phase 4.7).</summary>
public interface IChatRunFacts
{
    Task<(JsonObject Facts, int Cursor)> RunFactsAsync(Guid runId, int cursor, CancellationToken ct);
}

/// <summary>Where a topic's code is read when a person approves a code reading — one per topic kind ("pr", "run").</summary>
public interface IChatCodeSource
{
    string Kind { get; }

    /// <summary>The folder to read, a sentence on what is in it, the system prompt's key, and further folders the reading may open. A refusal is a <see cref="ChatRefused"/>.</summary>
    Task<(string? Dir, string Holds, string SystemKey, IReadOnlyList<string> ExtraDirs)> CodeForReadingAsync(ResolvedTopic topic, string conversationDir, CancellationToken ct);
}
