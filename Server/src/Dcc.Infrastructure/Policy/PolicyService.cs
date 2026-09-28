using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Policy;

/// <summary>
/// The policy editor's back end — the one place the routing policy changes.
/// A change is validated, merged over the current file, written back with a
/// bumped version, and recorded as a <c>policy.changed</c> event in the
/// person's name, so the version on every ledger row can be tied to who changed
/// what. A client's own retention period is the same kind of change, recorded
/// on that client.
/// </summary>
public sealed class PolicyService(DccDbContext db, ModelPolicyStore store, IEventLogWriter events, InternalClient internalClient)
{
    public static AppException Refused(string message) => AppException.Conflict("policy_refused", message);

    public async Task<JsonObject> ViewAsync(CancellationToken ct)
    {
        var ev = await SqlJson.QuerySingleAsync(db, """
            select occurred_at as "at", actor, payload from event_log where type = 'policy.changed' order by occurred_at desc limit 1
            """, null, ct);
        JsonNode? lastChange = null;
        if (ev is not null)
        {
            var userId = ev["actor"]?["userId"]?.GetValue<string>();
            var name = userId is null ? null : await SqlJson.ScalarAsync<string>(db, "select display_name from users where id = @id", new { id = Guid.Parse(userId) }, ct);
            var p = ev["payload"]!;
            lastChange = new JsonObject
            {
                ["at"] = ev["at"]!.GetValue<string>(), ["byName"] = name,
                ["fromVersion"] = p["fromVersion"]?.DeepClone(), ["toVersion"] = p["toVersion"]?.DeepClone(),
                ["changes"] = p["changes"]?.DeepClone() ?? new JsonArray(),
            };
        }
        var clients = await SqlJson.QueryAsync(db, """
            select id as "clientId", name as "clientName", chat_retention_days as "days" from client where archived_at is null order by name
            """, null, ct);
        return new JsonObject
        {
            ["policy"] = store.Load(),
            ["lastChange"] = lastChange,
            ["retention"] = new JsonObject { ["defaultDays"] = store.ChatRetentionDays, ["clients"] = new JsonArray(clients.Select(c => (JsonNode?)c).ToArray()) },
        };
    }

    /// <summary>The editor's save: validate, merge, bump the version, record who changed what.</summary>
    public async Task<JsonObject> UpdateAsync(JsonElement raw, Guid userId, CancellationToken ct)
    {
        var patch = PolicyPatch.Validate(raw);
        var current = store.Load();

        // A capability nothing calls is a statement, not a policy — the editor changes values, never the list.
        foreach (var (key, _) in patch["capabilities"] as JsonObject ?? [])
            if (current["capabilities"]?[key] is null) throw Refused($"אין יכולת בשם \"{key}\" — אפשר לשנות ערכים של יכולות קיימות בלבד");
        foreach (var (key, t) in patch["tiers"] as JsonObject ?? [])
        {
            var model = t?["model"]?.GetValue<string>();
            if (model is not null && current["prices"]?[model] is null && patch["prices"]?[model] is null)
                throw Refused($"למודל \"{model}\" אין מחיר בטבלת המחירים — הוסיפו אותו קודם ({key})");
        }

        var changes = new JsonArray();
        Diff("", current, patch, changes);
        if (changes.Count == 0) return new JsonObject { ["policy"] = current, ["changes"] = changes };

        var saved = store.Save(Merge(current, patch));
        await events.AppendAsync(new NewEvent
        {
            ClientId = await internalClient.IdAsync(ct), Source = "manual", Type = "policy.changed", Actor = new UserActor(userId),
            Payload = JsonSerializer.SerializeToElement(new JsonObject
            {
                ["fromVersion"] = current["version"]?.GetValue<int>() ?? 0, ["toVersion"] = saved["version"]!.GetValue<int>(), ["changes"] = changes.DeepClone(),
            }),
        }, ct);
        return new JsonObject { ["policy"] = saved, ["changes"] = changes };
    }

    /// <summary>A client's own chat retention period — null returns it to the policy's default. Recorded on that client.</summary>
    public async Task<JsonObject> SetClientRetentionAsync(Guid clientId, int? days, Guid userId, CancellationToken ct)
    {
        if (days is < 1 or > 3650) throw Refused("תקופת השמירה היא מספר ימים שלם בין 1 ל-3650");
        var row = await SqlJson.QuerySingleAsync(db, "select chat_retention_days as \"days\" from client where id = @id", new { id = clientId }, ct)
                  ?? throw Refused("הלקוח לא נמצא");
        var before = row["days"]?.GetValue<int>();
        if (before == days) return new JsonObject { ["clientId"] = clientId.ToString(), ["days"] = days };

        await SqlJson.ExecuteAsync(db, "update client set chat_retention_days = @d where id = @id", new { d = days, id = clientId }, ct);
        var version = store.Version;
        await events.AppendAsync(new NewEvent
        {
            ClientId = clientId, Source = "manual", Type = "policy.changed", Actor = new UserActor(userId),
            Payload = JsonSerializer.SerializeToElement(new JsonObject
            {
                ["fromVersion"] = version, ["toVersion"] = version,
                ["changes"] = new JsonArray(new JsonObject { ["path"] = "chatRetentionDays", ["from"] = before, ["to"] = days }),
            }),
        }, ct);
        return new JsonObject { ["clientId"] = clientId.ToString(), ["days"] = days };
    }

