using System.Text.Json.Nodes;
using Dcc.Application.Auth;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Onboarding;

namespace Dcc.Infrastructure.Actions;

/// <summary>
/// What both onboarding actions ask before anything moves: the run's repository (the chat knows only the run), and the
/// person's right to act on it — repos.onboard on the repository's client, as every door of the dossier asks. Both run
/// Claude on the server's machine (typing into the session drives it; a request is a model call), so a guest never
/// does either, whatever role they hold — as the screen's own doors refuse them.
/// </summary>
internal static class OnboardingActionGate
{
    public static async Task<string?> RefusalAsync(IPermissionService permissions, OnboardingStore store, Guid by, ActionEntity e, bool onTheMachine, CancellationToken ct)
    {
        if (!await permissions.HasAsync(by, Permissions.Repos.Onboard, new ScopeRef(ScopeType.Client, e.ClientId), ct))
            return "אין לך הרשאה לפעול בהטמעה של הריפו הזה";
        if (onTheMachine && await store.IsGuestAsync(by, ct)) return "אורחים לא מפעילים דבר על המחשב של השרת";
        return null;
    }

    public static async Task<Guid> RepoAsync(OnboardingRuns runs, ActionEntity e) =>
        e.RepoId ?? await runs.RepoOfAsync(e.ClientId, e.Id) ?? throw new ActionRefused("ההרצה לא נמצאה");
}

/// <summary>An instruction typed into the live <c>/init</c> draft session, in the person's name, as if they had typed it in the terminal.</summary>
public sealed class SendToSessionAction(OnboardingRuns runs, OnboardingStore store, IOnboardingTerminal terminal, IPermissionService permissions) : ActionDef
{
    public override string Key => "send_to_session";
    public override string Title => "שליחת הוראה לסשן טיוטת /init";
    public override string Topic => "run";
    public override string CostNote => "ההוראה נכנסת לסשן הטיוטה שכבר רץ — מה שקלוד יעשה בעקבותיה נרשם בעלות של ההרצה";
    public override IReadOnlyList<ActionParam> Params => [new("text", "ההוראה לסשן, באנגלית, פסקה אחת", Required: true)];

    public override Task<string> DescribeAsync(JsonObject p, ActionEntity e, CancellationToken ct) =>
        Task.FromResult($"ההוראה תוקלד לתוך סשן טיוטת /init של Claude Code, בשמכם, כאילו כתבתם אותה בטרמינל:\n\"{Str(p, "text") ?? ""}\"");

    public override async Task<string?> RefusalAsync(Guid by, ActionEntity e, JsonObject p, CancellationToken ct)
    {
        if (Str(p, "text") is null) return "אין הוראה לשלוח";
        if (terminal.State(e.Id) != "live") return "סשן הטיוטה לא פעיל — פתחו אותו מכרטיס הטיוטה במסך ההטמעה ואז שלחו";
        return await OnboardingActionGate.RefusalAsync(permissions, store, by, e, onTheMachine: true, ct);
    }

    public override Task<ActionEstimate?> EstimateAsync(JsonObject p, ActionEntity e, CancellationToken ct) => Task.FromResult<ActionEstimate?>(null);

    public override async Task<JsonNode?> RunAsync(JsonObject p, ActionEntity e, Guid by, string trigger, CancellationToken ct) =>
        await runs.SendToSessionAsync(await OnboardingActionGate.RepoAsync(runs, e), e.Id, by, Str(p, "text")!);
}

/// <summary>"תכין skill לתהליך X": a person's request becomes a component card in the open plan, with at most three questions.</summary>
public sealed class RequestComponentAction(OnboardingRuns runs, OnboardingStore store, ModelRouter router, IPermissionService permissions) : ActionDef
{
    public override string Key => "request_component";
    public override string Title => "בקשה לרכיב בתוכנית ההטמעה";
    public override string Topic => "run";
    public override string ApproveLabel => "אשר והוסף כרטיס";
    public override IReadOnlyList<ActionParam> Params => [new("text", "מה הרכיב צריך לעשות, במילים של האדם (skill לתהליך, סוכן שבודק, hook שאוסר, מסמך)", Required: true)];

    public override Task<string> DescribeAsync(JsonObject p, ActionEntity e, CancellationToken ct) =>
        Task.FromResult($"קלוד יהפוך את הבקשה לכרטיס רכיב בתוכנית — סוג, כותרת, מה הוא יעשה — ועד שלוש שאלות הבהרה עם ברירת מחדל. הכרטיס מחכה לאישורך כמו כל כרטיס אחר:\n\"{Str(p, "text") ?? ""}\"");

    public override async Task<string?> RefusalAsync(Guid by, ActionEntity e, JsonObject p, CancellationToken ct) =>
        Str(p, "text") is null ? "כתבו מה הרכיב צריך לעשות" : await OnboardingActionGate.RefusalAsync(permissions, store, by, e, onTheMachine: true, ct);

    public override Task<ActionEstimate?> EstimateAsync(JsonObject p, ActionEntity e, CancellationToken ct) =>
        Task.FromResult<ActionEstimate?>(ActionRegistry.Typical(router, "onboarding_processes", 3_000, 300));

    public override async Task<JsonNode?> RunAsync(JsonObject p, ActionEntity e, Guid by, string trigger, CancellationToken ct) =>
        await runs.RequestComponentAsync(await OnboardingActionGate.RepoAsync(runs, e), e.Id, by, Str(p, "text")!);
}
