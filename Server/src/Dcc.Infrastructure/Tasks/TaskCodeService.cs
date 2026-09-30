using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Domain.Tasks;
using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Repos;
using Dcc.Infrastructure.Requirements;

namespace Dcc.Infrastructure.Tasks;

/// <summary>
/// A task's code, read from git: what its branch changed and any file before and after (task-files.ts —
/// two COMMITS only, never the shared working tree), which other tasks changed the same files and whether the
/// two combine (task-merge.ts), and merging a dependency's work into the task's branch — tried in a scratch
/// tree first, so a refused merge leaves nothing half-done.
/// </summary>
public sealed partial class TaskCodeService(TaskStore store, FlowRunHub hub, RepoCheckouts checkouts, BriefService brief)
{
    private const int MaxFileBytes = 1_500_000;

    private async Task<(string Dir, string Base, string Branch)?> ContextAsync(Guid clientId, Guid taskId, CancellationToken ct)
    {
        var t = await store.RequireAsync(clientId, taskId, ct);
        var key = await store.RequirementKeyAsync(clientId, t.WorkitemId, ct);
        var dir = await store.ExistingCloneAsync(clientId, t.WorkitemId, ct);
        if (dir is null) return null;
        var branch = store.BranchOf(key, t);
        if (!await Git.ExistsAsync(dir, branch)) return null;
        return await Git.TaskBaseShaAsync(dir, branch, t.BaseSha) is { } b ? (dir, b, branch) : null;
    }

    [GeneratedRegex(@"^(\d+|-)\t(\d+|-)\t(.+)$")] private static partial Regex NumStat();
    [GeneratedRegex(@"^([AMDRT])\S*\t(.+?)(?:\t(.+))?$")] private static partial Regex NameStatus();

    /// <summary>Every file the task's branch touched, against what it was built on. Null = the branch was not found (not the same as a branch that changed nothing).</summary>
    public async Task<JsonArray?> ChangedFilesAsync(Guid clientId, Guid taskId, CancellationToken ct)
    {
        if (await ContextAsync(clientId, taskId, ct) is not { } c) return null;
        var status = await Git.RunAsync(["-c", "core.quotepath=false", "diff", "--name-status", c.Base, c.Branch], c.Dir, 60_000, ct: ct);
        var numstat = await Git.RunAsync(["-c", "core.quotepath=false", "diff", "--numstat", c.Base, c.Branch], c.Dir, 60_000, ct: ct);
        var counts = new Dictionary<string, (int Add, int Del)>();
        foreach (var line in numstat.Out.Split('\n'))
            if (NumStat().Match(line.TrimEnd('\r')) is { Success: true } m)
                counts[m.Groups[3].Value.Trim()] = (m.Groups[1].Value == "-" ? 0 : int.Parse(m.Groups[1].Value), m.Groups[2].Value == "-" ? 0 : int.Parse(m.Groups[2].Value));
        var files = new List<(string Path, string Status)>();
        foreach (var line in status.Out.Split('\n'))
            if (NameStatus().Match(line.TrimEnd('\r')) is { Success: true } m)
                files.Add(((m.Groups[3].Success ? m.Groups[3].Value : m.Groups[2].Value).Trim(), m.Groups[1].Value));
        return new JsonArray(files.OrderBy(f => f.Path, StringComparer.Create(System.Globalization.CultureInfo.InvariantCulture, false)).Select(f =>
        {
            var (add, del) = counts.GetValueOrDefault(f.Path);
            return (JsonNode?)new JsonObject { ["path"] = f.Path, ["status"] = f.Status, ["additions"] = add, ["deletions"] = del };
        }).ToArray());
    }

    /// <summary>One of them, before and after — both from git objects.</summary>
    public async Task<JsonObject> FileVersionsAsync(Guid clientId, Guid taskId, string filePath, CancellationToken ct)
    {
        if (filePath.Length == 0 || filePath.Contains("..") || filePath.StartsWith('/')) throw AppException.BadRequest("bad_request", "נתיב לא חוקי");
        var c = await ContextAsync(clientId, taskId, ct) ?? throw AppException.Conflict("task_refused", "למשימה הזו עדיין אין ענף — היא לא פותחה");
        async Task<(string? Text, bool TooLarge)> Read(string rev)
        {
            var at = $"{rev}:{filePath}";
            if (!(await Git.RunAsync(c.Dir, "cat-file", "-e", at)).Ok) return (null, false);
            if (long.TryParse((await Git.RunAsync(c.Dir, "cat-file", "-s", at)).Out, out var size) && size > MaxFileBytes) return (null, true);
            var shown = await Git.RunAsync(["show", at], c.Dir, 30_000, ct: ct);
            return (shown.Ok ? shown.Out : null, false);
        }
        var before = await Read(c.Base);
        var after = await Read(c.Branch);
        if (before.TooLarge || after.TooLarge) return new JsonObject { ["path"] = filePath, ["before"] = null, ["after"] = null, ["binary"] = false, ["tooLarge"] = true };
        var binary = (before.Text?.Contains('\0') ?? false) || (after.Text?.Contains('\0') ?? false);
        return new JsonObject { ["path"] = filePath, ["before"] = binary ? null : before.Text, ["after"] = binary ? null : after.Text, ["binary"] = binary, ["tooLarge"] = false };
    }