    /// <summary>Deep-merges a patch over the current values; null removes an optional value (a cap, an input limit).</summary>
    private static JsonObject Merge(JsonObject cur, JsonObject patch)
    {
        var output = (JsonObject)cur.DeepClone();
        foreach (var (k, v) in patch)
        {
            if (v is null) { output.Remove(k); continue; }
            output[k] = v is JsonObject po && cur[k] is JsonObject co ? Merge(co, po) : v.DeepClone();
        }
        return output;
    }

    private static void Diff(string path, JsonNode? from, JsonNode? to, JsonArray output)
    {
        if (to is JsonObject toObj && from is JsonObject or null)
        {
            foreach (var (k, v) in toObj) Diff(path.Length > 0 ? $"{path}.{k}" : k, (from as JsonObject)?[k], v, output);
            return;
        }
        if (JsonNode.DeepEquals(from, to)) return;
        var change = new JsonObject { ["path"] = path };
        if (from is not null) change["from"] = from.DeepClone();
        if (to is not null) change["to"] = to.DeepClone();
        output.Add(change);
    }
}

/// <summary>
/// The organisation's own client ("DCC Internal"), where events about the system
/// itself — a policy change — are recorded: by name, else the client in <c>.dcc.json</c>,
/// else the oldest live client.
/// </summary>
public sealed class InternalClient(DccDbContext db, Microsoft.Extensions.Hosting.IHostEnvironment env)
{
    private static Guid? _cached;

    public async Task<Guid> IdAsync(CancellationToken ct)
    {
        if (_cached is { } c) return c;
        var byName = await SqlJson.ScalarAsync<Guid?>(db, "select id from client where name = 'DCC Internal' and archived_at is null limit 1", null, ct);
        if (byName is { } n) return (_cached = n).Value;
        try
        {
            var cfg = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(env.ContentRootPath, "..", "..", "..", ".dcc.json"), ct));
            if (Guid.TryParse(cfg?["clientId"]?.GetValue<string>(), out var fromFile) &&
                await SqlJson.ScalarAsync<Guid?>(db, "select id from client where id = @id", new { id = fromFile }, ct) is { } exists)
                return (_cached = exists).Value;
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException) { }
        var any = await SqlJson.ScalarAsync<Guid?>(db, "select id from client where archived_at is null order by created_at limit 1", null, ct)
                  ?? throw AppException.Conflict("no_client", "אין לקוח במערכת — השינוי צריך לקוח פנימי שיירשם עליו");
        return (_cached = any).Value;
    }
}

/// <summary>What the policy editor may send: any subset of the editable values. Unknown keys are dropped.</summary>
public static class PolicyPatch
{
    private static readonly string[] Tiers = ["haiku", "sonnet", "opus"];
    private static readonly string[] Efforts = ["low", "medium", "high", "xhigh", "max"];

