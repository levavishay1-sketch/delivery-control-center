using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Application.Common;
using Dcc.Domain.Ado;
using Dcc.Domain.Events;
using Dcc.Domain.Prompts;
using Dcc.Domain.Spec;
using Dcc.Domain.Tasks;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Persistence;
using Dcc.Infrastructure.Prompts;
using Dcc.Infrastructure.Repos;
using Dcc.Infrastructure.Tasks;

namespace Dcc.Infrastructure.Requirements;

/// <summary>
/// The AI steps of a requirement (ai-assist.ts assess / breakdown, spec-map.ts): the readiness check reads the
/// requirement — and, for development, its code — and proposes gaps; the breakdown proposes the task tree with
/// its dependencies and TFS types by role; the spec reading marks the requirements in the attached document and
/// says which task implements each. Every call through <see cref="ClaudeRunner"/>, every prompt from the library.
/// </summary>
public sealed partial class RequirementAiService(
    ITenantScope tenant, ClaudeRunner claude, FlowRunHub hub, RepoCheckouts checkouts, PromptService prompts,
    BriefService brief, GapService gaps, IEventLogWriter events, TaskStore store, TaskRunService runs, TaskService tasks, SpecService specs)
{
    public const string DefaultAssessPromptKey = "assess.readiness.standard";
    private const string AssessContractKey = "assess.shared.output_contract";

    // ── the requirement as every prompt reads it ─────────────────────

    public sealed record ReqText(JsonObject Wi, List<(string Source, string Body)> Notes, List<(string Name, string? Text, string? Err)> Files)
    {
        public string Title => Wi["title"]!.GetValue<string>();
        public string RequirementType => Wi["requirementType"]?.GetValue<string>() ?? "development";
        /// <summary>The requirement's own detail — what is actually wanted; null until someone writes it.</summary>
        public string? Detail => Wi["description"]?.GetValue<string>() is { Length: > 0 } d ? d : null;
        /// <summary>The title and, when there is one, the detail — how every prompt opens the requirement.</summary>
        public IEnumerable<string> Head() => Detail is { } d ? [$"Title: {Title}", $"Detail: {d}"] : [$"Title: {Title}"];
    }

    public Task<ReqText> LoadTextAsync(Guid clientId, Guid workitemId, CancellationToken ct) =>
        tenant.RunAsync(clientId, async d =>
        {
            var wi = await SqlJson.QuerySingleAsync(d, """
                select id, key, title, description, requirement_type::text as "requirementType", type::text as "type" from workitem where id = @w
                """, new { w = workitemId }, ct) ?? throw AppException.NotFound("requirement");
            var notes = await SqlJson.QueryAsync(d, """
                select payload->>'body' as body, source::text as source from event_log
                where workitem_id = @w and type = 'note.added' and supersedes is null order by occurred_at asc limit 40
                """, new { w = workitemId }, ct);
            // The requirement is often mostly IN the attached spec — sending the note without it made Claude ask for a file already attached.
            var files = await SqlJson.QueryAsync(d, """
                select name, extracted_text as "text", extract_error as "err" from attachment where workitem_id = @w order by created_at
                """, new { w = workitemId }, ct);
            return new ReqText(wi,
                notes.Where(n => !string.IsNullOrEmpty(n["body"]?.GetValue<string>())).Select(n => (n["source"]!.GetValue<string>(), n["body"]!.GetValue<string>())).ToList(),
                files.Select(f => (f["name"]!.GetValue<string>(), f["text"]?.GetValue<string>(), f["err"]?.GetValue<string>())).ToList());
        }, ct);

    private static string FilesSection(List<(string Name, string? Text, string? Err)> files, bool he)
    {
        if (files.Count == 0) return "";
        var label = he ? "קובץ מצורף" : "ATTACHED FILE";
        var parts = files.Select(f => f.Text is { } t
            ? $"--- {label}: {f.Name} ---\n{t}"
            : $"--- {label}: {f.Name} — {(he ? "לא ניתן לקרוא כטקסט" : "NOT READABLE AS TEXT")} ({f.Err ?? "unknown"}) ---");
        return $"\n\n{(he ? "קבצים מצורפים לדרישה — הם חלק מהדרישה, לא רקע:" : "FILES ATTACHED TO THE REQUIREMENT — they are part of the requirement, not background:")}\n\n{string.Join("\n\n", parts)}";
    }

    /// <summary>
    /// The working copy, or a refusal — never a quiet downgrade to "text only": a readiness check that never opened
    /// the code is a guess with a confident voice. Research and testing requirements have no code and run on the text.
    /// </summary>
    private async Task<(string? Cwd, string? RepoName, string? Stale)> RequireCheckoutAsync(Guid clientId, Guid workitemId, string requirementType, Guid? runId, CancellationToken ct)
    {
        var r = await store.FirstRepoAsync(clientId, workitemId, ct);
        if (r is null)
        {
            if (requirementType != "development") return (null, null, null);
            throw AppException.Conflict("repo_required", "לדרישת פיתוח אין repository מקושר, ובחינת בשלות בודקת את הקוד עצמו. קשרו repository לדרישה (או ללקוח) והריצו שוב.");
        }
        hub.PushLine(runId, checkouts.StartLine(r));
        var c = await checkouts.CheckoutAsync(r);
        if (c.Dir is null)
        {
            var fetchFailed = !string.IsNullOrWhiteSpace(r.AdoRepoRef);
            throw AppException.Conflict("repo_required", $"{c.Reason ?? $"לא הצלחנו להביא עותק של {r.Name}."}\n\nבחינת בשלות חייבת לקרוא את הקוד, ולכן היא נעצרה כאן במקום לענות מהטקסט בלבד. "
                + (fetchFailed ? "נסו שוב — הורדה ראשונה של repository גדול יכולה לקחת כמה דקות." : "הוסיפו ל-repository כתובת git במסך Repositories, והריצו שוב."));
        }
        return (c.Dir, r.Name, c.Reason);
    }

    // ── 1. assess: is it baked? ──────────────────────────────────────

    private sealed record AssessBuilt(string Prompt, string? PromptHe, string? Model, string? Cwd, string? RepoName, string? Stale, int FilesRead, string TemplateTitle, string CurrentTitle);

    private async Task<AssessBuilt> BuildAssessAsync(Guid clientId, Guid workitemId, string promptKey, string? emphasis, string? model, Guid? runId, CancellationToken ct)
    {
        var req = await LoadTextAsync(clientId, workitemId, ct);
        var (cwd, repoName, stale) = await RequireCheckoutAsync(clientId, workitemId, req.RequirementType, runId, ct);
        var baseText = string.Join("\n\n", req.Head().Concat(req.Notes.Select(n => $"[{n.Source}] {n.Body}")));
        var tmpl = await prompts.RequireAsync(promptKey, ct);
        var en = new Dictionary<string, object?> { ["HAS_REPO"] = cwd is not null, ["REPO_NAME"] = repoName ?? "", ["REQUIREMENT"] = baseText + FilesSection(req.Files, false) };
        var he = new Dictionary<string, object?>(en) { ["REQUIREMENT"] = baseText + FilesSection(req.Files, true) };
        if (promptKey == "assess.readiness.custom")
        {
            en["CUSTOM_EMPHASIS"] = emphasis?.Trim() is { Length: > 0 } e1 ? e1 : "(none specified)";
            he["CUSTOM_EMPHASIS"] = emphasis?.Trim() is { Length: > 0 } e2 ? e2 : "(לא צוין)";
        }
        // The output SHAPE is authored once, shared by every tier.
        var contract = await prompts.RequireAsync(AssessContractKey, ct);
        static string Join(string focus, string? shape) => shape is { Length: > 0 } ? $"{focus}\n\n{shape}" : focus;
        var prompt = Join(PromptContract.Render(tmpl.Body, en), contract.Body);
        var promptHe = tmpl.BodyHe is { } bh ? Join(PromptContract.Render(bh, he), contract.BodyHe) : null;
        return new AssessBuilt(prompt, promptHe, model is { Length: > 0 } ? model : tmpl.DefaultModel, cwd, repoName, stale, req.Files.Count, tmpl.Title, req.Title);
    }

    /// <summary>Render (never run) one readiness tier's prompt — the preview.</summary>
    public async Task<JsonObject> PreviewAssessAsync(Guid clientId, Guid workitemId, string promptKey, string? emphasis, CancellationToken ct)
    {
        var b = await BuildAssessAsync(clientId, workitemId, promptKey, emphasis, null, null, ct);
        return new JsonObject { ["prompt"] = b.Prompt, ["promptHe"] = b.PromptHe, ["model"] = b.Model, ["templateTitle"] = b.TemplateTitle };
    }

    private static List<string> Lines(JsonNode? v) => v switch
    {
        JsonArray a => a.Select(x => x?.ToString().Trim() ?? "").Where(s => s.Length > 0).ToList(),
        JsonValue s when s.TryGetValue<string>(out var t) => t.Split('\n').Select(l => Bullet().Replace(l, "").Trim()).Where(l => l.Length > 0).ToList(),
        _ => [],
    };

    [GeneratedRegex(@"^[-•*]\s*")] private static partial Regex Bullet();

    public async Task<JsonNode> AssessAsync(FlowRunInput input, CancellationToken ct)
    {
        var o = input.Options ?? [];
        var b = await BuildAssessAsync(input.ClientId, input.WorkitemId, Str(o, "promptKey") ?? DefaultAssessPromptKey, Str(o, "customEmphasis"), Str(o, "model"), input.RunId, ct);
        if (b.Stale is not null) hub.PushLine(input.RunId, $"⚠ {b.Stale}");
        var filesLine = b.FilesRead > 0 ? $" · {b.FilesRead} קבצים מצורפים" : "";
        hub.PushLine(input.RunId, b.Cwd is not null ? $"קורא את ה-repo {b.RepoName}{filesLine} · {b.TemplateTitle}" : $"דרישת מחקר/בדיקות — מעריך מהטקסט{filesLine} · {b.TemplateTitle}");

        var raw = await claude.RunJsonAsync(b.Cwd ?? Environment.CurrentDirectory, b.Prompt, new ClaudeCall
        {
            TimeoutMs = 600_000, RunId = input.RunId, Model = b.Model,
            Ledger = new LedgerContext
            {
                ClientId = input.ClientId, UserId = input.UserId, Capability = "gap_detection", Trigger = input.Trigger, Entity = ("workitem", input.WorkitemId.ToString()),
                WorkitemId = input.WorkitemId, Screen = "requirement", Label = $"בחינת בשלות הדרישה · {b.TemplateTitle}",
            },
        }, ct) as JsonObject ?? [];
        hub.PushLine(input.RunId, "כותב סיכום ופערים…");

        var gapList = new List<JsonObject>();
        foreach (var g in (raw["gaps"] as JsonArray ?? []).OfType<JsonObject>())
        {
            var question = Str(g, "question") ?? Str(g, "description");
            if (question is null) continue;
            var conf = g["confidence"] is JsonValue cv && cv.TryGetValue<double>(out var cd) && cd != 0 ? cd : 0.7;
            gapList.Add(new JsonObject
            {
                ["question"] = question, ["why"] = Str(g, "why") ?? "", ["kind"] = Str(g, "kind") ?? "missing_info",
                ["whoAnswers"] = Str(g, "whoAnswers") == "client" ? "client" : "team",
                ["options"] = new JsonArray(((g["options"] as JsonArray) ?? []).Select(x => x?.ToString() ?? "").Where(x => x.Length > 0).Select(x => (JsonNode?)x).ToArray()),
                ["impactIfWrong"] = Str(g, "impactIfWrong") ?? "", ["blocking"] = g["blocking"] is JsonValue bv && bv.TryGetValue<bool>(out var bb) && bb,
                ["confidence"] = Math.Min(1, Math.Max(0, conf)),
            });
        }
        var title = Str(raw, "title") ?? "";
        var summary = Str(raw, "summary") ?? "";
        var whatChanges = Lines(raw["whatChanges"]);
        // Ground truth over the model's self-report: baked with open questions attached is not baked.
        var baked = raw["baked"] is JsonValue kv && kv.TryGetValue<bool>(out var k) && k && gapList.Count == 0;
        var rationale = Lines(raw["rationale"]);

        var body = new List<string> { $"סיכום Claude: {title}", summary };
        if (whatChanges.Count > 0) { body.Add(""); body.Add("מה משתנה:"); body.AddRange(whatChanges.Select(l => $"• {l}")); }
        body.Add("");
        body.Add(baked ? "הערכה: אפויה — מוכנה לפירוק" : "הערכה: לא אפויה — יש שאלות פתוחות");
        body.AddRange(rationale.Select(l => $"• {l}"));
        await events.AppendAsync(new NewEvent
        {
            ClientId = input.ClientId, WorkitemId = input.WorkitemId, Source = "claude_session", Type = "note.added",
            Actor = new DelegatedActor(input.UserId, "dcc:assess"), Payload = JsonSerializer.SerializeToElement(new { body = string.Join("\n", body) }),
        }, ct);
        foreach (var g in gapList)
            await gaps.ProposeAsync(input.ClientId, input.WorkitemId, new GapService.ProposeRequest(g["question"]!.GetValue<string>(), g["blocking"]!.GetValue<bool>(),
                g["confidence"]!.GetValue<double>(), "delegated", g["why"]!.GetValue<string>(), g["kind"]!.GetValue<string>(), g["whoAnswers"]!.GetValue<string>(),
                g["options"]!.AsArray().Select(x => x!.GetValue<string>()).ToArray(), g["impactIfWrong"]!.GetValue<string>()), input.UserId, ct);
        // A title typed only to fill the field carries no information; Claude's, after reading, does. A real title is never overwritten.
        var newTitle = title.Trim().Length > 0 && b.CurrentTitle.Trim().Length <= 6 ? title.Trim() : null;
        await tenant.RunAsync(input.ClientId, d => SqlJson.ExecuteAsync(d, "update workitem set phase = 'shaping', updated_at = now(), title = coalesce(@t, title) where id = @w",
            new { t = newTitle, w = input.WorkitemId }, ct), ct);
        await brief.RegenerateAsync(input.ClientId, input.WorkitemId, ct);
        return new JsonObject
        {
            ["title"] = title, ["summary"] = summary, ["whatChanges"] = Arr(whatChanges), ["baked"] = baked, ["rationale"] = Arr(rationale),
            ["gaps"] = new JsonArray(gapList.Select(x => (JsonNode?)x).ToArray()), ["repoUsed"] = b.RepoName,
        };
    }

    // ── 2. breakdown: propose tasks and dependencies ─────────────────

    private async Task<(string Prompt, string PromptHe, string? Cwd, string? RepoName)> BuildBreakdownAsync(Guid clientId, Guid workitemId, Guid? runId, CancellationToken ct)
    {
        var req = await LoadTextAsync(clientId, workitemId, ct);
        var (cwd, repoName, stale) = await RequireCheckoutAsync(clientId, workitemId, req.RequirementType, runId, ct);
        if (stale is not null) hub.PushLine(runId, $"⚠ {stale}");
        hub.PushLine(runId, cwd is not null ? $"קורא את ה-repo {repoName}" : "דרישת מחקר/בדיקות — מפרק מהטקסט");
        var reqText = string.Join("\n\n", req.Head().Concat(req.Notes.Select(n => n.Body))) + FilesSection(req.Files, false);
        var tmpl = await prompts.RequireAsync("breakdown.tasks", ct);
        var vars = new Dictionary<string, object?> { ["HAS_REPO"] = cwd is not null, ["REPO_NAME"] = repoName ?? "", ["REQUIREMENT"] = reqText };
        var prompt = PromptContract.Render(tmpl.Body, vars);
        return (prompt, tmpl.BodyHe is { } he ? PromptContract.Render(he, vars) : prompt, cwd, repoName);
    }

    public async Task<JsonObject> PreviewBreakdownAsync(Guid clientId, Guid workitemId, CancellationToken ct)
    {
        var (p, he, _, repo) = await BuildBreakdownAsync(clientId, workitemId, null, ct);
        return new JsonObject { ["prompt"] = p, ["promptHe"] = he, ["repoName"] = repo };
    }

    private sealed record Proposed(int Seq, int? ParentSeq, string? Kind, string Intent, string? Prompt, string Appetite, List<string> AffectedPaths, List<string> Compiled, List<int> DependsOn);

    public async Task<JsonNode> BreakdownAsync(FlowRunInput input, CancellationToken ct)
    {
        var (prompt, _, cwd, _) = await BuildBreakdownAsync(input.ClientId, input.WorkitemId, input.RunId, ct);
        var raw = await claude.RunJsonAsync(cwd ?? Environment.CurrentDirectory, prompt, new ClaudeCall
        {
            TimeoutMs = 600_000, RunId = input.RunId,
            Ledger = new LedgerContext
            {
                ClientId = input.ClientId, UserId = input.UserId, Capability = "decomposition", Trigger = input.Trigger, Entity = ("workitem", input.WorkitemId.ToString()),
                WorkitemId = input.WorkitemId, Screen = "requirement", Label = "פירוק למשימות",
            },
        }, ct);
        hub.PushLine(input.RunId, "בונה את היררכיית המשימות…");
        static List<string> S(JsonNode? n) => (n as JsonArray)?.Select(x => x?.ToString() ?? "").Where(x => x.Length > 0).ToList() ?? [];
        static int? I(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? (int)d : null;
        var proposed = (raw as JsonArray ?? []).OfType<JsonObject>().Where(p => I(p["seq"]) is not null).Select(p => new Proposed(
            I(p["seq"])!.Value, I(p["parentSeq"]), Str(p, "kind"), Str(p, "intent") ?? "", Str(p, "prompt"), Str(p, "appetite") ?? "standard",
            S(p["affectedPaths"]), S(p["compiledComponents"]), (p["dependsOnSeq"] as JsonArray)?.Select(I).Where(x => x is not null).Select(x => x!.Value).ToList() ?? [])).ToList();

        // A check is always a leaf — one the model gave children is really work.
        var bySeq = proposed.GroupBy(p => p.Seq).ToDictionary(g => g.Key, g => g.First());
        var hasChildren = proposed.Where(p => p.ParentSeq is not null).Select(p => p.ParentSeq!.Value).ToHashSet();
        string KindOf(int seq) => hasChildren.Contains(seq) ? "task" : bySeq.GetValueOrDefault(seq)?.Kind == "check" ? "check" : "task";
        int LevelOf(int seq, HashSet<int>? seen = null)
        {
            seen ??= [];
            var parent = bySeq.GetValueOrDefault(seq)?.ParentSeq;
            if (parent is null || parent == seq || !seen.Add(seq) || !bySeq.ContainsKey(parent.Value)) return 0;
            return LevelOf(parent.Value, seen) + 1;
        }
        var levels = proposed.ToDictionary(p => p.Seq, p => Math.Min(LevelOf(p.Seq), AdoMap.MaxTaskDepth - 1));
        var work = proposed.Where(p => KindOf(p.Seq) == "task").Select(p => new TaskTypes.Node(p.Seq.ToString(CultureInfo.InvariantCulture), p.ParentSeq?.ToString(CultureInfo.InvariantCulture))).ToList();
        var depth = Math.Min(proposed.Where(p => KindOf(p.Seq) == "task").Select(p => levels[p.Seq]).DefaultIfEmpty(0).Max() + 1, AdoMap.MaxTaskDepth);
        var typeOfSeq = TaskTypes.Structural(work);
        var rung = TaskTypes.RequirementRungFor(work);
        var checkCount = proposed.Count(p => KindOf(p.Seq) == "check");
        var counts = typeOfSeq.Values.GroupBy(t => t).Select(g => $"{g.Count()} {g.Key}");
        hub.PushLine(input.RunId, string.Join(" · ", counts) + (rung is not null ? $" · הדרישה עצמה היא {rung.Type} מעל {rung.Over} {rung.Of}" : "") + (checkCount > 0 ? $" · {checkCount} בדיקות (לא ב-TFS בנפרד)" : ""));

        var wiType = await tenant.RunAsync(input.ClientId, d => SqlJson.ScalarAsync<string>(d, "select type::text from workitem where id = @w", new { w = input.WorkitemId }, ct), ct);
        var inherited = wiType == "bug" ? await tasks.InheritedChecksForBugAsync(input.ClientId, input.WorkitemId, ct) : [];
        var rows = await tenant.RunAsync(input.ClientId, async d =>
        {
            // Re-running replaces the previous proposal — anything a person wrote, or that is in TFS already, stays.
            var dropped = await SqlJson.ExecuteAsync(d, "delete from task where workitem_id = @w and origin = 'ai' and linked_ado_id is null", new { w = input.WorkitemId }, ct);
            if (dropped > 0) hub.PushLine(input.RunId, $"מחליף {dropped} משימות מהצעה קודמת");
            var seqToId = new Dictionary<int, Guid>();
            var output = new List<JsonObject>();
            foreach (var p in proposed.OrderBy(p => levels[p.Seq]))
            {
                var appetite = p.Appetite is "small" or "standard" or "large" ? p.Appetite : "standard";
                var kind = KindOf(p.Seq);
                var adoType = kind == "task" ? typeOfSeq.GetValueOrDefault(p.Seq.ToString(CultureInfo.InvariantCulture)) ?? "Task" : null;
                Guid? parentId = p.ParentSeq is { } ps && seqToId.TryGetValue(ps, out var pid) ? pid : null;
                var promptText = p.Prompt?.Trim() is { Length: > 0 } pt ? pt : null;
                var id = await SqlJson.ScalarAsync<Guid>(d, """
                    insert into task (client_id, workitem_id, seq, kind, intent, appetite, origin, state, affected_paths, compiled_components, parent_task_id, ado_type, prompt)
                    values (@c, @w, @seq, @kind, @intent, @appetite::task_appetite, 'ai', 'pending', @paths, @compiled, @parent, @ado, @prompt) returning id
                    """, new
                {
                    c = input.ClientId, w = input.WorkitemId, seq = p.Seq, kind, intent = p.Intent, appetite, paths = SqlJson.Jsonb(p.AffectedPaths),
                    compiled = SqlJson.Jsonb(p.Compiled), parent = parentId, ado = adoType, prompt = promptText,
                }, ct);
                seqToId[p.Seq] = id;
                output.Add(new JsonObject
                {
                    ["id"] = id.ToString(), ["seq"] = p.Seq, ["kind"] = kind, ["intent"] = p.Intent, ["appetite"] = appetite,
                    ["affectedPaths"] = Arr(p.AffectedPaths), ["compiledComponents"] = Arr(p.Compiled), ["dependsOnSeq"] = new JsonArray(p.DependsOn.Select(x => (JsonNode?)x).ToArray()),
                    ["parentSeq"] = p.ParentSeq, ["level"] = levels[p.Seq], ["adoType"] = adoType, ["prompt"] = promptText,
                });
            }
            foreach (var p in proposed)
                foreach (var dep in p.DependsOn)
                    if (seqToId.TryGetValue(p.Seq, out var from) && seqToId.TryGetValue(dep, out var to) && from != to)
                        await SqlJson.ExecuteAsync(d, "insert into task_dependency (client_id, task_id, depends_on_task_id, reason) values (@c, @f, @t, 'AI breakdown') on conflict do nothing",
                            new { c = input.ClientId, f = from, t = to }, ct);
            // A Bug inherits the checks already on the task(s) it is linked to — under its own first top-level task.
            var root = output.Where(r => TaskFacts.Str(r, "kind") == "task" && r["level"]!.GetValue<int>() == 0).OrderBy(r => r["seq"]!.GetValue<int>()).FirstOrDefault();
            if (inherited.Count > 0 && root is not null)
            {
                var nextSeq = output.Max(r => r["seq"]!.GetValue<int>()) + 1;
                foreach (var (intent, promptText) in inherited)
                {
                    var text = $"{intent} (ירושה מבדיקות המשימה המקושרת)";
                    var id = await SqlJson.ScalarAsync<Guid>(d, """
                        insert into task (client_id, workitem_id, seq, kind, intent, appetite, origin, state, parent_task_id, prompt)
                        values (@c, @w, @seq, 'check', @intent, 'small', 'human', 'pending', @parent, @prompt) returning id
                        """, new { c = input.ClientId, w = input.WorkitemId, seq = nextSeq, intent = text, parent = Guid.Parse(root["id"]!.GetValue<string>()), prompt = promptText }, ct);
                    output.Add(new JsonObject
                    {
                        ["id"] = id.ToString(), ["seq"] = nextSeq, ["kind"] = "check", ["intent"] = text, ["appetite"] = "small", ["affectedPaths"] = new JsonArray(),
                        ["compiledComponents"] = new JsonArray(), ["dependsOnSeq"] = new JsonArray(), ["parentSeq"] = root["seq"]!.GetValue<int>(),
                        ["level"] = root["level"]!.GetValue<int>() + 1, ["adoType"] = null, ["prompt"] = promptText,
                    });
                    nextSeq++;
                }
                hub.PushLine(input.RunId, $"ירש {inherited.Count} בדיקות מהמשימה המקושרת");
            }
            return output;
        }, ct);
        if (rows.Count > 0)
        {
            var apps = rows.Select(r => r["appetite"]!.GetValue<string>()).ToList();
            await events.AppendAsync(new NewEvent
            {
                ClientId = input.ClientId, WorkitemId = input.WorkitemId, Source = "claude_session", Type = "tasks.proposed",
                Actor = new DelegatedActor(input.UserId, "skill:task-breakdown"),
                Payload = JsonSerializer.SerializeToElement(new
                {
                    taskCount = rows.Count, dependencyCount = proposed.Sum(p => p.DependsOn.Count),
                    appetite = apps.Contains("large") ? "large" : apps.Contains("standard") ? "standard" : "small",
                }),
            }, ct);
        }
        // Every task that is built itself gets the checks DCC requires, as part of the proposal.
        var withChecks = 0;
        foreach (var r in rows.Where(x => TaskFacts.Str(x, "kind") == "task"))
            if ((await runs.EnsureStandardChecksAsync(input.ClientId, Guid.Parse(r["id"]!.GetValue<string>()), TaskRunService.RequiredChecks, true, null, ct)).Count > 0) withChecks++;
        if (withChecks > 0) hub.PushLine(input.RunId, $"נוספו בדיקות חובה (Build, בדיקות לפיתוח, רגרסיה) ל-{withChecks} משימות");
        await brief.RegenerateAsync(input.ClientId, input.WorkitemId, ct);
        return new JsonObject { ["depth"] = depth, ["tasks"] = new JsonArray(rows.OrderBy(r => r["seq"]!.GetValue<int>()).Select(x => (JsonNode?)x).ToArray()) };
    }

    // ── the spec: which task implements what (spec-map.ts) ───────────

    /// <summary>What a task says it does — its title and instruction. A link's quoted evidence is checked against exactly this.</summary>
    private static string TaskSaid(string intent, string? prompt)
    {
        var p = (prompt ?? "").Trim();
        return p.Length > 0 && p != intent.Trim() ? $"{intent}\n   {p}" : intent;
    }

    private sealed record SpecInput(string Title, string? Key, (Guid Id, string Name)? Att, SpecDocument? Doc, List<(Guid Id, string Description, string? Answer)> Decisions, List<(Guid Id, int Seq, string Kind, string Intent, string? Prompt)> Tasks);

    private async Task<SpecInput> SpecInputAsync(Guid clientId, Guid workitemId, CancellationToken ct) =>
        await tenant.RunAsync(clientId, async d =>
        {
            var wi = await SqlJson.QuerySingleAsync(d, "select title, key from workitem where id = @w", new { w = workitemId }, ct);
            var (att, doc) = await SpecService.UnreadDocAsync(d, workitemId, ct);
            var decisions = (await SqlJson.QueryAsync(d, """
                select id, description, answer from gap where workitem_id = @w and state = 'resolved' and coalesce(trim(answer), '') <> '' order by created_at
                """, new { w = workitemId }, ct)).Select(g => (Guid.Parse(g["id"]!.GetValue<string>()), g["description"]!.GetValue<string>(), g["answer"]?.GetValue<string>())).ToList();
            // DCC's own standard checks verify that the code builds and still works — never a line of the spec.
            var taskRows = (await SqlJson.QueryAsync(d, """
                select id, seq, kind, intent, prompt from task where workitem_id = @w and active and state <> 'dropped' and check_kind is null order by seq
                """, new { w = workitemId }, ct)).Select(t => (Guid.Parse(t["id"]!.GetValue<string>()), t["seq"]!.GetValue<int>(), t["kind"]!.GetValue<string>(),
                t["intent"]!.GetValue<string>(), t["prompt"]?.GetValue<string>())).ToList();
            return new SpecInput(wi?["title"]?.GetValue<string>() ?? "", wi?["key"]?.GetValue<string>(), att, doc, decisions, taskRows);
        }, ct);

    private async Task<(string Prompt, string PromptHe, SpecInput Input)> BuildSpecMapAsync(Guid clientId, Guid workitemId, CancellationToken ct)
    {
        var input = await SpecInputAsync(clientId, workitemId, ct);
        if (input.Att is null) throw AppException.Conflict("spec_refused", "אין לדרישה מסמך אפיון קריא — צרפו קובץ, או שהטקסט שלו לא חולץ");
        if (input.Tasks.Count == 0) throw AppException.Conflict("spec_refused", "הדרישה עוד לא פורקה למשימות — אין מה למפות");
        if (input.Doc is null) throw AppException.Conflict("spec_refused", "לא הצלחתי לקרוא את מסמך האפיון");
        var tmpl = await prompts.RequireAsync("spec.map", ct);
        var vars = new Dictionary<string, object?>
        {
            ["TITLE"] = $"{(input.Key is { } k ? $"{k}: " : "")}{input.Title}",
            ["DOC_NAME"] = input.Att.Value.Name,
            ["SPEC"] = SpecDocs.ForPrompt(input.Doc),
            ["DECISIONS"] = input.Decisions.Count > 0 ? string.Join("\n", input.Decisions.Select(x => $"[{SpecDocs.DecisionAnchor(x.Id)}] {x.Description}\n   → {x.Answer}")) : "(אין)",
            // Each task's WHOLE instruction: a link must quote it.
            ["TASKS"] = string.Join("\n\n", input.Tasks.Select(t => $"#{t.Seq} [{t.Kind}]: {TaskSaid(t.Intent, t.Prompt)}")),
        };
        var prompt = PromptContract.Render(tmpl.Body, vars);
        return (prompt, tmpl.BodyHe is { } he ? PromptContract.Render(he, vars) : prompt, input);
    }

    public async Task<JsonObject> PreviewSpecMapAsync(Guid clientId, Guid workitemId, CancellationToken ct)
    {
        var (p, he, input) = await BuildSpecMapAsync(clientId, workitemId, ct);
        return new JsonObject { ["prompt"] = p, ["promptHe"] = he, ["doc"] = input.Att?.Name, ["tasks"] = input.Tasks.Count, ["decisions"] = input.Decisions.Count };
    }

    /// <summary>
    /// Mark the requirements in the spec once, and record which task implements which. What cannot be trusted is
    /// refused rather than half-written — a wrong mapping says a line is covered when it is not.
    /// </summary>
    public async Task<JsonObject> MapSpecAsync(Guid clientId, Guid workitemId, Guid actor, string trigger, CancellationToken ct)
    {
        var (prompt, _, input) = await BuildSpecMapAsync(clientId, workitemId, ct);
        var dir = await store.ExistingCloneAsync(clientId, workitemId, ct) ?? Environment.CurrentDirectory;
        var raw = await claude.RunJsonAsync(dir, prompt, new ClaudeCall
        {
            TimeoutMs = 600_000,
            Ledger = new LedgerContext
            {
                ClientId = clientId, UserId = actor, Capability = "decomposition", Trigger = trigger, Entity = ("workitem", workitemId.ToString()), WorkitemId = workitemId,
                Screen = "requirement", Label = $"סימון הדרישות באפיון · {(input.Title.Length > 50 ? input.Title[..50] : input.Title)}", Signals = new RoutingSignals { Mechanical = true },
            },
        }, ct);
        SpecRead read;
        try { read = raw.Deserialize<SpecRead>(TaskFacts.Json) ?? new SpecRead(null, null, null); }
        catch (JsonException e) { throw AppException.Conflict("spec_refused", $"הקריאה של האפיון לא התקבלה: {e.Message}"); }
        var (accepted, why) = SpecDocs.Check(read, input.Doc!, input.Tasks.Select(t => (t.Seq, TaskSaid(t.Intent, t.Prompt))).ToList(), input.Decisions.Select(x => SpecDocs.DecisionAnchor(x.Id)).ToList());
        if (accepted is null) throw AppException.Conflict("spec_refused", $"הקריאה של האפיון לא התקבלה: {why}");
        var saved = await SaveSpecReadAsync(clientId, workitemId, input.Att!.Value.Id, input.Doc!, accepted, input.Decisions, input.Tasks.Select(t => (t.Id, t.Seq)).ToList(), actor, "mapping", ct);
        await brief.RegenerateAsync(clientId, workitemId, ct);
        var view = await specs.SpecForAsync(clientId, workitemId, ct);
        saved["unsupported"] = accepted.Unsupported.Count;
        saved["uncovered"] = view["uncovered"]!.AsArray().Count;
        return saved;
    }

    /// <summary>Replace the requirement's reading: the document as read, its requirements, the decisions, who implements what. A person's own links survive while their piece does.</summary>
    private async Task<JsonObject> SaveSpecReadAsync(Guid clientId, Guid workitemId, Guid? attachmentId, SpecDocument doc, SpecReadAccepted read,
        List<(Guid Id, string Description, string? Answer)> decisions, List<(Guid Id, int Seq)> taskList, Guid actor, string source, CancellationToken ct)
    {
        var bySeq = taskList.ToDictionary(t => t.Seq, t => t.Id);
        var order = SpecDocs.Elements(doc);
        var at = order.Select((e, i) => (e.Id, i)).ToDictionary(x => x.Id, x => x.i);
        var textOf = order.ToDictionary(e => e.Id, e => e.Text);
        var kept = await tenant.RunAsync(clientId, async d =>
        {
            var manual = await SqlJson.QueryAsync(d, "select task_id as \"taskId\", anchor from task_spec_link where workitem_id = @w and source = 'manual'", new { w = workitemId }, ct);
            await SqlJson.ExecuteAsync(d, "delete from task_spec_link where workitem_id = @w", new { w = workitemId }, ct);
            await SqlJson.ExecuteAsync(d, "delete from spec_section where workitem_id = @w", new { w = workitemId }, ct);
            await SqlJson.ExecuteAsync(d, "delete from spec_document where workitem_id = @w", new { w = workitemId }, ct);
            await SqlJson.ExecuteAsync(d, "insert into spec_document (client_id, workitem_id, attachment_id, doc, corrections) values (@c, @w, @a, @doc, @corr)",
                new { c = clientId, w = workitemId, a = attachmentId, doc = SqlJson.Jsonb(JsonSerializer.SerializeToNode(doc, TaskFacts.Json)), corr = SqlJson.Jsonb(JsonSerializer.SerializeToNode(read.Corrections, TaskFacts.Json)) }, ct);
            var reqs = read.Requirements.OrderBy(r => at.GetValueOrDefault(r.Id)).ToList();
            var ordinal = 0;
            foreach (var r in reqs)
                await SqlJson.ExecuteAsync(d, """
                    insert into spec_section (client_id, workitem_id, anchor, ordinal, kind, title, body, attachment_id) values (@c, @w, @a, @o, 'requirement', @t, @b, @att)
                    """, new { c = clientId, w = workitemId, a = r.Id, o = ordinal++, t = r.Title.Trim(), b = textOf.GetValueOrDefault(r.Id) ?? "", att = attachmentId }, ct);
            foreach (var x in decisions)
                await SqlJson.ExecuteAsync(d, """
                    insert into spec_section (client_id, workitem_id, anchor, ordinal, kind, title, body, gap_id) values (@c, @w, @a, @o, 'decision', @t, @b, @g)
                    """, new { c = clientId, w = workitemId, a = SpecDocs.DecisionAnchor(x.Id), o = ordinal++, t = x.Description.Trim(), b = (x.Answer ?? "").Trim(), g = x.Id }, ct);
            var anchors = reqs.Select(r => r.Id).Concat(decisions.Select(x => SpecDocs.DecisionAnchor(x.Id))).ToHashSet();
            var links = 0;
            foreach (var l in read.Links)
                if (bySeq.TryGetValue(l.Seq, out var taskId) && anchors.Contains(l.Id))
                    links += await SqlJson.ExecuteAsync(d, "insert into task_spec_link (client_id, workitem_id, task_id, anchor, source) values (@c, @w, @t, @a, @s) on conflict do nothing",
                        new { c = clientId, w = workitemId, t = taskId, a = l.Id, s = source }, ct);
            var lostManual = 0;
            foreach (var m in manual)
            {
                var anchor = m["anchor"]!.GetValue<string>();
                if (!anchors.Contains(anchor)) { lostManual++; continue; }
                await SqlJson.ExecuteAsync(d, """
                    insert into task_spec_link (client_id, workitem_id, task_id, anchor, source) values (@c, @w, @t, @a, 'manual')
                    on conflict (task_id, anchor) do update set source = 'manual'
                    """, new { c = clientId, w = workitemId, t = Guid.Parse(m["taskId"]!.GetValue<string>()), a = anchor }, ct);
            }
            return (reqs.Count, links, lostManual);
        }, ct);
        var note = $"📑 האפיון נקרא: {kept.Item1} דרישות סומנו במסמך · {kept.links} קישורים למשימות"
            + (read.Unsupported.Count > 0 ? $" · {read.Unsupported.Count} קישורים נדחו — ההוראה של המשימה לא אומרת את מה שצוטט ממנה" : "")
            + (read.Corrections.Count > 0 ? $" · {read.Corrections.Count} מקומות שהחלטה גוברת על המסמך" : "")
            + (kept.lostManual > 0 ? $" · {kept.lostManual} קישורים ידניים אבדו (החלק שהם הצביעו עליו כבר לא קיים)" : "");
        await events.AppendAsync(new NewEvent
        {
            ClientId = clientId, WorkitemId = workitemId, Source = "claude_session", Type = "note.added", Actor = new DelegatedActor(actor, "dcc:spec-map"),
            Payload = JsonSerializer.SerializeToElement(new { body = note }),
        }, ct);
        return new JsonObject { ["requirements"] = kept.Item1, ["links"] = kept.links, ["lostManual"] = kept.lostManual };
    }

    /// <summary>What one task implements — its own list.</summary>
    public Task<List<JsonObject>> SpecForTaskAsync(Guid clientId, Guid taskId, CancellationToken ct) =>
        tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select s.anchor, s.title, s.kind from task_spec_link l
            join spec_section s on s.workitem_id = l.workitem_id and s.anchor = l.anchor
            where l.task_id = @t order by s.ordinal
            """, new { t = taskId }, ct), ct);

    /// <summary>One task's own mapping, set by a person on the task screen — only anchors of this requirement count.</summary>
    public Task<int> SetTaskSpecLinksAsync(Guid clientId, Guid taskId, IReadOnlyList<string> anchors, CancellationToken ct) =>
        tenant.RunAsync(clientId, async d =>
        {
            var w = await SqlJson.ScalarAsync<Guid?>(d, "select workitem_id from task where id = @t", new { t = taskId }, ct) ?? throw new AppException(404, "not_found", "משימה לא נמצאה");
            var valid = anchors.Count == 0 ? [] : (await SqlJson.QueryAsync(d, "select anchor from spec_section where workitem_id = @w and anchor = any(@a)", new { w, a = anchors.ToArray() }, ct))
                .Select(r => r["anchor"]!.GetValue<string>()).ToList();
            await SqlJson.ExecuteAsync(d, "delete from task_spec_link where task_id = @t", new { t = taskId }, ct);
            foreach (var a in valid)
                await SqlJson.ExecuteAsync(d, "insert into task_spec_link (client_id, workitem_id, task_id, anchor, source) values (@c, @w, @t, @a, 'manual')", new { c = clientId, w, t = taskId, a }, ct);
            return valid.Count;
        }, ct);

    // ── what a requirement cost ──────────────────────────────────────

    /// <summary>Every ledger row against the requirement, summed — never reset by a re-breakdown or dropped work.</summary>
    public Task<JsonObject> CostSummaryAsync(Guid clientId, Guid workitemId, CancellationToken ct) =>
        tenant.RunAsync(clientId, async d =>
        {
            var rows = await SqlJson.QueryAsync(d, """
                select capability, cost_usd::float as "usd", input_tokens as "inTok", output_tokens as "outTok" from claude_call where workitem_id = @w
                """, new { w = workitemId }, ct);
            var byKind = new JsonObject();
            double total = 0; long inTok = 0, outTok = 0;
            foreach (var r in rows)
            {
                var usd = r["usd"]!.GetValue<double>();
                total += usd; inTok += r["inTok"]!.GetValue<int>(); outTok += r["outTok"]!.GetValue<int>();
                var cap = r["capability"]!.GetValue<string>();
                var bucket = byKind[cap] as JsonObject ?? (JsonObject)(byKind[cap] = new JsonObject { ["count"] = 0, ["usd"] = 0.0 });
                bucket["count"] = bucket["count"]!.GetValue<int>() + 1;
                bucket["usd"] = bucket["usd"]!.GetValue<double>() + usd;
            }
            return new JsonObject { ["totalUsd"] = total, ["totalInputTokens"] = inTok, ["totalOutputTokens"] = outTok, ["runCount"] = rows.Count, ["byKind"] = byKind };
        }, ct);

    /// <summary>Every call behind the total, newest first.</summary>
    public Task<List<JsonObject>> CostDetailAsync(Guid clientId, Guid workitemId, CancellationToken ct) =>
        tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d, """
            select id, started_at as "occurredAt", capability as "kind", trigger, label, coalesce(model_used, model_requested) as "model", effort,
                   cost_usd::float as "costUsd", input_tokens as "inputTokens", cache_read_tokens as "cacheReadTokens", output_tokens as "outputTokens",
                   duration_ms as "durationMs", num_turns as "numTurns", outcome
            from claude_call where workitem_id = @w order by started_at desc
            """, new { w = workitemId }, ct), ct);

    private static string? Str(JsonObject? o, string k) => o?[k] is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 ? s : null;
    private static JsonArray Arr(IEnumerable<string> xs) => new(xs.Select(x => (JsonNode?)x).ToArray());
}

/// <summary>The readiness check as a background run.</summary>
public sealed class AssessRun(RequirementAiService ai) : IFlowRunWork
{
    public string Kind => "assess";
    public Task<JsonNode> RunAsync(FlowRunInput input, CancellationToken ct) => ai.AssessAsync(input, ct);
}

/// <summary>The breakdown as a background run.</summary>
public sealed class BreakdownRun(RequirementAiService ai) : IFlowRunWork
{
    public string Kind => "breakdown";
    public Task<JsonNode> RunAsync(FlowRunInput input, CancellationToken ct) => ai.BreakdownAsync(input, ct);
}