    // ── overlaps and merging a dependency in (task-merge.ts) ─────────

    private static async Task<List<string>> OwnFilesAsync(string dir, string branch, string? baseSha)
    {
        if (await Git.TaskBaseShaAsync(dir, branch, baseSha) is not { } from) return [];
        return Git.Lines((await Git.RunAsync(["-c", "core.quotepath=false", "diff", "--name-only", from, branch], dir, 60_000)).Out);
    }

    private static async Task<TaskBranches.MergePreview?> PreviewMergeAsync(string dir, string a, string b)
    {
        var r = await Git.RunAsync(["merge-tree", "--write-tree", "--name-only", a, b], dir, 60_000);
        return TaskBranches.ReadMergeTree(r.Code, r.Out);
    }

    private static JsonObject? PreviewJson(TaskBranches.MergePreview? p) => p is null ? null : p.Clean
        ? new JsonObject { ["clean"] = true }
        : new JsonObject { ["clean"] = false, ["conflictFiles"] = new JsonArray(p.ConflictFiles!.Select(f => (JsonNode?)f).ToArray()) };

    /// <summary>The other developed tasks of the requirement that changed a file this one changed, how the two are tied, and whether they combine.</summary>
    public async Task<JsonArray> OverlapsAsync(Guid clientId, Guid taskId, CancellationToken ct)
    {
        var t = await store.GetAsync(clientId, taskId, ct);
        if (t is null || t.Kind != "task") return [];
        var key = await store.RequirementKeyAsync(clientId, t.WorkitemId, ct);
        var dir = await store.ExistingCloneAsync(clientId, t.WorkitemId, ct);
        if (dir is null) return [];
        var mine = store.BranchOf(key, t);
        if (await Git.TaskCommitCountAsync(dir, mine, t.BaseSha) == 0) return [];
        var myFiles = await OwnFilesAsync(dir, mine, t.BaseSha);
        if (myFiles.Count == 0) return [];
        var rel = await store.RelationsAsync(clientId, t.WorkitemId, ct);
        var iWaitFor = rel.EffectiveDeps(t.Id).Select(d => d.Row.Id).ToHashSet();
        var output = new List<(int Seq, JsonObject O)>();
        foreach (var o in rel.Rows)
        {
            if (o.Id == t.Id || o.Kind != "task" || o.State == "dropped" || !o.Active || rel.IsGroup(o.Id)) continue;
            var theirs = store.BranchOf(key, o);
            if (await Git.TaskCommitCountAsync(dir, theirs, o.BaseSha) == 0) continue;
            var files = TaskBranches.SharedFiles(myFiles, await OwnFilesAsync(dir, theirs, o.BaseSha));
            if (files.Count == 0) continue;
            var inOneLine = await Git.IsAncestorAsync(dir, theirs, mine) || await Git.IsAncestorAsync(dir, mine, theirs);
            var relation = iWaitFor.Contains(o.Id) ? "waits_for" : rel.EffectiveDeps(o.Id).Any(d => d.Row.Id == t.Id) ? "waited_on_by" : "none";
            output.Add((o.Seq, new JsonObject
            {
                ["id"] = o.Id.ToString(), ["seq"] = o.Seq, ["intent"] = o.Intent, ["relation"] = relation,
                ["files"] = new JsonArray(files.Select(f => (JsonNode?)f).ToArray()), ["inOneLine"] = inOneLine,
                ["merge"] = inOneLine ? new JsonObject { ["clean"] = true } : PreviewJson(await PreviewMergeAsync(dir, mine, theirs)),
            }));
        }
        return new JsonArray(output.OrderBy(x => x.Seq).Select(x => (JsonNode?)x.O).ToArray());
    }

