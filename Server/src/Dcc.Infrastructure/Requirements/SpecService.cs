using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Domain.Spec;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Requirements;

/// <summary>
/// The requirement's specification as the screen draws it: the document as it
/// arrived, the requirements marked in it, the decisions, and which task
/// implements each — and what nothing implements. Until the requirements have
/// been marked (a Claude reading, phase 4.5) the document is read straight out
/// of the attached file and shown with nothing marked on it.
/// </summary>
public sealed class SpecService(ITenantScope tenant)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public Task<JsonObject> SpecForAsync(Guid clientId, Guid workitemId, CancellationToken ct) =>
        tenant.RunAsync(clientId, async d =>
        {
            var args = new { w = workitemId };
            var stored = await SqlJson.QuerySingleAsync(d, "select attachment_id as \"attachmentId\", doc, corrections from spec_document where workitem_id = @w limit 1", args, ct);
            var reqs = await SqlJson.QueryAsync(d, "select anchor, title from spec_section where workitem_id = @w and kind = 'requirement' order by ordinal", args, ct);
            var links = await SqlJson.QueryAsync(d, "select task_id as \"taskId\", anchor, source from task_spec_link where workitem_id = @w", args, ct);
            var tasks = (await SqlJson.QueryAsync(d, """
                select id, seq, intent, active, state::text as "state" from task where id in (select task_id from task_spec_link where workitem_id = @w)
                """, args, ct)).ToDictionary(t => t["id"]!.GetValue<string>());
            // The answers as they stand now — a question closed after the reading still shows, and shows as not yet implemented.
            var decisions = (await SqlJson.QueryAsync(d, """
                select id, description, answer from gap where workitem_id = @w and state = 'resolved' and coalesce(trim(answer), '') <> '' order by created_at
                """, args, ct)).Select(g => new JsonObject
            {
                ["anchor"] = SpecDocs.DecisionAnchor(Guid.Parse(g["id"]!.GetValue<string>())),
                ["question"] = g["description"]!.GetValue<string>().Trim(),
                ["answer"] = g["answer"]!.GetValue<string>().Trim(),
            }).ToList();

            JsonObject? source = null;
            if (stored?["attachmentId"]?.GetValue<string>() is { } attId)
            {
                var att = await SqlJson.QuerySingleAsync(d, "select id as \"attachmentId\", name from attachment where id = @a", new { a = Guid.Parse(attId) }, ct);
                source = att;
            }

            var byAnchor = new Dictionary<string, List<JsonObject>>();
            foreach (var l in links)
            {
                if (!tasks.TryGetValue(l["taskId"]!.GetValue<string>(), out var t)) continue;
                if (!t["active"]!.GetValue<bool>() || t["state"]!.GetValue<string>() == "dropped") continue;
                var anchor = l["anchor"]!.GetValue<string>();
                if (!byAnchor.TryGetValue(anchor, out var list)) byAnchor[anchor] = list = [];
                list.Add(new JsonObject { ["id"] = t["id"]!.GetValue<string>(), ["seq"] = t["seq"]!.GetValue<int>(), ["intent"] = t["intent"]!.GetValue<string>(), ["source"] = l["source"]!.GetValue<string>() });
            }
            JsonArray TasksOf(string a) => new((byAnchor.GetValueOrDefault(a) ?? []).OrderBy(x => x["seq"]!.GetValue<int>()).Select(x => (JsonNode?)x).ToArray());

            var docNode = stored?["doc"];
            var corrections = stored?["corrections"] as JsonArray ?? [];
            var overruled = new HashSet<string>();
            if (docNode is not null)
            {
                var doc = docNode.Deserialize<SpecDocument>(Json)!;
                var corr = corrections.Deserialize<List<SpecCorrection>>(Json) ?? [];
                overruled = SpecDocs.Overruled(doc, corr);
            }

            var pieces = new JsonArray();
            if (stored is not null)
            {
                foreach (var r in reqs)
                {
                    var a = r["anchor"]!.GetValue<string>();
                    pieces.Add(new JsonObject { ["anchor"] = a, ["kind"] = "requirement", ["title"] = r["title"]!.GetValue<string>(), ["overruled"] = overruled.Contains(a), ["tasks"] = TasksOf(a) });
                }
                foreach (var dcs in decisions)
                {
                    var a = dcs["anchor"]!.GetValue<string>();
                    pieces.Add(new JsonObject { ["anchor"] = a, ["kind"] = "decision", ["title"] = dcs["question"]!.GetValue<string>(), ["overruled"] = false, ["tasks"] = TasksOf(a) });
                }
            }
            var uncovered = new JsonArray(pieces.OfType<JsonObject>()
                .Where(p => p["tasks"]!.AsArray().Count == 0 && !p["overruled"]!.GetValue<bool>())
                .Select(p => (JsonNode?)p["anchor"]!.GetValue<string>()).ToArray());

            var view = new JsonObject
            {
                ["read"] = stored is not null,
                ["source"] = source,
                ["doc"] = docNode?.DeepClone(),
                ["corrections"] = corrections.DeepClone(),
                ["pieces"] = pieces,
                ["decisions"] = new JsonArray(decisions.Select(x => (JsonNode?)x).ToArray()),
                ["uncovered"] = uncovered,
            };
            if (stored is not null) return view;

            // Not read yet: the attachment with the most to say, shown as it arrived.
            var (att2, parsed) = await UnreadDocAsync(d, workitemId, ct);
            view["doc"] = parsed is null ? null : JsonSerializer.SerializeToNode(parsed, Json);
            view["source"] = att2 is not null && parsed is not null ? new JsonObject { ["attachmentId"] = att2.Value.Id.ToString(), ["name"] = att2.Value.Name } : null;
            return view;
        }, ct);

    /// <summary>The attachment the spec is read out of — the one with the most extracted text — and its blocks.</summary>
    public static async Task<((Guid Id, string Name)? Att, SpecDocument? Doc)> UnreadDocAsync(DccDbContext d, Guid workitemId, CancellationToken ct)
    {
        await using var cmd = new Npgsql.NpgsqlCommand("""
            select id, name, content, extracted_text from attachment
            where workitem_id = @w and coalesce(trim(extracted_text), '') <> ''
            order by length(extracted_text) desc limit 1
            """, (Npgsql.NpgsqlConnection)d.Database.GetDbConnectionSafe(), d.CurrentNpgsqlTransaction());
        cmd.Parameters.AddWithValue("w", workitemId);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return (null, null);
        var id = r.GetGuid(0);
        var name = r.GetString(1);
        var content = r.IsDBNull(2) ? null : (byte[])r[2];
        var text = r.IsDBNull(3) ? "" : r.GetString(3);
        SpecDocument? doc = null;
        try
        {
            if (content is not null && name.EndsWith(".docx", StringComparison.OrdinalIgnoreCase)) doc = DocumentReader.SpecFromDocx(content);
            if (doc is null && text.Trim().Length > 0) doc = SpecDocs.FromText(text.Trim());
        }
        catch (Exception e) when (e is not OperationCanceledException) { doc = null; }
        return ((id, name), doc);
    }
}
