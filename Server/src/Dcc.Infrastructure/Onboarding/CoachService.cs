using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Dcc.Application.Common;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>A refusal of the coach, in a sentence for the person (coach.ts CoachError) — answered as a 409.</summary>
public sealed class CoachRefused(string message) : AppException(409, "coach_refused", message);

/// <summary>
/// Starts the coach run an approved proposal asks for — the run engine's start of a run of kind <c>coach</c>, which
/// also marks the proposals <c>approved</c> with the run's id. Behind an interface so the coach reads and decides
/// without the engine (and a test can stand in for it). Throws a refusal when a run is already live.
/// </summary>
public interface ICoachRunStarter
{
    Task<Guid> StartCoachRunAsync(Guid repoId, Guid userId, IReadOnlyList<Guid> proposalIds, CancellationToken ct);
}

/// <summary>One check of a developed task: its kind (build, tests, regression, e2e), result and cause.</summary>
public sealed record CoachCheck(string? Kind, string? Result, string? Cause);

/// <summary>What the coach knows of one developed task: its implementation runs, its checks, what it cost, when it last ran.</summary>
public sealed record CoachTask(Guid Id, string Intent, int Seq, int Runs, IReadOnlyList<CoachCheck> Checks, double CostUsd, DateTimeOffset? At);

/// <summary>A component a delivered run installed, as the coach weighs it.</summary>
public sealed record CoachInstalled(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("contextTokens")] int? ContextTokens,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("runId")] string RunId);

/// <summary>The repository's health over the window; <c>Trend</c>: up, down, flat or null.</summary>
public sealed record HealthScore(
    [property: JsonPropertyName("firstPassRate")] double? FirstPassRate,
    [property: JsonPropertyName("rerunsPerTask")] double? RerunsPerTask,
    [property: JsonPropertyName("costPerTaskUsd")] double? CostPerTaskUsd,
    [property: JsonPropertyName("mergedWithoutRewriteRate")] double? MergedWithoutRewriteRate,
    [property: JsonPropertyName("tasks")] int Tasks,
    [property: JsonPropertyName("windowDays")] int WindowDays,
    [property: JsonPropertyName("score")] int? Score,
    [property: JsonPropertyName("trend")] string? Trend);

/// <summary>What real work shows, before it is a proposal. <c>Kind</c>: add, change, remove or new_in_world. <c>Seed</c>: the card a coach run builds from it.</summary>
public sealed record CoachSignal(string Key, string Kind, string ComponentKey, string Title, string Why, JsonObject Evidence, JsonObject Measure, JsonObject? Seed);

