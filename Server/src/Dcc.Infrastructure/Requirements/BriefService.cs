using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Requirements;

/// <summary>
/// A WorkItem's Context Brief (architecture §10): what the SessionStart hook
/// prints, so the next Claude Code session starts from the flow, not from zero.
/// ASSEMBLED from structured state — open gaps, blockers, decisions, tasks, the
/// recent timeline — never summarised by a model (claude-in-dcc §6.1), and
/// regenerated on every new event.
/// </summary>
public sealed class BriefService(ITenantScope tenant)
{
    /// <summary>The brief's text; built on the spot when there is none yet. "" for a missing WorkItem.</summary>
    public async Task<string> BriefForAsync(Guid clientId, Guid workitemId, CancellationToken ct)
    {
        var body = await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<string>(d, "select body from context_brief where workitem_id = @w", new { w = workitemId }, ct), ct);
        if (!string.IsNullOrEmpty(body)) return body;
        await RegenerateAsync(clientId, workitemId, ct);
        return await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<string>(d, "select body from context_brief where workitem_id = @w", new { w = workitemId }, ct), ct) ?? "";
    }

    public Task RegenerateAsync(Guid clientId, Guid workitemId, CancellationToken ct) =>
        tenant.RunAsync(clientId, async d =>
        {
            var args = new { w = workitemId };
            var wi = await SqlJson.QuerySingleAsync(d, """
                select key, title, phase::text as "phase", type::text as "type", linked_ado_id as "linkedAdoId",
                       started_with_open_blocker as "startedWithOpenBlocker"
                from workitem where id = @w
                """, args, ct);
            if (wi is null) return 0;
            var gaps = await SqlJson.QueryAsync(d, """
                select description, blocking, state::text = 'verified' as "verified", confidence::float as "confidence"
                from gap where workitem_id = @w and state in ('proposed', 'verified') order by blocking desc, created_at
                """, args, ct);
            var open = await SqlJson.QueryAsync(d, "select question_type as \"questionType\", question from blocker where workitem_id = @w and state = 'open'", args, ct);
            var answered = await SqlJson.QueryAsync(d, """
                select question, coalesce(answer, '') as "answer" from blocker where workitem_id = @w and state = 'answered'
                order by answered_at desc limit 5
                """, args, ct);
            var tasks = await SqlJson.QueryAsync(d, "select seq, intent, state::text as \"state\" from task where workitem_id = @w order by seq", args, ct);
            var review = await SqlJson.QuerySingleAsync(d, "select verdict, findings from review where workitem_id = @w order by created_at desc limit 1", args, ct);
            var recent = await SqlJson.QueryAsync(d, """
                select occurred_at as "occurredAt", source::text as "source", type, payload
                from event_log where workitem_id = @w and supersedes is null order by occurred_at desc limit 15
                """, args, ct);
            recent.Reverse();

            var text = Render(wi, gaps, open, answered, tasks, review, recent);
            var lastEvent = await SqlJson.ScalarAsync<Guid?>(d, "select id from event_log where workitem_id = @w order by recorded_at desc limit 1", args, ct);
            await SqlJson.ExecuteAsync(d, """
                insert into context_brief (workitem_id, client_id, body, current_as_of_event, model_used, updated_at)
                values (@w, @c, @body, @last, 'assembled/v0', now())
                on conflict (workitem_id) do update set body = excluded.body, current_as_of_event = excluded.current_as_of_event,
                  model_used = excluded.model_used, updated_at = now()
                """, new { w = workitemId, c = clientId, body = text, last = lastEvent }, ct);
            return 0;
        }, ct);

    /// <summary>The brief as Markdown — compact by design: a few thousand tokens, not the whole timeline.</summary>
    public static string Render(JsonObject wi, List<JsonObject> gaps, List<JsonObject> openBlockers, List<JsonObject> answered,
        List<JsonObject> tasks, JsonObject? review, List<JsonObject> recent)
    {
        var o = new List<string>();
        var key = wi["key"]?.GetValue<string>() ?? "(no key)";
        o.Add($"# {key} — {wi["title"]!.GetValue<string>()}");
        o.Add("");
        var ado = wi["linkedAdoId"]?.GetValue<int>();
        o.Add($"**Phase:** {wi["phase"]} · **Type:** {wi["type"]}" + (ado is { } a && a != 0 ? $" · **ADO:** #{a}" : " · **ADO:** not linked"));
        if (wi["startedWithOpenBlocker"]?.GetValue<bool>() == true)
        {
            o.Add("");
            o.Add("> ⚠️ Work started while a blocker was still open — proceed with that in mind.");
        }

        o.Add("");
        o.Add("## Open gaps");
        if (gaps.Count == 0) o.Add("_None._");
        foreach (var g in gaps.Where(g => g["blocking"]!.GetValue<bool>()))
            o.Add($"- **BLOCKING** — {g["description"]}  _(confidence {Fixed2(g)}{(g["verified"]!.GetValue<bool>() ? ", verified" : ", not yet verified")})_");
        foreach (var g in gaps.Where(g => !g["blocking"]!.GetValue<bool>()))
            o.Add($"- {g["description"]}  _(non-blocking, confidence {Fixed2(g)}{(g["verified"]!.GetValue<bool>() ? ", verified" : ", not yet verified")})_");

        if (openBlockers.Count > 0)
        {
            o.Add("");
            o.Add("## Active blockers");
            foreach (var b in openBlockers) o.Add($"- [{b["questionType"]}] {b["question"]}");
        }
        if (answered.Count > 0)
        {
            o.Add("");
            o.Add("## Decisions on record");
            foreach (var b in answered)
            {
                o.Add($"- **Q:** {b["question"]}");
                o.Add($"  **A:** {b["answer"]}");
            }
        }
        if (review is not null && review["verdict"]?.GetValue<string>() == "changes_requested")
        {
            o.Add("");
            o.Add("## Review — changes requested");
            foreach (var f in review["findings"] as JsonArray ?? [])
            {
                var sev = f?["severity"]?.GetValue<string>() ?? "";
                o.Add($"- {(sev == "block" ? "**BLOCK**" : sev)} · `{f?["file"]}` — {f?["note"]}");
            }
        }
        if (tasks.Count > 0)
        {
            var mark = new Dictionary<string, string> { ["done"] = "[x]", ["in_progress"] = "[~]", ["blocked"] = "[!]", ["pending"] = "[ ]", ["dropped"] = "[-]" };
            var done = tasks.Count(t => t["state"]!.GetValue<string>() == "done");
            o.Add("");
            o.Add($"## Tasks — {done}/{tasks.Count} done");
            foreach (var t in tasks) o.Add($"- {mark.GetValueOrDefault(t["state"]!.GetValue<string>(), "[ ]")} {t["intent"]}");
        }

        o.Add("");
        o.Add("## Recent timeline");
        foreach (var e in recent)
        {
            var p = e["payload"] as JsonObject ?? [];
            var gist = Gist(p) ?? e["type"]!.GetValue<string>();
            if (gist.Length > 200) gist = gist[..200];
            var at = DateTime.Parse(e["occurredAt"]!.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
            o.Add($"- `{at:yyyy-MM-dd HH:mm}` **{e["source"]}** {e["type"]} — {gist}");
        }
        o.Add("");
        o.Add("---");
        o.Add("_Load the full timeline or the code only when this brief does not cover what you need._");
        return string.Join("\n", o);
    }

    /// <summary>The same first-non-empty choice of words the old renderer made.</summary>
    private static string? Gist(JsonObject p)
    {
        string? S(string k) => p[k] is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 ? s : null;
        bool Truthy(string k) => p[k] switch { null => false, JsonValue v when v.TryGetValue<string>(out var s) => s.Length > 0, JsonValue v when v.TryGetValue<double>(out var n) => n != 0, JsonValue v when v.TryGetValue<bool>(out var b) => b, _ => true };
        string Str(string k) => p[k] is JsonValue v ? (v.TryGetValue<string>(out var s) ? s : v.ToJsonString()) : p[k]?.ToJsonString() ?? "";

        var gist = S("summary") ?? S("body") ?? S("answer") ?? S("description") ?? S("question");
        if (gist is not null) return gist;
        if (Truthy("callId")) return $"{Str("capability")}: {(p["label"] is null ? "" : Str("label"))}";
        if (Truthy("verdict")) return $"{Str("verdict")}{(Truthy("blockingCount") ? $" — {Str("blockingCount")} blocking" : "")} ({(p["findingCount"] is null ? "0" : Str("findingCount"))} findings)";
        if (Truthy("taskCount")) return $"{Str("taskCount")} tasks, {Str("dependencyCount")} deps";
        if (Truthy("to")) return $"{(p["from"] is null ? "?" : Str("from"))} → {Str("to")}";
        if (Truthy("outcome")) return $"→ {Str("outcome")}";
        var kindBranch = $"{(p["kind"] is null ? "" : Str("kind"))} {(Truthy("branch") ? $"on {Str("branch")}" : "")}".Trim();
        return kindBranch.Length > 0 ? kindBranch : null;
    }

    private static string Fixed2(JsonObject g) => g["confidence"]!.GetValue<double>().ToString("0.00", CultureInfo.InvariantCulture);
}
