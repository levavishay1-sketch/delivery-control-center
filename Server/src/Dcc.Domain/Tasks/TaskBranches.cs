using System.Text.RegularExpressions;

namespace Dcc.Domain.Tasks;

/// <summary>A dependency of a task, as git sees it (task-base.ts).</summary>
public sealed record DependencyFacts(string Id, int Seq, string Intent, string State, string? Branch, bool Merged);

public sealed record MissingDep(DependencyFacts Dep, string Why);

/// <summary>What a task's branch is built on: a dependency's branch, or the default branch (null), and what is not in it.</summary>
public sealed record BasePlan(DependencyFacts? On, IReadOnlyList<MissingDep> Missing);

public static partial class TaskBranches
{
    /// <summary>
    /// The base is the one candidate (a dependency with code, not merged) that holds all the others;
    /// two candidates not in one line cannot both be a base — then the default branch, both named missing.
    /// <paramref name="contains"/>(a, b): a's branch already holds b's work.
    /// </summary>
    public static BasePlan ChooseBase(IReadOnlyList<DependencyFacts> deps, Func<DependencyFacts, DependencyFacts, bool> contains)
    {
        var candidates = deps.Where(d => !string.IsNullOrEmpty(d.Branch) && !d.Merged).ToList();
        var on = candidates.FirstOrDefault(c => candidates.All(o => ReferenceEquals(o, c) || contains(c, o)));
        var missing = new List<MissingDep>();
        foreach (var d in deps)
        {
            if (d.Merged) continue;
            if (string.IsNullOrEmpty(d.Branch))
            {
                if (d.State != "done") missing.Add(new MissingDep(d, "not_developed"));
                continue;
            }
            if (on is not null && (ReferenceEquals(d, on) || contains(on, d))) continue;
            missing.Add(new MissingDep(d, "parallel"));
        }
        return new BasePlan(on, missing);
    }

    /// <summary>The dependencies as the prompt names them: <c>#3 (short intent)</c>.</summary>
    public static string DepLabel(int seq, string intent) => $"#{seq} ({(intent.Length > 80 ? intent[..80] : intent)})";

    [GeneratedRegex("[^a-z0-9]+")] private static partial Regex NonSlug();

    private static string Slug(string s)
    {
        var v = NonSlug().Replace(s.ToLowerInvariant(), "-").Trim('-');
        return v.Length > 40 ? v[..40] : v;
    }

    /// <summary>The name a NEW branch for the task is given. Never use it to find an existing one — see <see cref="BranchOf"/>.</summary>
    public static string TaskBranchName(string? reqKey, int seq, string intent)
    {
        var slug = Slug(intent);
        return $"task/{reqKey ?? "REQ"}-t{seq}{(slug.Length > 0 ? $"-{slug}" : "")}";
    }

    /// <summary>The task's branch: the one recorded when it was created; only a task with none recorded falls back to the name it would get now.</summary>
    public static string BranchOf(string? reqKey, int seq, string intent, string? branch) =>
        !string.IsNullOrEmpty(branch) ? branch : TaskBranchName(reqKey, seq, intent);

    /// <summary>The branch to record for a task that has none: its runs' branches newest first, then the derived name; the first that exists wins. Null = none.</summary>
    public static string? BranchToRecord(IEnumerable<string?> runBranches, string derived, Func<string, bool> exists)
    {
        var seen = new HashSet<string>();
        foreach (var b in runBranches.Append(derived))
        {
            if (string.IsNullOrEmpty(b) || !seen.Add(b)) continue;
            if (exists(b)) return b;
        }
        return null;
    }

    /// <summary>The files both lists name, sorted (task-overlap.ts).</summary>
    public static List<string> SharedFiles(IEnumerable<string> a, IEnumerable<string> b)
    {
        var inB = b.ToHashSet();
        return a.Where(inB.Contains).Distinct().OrderBy(f => f, StringComparer.Ordinal).ToList();
    }

    public sealed record MergePreview(bool Clean, IReadOnlyList<string>? ConflictFiles = null);

    /// <summary><c>git merge-tree --write-tree --name-only</c>: exit 0 clean; 1 conflicts listed after the tree id up to the first blank line; else null.</summary>
    public static MergePreview? ReadMergeTree(int code, string output)
    {
        if (code == 0) return new MergePreview(true);
        if (code != 1) return null;
        var files = new List<string>();
        foreach (var l in output.Replace("\r\n", "\n").Split('\n').Skip(1))
        {
            if (string.IsNullOrWhiteSpace(l)) break;
            files.Add(l.Trim());
        }
        return new MergePreview(false, files.Distinct().ToList());
    }
}
