using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// The build and the delivery (runs.ts): the plan's approved cards installed into the isolated copy by family, each
/// verified its own way, the trial run again against the baseline; then only what was approved committed in the person's
/// own name, pushed, and a pull request opened. Before the build writes anything the <c>/init</c> draft is set aside, so
/// what the session wrote reaches the pull request only through a card a person approved.
/// </summary>
public sealed partial class OnboardingRuns
{
    private const string NothingToDeliver = "אין קבצים מאושרים למסירה — רק קבצים של רכיבים שאושרו נכנסים ל-commit, ולא כל מה שנמצא בעותק.";

    private static readonly string[] DossierFiles = [".dcc/profile.json", ".dcc/components.json", ".dcc/processes.json", ".dcc/trials.json"];

    // ── setting the draft aside ─────────────────────────────────────

    /// <summary>git's standard output alone, and its standard error apart: a warning git prints on stderr (line endings on Windows) must not become a file name.</summary>
    private static async Task<(int Code, string Out, string Err)> GitApartAsync(string dir, IReadOnlyList<string> args, int timeoutMs)
    {
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = dir, RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
            UseShellExecute = false, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in new[] { "-c", "core.longpaths=true", "-c", "core.quotepath=off", "--literal-pathspecs" }.Concat(args)) psi.ArgumentList.Add(a);
        psi.Environment["GIT_TERMINAL_PROMPT"] = "0";
        Process p;
        try { p = Process.Start(psi)!; }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { return (-1, "", e.Message); }
        using (p)
        {
            p.StandardInput.Close();
            var stdout = p.StandardOutput.ReadToEndAsync(CancellationToken.None);
            var stderr = p.StandardError.ReadToEndAsync(CancellationToken.None);
            using var limit = new CancellationTokenSource(timeoutMs);
            try { await p.WaitForExitAsync(limit.Token); }
            catch (OperationCanceledException)
            {
                try { p.Kill(entireProcessTree: true); } catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { }
                return (-1, "", $"git {args[0]} did not finish in {timeoutMs / 1000}s");
            }
            return (p.ExitCode, await stdout, await stderr);
        }
    }

    /// <summary>
    /// Before the build writes anything, the copy goes back to where the run started: nothing but DCC's own <c>.dcc/</c>
    /// differs from the baseline before the build, so every difference is the draft — what the session wrote with any
    /// tool, committed or not. Commits the session made are undone first (their changes stay in the files), every
    /// changed file is kept under the run's runtime folder, and each is put back to the baseline or removed. So what the
    /// session wrote reaches the pull request only through a card a person approved. Recorded; nothing is lost.
    /// </summary>
    private async Task<List<string>> SetDraftAsideAsync(RunCtx ctx, Guid by)
    {
        var run = await store.RunAsync(ctx.RepoId, ctx.RunId);
        if (run.WorkspacePath is not { Length: > 0 } dir || run.BaselineSha is not { Length: > 0 } baseline) return [];
        async Task<string> G(string what, params string[] args)
        {
            var (code, output, err) = await GitApartAsync(dir, args, 120_000);
            if (code != 0) throw new OnboardingRefused($"לא ניתן להזיז את טיוטת /init הצידה ({what}): {Slice(err.Length > 0 ? err : $"git {args[0]} exited with {code}", 200)}");
            return output;
        }
        static List<string> Nul(string output) => output.Split('\0').Select(ComponentVerifier.JsTrim).Where(x => x.Length > 0).ToList();

        var commits = (await G("רשימת ה-commits", "rev-list", $"{baseline}..HEAD")).Split('\n').Select(ComponentVerifier.JsTrim).Where(x => x.Length > 0).ToList();
        // A Map: a path seen again keeps its first place and takes the later status.
        var changed = new OrderedDictionary<string, string>(StringComparer.Ordinal);
        var status = Nul(await G("מה השתנה", "diff", "--name-status", "--no-renames", "-z", baseline));
        for (var i = 0; i + 1 < status.Count; i += 2) changed[status[i + 1]] = status[i];
        foreach (var p in Nul(await G("קבצים חדשים", "ls-files", "--others", "--exclude-standard", "-z"))) changed[p] = "?";
        foreach (var p in changed.Keys.Where(k => k.StartsWith(".dcc/", StringComparison.Ordinal)).ToList()) changed.Remove(p);
        if (changed.Count == 0 && commits.Count == 0) return [];

        var keep = Path.Combine(workspace.RuntimeDir(ctx.RunId), "init-draft");
        foreach (var p in changed.Keys)
        {
            var from = Path.Combine(dir, p);
            if (!File.Exists(from)) continue;
            var to = Path.Combine(keep, p);
            Directory.CreateDirectory(Path.GetDirectoryName(to)!);
            File.Copy(from, to, overwrite: true);
        }
        var files = changed.Keys.ToList();
        await store.EventAsync(ctx, "onboarding.draft.set_aside", new()
        {
            ["files"] = OnboardingJson.Arr(files.Take(200)), ["count"] = files.Count, ["commitsUndone"] = OnboardingJson.Arr(commits), ["keptAt"] = keep,
        }, by);
        try
        {
            if (commits.Count > 0) await G("ביטול ה-commits של הסשן", "reset", "--quiet", "--mixed", baseline);
            var restore = files.Where(p => changed[p] is not ("A" or "?")).ToList();
            for (var i = 0; i < restore.Count; i += 100) await G("החזרת קבצים", ["checkout", baseline, "--", .. restore.Skip(i).Take(100)]);
            foreach (var p in files.Where(x => !restore.Contains(x)))
            {
                var f = Path.Combine(dir, p);
                if (File.Exists(f)) File.Delete(f);
            }
        }
        catch (Exception e)
        {
            await store.EventAsync(ctx, "onboarding.draft.set_aside_failed", new() { ["error"] = Slice(e.Message, 300) }, by);
            throw;
        }
        terminal.Line(ctx.RunId, $"טיוטת /init הוזזה הצידה ({files.Count} קבצים{(commits.Count > 0 ? $", {commits.Count} commits בוטלו" : "")}; נשמרו ב-{keep}) — רק מה שאושר בכרטיס נכנס");
        return files;
    }

    // ── 5. build: install by family, verify per kind, trial again ───

    /// <summary>
    /// "בנה": the plan completes with what was decided, a live draft session is stopped and its draft set aside, and the
    /// build starts. Refused while a scan of the draft runs — both change the plan's cards from the draft.
    /// </summary>
    public async Task<JsonObject> StartBuildAsync(Guid repoId, Guid runId, Guid by)
    {
        var loaded = await store.RunAsync(repoId, runId);
        var ctx = loaded.Ctx;
        if (loaded.Over) throw new OnboardingRefused("ההרצה הסתיימה");
        if (loaded.StepStatus("plan") != Steps.WaitingForUser) throw new OnboardingRefused("התוכנית לא ממתינה");
        var cards = await store.CardsAsync(ctx);
        var approved = cards.Where(c => c.Status == ComponentStatuses.Approved).ToList();
        if (approved.Count == 0) throw new OnboardingRefused("שום רכיב לא אושר — אשרו לפחות אחד, או בטלו את ההרצה");
        if (!locks.TryPlan(runId)) throw new OnboardingRefused("סריקת טיוטת /init עוד רצה — חכו שתסתיים, או בנו אחריה");
        try
        {
            if (terminal.State(runId) == "live") await drafts.StopAsync(ctx.Draft, by, CancellationToken.None);
            await SetDraftAsideAsync(ctx, by);
        }
        finally
        {
            locks.EndPlan(runId);
        }
        var planNow = (await store.RunAsync(repoId, runId)).StepResult("plan") ?? loaded.StepResult("plan");
        var result = planNow is JsonObject o ? (JsonObject)o.DeepClone() : [];
        result["decided"] = cards.Count(c => c.Status != ComponentStatuses.Proposed);
        result["approved"] = approved.Count;
        result["declined"] = cards.Count(c => c.Status == ComponentStatuses.Declined && c.Group != "not_recommended");
        result["deferred"] = cards.Count(c => c.Status == ComponentStatuses.Deferred);
        result["undecided"] = cards.Count(c => c.Status == ComponentStatuses.Proposed);
        await CompleteStepAsync(ctx, "plan", result, by);
        await RunStepAsync(repoId, runId, "build", by, automated: true);
        return new JsonObject { ["building"] = approved.Count };
    }

    private async Task BuildAsync(RunCtx ctx, LoadedRun run, Guid by)
    {
        if (run.WorkspacePath is not { Length: > 0 } dir) throw new OnboardingRefused("אין עותק מבודד");
        var p = await store.RequireProfileAsync(ctx);
        var processes = await store.ProcessesAsync(ctx);
        var cards = await store.CardsAsync(ctx);
        double costUsd = 0;
        async Task<string> Author(AuthorInput a)
        {
            var c = a.Component;
            var answers = c.Questions.Count > 0 ? $"\nAnswers: {string.Join("; ", c.Questions.Select(q => $"{q.QuestionHe} → {q.Answer ?? q.Default}"))}" : "";
            var res = await CallModelAsync(ctx, "onboarding.author", new()
            {
                ["REPO_NAME"] = ctx.RepoName, ["PROFILE_SUMMARY"] = OnboardingProfile.Summary(p.Profile),
                ["COMPONENT"] = $"{KindHe(c.Kind)} · {c.TitleHe}\nWhy: {c.WhyHe}\nWhat: {c.WhatHe}\nParameters: {Slice(ComponentVerifier.StringifyJson(c.Params, false), 1500)}{answers}",
                ["PROCESS"] = a.Process is { } pr ? $"{pr.Title}\n{string.Join("\n", pr.Steps.Select(s => $"- {s.Title}: {s.What}"))}" : null,
                ["EVIDENCE"] = a.Evidence, ["FORMAT"] = a.Format,
            }, new CallOpts("onboarding_author", $"כתיבה: {c.TitleHe}", "build", by, dir) { MaxTurns = 25, TimeoutMs = 420_000 });
            costUsd += res.CostUsd;
            return res.Text;
        }
        var outcomes = await ComponentBuilder.BuildAsync(data.Catalog, new BuildInput(dir, ctx.RepoName, p.Profile, cards, processes, Author, l => terminal.Line(ctx.RunId, l)));
        foreach (var o in outcomes)
        {
            var c = cards.First(x => x.Key == o.Key);
            await store.UpdateCardAsync(ctx, c.Id!, new()
            {
                ["status"] = o.Status, ["files"] = SqlJson.Jsonb(o.Files), ["validation"] = o.Validation is null ? null : SqlJson.Jsonb(o.Validation),
            });
            await store.EventAsync(ctx, "onboarding.build.component", new()
            {
                ["key"] = o.Key, ["title"] = c.TitleHe, ["kind"] = c.Kind, ["status"] = o.Status, ["files"] = OnboardingJson.Arr(o.Files),
                ["validation"] = o.Validation is { } v ? new JsonObject { ["how"] = v.How, ["passed"] = v.Passed, ["detail"] = Slice(v.Detail, 300) } : null,
                ["notes"] = OnboardingJson.Arr(o.Notes),
            }, by);
        }
        var built = await store.CardsAsync(ctx);
        var joint = ComponentVerifier.Joint(built, dir);
        foreach (var d in joint.Duplicates) terminal.Line(ctx.RunId, $"כפילות: {d}");
        foreach (var d in joint.Contradictions) terminal.Line(ctx.RunId, $"סתירה: {d}");
        terminal.Line(ctx.RunId, $"הקשר שנטען בכל סשן: ~{OnboardingJson.Grouped(joint.AlwaysLoadedTokens)} טוקנים");
        // The trial again, on the same tasks, with the components in place — the only measure that says whether the set helped.
        TrialDelta? delta = null;
        var baseline = await store.TrialsAsync(ctx, "baseline");
        if (baseline.Count > 0 && run.Kind != "coach")
        {
            var tasks = Trials.TasksFor(p.Profile, data.TrialTemplates, processes).Where(t => baseline.Any(b => b.TaskKey == t.Key)).ToList();
            var after = await TrialPhaseAsync(ctx, dir, by, "after", tasks);
            delta = Trials.Delta(baseline, after);
            if (delta is not null)
                terminal.Line(ctx.RunId, $"לפני: {delta.Before.Passed}/{delta.Before.Total} · אחרי: {delta.After.Passed}/{delta.After.Total} · עלות למשימה: "
                    + (delta.CostPerTaskChange is { } change ? $"{ComponentVerifier.JsNumber(OnboardingJson.Round(change * 100))}%" : "—"));
        }
        // The repository's own dossier (.dcc/), delivered with the components.
        var dossier = ComponentBuilder.WriteDossier(dir, new DossierInput(p.Profile, p.Corrections, built, await store.TrialsAsync(ctx), processes, ctx.RunId.ToString(), run.BaselineSha));
        var files = built.SelectMany(c => c.Files).Concat(dossier).Distinct().ToList();
        var result = new JsonObject
        {
            ["installed"] = outcomes.Count(o => o.Status is ComponentStatuses.Installed or ComponentStatuses.Verified),
            ["verified"] = outcomes.Count(o => o.Status == ComponentStatuses.Verified),
            ["failed"] = outcomes.Count(o => o.Status == ComponentStatuses.Failed),
            ["skipped"] = outcomes.Count(o => o.Status is ComponentStatuses.Deferred or ComponentStatuses.Reported),
            ["files"] = OnboardingJson.Arr(files), ["delta"] = Node(delta), ["jointCheck"] = Node(joint), ["costUsd"] = costUsd,
        };
        await store.EventAsync(ctx, "onboarding.build.done", (JsonObject)result.DeepClone(), by);
        await CompleteStepAsync(ctx, "build", result, by);
        await AdvanceAsync(ctx, by);
    }

    // ── 6. deliver: only what was approved, in the person's identity ─

    /// <summary>The files a delivery commits: those of every card that was built (verified or installed), and the dossier files that exist.</summary>
    private async Task<List<string>> DeliverableFilesAsync(RunCtx ctx)
    {
        var cards = await store.CardsAsync(ctx);
        var run = await store.RunAsync(ctx.RepoId, ctx.RunId);
        var dossier = DossierFiles.Where(f => run.WorkspacePath is { Length: > 0 } ws && ComponentVerifier.Exists(Path.Combine(ws, f)));
        return cards.Where(c => c.Status is ComponentStatuses.Verified or ComponentStatuses.Installed).SelectMany(c => c.Files).Concat(dossier).Distinct().ToList();
    }

    /// <summary>
    /// "מסור": a commit of the approved files under the person's own name, a push and a pull request — in the background.
    /// An empty file list is refused here, before anything moves (the old server then staged everything in the copy).
    /// </summary>
    public async Task<JsonObject> DeliverAsync(Guid repoId, Guid runId, Guid by)
    {
        var loaded = await store.RunAsync(repoId, runId);
        var ctx = loaded.Ctx;
        if (loaded.Over) throw new OnboardingRefused("ההרצה הסתיימה");
        if (loaded.StepStatus("deliver") != Steps.WaitingForUser) throw new OnboardingRefused("המסירה לא ממתינה");
        if (string.IsNullOrEmpty(loaded.WorkspacePath) || string.IsNullOrEmpty(loaded.BranchName)) throw new OnboardingRefused("אין עותק מבודד למסירה");
        if ((await DeliverableFilesAsync(ctx)).Count == 0) throw AppException.Conflict("nothing_approved", NothingToDeliver);
        await store.PatchStepAsync(ctx, "deliver", new() { ["status"] = Steps.Running });
        await store.PatchRunAsync(ctx, new() { ["status"] = Steps.Running });
        Background(engine => engine.DeliverBodyAsync(ctx, loaded, by), (engine, e) => engine.FailStepAsync(ctx, "deliver", e, by));
        return new JsonObject { ["delivering"] = true };
    }

    private async Task DeliverBodyAsync(RunCtx ctx, LoadedRun run, Guid by)
    {
        var cards = await store.CardsAsync(ctx);
        var files = await DeliverableFilesAsync(ctx);
        var view = await ReadinessOfAsync(ctx, await store.RunAsync(ctx.RepoId, ctx.RunId), cards);
        var delta = OnboardingJson.From<TrialDelta>(run.StepResult("build")?["delta"]);
        var report = Components.PullRequestReport(ctx.RepoName, cards, delta, view, run.BranchName!, run.BaselineSha);
        var delivered = await deliverer.DeliverAsync(new DeliverInput(run.WorkspacePath!, run.BranchName!, run.DefaultBranch, run.BaselineSha, await store.IdentityAsync(by),
            $"DCC onboarding: Claude Code setup for {ctx.RepoName}", report, files, l => terminal.Line(ctx.RunId, l)));
        var result = delivered with { Report = report };
        foreach (var c in cards.Where(c => c.Source == "marketplace" && c.Status is ComponentStatuses.Verified or ComponentStatuses.Installed))
        {
            if (ComponentVerifier.AsString(c.Params["sourceId"]) is not { } sourceId || !Guid.TryParse(sourceId, out var id)) continue;
            try { await marketplace.CountSourceUseAsync(id); }
            catch (Exception e) when (e is not OperationCanceledException) { log.LogWarning(e, "onboarding: the use of marketplace source {Id} was not counted", id); }
        }
        await store.EventAsync(ctx, "onboarding.delivered", new()
        {
            ["commitSha"] = result.CommitSha, ["prUrl"] = result.PrUrl, ["compareUrl"] = result.CompareUrl, ["localOnly"] = result.LocalOnly, ["files"] = files.Count,
        }, by);
        if (terminal.State(ctx.RunId) == "live") await drafts.StopAsync(ctx.Draft, by, CancellationToken.None);
        await CompleteStepAsync(ctx, "deliver", Node(result)!, by);
    }
}
