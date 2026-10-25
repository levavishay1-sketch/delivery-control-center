using System.Text.Json.Nodes;
using Dcc.Domain.Chat;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Requirements;

namespace Dcc.Infrastructure.Actions;

/// <summary>The readiness check: Claude reads the requirement (and its code) and proposes gaps — a person accepts or dismisses each.</summary>
public sealed class AssessAction(RequirementAiService ai, FlowRunService flows, ModelRouter router) : ActionDef
{
    public override string Key => "assess";
    public override string Title => "בחינת בשלות";
    public override string Topic => "wi";
    public override IReadOnlyList<ActionParam> Params => [new("customEmphasis", "דגש נוסף לבדיקה, בעברית (לא חובה)")];

    public override Task<string> DescribeAsync(JsonObject p, ActionEntity e, CancellationToken ct) =>
        Task.FromResult($"קלוד יקרא את הדרישה (ואת המאגר אם יש) ויכתוב סיכום ורשימת פערים{(Str(p, "customEmphasis") is { } em ? $", עם דגש על: {em}" : "")}. הפערים מוצעים בלבד — אדם מאשר או דוחה כל אחד.");

    public override Task<string?> RefusalAsync(Guid by, ActionEntity e, JsonObject p, CancellationToken ct) => Task.FromResult<string?>(null);

    public override Task<ActionEstimate?> EstimateAsync(JsonObject p, ActionEntity e, CancellationToken ct) =>
        Task.FromResult<ActionEstimate?>(ActionRegistry.Typical(router, "gap_detection", 12_000, 1_500));

    public override async Task<(string Prompt, string PromptHe)?> PreviewAsync(JsonObject p, ActionEntity e, CancellationToken ct)
    {
        var r = await ai.PreviewAssessAsync(e.ClientId, e.Id, Str(p, "promptKey") ?? RequirementAiService.DefaultAssessPromptKey, Str(p, "customEmphasis"), ct);
        return (r["prompt"]!.GetValue<string>(), r["promptHe"]?.GetValue<string>() ?? "");
    }

    public override async Task<JsonNode?> RunAsync(JsonObject p, ActionEntity e, Guid by, string trigger, CancellationToken ct)
    {
        var o = new JsonObject { ["promptKey"] = Str(p, "promptKey"), ["customEmphasis"] = Str(p, "customEmphasis"), ["model"] = Str(p, "model") };
        var (runId, already) = await flows.StartAsync(e.ClientId, e.Id, "assess", by, null, trigger, o, ct);
        return new JsonObject { ["runId"] = runId.ToString(), ["alreadyRunning"] = already };
    }
}

/// <summary>The breakdown: Claude proposes the tasks with order and dependencies. Nothing reaches TFS until a person approves.</summary>
public sealed class BreakdownAction(RequirementAiService ai, FlowRunService flows, ModelRouter router) : ActionDef
{
    public override string Key => "breakdown";
    public override string Title => "פירוק למשימות";
    public override string Topic => "wi";

    public override Task<string> DescribeAsync(JsonObject p, ActionEntity e, CancellationToken ct) =>
        Task.FromResult("קלוד יקרא את הדרישה ואת הפערים שנסגרו ויציע רשימת משימות עם סדר ותלות. המשימות לא נוצרות ב-TFS עד שתאשרו אותן במסך הדרישה.");

    public override Task<string?> RefusalAsync(Guid by, ActionEntity e, JsonObject p, CancellationToken ct) => Task.FromResult<string?>(null);

    public override Task<ActionEstimate?> EstimateAsync(JsonObject p, ActionEntity e, CancellationToken ct) =>
        Task.FromResult<ActionEstimate?>(ActionRegistry.Typical(router, "decomposition", 15_000, 2_500));

    public override async Task<(string Prompt, string PromptHe)?> PreviewAsync(JsonObject p, ActionEntity e, CancellationToken ct)
    {
        var r = await ai.PreviewBreakdownAsync(e.ClientId, e.Id, ct);
        return (r["prompt"]!.GetValue<string>(), r["promptHe"]!.GetValue<string>());
    }

    public override async Task<JsonNode?> RunAsync(JsonObject p, ActionEntity e, Guid by, string trigger, CancellationToken ct)
    {
        var (runId, already) = await flows.StartAsync(e.ClientId, e.Id, "breakdown", by, null, trigger, null, ct);
        return new JsonObject { ["runId"] = runId.ToString(), ["alreadyRunning"] = already };
    }
}

/// <summary>A conversation about a requirement's gaps settles them one by one — but only the person closes a gap: each is a card they approve.</summary>
public abstract class GapActionBase(ITenantScope tenant, GapService gaps) : ActionDef
{
    public override string Topic => "gaps";
    protected abstract string Outcome { get; }
    protected abstract string ValueParam { get; }
    protected abstract string MissingValue { get; }

