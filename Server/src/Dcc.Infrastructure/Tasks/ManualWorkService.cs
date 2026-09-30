using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Domain.Tasks;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Requirements;

namespace Dcc.Infrastructure.Tasks;

/// <summary>
/// A task developed by a person, not by Claude (manual-work.ts). It goes through the SAME lifecycle — the
/// report is recorded as a development run marked manual, so status, steps and checks read it as they read
/// Claude's work; each check can be set by hand; the same done gate and timeline. Only who did the work, and
/// what they can say about it, differs.
/// </summary>
public sealed class ManualWorkService(DccDbContext db, TaskStore store, TaskRunService runs, FlowRunHub hub, BriefService brief)
{
    private static bool IsManual(JsonObject run) => (run["result"] as JsonObject)?["manual"] is not null;

    private Task<List<JsonObject>> DoneRunsAsync(Guid taskId, CancellationToken ct) => store.ImplementRunsAsync("task_id = @t and state = 'done'", new { t = taskId }, ct);

    private static AppException Refused(string m) => AppException.Conflict("manual_refused", m);

    /// <summary>Mark a task as developed by hand — or hand it back to Claude. Refused while either kind of development is in place.</summary>
    public async Task<JsonObject> SetManualAsync(Guid clientId, Guid taskId, bool manual, Guid actor, CancellationToken ct)
    {
        var t = await store.RequireAsync(clientId, taskId, ct);
        if (t.Kind != "task") throw Refused("רק משימה אפשר לסמן כמפותחת ידנית — לא בדיקה");
        if ((await store.WhereAsync(clientId, "parent_task_id = @t and kind = 'task' and state <> 'dropped'", new { t = taskId }, ct)).Count > 0)
            throw Refused("קבוצה לא מפותחת בעצמה — סמנו את תת-המשימות שלה");
        if (t.DevelopedManually == manual) return new JsonObject { ["manual"] = manual };
        if (hub.LiveTaskPhase(taskId) is not null) throw Refused("יש הרצה של Claude על המשימה כרגע — עצרו אותה קודם");
        var latest = (await DoneRunsAsync(taskId, ct)).FirstOrDefault();
        if (manual && latest is not null && !IsManual(latest)) throw Refused("Claude כבר פיתח את המשימה — בצעו Rollback לפני שעוברים לפיתוח ידני");
        if (!manual && latest is not null && IsManual(latest)) throw Refused("כבר יש דיווח ידני על המשימה — בטלו אותו קודם");
        await store.ExecAsync(clientId, "update task set developed_manually = @m, updated_at = now() where id = @id", new { id = taskId, m = manual }, ct);
        await store.NoteAsync(clientId, t.WorkitemId, taskId, new UserActor(actor), manual
            ? $"✍ משימה #{t.Seq} סומנה כמפותחת ידנית — מי שמפתח אותה מדווח על העבודה בעצמו, בלי Claude."
            : $"משימה #{t.Seq} חזרה להיות מפותחת עם Claude.", ct);
        await brief.RegenerateAsync(clientId, t.WorkitemId, ct);
        return new JsonObject { ["manual"] = manual };
    }