/// <summary>
/// The coach (coach.ts) — what continues after the run, from real work: the checks that fail, the tasks that need a
/// second development run, the cost per task, and what changed in the world. Thresholds are relative (the same failure
/// on two or more tasks; a measure worse than the repository's own earlier average), never one event. Every proposal
/// carries its evidence and the measure it will be judged by after it is applied; a proposal never interrupts work —
/// it waits in the dossier. Across repositories the coach learns from numbers only, and names a component only by
/// DCC's own catalog title — never by a title a client's run stored.
/// </summary>
public sealed partial class CoachService(DccDbContext db, ITenantScope tenant, RepoAiEvents events, IServiceProvider services, IOptions<OnboardingOptions> onboarding,
    IHostEnvironment env, ILogger<CoachService> log)
{
    public const int WindowDays = 30;

    // ── the repository's tasks ───────────────────────────────────────

    private static DateTimeOffset? Time(JsonNode? n) =>
        n is JsonValue v && v.TryGetValue<string>(out var s) ? DateTimeOffset.Parse(s, CultureInfo.InvariantCulture) : null;

    private static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static double Num(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? d : 0;

    /// <summary>The tasks of the repository's requirements that had an implementation run since <paramref name="since"/>.</summary>
    private static async Task<List<CoachTask>> RepoTasksAsync(DccDbContext d, Guid repoId, DateTimeOffset since, CancellationToken ct)
    {
        var rows = await SqlJson.QueryAsync(d, """
            select t.id, t.intent, t.seq from task t join workitem_repo wr on wr.workitem_id = t.workitem_id
            where wr.repo_id = @repo and t.kind = 'task' order by t.created_at, t.id
            """, new { repo = repoId }, ct);
        if (rows.Count == 0) return [];
        var ids = rows.Select(r => Guid.Parse(r["id"]!.GetValue<string>())).ToArray();
        var runs = await SqlJson.QueryAsync(d, """
            select task_id as "taskId", started_at as "startedAt" from flow_run where task_id = any(@ids) and kind = 'implement' and started_at >= @since
            """, new { ids, since }, ct);
        var checks = await SqlJson.QueryAsync(d, """
            select parent_task_id as "parentTaskId", check_kind as "checkKind", check_result as "checkResult", check_cause as "checkCause"
            from task where parent_task_id = any(@ids) and kind = 'check'
            """, new { ids }, ct);
        var cost = await SqlJson.QueryAsync(d, """
            select entity_id as "entityId", coalesce(sum(cost_usd), 0)::float8 as usd from claude_call
            where entity_kind = 'task' and entity_id = any(@ids) and started_at >= @since group by entity_id
            """, new { ids = ids.Select(i => i.ToString()).ToArray(), since }, ct);
        return rows.Select(r =>
        {
            var id = r["id"]!.GetValue<string>();
            var rs = runs.Where(x => Str(x["taskId"]) == id).ToList();
            return new CoachTask(Guid.Parse(id), r["intent"]!.GetValue<string>(), r["seq"]!.GetValue<int>(), rs.Count,
                checks.Where(c => Str(c["parentTaskId"]) == id).Select(c => new CoachCheck(Str(c["checkKind"]), Str(c["checkResult"]), Str(c["checkCause"]))).ToList(),
                Num(cost.FirstOrDefault(c => Str(c["entityId"]) == id)?["usd"]),
                rs.Select(x => Time(x["startedAt"])).OrderByDescending(t => t).FirstOrDefault());
        }).Where(t => t.Runs > 0).ToList();
    }

    // ── the health score ─────────────────────────────────────────────

    /// <summary>JavaScript's <c>Math.round</c>: half up.</summary>
    private static double Round(double x) => Math.Floor(x + 0.5);

    public static HealthScore HealthFrom(IReadOnlyList<CoachTask> tasks, IReadOnlyList<CoachTask>? previous = null)
    {
        var developed = tasks.Where(t => t.Runs > 0).ToList();
        var n = developed.Count;
        var withChecks = developed.Where(t => t.Checks.Count > 0).ToList();
        var firstPass = developed.Count(t => t.Runs == 1 && t.Checks.Count > 0 && t.Checks.All(c => c.Result == "passed"));
        double? firstPassRate = withChecks.Count > 0 ? (double)firstPass / withChecks.Count : null;
        double? rerunsPerTask = n > 0 ? developed.Sum(t => (double)(t.Runs - 1)) / n : null;
        var costs = developed.Where(t => t.CostUsd > 0).ToList();
        double? costPerTask = costs.Count > 0 ? costs.Sum(t => t.CostUsd) / costs.Count : null;
        var parts = new List<double>();
        if (firstPassRate is { } f) parts.Add(f * 100);
        if (rerunsPerTask is { } r) parts.Add(Math.Max(0, 100 - r * 50));
        int? score = parts.Count > 0 ? (int)Round(parts.Sum() / parts.Count) : null;
        var prev = previous is { Count: > 0 } ? HealthFrom(previous) : null;
        var trend = score is { } s && prev?.Score is { } p ? (s > p + 5 ? "up" : s < p - 5 ? "down" : "flat") : null;
        return new HealthScore(firstPassRate, rerunsPerTask, costPerTask, null, n, WindowDays, score, trend);
    }

    // ── signals → proposals ──────────────────────────────────────────

    private static string Seqs(IEnumerable<CoachTask> tasks) => string.Join(", ", tasks.Select(t => $"#{t.Seq}").Take(5));

    private static JsonObject Seed(string key, string kind, string family, string risk, string sourceRef, string title, string why, string what, string verify, JsonObject parameters) => new()
    {
        ["key"] = key, ["kind"] = kind, ["family"] = family, ["risk"] = risk, ["source"] = "coach", ["sourceRef"] = sourceRef,
        ["title_he"] = title, ["why_he"] = why, ["what_he"] = what, ["verifyHow_he"] = verify, ["params"] = parameters,
    };

    /// <summary>Relative thresholds: the same check failing on at least two tasks and on at least a third of the tasks that ran it.</summary>
    public static List<CoachSignal> SignalsFrom(IReadOnlyList<CoachTask> tasks, IReadOnlyList<CoachInstalled> installed, IReadOnlyList<CoachTask> previous)
    {
        var output = new List<CoachSignal>();
        foreach (var k in new[] { "build", "tests", "regression", "e2e" })
        {
            var ran = tasks.Where(t => t.Checks.Any(c => c.Kind == k)).ToList();
            var failed = ran.Where(t => t.Checks.Any(c => c.Kind == k && c.Result == "failed")).ToList();
            if (failed.Count < 2 || failed.Count < ran.Count / 3.0) continue;
            var (componentKey, title, kind) = k switch
            {
                "build" => ("build_gate_hook", "hook: build עובר לפני \"סיימתי\"", "hook"),
                "tests" => ("run_affected_tests_skill", "skill: הרצת הבדיקות של מה ששונה", "skill"),
                _ => ("regression_reviewer_agent", "סוכן סוקר לרגרסיות", "agent"),
            };
            if (installed.Any(c => c.Key == componentKey)) continue;
            var parameters = kind == "hook" ? new JsonObject { ["template"] = "build-gate", ["command"] = "" }
                : kind == "skill" ? new JsonObject { ["template"] = "run-affected-tests", ["command"] = "", ["dirs"] = new JsonArray(), ["frameworks"] = new JsonArray() }
                : new JsonObject { ["template"] = "reviewer", ["withReviewMd"] = true };
            output.Add(new CoachSignal($"check_{k}", "add", componentKey, title,
                $"בדיקת {k} נכשלה ב-{failed.Count} מתוך {ran.Count} משימות ב-{WindowDays} הימים האחרונים ({Seqs(failed)}). זה לא אירוע בודד.",
                new JsonObject
                {
                    ["check"] = k,
                    ["failed"] = new JsonArray(failed.Select(t => (JsonNode?)new JsonObject { ["seq"] = t.Seq, ["intent"] = t.Intent.Length > 80 ? t.Intent[..80] : t.Intent }).ToArray()),
                    ["ran"] = ran.Count,
                },
                new JsonObject { ["key"] = $"check_{k}_fail_rate", ["before"] = Round((double)failed.Count / ran.Count * 100) / 100 },
                Seed(componentKey, kind, kind == "hook" ? "verification" : kind == "skill" ? "skills" : "agents", kind == "agent" ? "significant" : "reversible", $"check_{k}",
                    title, $"בדיקת {k} נכשלה ב-{failed.Count}/{ran.Count} משימות.", $"{Components.KindHe[kind]} שעונה על הכישלון החוזר.",
                    "שיעור הכישלון של אותה בדיקה ב-30 הימים שאחרי.", parameters)));
        }

        var reruns = tasks.Where(t => t.Runs >= 2).ToList();
        var implCauses = reruns.Where(t => t.Checks.Any(c => c.Cause == "implementation")).ToList();
        if (reruns.Count >= 2 && implCauses.Count >= 2 && !installed.Any(c => c.Kind == "agent"))
        {
            output.Add(new CoachSignal("reruns_implementation", "add", "implementation_reviewer_agent", "סוכן סוקר לפני \"סיימתי\"",
                $"{reruns.Count} משימות נזקקו לסבב פיתוח שני, ב-{implCauses.Count} מהן הסיבה הייתה במימוש ({Seqs(implCauses)}). סוקר בהקשר טרי תופס את זה לפני הסבב השני.",
                new JsonObject { ["tasks"] = new JsonArray(reruns.Select(t => (JsonNode?)new JsonObject { ["seq"] = t.Seq, ["runs"] = t.Runs }).ToArray()) },
                new JsonObject { ["key"] = "reruns_per_task", ["before"] = Round(reruns.Sum(t => (double)(t.Runs - 1)) / Math.Max(1, tasks.Count) * 100) / 100 },
                Seed("implementation_reviewer_agent", "agent", "agents", "significant", "reruns_implementation", "סוכן סוקר לפני \"סיימתי\"",
                    $"{reruns.Count} משימות נזקקו לסבב שני.", "סוקר קריאה בלבד עם רשימת בדיקה מהכישלונות שהיו.", "סבבי פיתוח למשימה ב-30 הימים שאחרי.",
                    new JsonObject { ["template"] = "reviewer", ["withReviewMd"] = true })));
        }

        var environment = tasks.Where(t => t.Checks.Any(c => c.Cause == "environment")).ToList();
        if (environment.Count >= 2 && !installed.Any(c => c.Kind is "runner" or "devcontainer"))
        {
            output.Add(new CoachSignal("environment", "add", "environment_note", "שורת הנחיה: מה חסר בסביבה של הסוכן",
                $"{environment.Count} משימות נכשלו מסיבת סביבה ({Seqs(environment)}) — הסוכן לא ידע מה לא רץ כאן.",
                new JsonObject { ["tasks"] = new JsonArray(environment.Select(t => (JsonNode?)t.Seq).ToArray()) },
                new JsonObject { ["key"] = "environment_failures", ["before"] = environment.Count },
                Seed("environment_note", "rule", "knowledge", "reversible", "environment", "שורת הנחיה: מה לא רץ בסביבה של הסוכן",
                    $"{environment.Count} כישלונות סביבה.", "שורה ב-AGENTS.md שאומרת מה אי אפשר להריץ כאן ומה לעשות במקום.", "כישלונות סביבה ב-30 הימים שאחרי.",
                    new JsonObject { ["text"] = "Some checks cannot run in the agent's environment; say so instead of retrying, and name what would be needed." })));
        }

        // Cost: the last five tasks against the repository's own earlier average — a rise of a quarter or more points at the always-loaded context.
        var recent = tasks.OrderByDescending(t => t.At?.ToUnixTimeMilliseconds() ?? 0).Take(5).Where(t => t.CostUsd > 0).ToList();
        var earlier = previous.Where(t => t.CostUsd > 0).ToList();
        if (recent.Count >= 3 && earlier.Count >= 3)
        {
            var r = recent.Average(t => t.CostUsd);
            var e = earlier.Average(t => t.CostUsd);
            var heavy = installed.Where(c => (c.ContextTokens ?? 0) >= 1500).OrderByDescending(c => c.ContextTokens ?? 0).FirstOrDefault();
            if (r > e * 1.25 && heavy is not null)
            {
                output.Add(new CoachSignal($"cost_{heavy.Key}", "remove", heavy.Key, $"הסר או צמצם: {heavy.Title}",
                    $"העלות למשימה עלתה מ-${e.ToString("F2", CultureInfo.InvariantCulture)} ל-${r.ToString("F2", CultureInfo.InvariantCulture)} ({(int)Round((r - e) / e * 100)}%). הרכיב הזה טוען ~{(heavy.ContextTokens ?? 0).ToString("N0", CultureInfo.InvariantCulture)} טוקנים בכל סשן — המועמד הראשון.",
                    new JsonObject { ["before"] = e, ["after"] = r, ["component"] = heavy.Key },
                    new JsonObject { ["key"] = "cost_per_task", ["before"] = Round(r * 100) / 100 },
                    null));
            }
        }
        return output;
    }

    [GeneratedRegex("[^a-z0-9]+")] private static partial Regex NotSlug();

    // ── what the coach shows, and what it writes ─────────────────────

    /// <summary>The client that owns the repository; null when there is none (unknown, or shared between clients).</summary>
    public Task<Guid?> OwnerAsync(Guid repoId, CancellationToken ct = default) =>
        SqlJson.ScalarAsync<Guid?>(db, "select client_id from repo where id = @id", new { id = repoId }, ct);

    private static string Iso(DateTimeOffset t) => t.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary>
    /// The coach panel: the health score, the proposals (new ones are written now — once; one already proposed,
    /// approved or applied for the same thing, or declined in the last 60 days, is not written again), the installed
    /// components, what is new in the world for this stack, and the numbers across repositories.
    /// </summary>
    public async Task<JsonObject> ViewAsync(Guid repoId, CancellationToken ct = default)
    {
        var clientId = await OwnerAsync(repoId, ct) ?? throw new CoachRefused("הריפו לא נמצא או משותף");
        var now = DateTimeOffset.UtcNow;
        var since = now.AddDays(-WindowDays);
        var before = since.AddDays(-WindowDays);

        var (tasks, previous, last, installed, profile, existing) = await tenant.RunAsync(clientId, async d =>
        {
            var tasks = await RepoTasksAsync(d, repoId, since, ct);
            var previous = (await RepoTasksAsync(d, repoId, before, ct)).Where(t => t.At is { } at && at < since).ToList();
            var last = await SqlJson.QuerySingleAsync(d, """
                select id, kind, completed_at as "completedAt", started_at as "startedAt" from repository_onboarding_run
                where repo_id = @repo and status = 'Completed' order by completed_at desc limit 1
                """, new { repo = repoId }, ct);
            var installed = (await SqlJson.QueryAsync(d, """
                select c.key, c.kind, c.title, c.context_tokens as "contextTokens", c.status, c.run_id as "runId"
                from onboarding_component c join repository_onboarding_run r on r.id = c.run_id
                where r.repo_id = @repo and r.status = 'Completed' and c.status in ('verified', 'installed') order by c.created_at, c.id
                """, new { repo = repoId }, ct)).Select(c => new CoachInstalled(Str(c["key"])!, Str(c["kind"])!, Str(c["title"])!,
                    c["contextTokens"] is JsonValue v ? v.GetValue<int>() : (int?)null, Str(c["status"])!, Str(c["runId"])!)).ToList();
            var profile = last is null ? null : await SqlJson.ScalarAsync<string>(d,
                "select profile::text from repo_profile where run_id = @run limit 1", new { run = Guid.Parse(Str(last["id"])!) }, ct);
            var existing = await SqlJson.QueryAsync(d, """
                select id, kind, component_key as "componentKey", title, why, evidence, measure, status, created_at as "createdAt",
                       decided_at as "decidedAt", run_id as "runId"
                from repo_coach_proposal where repo_id = @repo order by created_at desc
                """, new { repo = repoId }, ct);
            return (tasks, previous, last, installed, profile, existing);
        }, ct);

        var signals = SignalsFrom(tasks, installed, previous);
        // What changed in the world since the last run, for this stack (marketplace_source belongs to no client).
        var newInWorld = new JsonArray();
        if (last is not null && profile is not null && JsonNode.Parse(profile) is JsonObject p)
        {
            var tags = Rules.StackTags(p);
            var from = Time(last["completedAt"]) ?? Time(last["startedAt"])!.Value;
            var changed = await SqlJson.QueryAsync(db, """
                select name, kind, url, tags, changed_at as "changedAt" from marketplace_source where changed_at >= @from
                """, new { from }, ct);
            foreach (var s in changed.Where(s => (s["tags"] as JsonArray ?? []).Any(t => Str(t) is { } tag && tags.Contains(tag))))
            {
                var (name, kind, url, changedAt) = (Str(s["name"])!, Str(s["kind"])!, Str(s["url"])!, Str(s["changedAt"])!);
                newInWorld.Add(new JsonObject { ["name"] = name, ["kind"] = kind, ["url"] = url, ["changedAt"] = changedAt });
                var slug = $"{kind}_{NotSlug().Replace(name.Replace("\u0130", "i\u0307").ToLowerInvariant(), "_")}";
                signals.Add(new CoachSignal($"world_{url}", "new_in_world", slug.Length > 60 ? slug[..60] : slug, $"חדש בעולם: {name} ({kind}) השתנה",
                    $"המקור עודכן ב-{changedAt[..10]} ומתאים לסטאק של הריפו. כדאי לבדוק על ריפו אחד לפני אימוץ.",
                    new JsonObject { ["url"] = url, ["changedAt"] = changedAt }, new JsonObject { ["key"] = "manual" }, null));
            }
        }

        foreach (var s in signals)
        {
            if (existing.Any(e => Str(e["componentKey"]) == s.ComponentKey && Str(e["kind"]) == s.Kind && Str(e["status"]) is var status
                && (status is "proposed" or "applied" or "approved" || status == "declined" && Time(e["decidedAt"]) is { } at && now - at < TimeSpan.FromDays(60)))) continue;
            var evidence = (JsonObject)s.Evidence.DeepClone();
            evidence["seed"] = s.Seed?.DeepClone();
            // One transaction per proposal, as before: each keeps its own creation time, so the panel's order stays the order they were found in.
            var row = await tenant.RunAsync(clientId, async d =>
            {
                var r = await SqlJson.QuerySingleAsync(d, """
                    insert into repo_coach_proposal (repo_id, client_id, kind, component_key, title, why, evidence, measure)
                    values (@repo, @client, @kind, @key, @title, @why, @evidence, @measure)
                    returning id, kind, component_key as "componentKey", title, why, evidence, measure, status, created_at as "createdAt",
                              decided_at as "decidedAt", run_id as "runId"
                    """, new
                {
                    repo = repoId, client = clientId, kind = s.Kind, key = s.ComponentKey, title = s.Title, why = s.Why,
                    evidence = SqlJson.Jsonb(evidence), measure = SqlJson.Jsonb(s.Measure),
                }, ct);
                await events.AppendAsync(clientId, repoId, "coach.proposal.created",
                    new JsonObject { ["proposalId"] = Str(r!["id"]), ["kind"] = s.Kind, ["title"] = s.Title, ["componentKey"] = s.ComponentKey }, null, ct);
                return r;
            }, ct);
            existing.Insert(0, row!);
        }

        return new JsonObject
        {
            ["health"] = JsonSerializer.SerializeToNode(HealthFrom(tasks, previous)),
            ["proposals"] = new JsonArray(existing.Select(e => (JsonNode?)new JsonObject
            {
                ["id"] = Str(e["id"]), ["kind"] = Str(e["kind"]), ["componentKey"] = Str(e["componentKey"]), ["title"] = Str(e["title"]), ["why"] = Str(e["why"]),
                ["evidence"] = e["evidence"]?.DeepClone() ?? new JsonObject(), ["measure"] = e["measure"]?.DeepClone() ?? new JsonObject(),
                ["status"] = Str(e["status"]), ["createdAt"] = Str(e["createdAt"]), ["decidedAt"] = Str(e["decidedAt"]), ["runId"] = Str(e["runId"]),
            }).ToArray()),
            ["installed"] = JsonSerializer.SerializeToNode(installed),
            ["lastRun"] = last is null ? null : new JsonObject { ["id"] = Str(last["id"]), ["completedAt"] = Str(last["completedAt"]), ["kind"] = Str(last["kind"]) },
            ["newInWorld"] = newInWorld,
            ["acrossRepos"] = await AcrossReposAsync(ct),
        };
    }

    /// <summary>
    /// Approve or decline a proposal. An approval opens a coach run — the only way the repository is ever written to: a
    /// run, on its own branch, delivered as a pull request. With a run already live the approval is refused before
    /// anything is saved, so a proposal never stays approved with no run to apply it.
    /// </summary>
    public async Task<JsonObject> DecideAsync(Guid repoId, Guid proposalId, Guid userId, string decision, string? reason, CancellationToken ct = default)
    {
        var clientId = await OwnerAsync(repoId, ct) ?? throw new CoachRefused("הריפו לא נמצא");
        var approve = decision == "approve";
        var p = await tenant.RunAsync(clientId, async d =>
        {
            var p = await SqlJson.QuerySingleAsync(d, "select id, status, title from repo_coach_proposal where id = @id and repo_id = @repo",
                new { id = proposalId, repo = repoId }, ct) ?? throw new CoachRefused("ההצעה לא נמצאה");
            if (Str(p["status"]) != "proposed") throw new CoachRefused("ההצעה כבר הוכרעה");
            if (approve && await SqlJson.ScalarAsync<Guid?>(d, "select id from repository_onboarding_run where repo_id = @repo and status = any(@live) limit 1",
                    new { repo = repoId, live = Steps.LiveRunStatuses.ToArray() }, ct) is not null)
                throw new CoachRefused("כבר יש הרצה פעילה לריפו הזה — סיימו או בטלו אותה קודם");
            await SqlJson.ExecuteAsync(d, """
                update repo_coach_proposal set status = @status, decided_by = @by, decided_at = now(), decline_reason = @reason where id = @id
                """, new { id = proposalId, status = approve ? "approved" : "declined", by = userId,
                    reason = approve ? null : ComponentVerifier.JsTrim(reason ?? "") is { Length: > 0 } r ? r : null }, ct);
            await events.AppendAsync(clientId, repoId, "coach.proposal.decided",
                new JsonObject { ["proposalId"] = proposalId.ToString(), ["decision"] = decision, ["reason"] = reason, ["title"] = Str(p["title"]) }, userId, ct);
            return p;
        }, ct);

        var result = new JsonObject { ["id"] = Str(p["id"]), ["status"] = approve ? "approved" : "declined" };
        if (!approve) return result;
        var starter = services.GetRequiredService<ICoachRunStarter>();
        try
        {
            result["runId"] = (await starter.StartCoachRunAsync(repoId, userId, [proposalId], ct)).ToString();
        }
        catch
        {
            // A run that started in the moment since the check: the proposal goes back to waiting, never stuck as approved.
            await tenant.RunAsync(clientId, d => SqlJson.ExecuteAsync(d, """
                update repo_coach_proposal set status = 'proposed', decided_by = null, decided_at = null
                where id = @id and status = 'approved' and run_id is null
                """, new { id = proposalId }, CancellationToken.None), CancellationToken.None);
            throw;
        }
        return result;
    }

    // ── across repositories: numbers only ────────────────────────────

    private static readonly ConcurrentDictionary<string, IReadOnlyDictionary<string, string>> Catalogs = new();

    [GeneratedRegex(@"\{[a-z_]+\}")] private static partial Regex Placeholder();

    /// <summary>
    /// The components DCC itself defines — the rules table and the coach's own — by their catalog title. A placeholder
    /// in a title (<c>{hot_dir}</c>) would be filled with a client's own words, so it reads "…" here.
    /// </summary>
    private IReadOnlyDictionary<string, string> CatalogTitles()
    {
        var data = onboarding.Value.DataPath;
        var dir = Path.IsPathRooted(data) ? data : Path.GetFullPath(Path.Combine(env.ContentRootPath, data));
        return Catalogs.GetOrAdd(Path.Combine(dir, "rules.json"), file =>
        {
            var titles = new Dictionary<string, string>(StringComparer.Ordinal);
            try
            {
                foreach (var rule in Rules.Parse(File.ReadAllText(file)))
                    foreach (var c in (rule["components"] as JsonArray ?? []).OfType<JsonObject>())
                        if (Str(c["key"]) is { } key && Str(c["title_he"]) is { } title) titles.TryAdd(key, Placeholder().Replace(title, "…"));
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException)
            {
                log.LogWarning(e, "coach: {File} could not be read — the numbers across repositories name only the coach's own components", file);
            }
            titles.TryAdd("build_gate_hook", "hook: build עובר לפני \"סיימתי\"");
            titles.TryAdd("run_affected_tests_skill", "skill: הרצת הבדיקות של מה ששונה");
            titles.TryAdd("regression_reviewer_agent", "סוכן סוקר לרגרסיות");
            titles.TryAdd("implementation_reviewer_agent", "סוכן סוקר לפני \"סיימתי\"");
            titles.TryAdd("environment_note", "שורת הנחיה: מה לא רץ בסביבה של הסוכן");
            return titles;
        });
    }

    /// <summary>
    /// Across repositories, numbers only: in how many repositories a component was verified, and how many of those runs
    /// improved on their baseline. Read client by client, each inside its own tenant; only components of DCC's own
    /// catalog are counted, and each is named by its catalog title — no client's text crosses the wall.
    /// </summary>
    public async Task<JsonArray> AcrossReposAsync(CancellationToken ct = default)
    {
        var titles = CatalogTitles();
        var clients = await SqlJson.QueryAsync(db, "select id from client order by created_at, id", null, ct);
        var by = new Dictionary<string, (HashSet<string> Repos, HashSet<string> Improved)>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var c in clients)
        {
            var clientId = Guid.Parse(Str(c["id"])!);
            var (rows, builds) = await tenant.RunAsync(clientId, async d =>
            {
                var rows = await SqlJson.QueryAsync(d, """
                    select c.key, c.run_id as "runId", r.repo_id as "repoId" from onboarding_component c
                    join repository_onboarding_run r on r.id = c.run_id where c.status = 'verified' and r.status = 'Completed'
                    order by c.created_at, c.id
                    """, null, ct);
                rows = rows.Where(x => titles.ContainsKey(Str(x["key"])!)).ToList();
                var runIds = rows.Select(x => Guid.Parse(Str(x["runId"])!)).Distinct().ToArray();
                List<JsonObject> builds = runIds.Length == 0 ? [] : await SqlJson.QueryAsync(d, """
                    select run_id as "runId", result from repository_onboarding_step where step_key = 'build' and run_id = any(@runs)
                    """, new { runs = runIds }, ct);
                return (rows, builds);
            }, ct);
            var improved = builds.Where(b => b["result"]?["delta"] is JsonObject delta && Num(delta["after"]?["passed"]) > Num(delta["before"]?["passed"]))
                .Select(b => Str(b["runId"])!).ToHashSet();
            foreach (var x in rows)
            {
                var key = Str(x["key"])!;
                if (!by.TryGetValue(key, out var e))
                {
                    e = (new HashSet<string>(), new HashSet<string>());
                    by[key] = e;
                    order.Add(key);
                }
                e.Repos.Add(Str(x["repoId"])!);
                if (improved.Contains(Str(x["runId"])!)) e.Improved.Add(Str(x["repoId"])!);
            }
        }
        return new JsonArray(order.OrderByDescending(k => by[k].Repos.Count).Take(30)
            .Select(k => (JsonNode?)new JsonObject { ["key"] = k, ["title"] = titles[k], ["repos"] = by[k].Repos.Count, ["improved"] = by[k].Improved.Count }).ToArray());
    }

    // ── weekly: what is new in the world ─────────────────────────────

    /// <summary>JavaScript's <c>\s</c>, so a page hashes as it did before (the stored hashes were written by the old server).</summary>
    [GeneratedRegex("[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+")] private static partial Regex JsSpaces();

    internal static string PageHash(string page)
    {
        var collapsed = JsSpaces().Replace(page, " ");
        var text = collapsed.Length > 60_000 ? collapsed[..60_000] : collapsed;
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)))[..16];
    }

    /// <summary>
    /// Every remembered source is looked at again: the page's tool descriptions are rescanned for injections and its
    /// content hashed; a change marks the source, and the dossiers of the repositories with that stack show it as "new
    /// in the world". Best effort — a page that cannot be fetched (or is not a public http(s) address) leaves the row as
    /// it was.
    /// </summary>
    public async Task<(int Checked, int Changed)> RecheckMarketplaceSourcesAsync(Action<string>? report = null, CancellationToken ct = default)
    {
        var rows = await SqlJson.QueryAsync(db, """
            select id, kind, name, url, publisher, description, tags, trust, trust_checks as "trustChecks", tool_count as "toolCount" from marketplace_source
            """, null, ct);
        int checkedCount = 0, changedCount = 0;
        foreach (var r in rows)
        {
            var page = await PageFetcher.FetchAsync(Str(r["url"])!, 8000, ct);
            if (page is null) continue;
            checkedCount++;
            var prev = r["trustChecks"] as JsonObject ?? [];
            var hash = PageHash(page);
            var trustNow = Str(r["trust"]);
            var src = new FoundSource
            {
                Kind = Str(r["kind"])!, Name = Str(r["name"])!, Url = Str(r["url"])!, Publisher = Str(r["publisher"]), Description = Str(r["description"]),
                Tags = (r["tags"] as JsonArray ?? []).Select(Str).OfType<string>().ToList(), Official = trustNow == SourceTrust.Official, Why = "",
                ToolCount = r["toolCount"] is JsonValue tc ? tc.GetValue<int>() : (int?)null,
                ReadOnly = prev["readOnlyMode"] is JsonValue ro && ro.TryGetValue<bool>(out var b) ? b : (bool?)null,
            };
            var (trust, checks) = MarketplaceSources.CheckTrust(src, page);
            var isChange = Str(prev["pageHash"]) is { Length: > 0 } before && before != hash;
            if (isChange) changedCount++;
            var stored = checks.ToJson();
            stored["pageHash"] = hash;
            if (prev.TryGetPropertyValue("hasLicense", out var license)) stored["license"] = license?.DeepClone();
            await SqlJson.ExecuteAsync(db, """
                update marketplace_source set trust_checks = @checks, trust = @trust, last_checked_at = now(),
                  changed_at = case when @changed then now() else changed_at end
                where id = @id
                """, new
            {
                id = Guid.Parse(Str(r["id"])!), checks = SqlJson.Jsonb(stored), changed = isChange,
                trust = checks.Suspicious.Count > 0 ? SourceTrust.Unverified : trustNow == SourceTrust.Unverified ? trust : trustNow,
            }, ct);
            if (checks.Suspicious.Count > 0) report?.Invoke($"marketplace: {Str(r["name"])} now has suspicious tool descriptions — marked unverified");
        }
        return (checkedCount, changedCount);
    }
}
