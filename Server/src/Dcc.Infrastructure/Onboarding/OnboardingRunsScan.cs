using System.Text.Json.Nodes;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Repos;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// The scan of the <c>/init</c> draft (runs.ts): what the interactive session wrote in the isolated copy is set against
/// DCC's own cards by an editor, and what it takes becomes cards that wait for a person — whatever the automation level.
/// Its state lives in the plan step's result (<c>initScan</c>), written with a jsonb merge, so a scan and a replan never
/// write back each other's stale copy; the screen polls it.
/// </summary>
public sealed partial class OnboardingRuns
{
    private static readonly Dictionary<string, string> VerdictHe = new()
    {
        ["adopt"] = "הטיוטה טובה יותר — לוקחים את רובה", ["merge"] = "משלבים את שתיהן", ["partial"] = "שלנו הבסיס, תוספות מהטיוטה", ["keep_ours"] = "נשארים עם שלנו",
    };

    /// <summary>What JavaScript's trimEnd() takes off: its WhiteSpace and LineTerminator — the BOM in, U+0085 out.</summary>
    private static readonly char[] JsSpace =
    [
        '\t', '\n', '\v', '\f', '\r', ' ', (char)0x00a0, (char)0x1680, (char)0x2000, (char)0x2001, (char)0x2002, (char)0x2003, (char)0x2004,
        (char)0x2005, (char)0x2006, (char)0x2007, (char)0x2008, (char)0x2009, (char)0x200a, (char)0x2028, (char)0x2029, (char)0x202f, (char)0x205f,
        (char)0x3000, (char)0xfeff,
    ];

    private static string? TrimEnd(string? s) => s?.TrimEnd(JsSpace);

    /// <summary>The draft as it is now in the copy: the files the session wrote, and the changed files where instructions live, before and after.</summary>
    private static async Task<List<DraftFile>> DraftOfAsync(LoadedRun run)
    {
        if (run.WorkspacePath is not { Length: > 0 } dir || run.BaselineSha is not { Length: > 0 } baseline) return [];
        var transcript = Str(RunSessions.Of(run.Run["session"]), "transcriptPath");
        var written = transcript is { Length: > 0 } ? Transcript.WrittenPaths(transcript, dir) : [];
        var paths = InitScans.DraftPaths(written, await RunChanges.ChangedFilesAsync(dir, baseline));
        var output = new List<DraftFile>();
        foreach (var p in paths)
        {
            FileVersions? v;
            try { v = await RunChanges.FileVersionsAsync(dir, baseline, p); }
            catch (Exception e) when (e is not OperationCanceledException) { v = null; }
            if (v is null || v.Binary || v.TooLarge || TrimEnd(v.Before) == TrimEnd(v.After)) continue;
            output.Add(new DraftFile(p, v.Before, v.After));
        }
        return output;
    }

    /// <summary>The scan's state, merged into the plan step's result next to the rest of the plan.</summary>
    private Task PatchInitScanAsync(RunCtx ctx, JsonObject scan) => store.MergePlanResultAsync(ctx, new JsonObject { ["initScan"] = scan });

    /// <summary>A failed scan keeps the last one's result beside the error, so the cards on the screen still have their reasons.</summary>
    internal async Task FailInitScanAsync(RunCtx ctx, Guid? by, string error, string? reason = null)
    {
        var loaded = await store.RunAsync(ctx.RepoId, ctx.RunId);
        var prev = loaded.StepResult("plan")?["initScan"] as JsonObject;
        var scan = prev is not null && ComponentVerifier.Truthy(prev["verdict"])
            ? (JsonObject)prev.DeepClone()
            : new JsonObject { ["startedAt"] = Str(prev, "startedAt") ?? Now(), ["by"] = by?.ToString() ?? "", ["files"] = prev?["files"]?.DeepClone() ?? new JsonArray() };
        scan["state"] = "failed";
        scan["error"] = error;
        scan["failedAt"] = Now();
        await PatchInitScanAsync(ctx, scan);
        await store.EventAsync(ctx, "onboarding.draft.scan_failed", new() { ["error"] = error, ["reason"] = reason }, by);
        terminal.Line(ctx.RunId, $"✗ סריקת טיוטת /init נכשלה: {error}");
    }