    /// <summary>The report of a task somebody developed themselves — from then on it counts as the task's development. Reporting again replaces the earlier report.</summary>
    public async Task<JsonObject> ReportAsync(Guid clientId, Guid taskId, Guid actor, ManualReportInput input, CancellationToken ct)
    {
        var t = await store.RequireAsync(clientId, taskId, ct);
        if (!t.DevelopedManually) throw Refused("סמנו קודם את המשימה כמפותחת ידנית");
        if (!t.Active || t.State == "dropped") throw Refused("המשימה לא פעילה");
        if (!t.Approved || t.LinkedAdoId is null) throw Refused("אי אפשר לדווח לפני שהמשימה מאושרת ומוקמה ב-TFS — על זה העבודה נעקבת");
        if (t.State == "done") throw Refused("המשימה כבר הושלמה — פתחו אותה מחדש כדי לעדכן את הדיווח");
        if (hub.LiveTaskPhase(taskId) is not null) throw Refused("יש הרצה של Claude על המשימה כרגע");
        var (report, why) = ManualReport.Check(input);
        if (report is null) throw Refused(why!);

        var earlier = await DoneRunsAsync(taskId, ct);
        if (earlier.Any(r => !IsManual(r))) throw Refused("Claude כבר פיתח את המשימה — בצעו Rollback קודם");
        if (earlier.Count > 0)
            await SqlJson.ExecuteAsync(db, "update flow_run set state = 'rolled_back' where task_id = @t and kind = 'implement' and state = 'done'", new { t = taskId }, ct);

        await runs.EnsureStandardChecksAsync(clientId, taskId, TaskRunService.RequiredChecks, false, actor, ct);
        var now = DateTimeOffset.UtcNow;
        var result = new JsonObject
        {
            ["manual"] = new JsonObject
            {
                ["customisations"] = Arr(report.Customisations), ["components"] = Arr(report.Components), ["reference"] = report.Reference,
                ["reportedBy"] = actor.ToString(), ["reportedAt"] = now.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture),
            },
            ["branch"] = "", ["dir"] = "", ["repoName"] = null, ["summary"] = report.Summary, ["filesChanged"] = new JsonArray(),
            ["commit"] = null, ["testsRun"] = null, ["followUps"] = new JsonArray(), ["affectedConsumers"] = new JsonArray(),
        };
        await InsertRunAsync(clientId, t.WorkitemId, taskId, actor, "דווח ידנית — בלי Claude", result, ct);
        if (t.State == "pending") await store.ExecAsync(clientId, "update task set state = 'in_progress', updated_at = now() where id = @id", new { id = taskId }, ct);
        await store.NoteAsync(clientId, t.WorkitemId, taskId, new UserActor(actor), ManualReport.Note(t.Seq, report), ct);
        await brief.RegenerateAsync(clientId, t.WorkitemId, ct);
        return new JsonObject { ["reported"] = true };
    }

    /// <summary>Take a manual report back: the task looks as before it was reported; the history keeps it.</summary>
    public async Task<JsonObject> CancelReportAsync(Guid clientId, Guid taskId, Guid actor, CancellationToken ct)
    {
        var t = await store.RequireAsync(clientId, taskId, ct);
        if (!(await DoneRunsAsync(taskId, ct)).Any(IsManual)) throw Refused("אין דיווח ידני לבטל");
        await SqlJson.ExecuteAsync(db, "update flow_run set state = 'rolled_back' where task_id = @t and kind = 'implement' and state = 'done'", new { t = taskId }, ct);
        await store.ExecAsync(clientId, """
            update task set state = case when state in ('in_progress', 'failed_checks') then 'pending'::task_state else state end, was_done = false, updated_at = now() where id = @id
            """, new { id = taskId }, ct);
        await store.ExecAsync(clientId, """
            update task set check_result = null, check_cause = null, check_resolved_by = null, check_resolved_at = null, state = 'pending', updated_at = now()
            where parent_task_id = @id and kind = 'check' and state <> 'dropped'
            """, new { id = taskId }, ct);
        await store.NoteAsync(clientId, t.WorkitemId, taskId, new UserActor(actor), $"↩ הדיווח הידני על משימה #{t.Seq} בוטל — המשימה נקייה כמו לפני שדווחה; מה שקרה נשאר בהיסטוריה.", ct);
        await brief.RegenerateAsync(clientId, t.WorkitemId, ct);
        return new JsonObject { ["cancelled"] = true };
    }

    /// <summary>
    /// Set one check by hand: passed, failed, or back to not run — the last word on a check is a person's,
    /// whoever developed the task. Recorded as that check's own run.
    /// </summary>
    public async Task<JsonObject> SetCheckAsync(Guid clientId, Guid checkId, string result, string? noteText, Guid actor, CancellationToken ct)
    {
        var c = await store.RequireAsync(clientId, checkId, ct);
        if (c.Kind != "check" || c.ParentTaskId is not { } parentId) throw Refused("זו לא בדיקה");
        var parent = await store.RequireAsync(clientId, parentId, ct);
        if (hub.LiveTaskPhase(parent.Id) is not null) throw Refused("יש הרצה של Claude על המשימה כרגע — חכו שתסתיים, או עצרו אותה");
        if ((await DoneRunsAsync(parent.Id, ct)).Count == 0)
            throw Refused(parent.DevelopedManually ? "דווחו קודם על הפיתוח — ואז אפשר לסמן את הבדיקות" : "המשימה עוד לא פותחה — אין מה לסמן");
        var text = (noteText ?? "").Trim();
        if (result == "failed" && text.Length == 0) throw Refused("כתבו מה נכשל — כדי שמי שימשיך יבין");

        await store.ExecAsync(clientId, result switch
        {
            "not_run" => "update task set check_result = null, check_cause = null, check_resolved_by = null, check_resolved_at = null, state = 'pending', updated_at = now() where id = @id",
            "passed" => "update task set check_result = 'passed', check_cause = null, state = 'done', check_resolved_by = @by, check_resolved_at = now(), updated_at = now() where id = @id",
            // A failure is not an approval — it carries no resolver.
            _ => "update task set check_result = 'failed', check_cause = null, state = 'pending', check_resolved_by = null, check_resolved_at = null, updated_at = now() where id = @id",
        }, new { id = checkId, by = actor }, ct);
        if (result != "not_run")
        {
            var run = new JsonObject
            {
                ["manual"] = new JsonObject { ["by"] = actor.ToString() }, ["summary"] = text.Length > 0 ? text : "סומן ידנית",
                ["checks"] = new JsonArray(new JsonObject
                {
                    ["seq"] = c.Seq, ["passed"] = result == "passed", ["detail"] = text.Length > 0 ? text : "סומן ידנית כעברה", ["likelyCause"] = null, ["kind"] = c.CheckKind,
                }),
            };
            await InsertRunAsync(clientId, c.WorkitemId, checkId, actor, "סומן ידנית", run, ct);
        }
        await store.SyncStateAfterChecksAsync(clientId, parent.Id, ct);
        var word = result switch { "passed" => "✓ עברה", "failed" => "✕ נכשלה", _ => "· חזרה להיות לא רצה" };
        await store.NoteAsync(clientId, c.WorkitemId, checkId, new UserActor(actor), $"✍ בדיקה #{c.Seq} של משימה #{parent.Seq} סומנה ידנית: {word}{(text.Length > 0 ? $" — {text}" : "")}", ct);
        await brief.RegenerateAsync(clientId, c.WorkitemId, ct);
        return new JsonObject { ["result"] = result };
    }

    private Task InsertRunAsync(Guid clientId, Guid workitemId, Guid taskId, Guid actor, string logLine, JsonObject result, CancellationToken ct) =>
        SqlJson.ExecuteAsync(db, """
            insert into flow_run (client_id, workitem_id, task_id, kind, state, log, result, started_by, started_at, finished_at)
            values (@c, @w, @t, 'implement', 'done', @log, @r, @by, now(), now())
            """, new { c = clientId, w = workitemId, t = taskId, log = SqlJson.Jsonb(new[] { logLine }), r = SqlJson.Jsonb(result), by = actor }, ct);

    private static JsonArray Arr(IEnumerable<string> xs) => new(xs.Select(x => (JsonNode?)x).ToArray());
}