    /// <summary>
    /// Bring a dependency's work into the task's own branch — for a task developed without it. A clean merge is
    /// done and the task then counts as built on it (its checks reset); a conflict is reported and changes nothing.
    /// </summary>
    public async Task<JsonObject> MergeDependencyAsync(Guid clientId, Guid taskId, Guid dependencyId, Guid actor, CancellationToken ct)
    {
        var t = await store.GetAsync(clientId, taskId, ct);
        var d = await store.GetAsync(clientId, dependencyId, ct);
        if (t is null || d is null || t.Kind != "task") throw new AppException(404, "not_found", "משימה לא נמצאה");
        var rel = await store.RelationsAsync(clientId, t.WorkitemId, ct);
        if (!rel.EffectiveDeps(t.Id).Any(x => x.Row.Id == d.Id)) throw AppException.Conflict("merge_refused", $"#{d.Seq} היא לא תלות של משימה #{t.Seq} — מיזוג נעשה רק עם משימה שהמשימה תלויה בה");
        if (hub.LiveTaskPhase(taskId) is not null || hub.LiveTaskPhase(dependencyId) is not null) throw AppException.Conflict("merge_refused", "יש הרצה של Claude על אחת המשימות כרגע — חכו שתסתיים");

        var key = await store.RequirementKeyAsync(clientId, t.WorkitemId, ct);
        var repo = await store.FirstRepoAsync(clientId, t.WorkitemId, ct) ?? throw AppException.Conflict("merge_refused", "אין repository מקושר לדרישה");
        var dir = await checkouts.EnsureAsync(repo with { LocalPath = null }) ?? throw AppException.Conflict("merge_refused", $"לא הצלחתי להביא עותק של {repo.Name}");
        var mine = store.BranchOf(key, t);
        var theirs = store.BranchOf(key, d);
        if (await Git.TaskCommitCountAsync(dir, mine, t.BaseSha) == 0) throw AppException.Conflict("merge_refused", $"משימה #{t.Seq} עוד לא פותחה — אין ענף לצרף אליו");
        if (await Git.TaskCommitCountAsync(dir, theirs, d.BaseSha) == 0) throw AppException.Conflict("merge_refused", $"ל-#{d.Seq} אין קוד משלה — אין מה למזג");
        if (await Git.IsAncestorAsync(dir, theirs, mine)) return new JsonObject { ["merged"] = true, ["already"] = true };
        if (t.BaseTaskId is { } bt && bt != d.Id)
        {
            var onSeq = (await store.GetAsync(clientId, bt, ct))?.Seq.ToString() ?? "?";
            return Refusal($"המשימה כבר בנויה על #{onSeq}. מיזוג של תלות נוספת מעליה לא נתמך — Rollback והרצה חוזרת יבנו אותה על כולן", []);
        }
        var preview = await PreviewMergeAsync(dir, mine, theirs);
        if (preview is null) return Refusal("git לא הצליח לבדוק את המיזוג", []);
        if (!preview.Clean)
            return Refusal($"המיזוג של #{d.Seq} לתוך #{t.Seq} מתנגש — שני הענפים שינו את אותן שורות. לא שיניתי כלום. Rollback והרצה חוזרת יפתחו את המשימה על #{d.Seq}, או שאפשר לפתור את הקונפליקט ידנית ב-git", preview.ConflictFiles!);

        var (name, email) = await store.CommitIdentityAsync(actor, ct);
        await Git.RunAsync(dir, "reset", "--hard");
        await Git.RunAsync(dir, "clean", "-fd");
        await Git.RunAsync(dir, "checkout", mine);
        var tip = (await Git.RunAsync(dir, "rev-parse", theirs)).Out;
        var m = await Git.RunAsync(dir, "-c", $"user.name={name}", "-c", $"user.email={email}", "merge", "--no-edit", "--no-ff", "-m", $"{key ?? "REQ"} t{t.Seq}: merge the work of #{d.Seq}\n\nDCC task {t.Id}", theirs);
        if (!m.Ok)
        {
            await Git.RunAsync(dir, "merge", "--abort");
            return Refusal($"המיזוג נכשל למרות שהבדיקה אמרה שהוא נקי: {(m.Out.Length > 200 ? m.Out[..200] : m.Out)}. לא שיניתי כלום", []);
        }
        var missing = t.BuiltWithout.Where(x => x != d.Id).Select(x => x.ToString()).ToArray();
        await store.ExecAsync(clientId, """
            update task set base_task_id = @bt, base_branch = @bb, base_sha = @bs, built_without = @bw,
              state = case when state in ('done', 'failed_checks') then 'in_progress'::task_state else state end, was_done = false, updated_at = now() where id = @id
            """, new { id = t.Id, bt = d.Id, bb = theirs, bs = tip, bw = Persistence.SqlJson.Jsonb(missing) }, ct);
        await store.ExecAsync(clientId, """
            update task set check_result = null, check_cause = null, check_resolved_by = null, check_resolved_at = null, state = 'pending', updated_at = now()
            where parent_task_id = @id and kind = 'check' and state <> 'dropped'
            """, new { id = t.Id }, ct);
        await store.NoteAsync(clientId, t.WorkitemId, t.Id, new UserActor(actor), $"⇄ העבודה של #{d.Seq} מוזגה לענף של משימה #{t.Seq} — מיזוג נקי, ללא קונפליקט. הבדיקות של המשימה נוקו כי הקוד השתנה ועליהן לרוץ שוב.", ct);
        await brief.RegenerateAsync(clientId, t.WorkitemId, ct);
        return new JsonObject { ["merged"] = true, ["already"] = false };
    }

    private static JsonObject Refusal(string reason, IReadOnlyList<string> files) =>
        new() { ["merged"] = false, ["reason"] = reason, ["conflictFiles"] = new JsonArray(files.Select(f => (JsonNode?)f).ToArray()) };
}
