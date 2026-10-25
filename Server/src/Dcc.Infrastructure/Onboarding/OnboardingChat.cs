using System.Text.Json.Nodes;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Chat;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// What the one chat knows about an onboarding run (runs.ts onboardingChatFacts; chat/proposals.ts): the step it is on,
/// what the diagnosis found, every card with its reason and result, the draft session's state and what it did since the
/// last question — and, when a person approves a code reading, the run's isolated copy with its changes written out as a
/// diff, because the reading tools have no git.
/// </summary>
public sealed class OnboardingChat(DccDbContext db, OnboardingStore store, ITenantScope tenant) : IChatRunFacts, IChatCodeSource
{
    public string Kind => "run";

    private static string? Str(JsonNode? o, string key) => OnboardingJson.Str(o, key);

    /// <summary>
    /// The facts, keyed in Hebrew as the old server keyed them, and the transcript cursor for the next question. The run's
    /// own client is found from the run (as the owning role, one column); everything else is read inside that client's scope.
    /// </summary>
    public async Task<(JsonObject Facts, int Cursor)> RunFactsAsync(Guid runId, int cursor, CancellationToken ct)
    {
        var clientId = await SqlJson.ScalarAsync<Guid?>(db, "select client_id from repository_onboarding_run where id = @id", new { id = runId }, ct);
        if (clientId is not { } client) return ([], cursor);
        var row = await tenant.RunAsync(client, d => SqlJson.QuerySingleAsync(d, """
            select repo_id as "repoId", status, current_step_key as "currentStepKey", session, triggered_by as "triggeredBy" from repository_onboarding_run where id = @id
            """, new { id = runId }, ct), ct);
        if (row is null) return ([], cursor);
        var ctx = new RunCtx(Guid.Parse(Str(row, "repoId")!), runId, client, "", Guid.Parse(Str(row, "triggeredBy")!));
        var p = await store.ProfileAsync(ctx, ct);
        var cards = await store.CardsAsync(ctx, ct);
        var s = RunSessions.Of(row["session"]);
        var transcript = Str(s, "transcriptPath");
        var digest = transcript is { Length: > 0 } ? Transcript.Digest(transcript, cursor, cursor != 0 ? 10_000 : 14_000) : new TranscriptDigest("", cursor, 0);
        var step = Str(row, "currentStepKey") is { Length: > 0 } key ? Steps.Definition(key)?.TitleHe ?? key : "—";
        var waiting = cards.Count(c => c.Status == ComponentStatuses.Proposed);
        var planResult = await tenant.RunAsync(client, d => SqlJson.QuerySingleAsync(d,
            "select result from repository_onboarding_step where run_id = @id and step_key = 'plan'", new { id = runId }, ct), ct);
        var initScan = planResult?["result"]?["initScan"] as JsonObject;

        var facts = new JsonObject
        {
            ["צעד נוכחי"] = step,
            ["מצב ההרצה"] = Str(row, "status"),
            ["מה האבחון מצא"] = p is null ? "(עדיין לא רץ)"
                : OnboardingJson.Arr(OnboardingProfile.Facts(p.Profile, p.Corrections).Select(f => $"{f.LabelHe}: {f.ValueHe}{(f.Corrected ? " (סומן כלא נכון)" : "")}").Take(16)),
            ["כרטיסי הרכיבים"] = cards.Count == 0 ? "(עדיין אין)" : OnboardingJson.Arr(cards.Select(Card).Take(40)),
            ["כרטיסים שמחכים להחלטה"] = waiting,
            ["סשן טיוטת /init"] = Str(s, "state") switch { "live" => "פעיל", "ended" => "נסגר", "disconnected" => "נותק", _ => "לא נפתח" },
        };
        if (digest.Text.Length > 0) facts["מה סשן הטיוטה עשה מאז השאלה הקודמת"] = digest.Text;
        if (Str(initScan, "state") == "done") facts["סריקת טיוטת /init"] = ScanLine(initScan!);
        return (facts, digest.Cursor);
    }