    /// <summary>"סרוק מה ש-/init עשה": the editor runs in the background (minutes — it reads the code to check claims); the screen follows its state.</summary>
    public async Task<JsonObject> ScanInitDraftAsync(Guid repoId, Guid runId, Guid by)
    {
        var loaded = await store.RunAsync(repoId, runId);
        var ctx = loaded.Ctx;
        if (loaded.Over) throw new OnboardingRefused("ההרצה הסתיימה");
        if (loaded.StepStatus("plan") != Steps.WaitingForUser) throw new OnboardingRefused("סריקת הטיוטה אפשרית כשהתוכנית פתוחה לאישור");
        if (string.IsNullOrEmpty(loaded.WorkspacePath) || string.IsNullOrEmpty(loaded.BaselineSha)) throw new OnboardingRefused("אין עותק מבודד");
        if (!locks.TryPlan(runId)) throw new OnboardingRefused("סריקה של הטיוטה או תחילת בנייה כבר רצות בהרצה הזו");
        List<string> files;
        try
        {
            var transcript = Str(RunSessions.Of(loaded.Run["session"]), "transcriptPath");
            if (terminal.State(runId) == "live" && transcript is { Length: > 0 } && !Transcript.SessionIdle(transcript).Idle)
                throw new OnboardingRefused("סשן הטיוטה עוד עובד — חכו שיסיים את התור (או עצרו אותו) ואז סרקו");
            var draft = await DraftOfAsync(loaded);
            if (draft.Count == 0) throw new OnboardingRefused("סשן הטיוטה עוד לא כתב כלום בעותק — אין מה לסרוק");
            files = draft.Select(f => f.Path).ToList();
            var prev = loaded.StepResult("plan")?["initScan"] as JsonObject;
            var running = prev is not null && ComponentVerifier.Truthy(prev["verdict"]) ? (JsonObject)prev.DeepClone() : [];
            running["state"] = "running";
            running["startedAt"] = Now();
            running["by"] = by.ToString();
            running["files"] = OnboardingJson.Arr(files);
            running.Remove("error");
            running.Remove("failedAt");
            await PatchInitScanAsync(ctx, running);
            await store.EventAsync(ctx, "onboarding.draft.scan_started", new() { ["files"] = OnboardingJson.Arr(files) }, by);
            terminal.Line(runId, $"סריקת טיוטת /init: {files.Count} קבצים — {string.Join(", ", files.Take(6))}");
            Background(engine => engine.RunInitScanAsync(ctx, loaded, by, draft),
                (engine, e) => engine.FailInitScanAsync(ctx, by, Slice(e.Message, 300)),
                () => locks.EndPlan(runId));
        }
        catch
        {
            locks.EndPlan(runId);
            throw;
        }
        return new JsonObject { ["scanning"] = true, ["files"] = files.Count };
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"^\./")] private static partial System.Text.RegularExpressions.Regex DotSlash();

    private async Task RunInitScanAsync(RunCtx ctx, LoadedRun run, Guid by, List<DraftFile> draft)
    {
        var dir = run.WorkspacePath!;
        var startedAt = Now();
        var p = await store.RequireProfileAsync(ctx);
        var processes = await store.ProcessesAsync(ctx);
        var trials = await store.TrialsAsync(ctx, "baseline");
        var cards = await store.CardsAsync(ctx);
        var ours = cards.Where(c => c.Source != "init").ToList();
        var earlier = cards.Where(c => c.Source == "init" && c.Status != ComponentStatuses.Proposed).ToList();
        var interview = (await store.RunAsync(ctx.RepoId, ctx.RunId)).StepResult("processes") as JsonObject ?? [];
        var said = (await store.EventsAsync(ctx)).Where(e => Str(e, "type") == "onboarding.session.answer")
            .Select(e => $"- {Str(e["payload"], "question") ?? ""} → {Str(e["payload"], "answer") ?? ""}").ToList();
        var ourCards = ours.Select(c => $"- [{c.Key}] {c.Kind} · {c.Status} · {c.TitleHe} — {Slice(c.WhyHe, 280)}"
                + (c.Kind == "rule" && ComponentVerifier.Truthy(c.Params["text"]) ? $" — the line: \"{Slice(ComponentVerifier.JsString(c.Params["text"]), 300)}\"" : ""))
            // What an earlier scan already took and a person decided: not to be proposed again; a better text names it in "replaces".
            .Concat(earlier.Select(c => $"- [{c.Key}] {c.Kind} · {c.Status} · taken from the draft by an earlier scan · {c.TitleHe} — the text: \"{Slice(c.Params["text"] is { } t ? ComponentVerifier.JsString(t) : "", 400)}\""))
            .ToList();
        var res = await CallModelAsync(ctx, "onboarding.init_scan", new()
        {
            ["REPO_NAME"] = ctx.RepoName, ["PROFILE_SUMMARY"] = OnboardingProfile.Summary(p.Profile),
            ["FACTS"] = string.Join("\n", OnboardingProfile.Facts(p.Profile, p.Corrections).Select(f => $"- {f.LabelHe}: {f.ValueHe}{(f.Corrected ? " (marked wrong by a person)" : "")}")),
            ["INTERVIEW"] = Processes.RenderInterview(OnboardingJson.From<List<InterviewQuestion>>(interview["questions"]) ?? [], OnboardingJson.From<List<InterviewAnswer>>(interview["answers"]) ?? []),
            ["PROCESSES"] = Processes.RenderProcesses(processes), ["TRIALS"] = Trials.Render(trials),
            ["SESSION_ANSWERS"] = said.Count > 0 ? string.Join("\n", said) : "(the person answered no question in the session)",
            ["OURS_AGENTS"] = ComponentBuilder.PreviewAgentsMd(data.Catalog, dir, p.Profile, ctx.RepoName, cards),
            ["OUR_CARDS"] = ourCards.Count > 0 ? string.Join("\n", ourCards) : "(no cards)",
            ["DRAFT"] = $"The isolated copy of the repository, to read with Read, Grep and Glob: {dir}\n\n{InitScans.RenderDraft(draft)}",
        }, new CallOpts("onboarding_init_scan", "סריקת טיוטת /init", "plan", by, dir) { Lean = true, LeanTools = "Read,Grep,Glob", AddDirs = [dir], Think = true, MaxTurns = 40, TimeoutMs = 900_000 });
        var scan = InitScans.ParseInitScan(res.Text);
        var facts = ComponentBuilder.RepoFactsOf(p.Profile, ctx.RepoName, null);
        List<string> knownCommands = [
            .. ComponentVerifier.Strings((p.Profile["build"] as JsonObject)?["commands"]), .. ComponentVerifier.Strings((p.Profile["ci"] as JsonObject)?["commands"]),
            facts.TestCommand ?? "", facts.LintCommand ?? "",
        ];
        knownCommands.RemoveAll(k => k.Length == 0);
        var inBase = new HashSet<string>();
        foreach (var it in scan.Items.Where(i => i.Form == "file"))
        {
            var target = DotSlash().Replace(it.Target, "");
            if ((await Git.RunAsync(["cat-file", "-e", $"{run.BaselineSha}:{target}"], dir)).Ok) inBase.Add(target);
        }
        // The call takes minutes; a person may have decided, asked for a card or corrected a fact meanwhile — write against the cards as they are now.
        var now = await store.CardsAsync(ctx);
        var oursNow = now.Where(c => c.Source != "init").ToList();
        var (seeds, refused) = InitScanSeeds.SeedsFromScan(new ScanSeedsInput(scan, dir, knownCommands, now, inBase.Contains));
        // What the scan takes always waits for a person, whatever the automation level.
        var level = run.Level;
        var taken = seeds.Select(sd =>
        {
            var c = Components.CardFromSeed(sd, level);
            if (c.Group != "not_recommended")
            {
                c.Group = "approval";
                c.Status = ComponentStatuses.Proposed;
            }
            return c;
        }).ToList();
        // A card of an earlier scan that a person already decided on stays; an undecided one is replaced by this scan.
        var kept = now.Where(c => c.Source == "init" && !string.IsNullOrEmpty(c.DecidedBy) && !taken.Any(t => t.Key == c.Key)).ToList();
        var removed = now.Where(c => c.Source == "init" && string.IsNullOrEmpty(c.DecidedBy) && !taken.Any(t => t.Key == c.Key)).Select(c => c.Key).ToList();
        var stays = oursNow.Concat(kept).ToList();
        // A Map: a key named twice keeps its first place and its last reason.
        var dropKeys = new List<string>();
        var drop = new Dictionary<string, string>();
        foreach (var d in scan.DropOurs.Where(d => stays.Any(c => c.Key == d.Key)))
        {
            if (!drop.ContainsKey(d.Key)) dropKeys.Add(d.Key);
            drop[d.Key] = d.Why;
        }
        var noted = stays.Select(c =>
        {
            var copy = Components.Copy(c);
            copy.WhyHe = InitScans.WithScanNote(c.WhyHe, drop.GetValueOrDefault(c.Key));
            return copy;
        }).ToList();
        await store.UpsertCardsAsync(ctx, [.. noted, .. taken]);
        var done = new JsonObject
        {
            ["state"] = "done", ["startedAt"] = startedAt, ["finishedAt"] = Now(), ["by"] = by.ToString(), ["files"] = OnboardingJson.Arr(draft.Select(d => d.Path)),
            ["verdict"] = scan.Verdict, ["summary"] = scan.Summary, ["compare"] = Node(scan.Compare),
            ["cards"] = new JsonArray(taken.Select(c => (JsonNode?)new JsonObject
            {
                ["key"] = c.Key, ["title"] = c.TitleHe, ["decision"] = c.Params["decision"] is { } dn ? ComponentVerifier.JsString(dn) : "take", ["notRecommended"] = c.Group == "not_recommended",
            }).ToArray()),
            ["dropOurs"] = new JsonArray(dropKeys.Select(k => (JsonNode?)new JsonObject { ["key"] = k, ["title"] = stays.First(c => c.Key == k).TitleHe, ["why"] = drop[k] }).ToArray()),
            ["reject"] = Node(scan.Reject), ["refused"] = Node(refused), ["costUsd"] = res.CostUsd,
        };
        await PatchInitScanAsync(ctx, done);
        await store.EventAsync(ctx, "onboarding.draft.scanned", new()
        {
            ["verdict"] = scan.Verdict, ["cards"] = taken.Count, ["asks"] = taken.Count(c => ComponentVerifier.IsString(c.Params["decision"], "ask")), ["dropOurs"] = drop.Count,
            ["rejected"] = scan.Reject.Count + refused.Count, ["costUsd"] = res.CostUsd,
            ["created"] = OnboardingJson.Arr(taken.Select(c => c.Key)), ["removed"] = OnboardingJson.Arr(removed), ["noted"] = OnboardingJson.Arr(dropKeys),
        }, by);
        terminal.Line(ctx.RunId, $"סריקת טיוטת /init: {VerdictHe.GetValueOrDefault(scan.Verdict, "undefined")} · {taken.Count} כרטיסים חדשים לאישור · {drop.Count} משלנו מסומנים כמיותרים · {scan.Reject.Count + refused.Count} לא נלקחו");
    }
}