    /// <summary>The gap a proposal names by its short reference, still open, on this requirement — or why not.</summary>
    protected async Task<(Guid Id, string Description)?> OpenGapAsync(ActionEntity e, JsonObject p, Action<string> why, CancellationToken ct)
    {
        var r = (Str(p, "gap") ?? "").Trim().ToLowerInvariant();
        if (r.Length == 0) { why("לא צוין איזה פער"); return null; }
        if (!System.Text.RegularExpressions.Regex.IsMatch(r, "^[0-9a-f]{4,36}$")) { why($"\"{Str(p, "gap")}\" אינו מזהה של פער"); return null; }
        var rows = await tenant.RunAsync(e.ClientId, d => SqlJson.QueryAsync(d, "select id, description, state::text as state from gap where workitem_id = @w and id::text like @r",
            new { w = e.WorkitemId ?? e.Id, r = $"{r}%" }, ct), ct);
        if (rows.Count == 0) { why("הפער לא נמצא בדרישה הזו"); return null; }
        if (rows.Count > 1) { why("המזהה מתאים ליותר מפער אחד"); return null; }
        if (!GapsPrompt.IsOpen(rows[0]["state"]!.GetValue<string>())) { why("הפער הזה כבר נסגר"); return null; }
        return (Guid.Parse(rows[0]["id"]!.GetValue<string>()), rows[0]["description"]!.GetValue<string>());
    }

    protected static string Quote(string d) => $"\"{(d.Length > 110 ? $"{d[..110]}…" : d)}\"";

    public override async Task<string?> RefusalAsync(Guid by, ActionEntity e, JsonObject p, CancellationToken ct)
    {
        string? why = null;
        if (await OpenGapAsync(e, p, w => why = w, ct) is null) return why;
        return Str(p, ValueParam) is null ? MissingValue : null;
    }

    public override Task<ActionEstimate?> EstimateAsync(JsonObject p, ActionEntity e, CancellationToken ct) => Task.FromResult<ActionEstimate?>(null);

    public override async Task<JsonNode?> RunAsync(JsonObject p, ActionEntity e, Guid by, string trigger, CancellationToken ct)
    {
        string? why = null;
        var g = await OpenGapAsync(e, p, w => why = w, ct) ?? throw new ActionRefused(why!);
        return await gaps.VerifyAsync(e.ClientId, g.Id, Outcome, null, Str(p, ValueParam), null, by, ct);
    }
}

public sealed class ResolveGapAction(ITenantScope tenant, GapService gaps) : GapActionBase(tenant, gaps)
{
    public override string Key => "resolve_gap";
    public override string Title => "סגירת פער עם הכרעה";
    public override string ApproveLabel => "אשר וסגור את הפער";
    public override string CostNote => "האישור לא עולה כסף — הוא רק שומר את ההכרעה. העלות של התשובה של קלוד רשומה מעליה";
    protected override string Outcome => "resolved";
    protected override string ValueParam => "answer";
    protected override string MissingValue => "אין הכרעה לשמור";
    public override IReadOnlyList<ActionParam> Params =>
    [
        new("gap", "המזהה הקצר של הפער (8 התווים שבסוגריים בעובדות)", true),
        new("answer", "ההכרעה כפי שסוכמה בשיחה, בעברית, שלמה ועומדת בפני עצמה — מי שיקרא אותה בלי השיחה יבין מה הוחלט", true),
    ];

    public override async Task<string> DescribeAsync(JsonObject p, ActionEntity e, CancellationToken ct)
    {
        var g = await OpenGapAsync(e, p, _ => { }, ct);
        return $"הפער {(g is { } x ? Quote(x.Description) : "")} ייסגר עם ההכרעה:\n\"{Str(p, "answer") ?? ""}\"\nההכרעה נשמרת כהערה בדרישה, בשמכם, ונכנסת לפירוק למשימות.";
    }
}

public sealed class DismissGapAction(ITenantScope tenant, GapService gaps) : GapActionBase(tenant, gaps)
{
    public override string Key => "dismiss_gap";
    public override string Title => "סימון כלא-פער";
    public override string ApproveLabel => "אשר — זה לא פער";
    public override string CostNote => "האישור לא עולה כסף — הוא רק שומר את הסיבה. העלות של התשובה של קלוד רשומה מעליה";
    protected override string Outcome => "dismissed";
    protected override string ValueParam => "reason";
    protected override string MissingValue => "חסרה הסיבה";
    public override IReadOnlyList<ActionParam> Params =>
    [
        new("gap", "המזהה הקצר של הפער (8 התווים שבסוגריים בעובדות)", true),
        new("reason", "למה זה לא פער אמיתי, כפי שעלה בשיחה — נשמר כדי שהשאלה לא תעלה שוב", true),
    ];

    public override async Task<string> DescribeAsync(JsonObject p, ActionEntity e, CancellationToken ct)
    {
        var g = await OpenGapAsync(e, p, _ => { }, ct);
        return $"הפער {(g is { } x ? Quote(x.Description) : "")} יסומן כלא-פער, מהסיבה:\n\"{Str(p, "reason") ?? ""}\"\nהסיבה נשמרת כדי שבחינת הבשלות הבאה לא תעלה את השאלה שוב.";
    }
}
