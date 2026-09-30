using System.Text.Json.Nodes;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Tasks;

namespace Dcc.Infrastructure.Actions;

/// <summary>Hand a task to Claude: its code, on DCC's own copy, on its own branch, committed locally. Approval and a TFS item come first.</summary>
public sealed class ImplementAction(TaskStore store, TaskRunService runs, FlowRunService flows, ModelRouter router) : ActionDef
{
    public override string Key => "implement";
    public override string Title => "פיתוח המשימה";
    public override string Topic => "task";

    public override Task<string> DescribeAsync(JsonObject p, ActionEntity e, CancellationToken ct) =>
        Task.FromResult("קלוד יכתוב את הקוד של המשימה בעותק מבודד של המאגר, על ענף משלה, ויקומיט מקומית. שום דבר לא נדחף ולא מתמזג לבד.");

    public override async Task<string?> RefusalAsync(Guid by, ActionEntity e, JsonObject p, CancellationToken ct)
    {
        var t = await store.GetAsync(e.ClientId, e.Id, ct);
        if (t is null) return "המשימה לא נמצאה";
        if (!t.Approved) return "המשימה עדיין לא אושרה — קודם מאשרים אותה, ואז מפתחים";
        // The TFS item is what the work is tracked on; a check carries its task's.
        if (t.LinkedAdoId is null) return "המשימה עוד לא הוקמה ב-TFS — אי אפשר לפתח לפני שיש לה work item. נסו שוב להקים אותה במסך המשימה";
        if (t.Kind == "task" && (await store.RelationsAsync(e.ClientId, t.WorkitemId, ct)).IsGroup(t.Id)) return TaskRunService.GroupNotDeveloped;
        // A task developed by a person is reported, never run — nor are its checks.
        var owner = t.Kind == "check" && t.ParentTaskId is { } pid ? await store.GetAsync(e.ClientId, pid, ct) : t;
        if (owner?.DevelopedManually == true)
            return "המשימה מסומנת כמפותחת ידנית — מי שמפתח אותה מדווח על העבודה במסך המשימה ומסמן את הבדיקות בעצמו. Claude לא מריץ אותה ולא את הבדיקות שלה";
        return null;
    }

    public override Task<ActionEstimate?> EstimateAsync(JsonObject p, ActionEntity e, CancellationToken ct) =>
        Task.FromResult<ActionEstimate?>(ActionRegistry.Typical(router, "execution", 60_000, 6_000));

    public override async Task<(string Prompt, string PromptHe)?> PreviewAsync(JsonObject p, ActionEntity e, CancellationToken ct)
    {
        var r = await runs.PreviewAsync(e.ClientId, e.WorkitemId!.Value, e.Id, ct);
        return (r["prompt"]!.GetValue<string>(), r["promptHe"]!.GetValue<string>());
    }

    public override async Task<JsonNode?> RunAsync(JsonObject p, ActionEntity e, Guid by, string trigger, CancellationToken ct)
    {
        var (runId, already) = await flows.StartAsync(e.ClientId, e.WorkitemId!.Value, "implement", by, e.Id, trigger, ct: ct);
        return new JsonObject { ["runId"] = runId.ToString(), ["alreadyRunning"] = already };
    }
}

/// <summary>Approve a task — its checklist with it — in the person's name; the screen may correct wording, size and prompt in the same stroke.</summary>
public sealed class ApproveTaskAction(TaskStore store, TaskRunService runs) : ActionDef
{
    public override string Key => "approve_task";
    public override string Title => "אישור המשימה";
    public override string Topic => "task";
    public override string CostNote => "האישור לא עולה כסף — הוא רק מסמן את המשימה כמאושרת";

    public override Task<string> DescribeAsync(JsonObject p, ActionEntity e, CancellationToken ct) =>
        Task.FromResult("המשימה תסומן כמאושרת לפיתוח, בשמכם. אפשר לתקן קודם את הניסוח ואת הגודל במסך המשימה.");

    public override async Task<string?> RefusalAsync(Guid by, ActionEntity e, JsonObject p, CancellationToken ct)
    {
        var t = await store.GetAsync(e.ClientId, e.Id, ct);
        if (t is null) return "המשימה לא נמצאה";
        return t.Approved ? "המשימה כבר מאושרת" : null;
    }

    public override Task<ActionEstimate?> EstimateAsync(JsonObject p, ActionEntity e, CancellationToken ct) => Task.FromResult<ActionEstimate?>(null);

    public override async Task<JsonNode?> RunAsync(JsonObject p, ActionEntity e, Guid by, string trigger, CancellationToken ct)
    {
        var appetite = Str(p, "appetite") is "small" or "standard" or "large" ? Str(p, "appetite") : null;
        var prompt = p["prompt"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
        return await runs.ApproveAsync(e.ClientId, e.Id, by, Str(p, "intent"), appetite, prompt, ct);
    }
}