    private static string Card(Component c)
    {
        var kind = Components.KindHe.TryGetValue(c.Kind, out var he) ? he : "undefined";
        var result = c.Validation is { } v ? $" — תוצאה: {(v.Passed == true ? "עבר" : v.Passed == false ? "נכשל" : "לא נבדק כאן")} ({v.Detail})" : "";
        return $"[{c.Key}] {c.TitleHe} · {kind} · {c.Group} · {c.Status} — למה: {c.WhyHe} — מה: {c.WhatHe} — איך נבדק: {c.VerifyHowHe}{result}";
    }

    private static string ScanLine(JsonObject scan)
    {
        static int Count(JsonNode? n) => n is JsonArray a ? a.Count : 0;
        var reject = scan["reject"] as JsonArray;
        var rejected = reject is { Count: > 0 }
            ? $"; לא נלקח: {OnboardingJson.Slice(string.Join("; ", reject.Select(r => $"{ComponentVerifier.JsString(r?["what"])} ({ComponentVerifier.JsString(r?["why"])})")), 900)}"
            : "";
        return $"{Str(scan, "summary") ?? ""} — {Count(scan["cards"])} כרטיסים מהטיוטה, {Count(scan["dropOurs"])} משלנו סומנו כמיותרים{rejected}";
    }

    /// <summary>
    /// A code reading on a run reads its isolated copy. What the run changed is written beside it as one diff (lock files
    /// without a body, long files cut), and the reading is told which files and where the diff is.
    /// </summary>
    public async Task<(string? Dir, string Holds, string SystemKey, IReadOnlyList<string> ExtraDirs)> CodeForReadingAsync(ResolvedTopic topic, string conversationDir, CancellationToken ct)
    {
        if (!Guid.TryParse(topic.Id, out var runId)) throw new ChatRefused("להרצה הזו אין עותק מבודד עדיין");
        var run = await tenant.RunAsync(topic.ClientId, d => SqlJson.QuerySingleAsync(d, """
            select workspace_path as "workspacePath", baseline_sha as "baselineSha" from repository_onboarding_run where id = @id
            """, new { id = runId }, ct), ct);
        var dir = Str(run, "workspacePath");
        if (string.IsNullOrEmpty(dir)) throw new ChatRefused("להרצה הזו אין עותק מבודד עדיין");
        var holds = "";
        var extra = new List<string>();
        if (Str(run, "baselineSha") is { Length: > 0 } baseline)
        {
            var changeDir = Path.Combine(conversationDir, "change");
            List<ChangedFile> files;
            try { files = await RunChanges.ChangedFilesAsync(dir, baseline); }
            catch (Exception e) when (e is not OperationCanceledException) { files = []; }
            if (files.Count > 0)
            {
                var diffFile = Path.Combine(changeDir, "changes.diff");
                ChangesDiff? w;
                try { w = await RunChanges.WriteDiffAsync(dir, baseline, files, diffFile); }
                catch (Exception e) when (e is not OperationCanceledException) { w = null; }
                if (w is not null)
                {
                    extra.Add(changeDir);
                    holds = string.Join("\n",
                        $"ההרצה שינתה {files.Count} קבצים מול נקודת ההתחלה: {string.Join("; ", files.Select(f => $"{f.Status} {f.Path} (+{f.Additions} −{f.Deletions})"))}.",
                        $"ה-diff של כולם ב-`{diffFile}`{(w.WithoutBody.Count > 0 ? $" (בלי הגוף של: {string.Join(", ", w.WithoutBody)})" : "")}{(w.Cut.Count > 0 ? $" (קוצר עבור: {string.Join(", ", w.Cut)} — קראו את הקובץ עצמו)" : "")}.");
                }
            }
        }
        return (dir, holds, "chat.code_read.onboarding_run", extra);
    }
}