    public static JsonObject Validate(JsonElement raw)
    {
        var problems = new List<string>();
        var output = new JsonObject();
        if (raw.ValueKind != JsonValueKind.Object) throw PolicyService.Refused("הערכים לא תקינים: הגוף צריך להיות אובייקט");

        if (Obj(raw, "tiers", "tiers", problems) is { } tiers)
        {
            var o = new JsonObject();
            foreach (var t in tiers.EnumerateObject())
            {
                if (!Tiers.Contains(t.Name)) { problems.Add($"tiers.{t.Name} — tier לא מוכר"); continue; }
                if (t.Value.ValueKind != JsonValueKind.Object) { problems.Add($"tiers.{t.Name} — צריך אובייקט"); continue; }
                var e = new JsonObject();
                Str(t.Value, "model", $"tiers.{t.Name}.model", e, problems);
                Num(t.Value, "maxUsdPerCall", $"tiers.{t.Name}.maxUsdPerCall", e, problems, positive: true);
                o[t.Name] = e;
            }
            output["tiers"] = o;
        }
        if (Obj(raw, "prices", "prices", problems) is { } prices)
        {
            var o = new JsonObject();
            foreach (var p in prices.EnumerateObject())
            {
                if (p.Name.Length == 0 || p.Value.ValueKind != JsonValueKind.Object) { problems.Add($"prices.{p.Name} — צריך אובייקט"); continue; }
                var e = new JsonObject();
                foreach (var f in new[] { "input", "cacheWrite", "cacheRead", "output" })
                    if (!Num(p.Value, f, $"prices.{p.Name}.{f}", e, problems, nonNegative: true, required: true)) { }
                o[p.Name] = e;
            }
            output["prices"] = o;
        }
        if (Obj(raw, "capabilities", "capabilities", problems) is { } caps)
        {
            var o = new JsonObject();
            foreach (var c in caps.EnumerateObject())
            {
                if (c.Value.ValueKind != JsonValueKind.Object) { problems.Add($"capabilities.{c.Name} — צריך אובייקט"); continue; }
                var e = new JsonObject();
                Enum(c.Value, "default", Tiers, $"capabilities.{c.Name}.default", e, problems);
                Enum(c.Value, "effort", Efforts, $"capabilities.{c.Name}.effort", e, problems);
                Num(c.Value, "maxUsdPerCall", $"capabilities.{c.Name}.maxUsdPerCall", e, problems, positive: true, nullable: true);
                Num(c.Value, "maxInputTokens", $"capabilities.{c.Name}.maxInputTokens", e, problems, positive: true, integer: true, nullable: true);
                foreach (var rule in new[] { "escalateOn", "downgradeOn" })
                    if (c.Value.TryGetProperty(rule, out var r))
                    {
                        if (r.ValueKind != JsonValueKind.Array || r.EnumerateArray().Any(x => x.ValueKind != JsonValueKind.Object)) problems.Add($"capabilities.{c.Name}.{rule} — צריך רשימה של אובייקטים");
                        else e[rule] = JsonNode.Parse(r.GetRawText());
                    }
                o[c.Name] = e;
            }
            output["capabilities"] = o;
        }
        if (Obj(raw, "chat", "chat", problems) is { } chat)
        {
            var e = new JsonObject();
            Num(chat, "rolloverInputTokens", "chat.rolloverInputTokens", e, problems, integer: true, min: 2_000, max: 180_000);
            Num(chat, "rolloverColdDays", "chat.rolloverColdDays", e, problems, integer: true, min: 1, max: 365);
            Num(chat, "retentionDays", "chat.retentionDays", e, problems, integer: true, min: 1, max: 3650);
            Num(chat, "declareCostAboveUsd", "chat.declareCostAboveUsd", e, problems, nonNegative: true);
            Num(chat, "insightsMinRepeats", "chat.insightsMinRepeats", e, problems, integer: true, min: 2, max: 100);
            output["chat"] = e;
        }
        if (Obj(raw, "guardrails", "guardrails", problems) is { } g)
        {
            var e = new JsonObject();
            Num(g, "killAfterStuckIterations", "guardrails.killAfterStuckIterations", e, problems, integer: true, min: 1);
            Num(g, "budgetWarnAtFraction", "guardrails.budgetWarnAtFraction", e, problems, min: 0, max: 1);
            output["guardrails"] = e;
        }

        if (problems.Count > 0) throw PolicyService.Refused("הערכים לא תקינים: " + string.Join("; ", problems));
        return output;
    }

    private static JsonElement? Obj(JsonElement src, string name, string path, List<string> problems)
    {
        if (!src.TryGetProperty(name, out var v)) return null;
        if (v.ValueKind != JsonValueKind.Object) { problems.Add($"{path} — צריך אובייקט"); return null; }
        return v;
    }

    private static void Str(JsonElement src, string name, string path, JsonObject into, List<string> problems)
    {
        if (!src.TryGetProperty(name, out var v)) return;
        if (v.ValueKind != JsonValueKind.String || v.GetString()!.Length == 0) problems.Add($"{path} — צריך טקסט לא ריק");
        else into[name] = v.GetString();
    }

    private static void Enum(JsonElement src, string name, string[] values, string path, JsonObject into, List<string> problems)
    {
        if (!src.TryGetProperty(name, out var v)) return;
        if (v.ValueKind != JsonValueKind.String || !values.Contains(v.GetString())) problems.Add($"{path} — אחד מ: {string.Join(", ", values)}");
        else into[name] = v.GetString();
    }

    private static bool Num(JsonElement src, string name, string path, JsonObject into, List<string> problems,
        bool positive = false, bool nonNegative = false, bool integer = false, bool nullable = false, bool required = false, double? min = null, double? max = null)
    {
        if (!src.TryGetProperty(name, out var v))
        {
            if (required) problems.Add($"{path} — חובה");
            return !required;
        }
        if (v.ValueKind == JsonValueKind.Null && nullable) { into[name] = null; return true; }
        if (v.ValueKind != JsonValueKind.Number) { problems.Add($"{path} — צריך מספר"); return false; }
        var n = v.GetDouble();
        if (integer && n != Math.Floor(n)) { problems.Add($"{path} — צריך מספר שלם"); return false; }
        if (positive && n <= 0) { problems.Add($"{path} — צריך מספר חיובי"); return false; }
        if (nonNegative && n < 0) { problems.Add($"{path} — לא יכול להיות שלילי"); return false; }
        if (min is { } lo && n < lo) { problems.Add($"{path} — לפחות {lo}"); return false; }
        if (max is { } hi && n > hi) { problems.Add($"{path} — לכל היותר {hi}"); return false; }
        into[name] = JsonNode.Parse(v.GetRawText());
        return true;
    }
}
