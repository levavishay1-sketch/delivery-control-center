using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Audit;
using Dcc.Domain.Prompts;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Policy;

namespace Dcc.Infrastructure.Prompts;

/// <summary>
/// The system's own prompt library (org-shared, no RLS). Every instruction DCC
/// sends to Claude is a row of <c>prompt_template</c>, read at the moment of the
/// call — what the Prompts screen shows is what is sent, and an edit changes the
/// next call without a code change. What the code depends on in each one is
/// declared in <see cref="PromptContract"/>.
/// </summary>
public sealed class PromptService(DccDbContext db, ModelPolicyStore policy, IAuditLog audit)
{
    /// <summary>Each row as the Prompts screen shows it: what runs it, and anything in it that would break its caller.</summary>
    public async Task<List<JsonObject>> ListAsync(CancellationToken ct)
    {
        var rows = await SqlJson.QueryAsync(db, """
            select id, key, title, description, body, default_model as "defaultModel", updated_at as "updatedAt",
                   updated_by as "updatedBy", body_he as "bodyHe", sort_order as "sortOrder"
            from prompt_template order by sort_order, title
            """, null, ct);
        foreach (var r in rows)
        {
            var key = r["key"]!.GetValue<string>();
            if (PromptContract.Uses.TryGetValue(key, out var u))
            {
                var (model, tier, effort) = policy.Recommend(u.Capability);
                r["use"] = new JsonObject
                {
                    ["capability"] = u.Capability,
                    ["modelPerRun"] = u.ModelPerRun,
                    ["policy"] = new JsonObject { ["model"] = model, ["tier"] = tier, ["effort"] = effort },
                    ["vars"] = Arr(u.Vars),
                    ["optional"] = Arr(u.Optional ?? []),
                    ["keeps"] = Arr(u.Keeps),
                    ["appendedTo"] = u.AppendedTo,
                };
            }
            else r["use"] = null;
            r["problems"] = Arr(PromptContract.Problems(key, r["body"]!.GetValue<string>()));
        }
        return rows;
    }

    public sealed record UpdatePromptRequest(string? Title, string? Description, bool DescriptionSet, string? Body, string? BodyHe, bool BodyHeSet, string? DefaultModel, bool DefaultModelSet);

    /// <summary>Saves an edit; a body that would break its caller is refused, with every reason.</summary>
    public async Task<JsonObject> UpdateAsync(Guid id, UpdatePromptRequest req, Guid actor, CancellationToken ct)
    {
        var key = await SqlJson.ScalarAsync<string>(db, "select key from prompt_template where id = @id", new { id }, ct);
        if (req.Body is not null)
        {
            if (key is null) throw Refused("הפרומפט לא נמצא");
            if (req.Body.Trim().Length == 0) throw Refused("גוף הפרומפט ריק — זה מה שנשלח לקלוד");
            var problems = PromptContract.Problems(key, req.Body);
            if (problems.Count > 0) throw Refused("לא נשמר — השינוי היה שובר את הקריאה:\n" + string.Join("\n", problems.Select(p => $"• {p}")));
        }

        var sets = new List<string> { "updated_at = now()", "updated_by = @by" };
        var args = new Dictionary<string, object?> { ["id"] = id, ["by"] = actor };
        if (req.Title is not null) { sets.Add("title = @title"); args["title"] = req.Title; }
        if (req.DescriptionSet) { sets.Add("description = @desc"); args["desc"] = req.Description; }
        if (req.Body is not null) { sets.Add("body = @body"); args["body"] = req.Body; }
        if (req.BodyHeSet) { sets.Add("body_he = @he"); args["he"] = req.BodyHe; }
        if (req.DefaultModelSet) { sets.Add("default_model = @model"); args["model"] = req.DefaultModel; }
        await SqlJson.ExecuteAsync(db, $"update prompt_template set {string.Join(", ", sets)} where id = @id", args, ct);
        await audit.WriteAsync(new AuditEntry(actor, "prompt.updated", "prompt", id.ToString(), After: new { key, req.Title, bodyChanged = req.Body is not null, req.DefaultModel }), ct);
        return new JsonObject { ["updated"] = true };
    }

    public sealed record PromptRow(string Key, string Title, string Body, string? BodyHe, string? DefaultModel);

    /// <summary>The row a call is built from. Missing is a real failure, said in words — never a hidden copy of the text in code.</summary>
    public async Task<PromptRow> RequireAsync(string key, CancellationToken ct)
    {
        var r = await SqlJson.QuerySingleAsync(db, """
            select key, title, body, body_he as "bodyHe", default_model as "defaultModel" from prompt_template where key = @key
            """, new { key }, ct) ?? throw AppException.Conflict("prompt_missing", $"הפרומפט \"{key}\" חסר במסך הפרומפטים — אי אפשר לבנות את הקריאה בלעדיו");
        return new PromptRow(key, r["title"]!.GetValue<string>(), r["body"]!.GetValue<string>(), r["bodyHe"]?.GetValue<string>(), r["defaultModel"]?.GetValue<string>());
    }

    private static AppException Refused(string message) => AppException.Conflict("prompt_refused", message);

    private static JsonArray Arr(IEnumerable<string> items) => new(items.Select(i => (JsonNode?)i).ToArray());
}
