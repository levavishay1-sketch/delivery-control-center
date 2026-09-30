using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Domain.Prompts;
using Dcc.Domain.Tasks;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Prompts;
using Dcc.Infrastructure.Repos;
using Dcc.Infrastructure.Requirements;

namespace Dcc.Infrastructure.Tasks;

/// <summary>
/// Developing a task (ai-assist.ts runImplement and what surrounds it): on DCC's own copy of the repository,
/// on the task's own branch — built on the one dependency whose work exists and is not in the default branch
/// yet (task-base.ts) — then the build with its real command (never a model), then the other checks without
/// write access, one verdict per check. Commits locally; never pushes. Also: the checks DCC adds to every task,
/// the preview of what will be sent, rollback, push, surgical delete, approve and reject.
/// </summary>
public sealed partial class TaskRunService(
    DccDbContext db, ITenantScope tenant, TaskStore store, TaskFacts facts, FlowRunHub hub, ClaudeRunner claude,
    RepoCheckouts checkouts, PromptService prompts, BriefService brief, TaskAdoSync adoSync) : IFlowRunWork
{
    public string Kind => "implement";

    public static readonly Dictionary<string, string> StandardCheckIntent = new()
    {
        ["build"] = "Build לרכיבים המתקמפלים", ["tests"] = "בדיקות לפיתוח", ["regression"] = "בדיקות רגרסיה", ["e2e"] = "בדיקות E2E",
    };

    /// <summary>The checks every task gets; E2E is added on request.</summary>
    public static readonly string[] RequiredChecks = ["build", "tests", "regression"];

    public const string GroupNotDeveloped = "זו קבוצה — יש לה תת-משימות, והעבודה שלה היא תת-המשימות. היא לא מפותחת בעצמה: מפתחים כל תת-משימה, ובדיקת הקבוצה בודקת אותן יחד.";

    private static readonly string[] CheckCauses = ["implementation", "requirement_ambiguity", "dependency_missing", "environment"];

    private static string Cut(string s, int n) => s.Length > n ? s[..n] : s;
    private static DelegatedActor Delegated(Guid userId) => new(userId, "dcc:implement");

    // ── the checks DCC adds to every task ────────────────────────────

    /// <summary>
    /// Adds the checks DCC requires of a task that it does not have yet — each with its own copy of the
    /// <c>check.&lt;kind&gt;</c> prompt, editable afterwards. Only a task built itself (a group's sub-tasks are).
    /// Idempotent. Returns the names of what it added.
    /// </summary>
    public async Task<List<string>> EnsureStandardChecksAsync(Guid clientId, Guid taskId, IReadOnlyList<string>? kinds, bool quiet, Guid? by, CancellationToken ct)
    {
        var t = await store.GetAsync(clientId, taskId, ct);
        if (t is null || t.Kind != "task" || t.State == "dropped") return [];
        // A research or testing requirement has one tracking task and no code: nothing to build or test.
        var requirementType = await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<string>(d, "select requirement_type::text from workitem where id = @w", new { w = t.WorkitemId }, ct), ct);
        if (requirementType is not "development") return [];
        var children = await store.WhereAsync(clientId, "parent_task_id = @t and state <> 'dropped'", new { t = t.Id }, ct);
        if (children.Any(c => c.Kind == "task")) return [];
        var have = children.Where(c => c.Kind == "check" && c.CheckKind is not null).Select(c => c.CheckKind!).ToHashSet();
        var missing = (kinds ?? RequiredChecks).Where(k => !have.Contains(k)).ToList();
        if (missing.Count == 0) return [];

        var vars = new Dictionary<string, object?> { ["COMPILED"] = string.Join(", ", t.CompiledComponents), ["PATHS"] = string.Join(", ", t.AffectedPaths), ["INTENT"] = t.Intent };
        var rows = new List<(string Kind, string Prompt)>();
        foreach (var k in missing) rows.Add((k, PromptContract.Render((await prompts.RequireAsync($"check.{k}", ct)).Body, vars).Trim()));
        await tenant.RunAsync(clientId, async d =>
        {
            var seq = await SqlJson.ScalarAsync<int>(d, "select coalesce(max(seq), 0)::int from task where workitem_id = @w", new { w = t.WorkitemId }, ct);
            foreach (var r in rows)
                await SqlJson.ExecuteAsync(d, """
                    insert into task (client_id, workitem_id, seq, kind, check_kind, intent, appetite, origin, state, parent_task_id, prompt, approved_at, approved_by)
                    values (@c, @w, @seq, 'check', @kind, @intent, 'small', @origin, 'pending', @parent, @prompt, @approvedAt::timestamptz, @approvedBy)
                    """, new
                {
                    c = clientId, w = t.WorkitemId, seq = ++seq, kind = r.Kind, intent = StandardCheckIntent[r.Kind], origin = t.Origin,
                    parent = t.Id, prompt = r.Prompt, approvedAt = t.ApprovedAt, approvedBy = t.ApprovedBy,
                }, ct);
            return 0;
        }, ct);
        var names = missing.Select(k => StandardCheckIntent[k]).ToList();
        if (!quiet)
            await store.NoteAsync(clientId, t.WorkitemId, t.Id, by is { } u ? new UserActor(u) : new SystemActor("dcc:standard-checks"),
                $"🧪 נוספו למשימה #{t.Seq} בדיקות: {string.Join(", ", names)}", ct, "claude_session");
        return names;
    }

    // ── what is sent ─────────────────────────────────────────────────

    /// <summary>The requirement a task came from, as the prompts carry it: its title and notes, in order.</summary>
    private Task<(string? Key, string Ctx)> RequirementContextAsync(Guid clientId, Guid workitemId, CancellationToken ct) =>
        tenant.RunAsync(clientId, async d =>
        {
            var wi = await SqlJson.QuerySingleAsync(d, "select key, title from workitem where id = @w", new { w = workitemId }, ct);
            var notes = await SqlJson.QueryAsync(d, """
                select payload->>'body' as body from event_log
                where workitem_id = @w and type = 'note.added' and supersedes is null order by occurred_at asc limit 20
                """, new { w = workitemId }, ct);
            var key = wi?["key"]?.GetValue<string>();
            var parts = new List<string> { $"Requirement {key ?? ""}: {wi?["title"]?.GetValue<string>() ?? ""}" };
            parts.AddRange(notes.Select(n => n["body"]?.GetValue<string>() ?? "").Where(b => b.Length > 0));
            return (key, Cut(string.Join("\n\n", parts), 6000));
        }, ct);

    private static Dictionary<string, object?> BuiltOnVars(TaskBuiltOn b) => new()
    {
        ["BUILT_ON"] = b.On is { } on ? TaskBranches.DepLabel(on.Seq, on.Intent) : "",
        ["MISSING"] = string.Join(", ", b.Missing.Select(m => TaskBranches.DepLabel(m.Seq, m.Intent))),
    };

    private sealed record BuiltPrompt(string Prompt, string PromptHe, string Instruction, TaskRow Task, bool HasChecks);

    /// <summary>The prompt's TEXT is the same for the real run and the preview. A task writes the code and its tests; a check run on its own is that one check.</summary>
    private async Task<BuiltPrompt> BuildImplementPromptAsync(Guid clientId, Guid workitemId, Guid taskId, Optional<TaskBuiltOn?> built, CancellationToken ct)
    {
        var t = await store.GetAsync(clientId, taskId, ct) ?? throw AppException.NotFound("task");
        // The task's own prompt is the instruction — written by the breakdown, reviewed before approval, run verbatim.
        var instruction = (t.Prompt ?? "").Trim() is { Length: > 0 } p ? p : t.Intent;
        if (t.Kind == "check")
        {
            var owner = t.ParentTaskId is { } pid ? await store.GetAsync(clientId, pid, ct) : null;
            if (owner is null) throw AppException.Conflict("task_refused", "לבדיקה הזו אין משימה שהיא בודקת — אין מה לאמת");
            var dir = await store.ExistingCloneAsync(clientId, workitemId, ct);
            var rel = await store.RelationsAsync(clientId, owner.WorkitemId, ct);
            var subs = rel.IsGroup(owner.Id) ? rel.SubtasksOf(owner.Id) : null;
            TaskBuiltOn? b = null;
            if (subs is null)
            {
                if (built.HasValue) b = built.Value;
                else try { b = await facts.BuiltOnAsync(clientId, owner.Id, ct, dir); } catch (AppException) { }
            }
            var c = await BuildChecksPromptAsync(clientId, owner, [t], b, dir, subs, ct);
            return new BuiltPrompt(c.Prompt, c.PromptHe, instruction, t, false);
        }

        var (_, ctx) = await RequirementContextAsync(clientId, workitemId, ct);
        var tmpl = await prompts.RequireAsync("implement.task", ct);
        var vars = new Dictionary<string, object?>
        {
            ["INSTRUCTION"] = instruction,
            ["SHORT_TITLE"] = (t.Prompt ?? "").Trim() is { Length: > 0 } pr && pr != t.Intent ? t.Intent : "",
            ["AFFECTED_PATHS"] = string.Join(", ", t.AffectedPaths),
            ["APPETITE"] = t.Appetite,
            ["CONTEXT"] = ctx,
        };
        if (built.HasValue && built.Value is { } bo) foreach (var (k, v) in BuiltOnVars(bo)) vars[k] = v;
        var prompt = PromptContract.Render(tmpl.Body, vars);
        var promptHe = tmpl.BodyHe is { } he ? PromptContract.Render(he, vars) : prompt;
        var counted = (await store.ChecksOfAsync(clientId, t.Id, ct)).Count;
        return new BuiltPrompt(prompt, promptHe, instruction, t, counted > 0);
    }

    /// <summary>A task's checks as one run without write access (checks.run), numbered by seq so each verdict comes back to its own row.</summary>
    private async Task<(string Prompt, string PromptHe)> BuildChecksPromptAsync(Guid clientId, TaskRow owner, IReadOnlyList<TaskRow> checks, TaskBuiltOn? built, string? dir, IReadOnlyList<TaskRow>? subtasks, CancellationToken ct)
    {
        var (key, ctx) = await RequirementContextAsync(clientId, owner.WorkitemId, ct);
        var changed = "(not known here — read this branch's own commits)";
        if (dir is not null)
        {
            var files = new SortedSet<string>(StringComparer.Ordinal);
            var ordered = new List<string>();
            var any = false;
            foreach (var s in subtasks ?? [owner])
            {
                var branch = store.BranchOf(key, s);
                if (!await Git.ExistsAsync(dir, branch)) continue;
                any = true;
                if (await Git.TaskBaseShaAsync(dir, branch, s.BaseSha) is { } from)
                    foreach (var f in Git.Lines((await Git.RunAsync(dir, "diff", "--name-only", $"{from}..{branch}")).Out))
                        if (files.Add(f)) ordered.Add(f);
            }
            if (any) changed = ordered.Count > 0 ? string.Join(", ", ordered) : "(none — this task changed no files)";
        }
        var tmpl = await prompts.RequireAsync("checks.run", ct);
        var vars = new Dictionary<string, object?>
        {
            ["INTENT"] = owner.Intent, ["CHANGED_FILES"] = changed, ["CONTEXT"] = ctx,
            ["CHECKS"] = string.Join("\n", checks.Select(c => $"#{c.Seq}{(c.CheckKind is { } k ? $" [{k}]" : "")}: {((c.Prompt ?? "").Trim() is { Length: > 0 } p ? p : c.Intent)}")),
        };
        if (built is not null) foreach (var (k, v) in BuiltOnVars(built)) vars[k] = v;
        var prompt = PromptContract.Render(tmpl.Body, vars);
        return (prompt, tmpl.BodyHe is { } he ? PromptContract.Render(he, vars) : prompt);
    }

    /// <summary>What building a task means right now, read from its branch — the same facts for the preview and the run.</summary>
    private static async Task<BuildPlan> BuildPlanForAsync(string dir, TaskRow owner, string branch)
    {
        if (!await Git.ExistsAsync(dir, branch)) return BuildPlan.Nothing("למשימה עוד אין ענף — היא עוד לא פותחה");
        var from = await Git.TaskBaseShaAsync(dir, branch, owner.BaseSha);
        var changed = from is not null ? Git.Lines((await Git.RunAsync(dir, "-c", "core.quotepath=false", "diff", "--name-only", $"{from}..{branch}")).Out) : [];
        var files = Git.Lines((await Git.RunAsync(dir, "-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", branch)).Out);
        return await BuildRecipes.PlanAsync(new BuildPlanInput(dir, files, changed, owner.CompiledComponents, async rel =>
        {
            var r = await Git.RunAsync(dir, "show", $"{branch}:{rel}");
            return r.Ok ? r.Out : null;
        }, BuildRecipes.FindClassicMsbuild()));
    }

    /// <summary>Render (never run) what a run would send — or, for a build check, the real commands; for a group, why nothing.</summary>
    public async Task<JsonObject> PreviewAsync(Guid clientId, Guid workitemId, Guid taskId, CancellationToken ct)
    {
        TaskBuiltOn? built = null;
        try { built = await facts.BuiltOnAsync(clientId, taskId, ct); } catch (AppException) { }
        var t0 = await store.GetAsync(clientId, taskId, ct);
        if (t0 is { Kind: "check", CheckKind: "build", ParentTaskId: { } ownerId })
        {
            var owner = await store.GetAsync(clientId, ownerId, ct);
            var key = await store.RequirementKeyAsync(clientId, workitemId, ct);
            var dir = await store.ExistingCloneAsync(clientId, workitemId, ct);
            var plan = owner is null ? BuildPlan.Cannot("לבדיקה הזו אין משימה שהיא בונה")
                : dir is null ? BuildPlan.Nothing("אין עדיין עותק עבודה של המאגר — המשימה עוד לא פותחה")
                : await BuildPlanForAsync(dir, owner, store.BranchOf(key, owner));
            var text = BuildRecipes.Describe(plan);
            return new JsonObject { ["prompt"] = text, ["promptHe"] = text, ["approved"] = t0.Approved, ["deterministic"] = true };
        }
        if (t0 is { Kind: "task" } && (await store.RelationsAsync(clientId, t0.WorkitemId, ct)).IsGroup(t0.Id))
            return new JsonObject { ["prompt"] = GroupNotDeveloped, ["promptHe"] = GroupNotDeveloped, ["approved"] = t0.Approved, ["deterministic"] = true };
        var b = await BuildImplementPromptAsync(clientId, workitemId, taskId, built, ct);
        return new JsonObject { ["prompt"] = b.Prompt, ["promptHe"] = b.PromptHe, ["approved"] = b.Task.Approved };
    }

    // ── the checks step ──────────────────────────────────────────────

    private static JsonObject Outcome(int seq, string? kind, bool passed, string detail, string? cause) =>
        new() { ["seq"] = seq, ["kind"] = kind, ["passed"] = passed, ["detail"] = detail, ["likelyCause"] = cause };

    /// <summary>
    /// The build check — never a model call: the projects that hold what the task changed, built with their real
    /// command, one after another. "Nothing to build" passes and says so; a change DCC cannot build fails as an
    /// environment matter, in words.
    /// </summary>
    private async Task<(string Summary, List<JsonObject> Checks)> RunBuildStepAsync(FlowRunInput input, string dir, TaskRow owner, IReadOnlyList<TaskRow> checks, string branch, CancellationToken ct)
    {
        var plan = await BuildPlanForAsync(dir, owner, branch);
        bool passed;
        string detail;
        string? cause = null;
        if (plan.Kind == "build")
        {
            hub.PushLine(input.RunId, $"Build ישירות (בלי AI): {string.Join(", ", plan.Recipes!.Select(r => r.Project))}");
            var outs = new List<string>();
            passed = true;
            // One at a time: projects that reference each other write the same output folders.
            foreach (var r in plan.Recipes!)
            {
                var res = await BuildRecipes.RunAsync(r, ct: ct);
                outs.Add($"{r.Tool} {r.Project} — {(res.Passed ? "עבר" : "נכשל")}:\n{(res.Out.Length > 2000 ? res.Out[^2000..] : res.Out)}");
                if (!res.Passed) { passed = false; break; }
            }
            detail = string.Join("\n\n", outs.Concat(plan.Notes!));
            if (!passed) cause = "implementation";
        }
        else
        {
            passed = plan.Kind == "nothing";
            detail = BuildRecipes.Describe(plan);
            if (!passed) cause = "environment";
        }
        var verdict = plan.Kind == "nothing" ? "אין מה לבנות" : plan.Kind == "cannot" ? "אי אפשר לבנות כאן" : passed ? "עבר" : "נכשל";

        var outcomes = new List<JsonObject>();
        foreach (var c in checks)
        {
            await store.ExecAsync(input.ClientId, "update task set check_result = @r, check_cause = @c, state = @s::task_state, updated_at = now() where id = @id",
                new { id = c.Id, r = passed ? "passed" : "failed", c = cause, s = passed ? "done" : "pending" }, ct);
            await store.NoteAsync(input.ClientId, input.WorkitemId, c.Id, Delegated(input.UserId),
                $"{(passed ? "✓" : "✕")} בדיקה #{c.Seq} (Build, בלי AI) — {verdict}: {Cut(detail, 800)}", ct, "claude_session");
            hub.PushLine(input.RunId, $"{(passed ? "✓" : "✕")} בדיקה #{c.Seq} {Cut(c.Intent, 50)} — {verdict}");
            outcomes.Add(Outcome(c.Seq, c.CheckKind, passed, detail, cause));
        }
        return ($"Build (בלי AI): {verdict}", outcomes);
    }

    /// <summary>
    /// Some of a task's checks as one call that may read and run commands but not edit, each verdict to its own
    /// row. Needs work that is not there yet → waits; could not run here → says so; not reported → "not run".
    /// Whatever a check changed in tracked files is put back — a check that changes code proves nothing.
    /// </summary>
    private async Task<(string Summary, List<JsonObject> Checks)> RunChecksStepAsync(FlowRunInput input, string dir, TaskRow owner, IReadOnlyList<TaskRow> checks, TaskBuiltOn? built, IReadOnlyList<TaskRow>? subtasks, CancellationToken ct)
    {
        var (prompt, _) = await BuildChecksPromptAsync(input.ClientId, owner, checks, built, dir, subtasks, ct);
        var res = await claude.RunJsonAsync(dir, prompt, new ClaudeCall
        {
            TimeoutMs = 900_000, RunId = input.RunId, Commands = true,
            Ledger = new LedgerContext
            {
                ClientId = input.ClientId, UserId = input.UserId, Capability = "execution", Trigger = input.Trigger,
                Entity = ("task", owner.Id.ToString()), WorkitemId = input.WorkitemId, Screen = "task",
                Label = $"בדיקות משימה #{owner.Seq}: {string.Join(", ", checks.Select(c => $"#{c.Seq}"))}",
                Signals = new RoutingSignals { Mechanical = true }, Meta = new { taskSeq = owner.Seq, check = true },
            },
        }, ct);
        if ((await Git.RunAsync(dir, "status", "--porcelain", "--untracked-files=no")).Out.Trim().Length > 0)
        {
            await Git.RunAsync(dir, "reset", "--hard");
            hub.PushLine(input.RunId, "⚠ בזמן הבדיקות השתנו קבצים במאגר — השינוי בוטל: בדיקה לא משנה קוד");
        }

        var reported = new Dictionary<int, JsonObject>();
        foreach (var c in ((res as JsonObject)?["checks"] as JsonArray ?? []).OfType<JsonObject>())
            if (c["seq"] is JsonValue sv && sv.TryGetValue<double>(out var s)) reported[(int)s] = c;
        var outcomes = new List<JsonObject>();
        foreach (var c in checks)
        {
            var cr = reported.GetValueOrDefault(c.Seq);
            var passedFlag = cr?["passed"] is JsonValue pv && pv.TryGetValue<bool>(out var pb) && pb;
            string? cause = cr is not null && !passedFlag
                ? (TaskFacts.Str(cr, "likelyCause") is { } lc && CheckCauses.Contains(lc) ? lc : "implementation") : null;
            var result = cr is null ? null : passedFlag ? "passed" : cause == "dependency_missing" ? "waiting" : "failed";
            await store.ExecAsync(input.ClientId, "update task set check_result = @r, check_cause = @c, state = @s::task_state, updated_at = now() where id = @id",
                new { id = c.Id, r = result, c = cause, s = result == "passed" ? "done" : "pending" }, ct);
            var detail = cr is not null ? TaskFacts.Str(cr, "detail") ?? "" : "Claude לא דיווח על הבדיקה הזו — היא לא רצה";
            var mark = result switch { "passed" => "✓", "waiting" => "⏸", null => "·", _ => "✕" };
            var note = result == "waiting" ? " מחכה לתלות" : cause == "environment" ? " לא יכלה לרוץ כאן" : "";
            await store.NoteAsync(input.ClientId, input.WorkitemId, c.Id, Delegated(input.UserId),
                $"{mark} בדיקה #{c.Seq}{note}: {detail}{(cause == "requirement_ambiguity" ? "\n(נראה כמו עמימות בדרישה, לא באג — כדאי לבדוק שלבים מוקדמים)" : "")}", ct, "claude_session");
            outcomes.Add(Outcome(c.Seq, c.CheckKind, result == "passed", detail, cause));
            hub.PushLine(input.RunId, $"{mark} בדיקה #{c.Seq} {Cut(c.Intent, 50)}{note}");
        }
        return (TaskFacts.Str(res as JsonObject, "summary") ?? "", outcomes);
    }

    /// <summary>
    /// A group's check runs on its sub-tasks' work together: a local branch from the default branch with each
    /// developed sub-task's branch merged in (never pushed). Returns what conflicts, in words — a finding about the group.
    /// </summary>
    private async Task<string?> IntegrateSubtasksAsync(string dir, string? key, string branch, IReadOnlyList<TaskRow> subs, Guid runId)
    {
        var withCode = new List<TaskRow>();
        var missing = new List<int>();
        foreach (var s in subs)
        {
            if (await Git.TaskCommitCountAsync(dir, store.BranchOf(key, s), s.BaseSha) > 0) withCode.Add(s);
            else if (s.State != "done") missing.Add(s.Seq);
        }
        if (missing.Count > 0) throw AppException.Conflict("task_refused", $"בדיקת הקבוצה רצה על העבודה של כל תת-המשימות יחד — {string.Join(", ", missing.Select(n => $"#{n}"))} עוד לא פותחה");
        await Git.RunAsync(dir, "checkout", "-B", branch, await Git.DefaultBranchAsync(dir));
        foreach (var s in withCode)
        {
            var from = store.BranchOf(key, s);
            var m = await Git.RunAsync(dir, "-c", "user.name=DCC", "-c", "user.email=dcc@localhost", "merge", "--no-edit", "--no-ff", from);
            if (!m.Ok)
            {
                var files = Git.Lines((await Git.RunAsync(dir, "-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=U")).Out);
                await Git.RunAsync(dir, "merge", "--abort");
                var before = string.Join(", ", withCode.Take(withCode.IndexOf(s)).Select(x => $"#{x.Seq}"));
                return $"תת-משימה #{s.Seq} מתנגשת עם {(before.Length > 0 ? before : "הענף הראשי")}{(files.Count > 0 ? $" בקבצים {string.Join(", ", files)}" : "")} — הן שינו את אותם מקומות בדרכים שונות, ולכן אי אפשר לבדוק אותן יחד עד שמיישבים את זה";
            }
            hub.PushLine(runId, $"מוזג לבדיקה: #{s.Seq}");
        }
        return null;
    }

    private static JsonObject Result(string branch, string dir, string? repoName, string summary, IEnumerable<string>? filesChanged = null, string? commit = null,
        string? testsRun = null, JsonArray? followUps = null, JsonArray? consumers = null) => new()
    {
        ["branch"] = branch, ["dir"] = dir, ["repoName"] = repoName, ["summary"] = summary,
        ["filesChanged"] = new JsonArray((filesChanged ?? []).Select(f => (JsonNode?)f).ToArray()),
        ["commit"] = commit, ["testsRun"] = testsRun, ["followUps"] = followUps ?? [], ["affectedConsumers"] = consumers ?? [],
    };

    // ── the run ──────────────────────────────────────────────────────

    public async Task<JsonNode> RunAsync(FlowRunInput input, CancellationToken ct)
    {
        var taskId = input.TaskId ?? throw new InvalidOperationException("an implement run needs a task");
        var t = await store.GetAsync(input.ClientId, taskId, ct) ?? throw AppException.NotFound("task");
        // Defense in depth — the action refuses this before a run is queued; a run only does what this lets it.
        if (!t.Approved) throw AppException.Conflict("task_refused", "המשימה טרם אושרה — אי אפשר לפתח לפני אישור.");
        var key = await store.RequirementKeyAsync(input.ClientId, input.WorkitemId, ct);
        var isCheck = t.Kind == "check";
        var r = await store.FirstRepoAsync(input.ClientId, input.WorkitemId, ct) ?? throw AppException.Conflict("task_refused", "אין repository מקושר לדרישה — אי אפשר לפתח בלי קוד");
        // Deliberately the CACHE clone, never the user's own working copy.
        var cache = r with { LocalPath = null };
        hub.PushLine(input.RunId, checkouts.StartLine(cache));
        var dir = await checkouts.EnsureAsync(cache) ?? throw AppException.Conflict("task_refused", $"לא הצלחתי להביא עותק של {r.Name}");

        // A check run on its own verifies its task's branch; a group's check, all its sub-tasks' work together.
        var branchOwner = t;
        if (isCheck && t.ParentTaskId is { } pid && await store.GetAsync(input.ClientId, pid, ct) is { } parent) branchOwner = parent;
        var rel = await store.RelationsAsync(input.ClientId, input.WorkitemId, ct);
        if (!isCheck && rel.IsGroup(t.Id)) throw AppException.Conflict("task_refused", GroupNotDeveloped);
        var groupSubs = isCheck && rel.IsGroup(branchOwner.Id) ? rel.SubtasksOf(branchOwner.Id) : null;
        var branch = groupSubs is not null ? $"{store.BranchOf(key, branchOwner)}-together" : store.BranchOf(key, branchOwner);
        hub.PushLine(input.RunId, $"branch: {branch}");

        await Git.RunAsync(dir, "reset", "--hard");
        await Git.RunAsync(dir, "clean", "-fd");
        TaskBuiltOn? built = null;
        var baseSha = t.BaseSha;
        if (isCheck && groupSubs is not null)
        {
            if (await IntegrateSubtasksAsync(dir, key, branch, groupSubs, input.RunId) is { } conflict)
            {
                await store.ExecAsync(input.ClientId, "update task set check_result = 'failed', check_cause = 'implementation', state = 'pending', updated_at = now() where id = @id", new { id = t.Id }, ct);
                await store.NoteAsync(input.ClientId, input.WorkitemId, t.Id, Delegated(input.UserId), $"✕ בדיקה #{t.Seq}: {conflict}", ct, "claude_session");
                await store.SyncStateAfterChecksAsync(input.ClientId, branchOwner.Id, ct);
                await brief.RegenerateAsync(input.ClientId, input.WorkitemId, ct);
                var res0 = Result(branch, dir, r.Name, conflict);
                res0["checks"] = new JsonArray(Outcome(t.Seq, t.CheckKind, false, conflict, "implementation"));
                return res0;
            }
        }
        else if (isCheck)
        {
            if (!await Git.ExistsAsync(dir, branch)) throw AppException.Conflict("task_refused", $"אין branch בשם {branch} — המשימה שהבדיקה הזו שייכת לה עוד לא פותחה, אין מה לאמת");
            await Git.RunAsync(dir, "checkout", branch);
        }
        else if (await Git.TaskCommitCountAsync(dir, branch, t.BaseSha) > 0 || (t.BaseSha is not null && await Git.ExistsAsync(dir, branch)))
        {
            // Developed already: continue on it, on what it was built on.
            await Git.RunAsync(dir, "checkout", branch);
            built = await facts.BuiltOnAsync(input.ClientId, taskId, ct, dir);
        }
        else
        {
            // A first run, or one after a rollback: decide now what the branch starts from, and record it.
            var def = await Git.DefaultBranchAsync(dir);
            var plan = await facts.PlanBaseAsync(input.ClientId, t, key, dir, ct);
            var from = plan.On?.Branch ?? def;
            baseSha = (await Git.RunAsync(dir, "rev-parse", from)).Out;
            await Git.RunAsync(dir, "checkout", "-B", branch, from);
            await store.ExecAsync(input.ClientId, """
                update task set branch = @b, base_task_id = @bt, base_branch = @bb, base_sha = @bs, built_without = @bw, updated_at = now() where id = @id
                """, new { id = t.Id, b = branch, bt = plan.On is { } on0 ? Guid.Parse(on0.Id) : (Guid?)null, bb = from, bs = baseSha, bw = SqlJson.Jsonb(plan.Missing.Select(m => m.Dep.Id).ToArray()) }, ct);
            built = new TaskBuiltOn("built", plan.On is { } on ? new BuiltOnRef(Guid.Parse(on.Id), on.Seq, on.Intent, from) : null,
                plan.Missing.Select(m => new BuiltOnMissing(Guid.Parse(m.Dep.Id), m.Dep.Seq, m.Dep.Intent, m.Dep.State, m.Why)).ToList(), false, []);
            if (plan.On is { } o2) hub.PushLine(input.RunId, $"בונה על גבי הענף של משימה #{o2.Seq} — העבודה שלה עוד לא בענף הראשי, וקלוד יראה אותה");
            if (plan.Missing.Count > 0) hub.PushLine(input.RunId, $"⚠ מפתח בלי {string.Join(", ", plan.Missing.Select(m => $"#{m.Dep.Seq}"))} — העבודה שלהן עוד לא קיימת בקוד. בדיקות שצריכות אותה יסומנו \"מחכות לתלות\"");
        }

        if (isCheck)
        {
            hub.SetPhase(input.RunId, "test");
            TaskBuiltOn? ownerBuilt = null;
            if (groupSubs is null) try { ownerBuilt = await facts.BuiltOnAsync(input.ClientId, branchOwner.Id, ct, dir); } catch (AppException) { }
            var step = t.CheckKind == "build" && groupSubs is null
                ? await RunBuildStepAsync(input, dir, branchOwner, [t], branch, ct)
                : await RunChecksStepAsync(input, dir, branchOwner, [t], ownerBuilt, groupSubs, ct);
            await store.SyncStateAfterChecksAsync(input.ClientId, branchOwner.Id, ct);
            await store.NoteAsync(input.ClientId, input.WorkitemId, taskId, Delegated(input.UserId), $"🔍 Claude אימת בדיקה #{t.Seq}: {Cut(t.Intent, 70)}\n\n{step.Summary}", ct, "claude_session");
            await brief.RegenerateAsync(input.ClientId, input.WorkitemId, ct);
            var res1 = Result(branch, dir, r.Name, step.Summary);
            res1["checks"] = new JsonArray(step.Checks.Select(x => (JsonNode?)x).ToArray());
            return res1;
        }

        // Kept on the run from the start, so a run that fails still says what it was built on.
        var baseJson = built is not null ? TaskFacts.BaseJson(new FlowBase(built.On is { } bo ? new FlowBaseOn(bo.Seq, baseSha) : null, built.Missing.Select(m => m.Seq).ToList())) : null;
        if (baseJson is not null)
            await SqlJson.ExecuteAsync(db, "update flow_run set result = @r where id = @id", new { id = input.RunId, r = SqlJson.Jsonb(new JsonObject { ["base"] = baseJson.DeepClone() }) }, ct);

        var added = await EnsureStandardChecksAsync(input.ClientId, t.Id, RequiredChecks, false, input.UserId, ct);
        if (added.Count > 0) hub.PushLine(input.RunId, $"נוספו למשימה בדיקות חובה: {string.Join(", ", added)}");

        // 1 — development: the code, and the tests for it.
        hub.SetPhase(input.RunId, "develop");
        hub.PushLine(input.RunId, "שלב 1 מתוך 3 — פיתוח");
        var bp = await BuildImplementPromptAsync(input.ClientId, input.WorkitemId, taskId, built, ct);
        hub.PushLine(input.RunId, $"הפרומט של המשימה:\n{bp.Instruction}");
        var res = await claude.RunJsonAsync(dir, bp.Prompt, new ClaudeCall
        {
            TimeoutMs = 900_000, RunId = input.RunId, Write = true,
            Ledger = new LedgerContext
            {
                ClientId = input.ClientId, UserId = input.UserId, Capability = "execution", Trigger = input.Trigger,
                Entity = ("task", taskId.ToString()), WorkitemId = input.WorkitemId, Screen = "task",
                Label = $"פיתוח משימה #{t.Seq}: {Cut(t.Intent, 60)}", Signals = new RoutingSignals { Mechanical = false }, Meta = new { taskSeq = t.Seq, check = false },
            },
        }, ct);

        string? commit = null;
        hub.PushLine(input.RunId, "מקומיט מקומית (בלי push)…");
        await Git.RunAsync(dir, "add", "-A");
        var changed = Git.Lines((await Git.RunAsync(dir, "diff", "--cached", "--name-only")).Out);
        if (changed.Count > 0)
        {
            var msg = $"{key ?? "REQ"} t{t.Seq}: {Cut(t.Intent, 90)}\n\nDCC task {t.Id}\n\nCo-Authored-By: Claude <noreply@anthropic.com>";
            var (name, email) = await store.CommitIdentityAsync(input.UserId, ct);
            var c = await Git.RunAsync(dir, "-c", $"user.name={name}", "-c", $"user.email={email}", "commit", "-m", msg);
            if (c.Ok) commit = (await Git.RunAsync(dir, "rev-parse", "--short", "HEAD")).Out;
            hub.PushLine(input.RunId, commit is not null ? $"✓ commit {commit} · {changed.Count} קבצים" : $"commit נכשל: {Cut(c.Out, 200)}");
            await store.ExecAsync(input.ClientId, "update task set state = 'in_progress', updated_at = now() where id = @id", new { id = taskId }, ct);
        }
        else hub.PushLine(input.RunId, "לא השתנו קבצים");

        // 2 — the build; 3 — every other check, only once it builds.
        var checks = await store.ChecksOfAsync(input.ClientId, t.Id, ct);
        var buildChecks = checks.Where(c => c.CheckKind == "build").ToList();
        var rest = checks.Where(c => c.CheckKind != "build").ToList();
        var outcomes = new List<JsonObject>();
        var skipped = new List<int>();
        if (buildChecks.Count > 0)
        {
            hub.SetPhase(input.RunId, "build");
            hub.PushLine(input.RunId, "שלב 2 מתוך 3 — Build");
            outcomes.AddRange((await RunBuildStepAsync(input, dir, t, buildChecks, branch, ct)).Checks);
        }
        if (rest.Count > 0)
        {
            if (outcomes.All(o => o["passed"]!.GetValue<bool>()))
            {
                hub.SetPhase(input.RunId, "test");
                hub.PushLine(input.RunId, "שלב 3 מתוך 3 — בדיקות");
                outcomes.AddRange((await RunChecksStepAsync(input, dir, t, rest, built, null, ct)).Checks);
            }
            else
            {
                // Tests of code that does not build say nothing — they wait for the build to pass.
                skipped = rest.Select(c => c.Seq).ToList();
                await store.ExecAsync(input.ClientId, "update task set check_result = null, check_cause = null, state = 'pending', updated_at = now() where id = any(@ids)",
                    new { ids = rest.Select(c => c.Id).ToArray() }, ct);
                hub.PushLine(input.RunId, $"⚠ ה-Build לא עבר — {rest.Count} הבדיקות האחרות לא רצו");
            }
        }
        await store.SyncStateAfterChecksAsync(input.ClientId, taskId, ct);

        var passedCount = outcomes.Count(o => o["passed"]!.GetValue<bool>());
        var waiting = outcomes.Count(o => TaskFacts.Str(o, "likelyCause") == "dependency_missing");
        var summary = TaskFacts.Str(res as JsonObject, "summary") ?? "";
        await store.NoteAsync(input.ClientId, input.WorkitemId, taskId, Delegated(input.UserId),
            $"🛠 Claude פיתח משימה #{t.Seq}: {Cut(t.Intent, 70)}\nbranch {branch}{(commit is not null ? $" · commit {commit}" : " · ללא שינויים")}"
            + (outcomes.Count > 0 ? $" · {passedCount}/{outcomes.Count} בדיקות עברו" : "") + (waiting > 0 ? $", {waiting} מחכות לתלות" : "")
            + (skipped.Count > 0 ? $", {skipped.Count} לא רצו — ה-Build לא עבר" : "") + $"\n\n{summary}", ct, "claude_session");
        await brief.RegenerateAsync(input.ClientId, input.WorkitemId, ct);

        var reported = ((res as JsonObject)?["filesChanged"] as JsonArray)?.Select(x => x?.ToString() ?? "").ToList() ?? [];
        var consumers = new JsonArray(((res as JsonObject)?["affectedConsumers"] as JsonArray ?? []).OfType<JsonObject>().Select(c => (JsonNode?)new JsonObject
        {
            ["path"] = TaskFacts.Str(c, "path"), ["usedBy"] = c["usedBy"]?.DeepClone() ?? new JsonArray(), ["reason"] = TaskFacts.Str(c, "reason"),
        }).ToArray());
        var result = Result(branch, dir, r.Name, summary, changed.Count > 0 ? changed : reported, commit, TaskFacts.Str(res as JsonObject, "testsRun"),
            (res as JsonObject)?["followUps"] is JsonArray fu ? (JsonArray)fu.DeepClone() : null, consumers);
        if (outcomes.Count > 0) result["checks"] = new JsonArray(outcomes.Select(x => (JsonNode?)x).ToArray());
        if (skipped.Count > 0) result["skipped"] = new JsonArray(skipped.Select(x => (JsonNode?)x).ToArray());
        if (baseJson is not null) result["base"] = baseJson;
        return result;
    }

    // ── a task's runs, as its screen tells them ──────────────────────

    /// <summary>Every development run of a task, oldest first — what each round of its story was. Never the transcript.</summary>
    public async Task<JsonArray> HistoryAsync(Guid taskId, CancellationToken ct)
    {
        var runs = await store.ImplementRunsAsync("task_id = @t", new { t = taskId }, ct, "started_at");
        return new JsonArray(runs.Where(r => TaskFacts.Str(r, "state") is not ("stopped" or "running")).Select(r =>
        {
            var res = r["result"] as JsonObject ?? new JsonObject();
            return (JsonNode?)new JsonObject
            {
                ["id"] = r["id"]?.DeepClone(), ["state"] = r["state"]?.DeepClone(), ["startedAt"] = r["startedAt"]?.DeepClone(), ["finishedAt"] = r["finishedAt"]?.DeepClone(),
                ["summary"] = res["summary"]?.DeepClone() ?? "", ["filesChanged"] = res["filesChanged"]?.DeepClone() ?? new JsonArray(),
                ["commit"] = res["commit"]?.DeepClone(), ["testsRun"] = res["testsRun"]?.DeepClone(), ["followUps"] = res["followUps"]?.DeepClone() ?? new JsonArray(),
                ["checks"] = res["checks"]?.DeepClone() ?? new JsonArray(), ["skipped"] = res["skipped"]?.DeepClone() ?? new JsonArray(),
                ["manual"] = res["manual"]?.DeepClone(), ["error"] = r["error"]?.DeepClone(),
            };
        }).ToArray());
    }

    /// <summary>The transcript of one development run — read only when a person asks for it.</summary>
    public async Task<JsonNode> RunLogAsync(Guid taskId, Guid runId, CancellationToken ct) =>
        (await SqlJson.QuerySingleAsync(db, "select log from flow_run where id = @id and task_id = @t", new { id = runId, t = taskId }, ct))?["log"]?.DeepClone() ?? new JsonArray();

    /// <summary>What the development in place says it did — the latest finished run that was not rolled back.</summary>
    public async Task<JsonNode?> LatestDevelopmentAsync(Guid taskId, CancellationToken ct) =>
        (await store.ImplementRunsAsync("task_id = @t and state = 'done'", new { t = taskId }, ct)).FirstOrDefault()?["result"]?.DeepClone();

    /// <summary>Adds to the latest finished run's result — it was pushed, or the task was closed on it.</summary>
    public async Task MarkLatestRunAsync(Guid taskId, string field, CancellationToken ct)
    {
        var last = (await store.ImplementRunsAsync("task_id = @t and state = 'done'", new { t = taskId }, ct)).FirstOrDefault();
        if (last is null) return;
        var res = last["result"] as JsonObject ?? new JsonObject();
        res[field] = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
        await SqlJson.ExecuteAsync(db, "update flow_run set result = @r where id = @id", new { id = Guid.Parse(TaskFacts.Str(last, "id")!), r = SqlJson.Jsonb(res) }, ct);
    }

    // ── rollback and push ────────────────────────────────────────────

    /// <summary>
    /// Undo everything a run did for one task, in DCC's own copy: its branch back to where its own work starts,
    /// what it was built on forgotten (the next run decides again), its checks back to not run, its runs kept as history.
    /// </summary>
    public async Task<JsonObject> RollbackAsync(Guid clientId, Guid workitemId, Guid taskId, Guid actor, CancellationToken ct)
    {
        var t = await store.RequireAsync(clientId, taskId, ct);
        var key = await store.RequirementKeyAsync(clientId, workitemId, ct);
        var r = await store.FirstRepoAsync(clientId, workitemId, ct) ?? throw AppException.Conflict("task_refused", "אין repository מקושר לדרישה");
        var dir = await checkouts.EnsureAsync(r with { LocalPath = null }) ?? throw AppException.Conflict("task_refused", $"לא הצלחתי להביא עותק של {r.Name}");
        var branch = store.BranchOf(key, t);
        if (!await Git.ExistsAsync(dir, branch)) return new JsonObject { ["rolledBack"] = false, ["reason"] = "המשימה עדיין לא פותחה — אין מה לבטל" };

        await Git.RunAsync(dir, "checkout", branch);
        await Git.RunAsync(dir, "fetch", "origin", await Git.DefaultBranchAsync(dir));
        if (await Git.TaskBaseShaAsync(dir, branch, t.BaseSha) is { } from) await Git.RunAsync(dir, "reset", "--hard", from);
        await Git.RunAsync(dir, "clean", "-fd");

        await tenant.RunAsync(clientId, async d =>
        {
            await SqlJson.ExecuteAsync(d, """
                update task set state = case when state in ('in_progress', 'failed_checks') then 'pending'::task_state else state end, was_done = false,
                  base_task_id = null, base_branch = null, base_sha = null, built_without = '[]'::jsonb, updated_at = now() where id = @id
                """, new { id = taskId }, ct);
            return await SqlJson.ExecuteAsync(d, """
                update task set check_result = null, check_cause = null, check_resolved_by = null, check_resolved_at = null, state = 'pending', updated_at = now()
                where parent_task_id = @id and kind = 'check' and state <> 'dropped'
                """, new { id = taskId }, ct);
        }, ct);
        var invalidated = await SqlJson.ExecuteAsync(db, "update flow_run set state = 'rolled_back' where task_id = @t and kind = 'implement' and state = 'done'", new { t = taskId }, ct);
        await store.NoteAsync(clientId, workitemId, taskId, new UserActor(actor),
            $"↩ שינויי הקוד של משימה #{t.Seq} ({Cut(t.Intent, 60)}) בוטלו — ה-branch אופס לבסיס. המשימה נקייה כמו לפני שפותחה; מה שקרה נשאר בהיסטוריה.", ct, "claude_session");
        await brief.RegenerateAsync(clientId, workitemId, ct);
        return new JsonObject { ["rolledBack"] = true, ["branch"] = branch, ["dir"] = dir, ["invalidatedRuns"] = invalidated };
    }

    [GeneratedRegex(@"^git@([^:]+):(.+?)(\.git)?$")] private static partial Regex SshRemote();
    [GeneratedRegex(@"^https?://([^/]+)/(.+?)(\.git)?$")] private static partial Regex HttpsRemote();

    /// <summary>git@github.com:owner/repo.git or https://github.com/owner/repo.git → https://github.com/owner/repo</summary>
    public static string? HttpsRepoUrl(string remote)
    {
        if (SshRemote().Match(remote) is { Success: true } s) return $"https://{s.Groups[1].Value}/{s.Groups[2].Value}";
        if (HttpsRemote().Match(remote) is { Success: true } h) return $"https://{h.Groups[1].Value}/{h.Groups[2].Value}";
        return null;
    }

    /// <summary>
    /// Push a task's branch to the repository's real remote — the one step never automatic. Uses whatever git
    /// credentials are already set up. A task built on another task's branch is reviewed against that branch.
    /// </summary>
    public async Task<JsonObject> PushAsync(Guid clientId, Guid workitemId, Guid taskId, Guid actor, CancellationToken ct)
    {
        var t = await store.RequireAsync(clientId, taskId, ct);
        var key = await store.RequirementKeyAsync(clientId, workitemId, ct);
        var r = await store.FirstRepoAsync(clientId, workitemId, ct) ?? throw AppException.Conflict("task_refused", "אין repository מקושר לדרישה");
        var dir = await checkouts.EnsureAsync(r with { LocalPath = null }) ?? throw AppException.Conflict("task_refused", $"לא הצלחתי להביא עותק של {r.Name}");
        var branch = store.BranchOf(key, t);
        if (await Git.TaskCommitCountAsync(dir, branch, t.BaseSha) == 0) return new JsonObject { ["pushed"] = false, ["reason"] = "אין קוד מומש על המשימה הזו — אין מה לדחוף" };

        await Git.RunAsync(dir, "checkout", branch);
        var res = await Git.RunAsync(["push", "-u", "origin", branch], dir, 25_000);
        if (!res.Ok) return new JsonObject { ["pushed"] = false, ["reason"] = $"push נכשל: {Cut(res.Out, 400)}" };

        var remote = (await Git.RunAsync(dir, "remote", "get-url", "origin")).Out;
        var def = await Git.DefaultBranchAsync(dir);
        var baseBranch = def;
        string? note = null;
        if (t.BaseTaskId is { } baseTask && t.BaseBranch is { } bb && bb != def)
        {
            await Git.RunAsync(["fetch", "origin", def], dir, 25_000);
            var merged = await Git.IsAncestorAsync(dir, bb, $"origin/{def}");
            var onHost = (await Git.RunAsync(["ls-remote", "--exit-code", "--heads", "origin", bb], dir, 25_000)).Ok;
            var on = await store.GetAsync(clientId, baseTask, ct);
            var label = on is not null ? $"#{on.Seq}" : "המשימה שהיא בנויה עליה";
            if (!merged && onHost) baseBranch = bb;
            else if (!merged) note = $"המשימה בנויה על גבי הענף של {label}, והענף הזה לא נמצא ב-GitHub. אם {label} עוד לא נדחפה — דחפו אותה קודם, ואז פתחו את בקשת המיזוג של המשימה הזו מול הענף שלה ({bb}); בקשה מול {def} תכלול גם את העבודה של {label}. אם {label} כבר מוזגה — פתחו מול {def}.";
        }
        var httpsBase = HttpsRepoUrl(remote);
        await MarkLatestRunAsync(taskId, "pushedAt", ct);
        await store.NoteAsync(clientId, workitemId, taskId, new UserActor(actor), $"⬆ הקוד של משימה #{t.Seq} ({Cut(t.Intent, 60)}) נדחף ל-GitHub — branch {branch}.", ct, "git");
        await brief.RegenerateAsync(clientId, workitemId, ct);
        var o = new JsonObject
        {
            ["pushed"] = true, ["branch"] = branch,
            ["branchUrl"] = httpsBase is not null ? $"{httpsBase}/tree/{Uri.EscapeDataString(branch)}" : null,
            ["compareUrl"] = httpsBase is not null ? $"{httpsBase}/compare/{Uri.EscapeDataString(baseBranch)}...{Uri.EscapeDataString(branch)}?expand=1" : null,
            ["base"] = baseBranch,
        };
        if (httpsBase is null) { o.Remove("branchUrl"); o.Remove("compareUrl"); }
        if (note is not null) o["note"] = note;
        return o;
    }

    // ── deleting a task: surgical, never a silent cascade ────────────

    /// <summary>What deleting a task would really touch: its subtree, TFS links, implemented code, other tasks on the same files.</summary>
    public async Task<JsonObject> PrecheckDeleteAsync(Guid clientId, Guid workitemId, Guid taskId, CancellationToken ct)
    {
        var all = await store.OfRequirementAsync(clientId, workitemId, ct);
        var key = await store.RequirementKeyAsync(clientId, workitemId, ct);
        var byId = all.ToDictionary(t => t.Id);
        if (!byId.ContainsKey(taskId)) throw new AppException(404, "not_found", "משימה לא נמצאה");
        var childrenOf = all.Where(t => t.ParentTaskId is not null).GroupBy(t => t.ParentTaskId!.Value).ToDictionary(g => g.Key, g => g.ToList());
        var subtreeIds = new List<Guid>();
        var seen = new HashSet<Guid>();
        var queue = new Queue<Guid>([taskId]);
        while (queue.Count > 0)
        {
            var id = queue.Dequeue();
            if (!seen.Add(id)) continue;
            subtreeIds.Add(id);
            foreach (var c in childrenOf.GetValueOrDefault(id) ?? []) queue.Enqueue(c.Id);
        }
        var subtreeRows = subtreeIds.Select(id => byId[id]).ToList();

        // the latest finished run per task, for the files it really touched
        var latest = new Dictionary<Guid, JsonObject>();
        foreach (var run in await store.ImplementRunsAsync("workitem_id = @w and state = 'done'", new { w = workitemId }, ct))
            if (TaskFacts.Str(run, "taskId") is { } tid && !latest.ContainsKey(Guid.Parse(tid)) && run["result"] is JsonObject res) latest[Guid.Parse(tid)] = res;

        var repo = await store.FirstRepoAsync(clientId, workitemId, ct);
        var dir = repo is not null ? await checkouts.EnsureAsync(repo with { LocalPath = null }) : null;
        var commits = new Dictionary<Guid, int>();
        if (dir is not null) foreach (var t in subtreeRows) commits[t.Id] = await Git.TaskCommitCountAsync(dir, store.BranchOf(key, t), t.BaseSha);

        var subtree = new JsonArray(subtreeRows.Select(t => (JsonNode?)new JsonObject
        {
            ["id"] = t.Id.ToString(), ["seq"] = t.Seq, ["intent"] = t.Intent, ["kind"] = t.Kind, ["state"] = t.State,
            ["linkedAdoId"] = t.LinkedAdoId, ["adoUrl"] = t.AdoUrl, ["approvedAt"] = t.ApprovedAt, ["commitCount"] = commits.GetValueOrDefault(t.Id),
        }).ToArray());

        IEnumerable<string> FilesOf(TaskRow t) => t.AffectedPaths.Concat((latest.GetValueOrDefault(t.Id)?["filesChanged"] as JsonArray)?.Select(x => x?.ToString() ?? "") ?? []).Where(f => f.Length > 0);
        var subtreeFiles = subtreeRows.SelectMany(FilesOf).ToHashSet();
        var coTouched = new JsonArray();
        if (subtreeFiles.Count > 0)
            foreach (var t in all.Where(t => !seen.Contains(t.Id)))
            {
                var overlap = FilesOf(t).Distinct().Where(subtreeFiles.Contains).ToList();
                if (overlap.Count > 0)
                    coTouched.Add(new JsonObject { ["id"] = t.Id.ToString(), ["seq"] = t.Seq, ["intent"] = t.Intent, ["state"] = t.State, ["files"] = new JsonArray(overlap.Select(f => (JsonNode?)f).ToArray()) });
            }
        var hasChildren = subtreeRows.Count > 1;
        var hasAdo = subtreeRows.Any(t => t.LinkedAdoId is not null);
        var hasCode = commits.Values.Any(n => n > 0);
        var hasCo = coTouched.Count > 0;
        return new JsonObject
        {
            ["taskId"] = taskId.ToString(), ["subtree"] = subtree, ["coTouchedBy"] = coTouched,
            ["hasChildren"] = hasChildren, ["hasAdoLinks"] = hasAdo, ["hasImplementedCode"] = hasCode, ["hasCoTouch"] = hasCo,
            ["safe"] = !hasChildren && !hasAdo && !hasCode && !hasCo,
        };
    }

    public sealed record DeleteOptions(bool ConfirmSubtree, bool ConfirmAdoLinked, bool ConfirmCoTouch, bool RollbackImplemented, bool ConfirmOrphanCode);

    /// <summary>A delete that names each risk and needs it confirmed — 409 with the precheck otherwise. TFS items are never deleted, only noted.</summary>
    public async Task<JsonObject> DeleteAsync(Guid clientId, Guid workitemId, Guid taskId, Guid actor, DeleteOptions o, CancellationToken ct)
    {
        var pre = await PrecheckDeleteAsync(clientId, workitemId, taskId, ct);
        var subtree = pre["subtree"]!.AsArray().OfType<JsonObject>().ToList();
        var missing = new List<string>();
        if (pre["hasChildren"]!.GetValue<bool>() && !o.ConfirmSubtree) missing.Add($"{subtree.Count - 1} תת-פריטים ימחקו איתה");
        if (pre["hasAdoLinks"]!.GetValue<bool>() && !o.ConfirmAdoLinked) missing.Add("חלק כבר קיים ב-TFS — לא יימחק שם, רק יתועד שהוסר מ-DCC");
        if (pre["hasCoTouch"]!.GetValue<bool>() && !o.ConfirmCoTouch) missing.Add($"{pre["coTouchedBy"]!.AsArray().Count} משימות אחרות כבר נגעו באותם קבצים");
        if (pre["hasImplementedCode"]!.GetValue<bool>() && !o.RollbackImplemented && !o.ConfirmOrphanCode) missing.Add("יש קוד מומש שטרם בוטל — לבחור rollback או לאשר השארה כ-orphan");
        if (missing.Count > 0) throw new DeleteNeedsConfirmation($"מחיקה חסומה: {string.Join(" · ", missing)}", pre);

        var ids = subtree.Select(n => Guid.Parse(n["id"]!.GetValue<string>())).ToList();
        var rows = await store.OfRequirementAsync(clientId, workitemId, ct);
        var parentOf = rows.ToDictionary(r => r.Id, r => r.ParentTaskId);
        var remaining = ids.ToHashSet();
        var childCount = ids.ToDictionary(id => id, _ => 0);
        foreach (var id in ids) if (parentOf.GetValueOrDefault(id) is { } p && childCount.ContainsKey(p)) childCount[p]++;
        var order = new List<Guid>();
        while (remaining.Count > 0)
        {
            var leaf = ids.FirstOrDefault(id => remaining.Contains(id) && childCount[id] == 0);
            if (leaf == Guid.Empty) { order.AddRange(remaining); break; }
            order.Add(leaf);
            remaining.Remove(leaf);
            if (parentOf.GetValueOrDefault(leaf) is { } p && childCount.ContainsKey(p)) childCount[p]--;
        }

        var rolledBack = new JsonArray();
        if (o.RollbackImplemented)
            foreach (var n in subtree.Where(n => n["commitCount"]!.GetValue<int>() > 0))
            {
                await RollbackAsync(clientId, workitemId, Guid.Parse(n["id"]!.GetValue<string>()), actor, ct);
                rolledBack.Add(n["id"]!.GetValue<string>());
            }

        var adoNotes = 0;
        if (pre["hasAdoLinks"]!.GetValue<bool>() && await adoSync.ConnectionAsync(clientId, ct) is { Project.Length: > 0 } conn)
            foreach (var n in subtree)
                if (n["linkedAdoId"] is JsonValue av && av.TryGetValue<int>(out var adoId)
                    && await adoSync.HistoryNoteAsync(conn, adoId, $"🗑 הוסר מ-DCC (לא נמחק כאן ב-TFS) — ע\"י {actor}.", ct))
                    adoNotes++;

        var seq = subtree.FirstOrDefault(n => n["id"]!.GetValue<string>() == taskId.ToString())?["seq"]?.ToString() ?? "?";
        var lines = new List<string> { $"🗑 משימה #{seq} נמחקה ({subtree.Count} פריטים בסך הכל)." };
        if (rolledBack.Count > 0) lines.Add($"בוטל קוד עבור {rolledBack.Count} מהם לפני המחיקה.");
        if (adoNotes > 0) lines.Add($"{adoNotes} פריטי TFS תועדו כ\"הוסר מ-DCC\" (לא נמחקו שם).");
        await store.NoteAsync(clientId, workitemId, taskId, new UserActor(actor), string.Join("\n", lines), ct);

        await tenant.RunAsync(clientId, async d =>
        {
            foreach (var id in order)
            {
                await SqlJson.ExecuteAsync(d, "delete from task_dependency where task_id = @id or depends_on_task_id = @id", new { id }, ct);
                await SqlJson.ExecuteAsync(d, "delete from task where id = @id", new { id }, ct);
            }
            return 0;
        }, ct);
        await brief.RegenerateAsync(clientId, workitemId, ct);
        return new JsonObject { ["deleted"] = true, ["subtreeDeleted"] = subtree.Count, ["adoNotesPosted"] = adoNotes, ["rolledBack"] = rolledBack };
    }

    // ── approval ─────────────────────────────────────────────────────

    /// <summary>
    /// Approving a task approves its checklist in the same stroke, then tries to put it in TFS at once. A failure
    /// there does not fail the approval — it is reported, and "put in TFS" stays as a retry.
    /// </summary>
    public async Task<JsonObject> ApproveAsync(Guid clientId, Guid taskId, Guid actor, string? intent, string? appetite, string? prompt, CancellationToken ct)
    {
        var wi = await tenant.RunAsync(clientId, async d =>
        {
            var w = await SqlJson.ScalarAsync<Guid?>(d, """
                update task set approved_at = now(), approved_by = @by, intent = coalesce(@intent, intent),
                  appetite = coalesce(@appetite::task_appetite, appetite), prompt = case when @setPrompt then @prompt else prompt end
                where id = @id returning workitem_id
                """, new
            {
                id = taskId, by = actor, intent = intent is { Length: > 0 } ? intent : null, appetite,
                setPrompt = prompt is not null, prompt = prompt is { } p && p.Trim().Length > 0 ? p.Trim() : null,
            }, ct);
            if (w is null) return null;
            // A checklist is never approved piecemeal against its task.
            await SqlJson.ExecuteAsync(d, "update task set approved_at = now(), approved_by = @by where parent_task_id = @id and kind = 'check' and approved_at is null", new { id = taskId, by = actor }, ct);
            return w;
        }, ct);
        if (wi is not { } workitemId) return new JsonObject { ["approved"] = false };
        await EnsureStandardChecksAsync(clientId, taskId, RequiredChecks, false, actor, ct);
        await brief.RegenerateAsync(clientId, workitemId, ct);

        if (await adoSync.ConnectionAsync(clientId, ct) is null)
            return new JsonObject { ["approved"] = true, ["materialized"] = null, ["materializeError"] = "אין חיבור Azure DevOps פעיל — האישור נשמר, אפשר להקים ב-TFS ידנית ברגע שיהיה חיבור." };
        try
        {
            return new JsonObject { ["approved"] = true, ["materialized"] = await adoSync.MaterializeAsync(clientId, workitemId, actor, ct) };
        }
        catch (AppException e)
        {
            return new JsonObject { ["approved"] = true, ["materialized"] = null, ["materializeError"] = e.Message };
        }
    }

    public async Task<JsonObject> RejectAsync(Guid clientId, Guid taskId, CancellationToken ct)
    {
        var wi = await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<Guid?>(d, "update task set state = 'dropped' where id = @id returning workitem_id", new { id = taskId }, ct), ct);
        if (wi is { } w) await brief.RegenerateAsync(clientId, w, ct);
        return new JsonObject { ["rejected"] = true };
    }

    // ── once, at startup ─────────────────────────────────────────────

    /// <summary>Open tasks from before DCC added checks by itself get them. After the first time, one query and nothing to do.</summary>
    public async Task<int> BackfillStandardChecksAsync(CancellationToken ct)
    {
        var rows = await SqlJson.QueryAsync(db, """
            select id, client_id as "c" from task t where kind = 'task' and active and state not in ('done', 'dropped')
              and not exists (select 1 from task c where c.parent_task_id = t.id and c.check_kind is not null)
            """, null, ct);
        var n = 0;
        foreach (var r in rows)
            if ((await EnsureStandardChecksAsync(Guid.Parse(r["c"]!.GetValue<string>()), Guid.Parse(r["id"]!.GetValue<string>()), null, false, null, ct)).Count > 0) n++;
        return n;
    }

    /// <summary>Every stored state brought to the same rule: failed_checks only while a check failed.</summary>
    public async Task<int> ResyncTaskStatesAsync(CancellationToken ct)
    {
        var rows = await SqlJson.QueryAsync(db, """
            select id, client_id as "c" from task t where kind = 'task' and state = 'failed_checks'
              and not exists (select 1 from task c where c.parent_task_id = t.id and c.kind = 'check' and c.active and c.state <> 'dropped' and c.check_result = 'failed')
            """, null, ct);
        foreach (var r in rows) await store.SyncStateAfterChecksAsync(Guid.Parse(r["c"]!.GetValue<string>()), Guid.Parse(r["id"]!.GetValue<string>()), ct);
        return rows.Count;
    }
}

/// <summary>A delete that needs its risks confirmed — answered 409 with what is at stake.</summary>
public sealed class DeleteNeedsConfirmation(string message, JsonObject precheck) : Exception(message)
{
    public JsonObject Precheck { get; } = precheck;
}
