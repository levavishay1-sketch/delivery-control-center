namespace Dcc.Domain.Tasks;

/// <summary>
/// What a task is and what it really depends on — decided by structure alone, never
/// by its TFS type. Pure. Two kinds of task: one with no sub-tasks is DEVELOPED; one
/// with sub-tasks is a GROUP, never developed itself — its work is its sub-tasks.
/// A dependency is declared between any two rows, but what a task waits for is always
/// developed work: on a group — each of its sub-tasks; on a check — the task that check
/// belongs to. A sub-task also waits for whatever its group waits for.
/// </summary>
public sealed record RelRow(string Id, int Seq, string Kind, string? ParentTaskId, bool Active, string State);

public sealed record RelDep(string TaskId, string DependsOnTaskId);

/// <summary>How an effective dependency came to be: through a group, a check, or inherited from the task's group.</summary>
public sealed record DepVia(string Through, int Seq);

public sealed record EffectiveDep(string Id, DepVia? Via = null);

public sealed class TaskRelations(IReadOnlyList<RelRow> rows, IReadOnlyList<RelDep> deps)
{
    private readonly Dictionary<string, RelRow> _byId = rows.ToDictionary(r => r.Id);

    private static bool InPlay(RelRow? r) => r is not null && r.Active && r.State != "dropped";

    public List<RelRow> SubtasksOf(string id) => rows.Where(r => r.ParentTaskId == id && r.Kind == "task" && InPlay(r)).ToList();

    public bool IsGroup(string id) => _byId.TryGetValue(id, out var r) && r.Kind == "task" && SubtasksOf(id).Count > 0;

    private IEnumerable<string> Declared(string id) => deps.Where(d => d.TaskId == id).Select(d => d.DependsOnTaskId);

    /// <summary>The developed tasks behind one dependency target.</summary>
    private List<EffectiveDep> Expand(string targetId, DepVia? via = null)
    {
        if (!_byId.TryGetValue(targetId, out var t) || !InPlay(t)) return [];
        if (t.Kind == "check") return t.ParentTaskId is { } p ? Expand(p, via ?? new DepVia("check", t.Seq)) : [];
        var subs = SubtasksOf(t.Id);
        if (subs.Count > 0) return subs.SelectMany(s => Expand(s.Id, via ?? new DepVia("group", t.Seq))).ToList();
        return [new EffectiveDep(t.Id, via)];
    }

    /// <summary>Every developed task this one waits for, once each; never itself, its own group or its own sub-tasks.</summary>
    public List<EffectiveDep> EffectiveDeps(string id)
    {
        if (!_byId.TryGetValue(id, out var t)) return [];
        var parent = t.ParentTaskId is { } pid ? _byId.GetValueOrDefault(pid) : null;
        var own = Declared(id).Where(d => d != t.ParentTaskId).SelectMany(d => Expand(d));
        var inherited = t.Kind == "task" && parent is not null && InPlay(parent)
            ? Declared(parent.Id).SelectMany(d => Expand(d, new DepVia("parent", parent.Seq)))
            : [];
        var skip = new HashSet<string> { id };
        if (t.ParentTaskId is { } p2) skip.Add(p2);
        foreach (var s in SubtasksOf(id)) skip.Add(s.Id);
        var output = new List<EffectiveDep>();
        var seen = new HashSet<string>();
        foreach (var d in own.Concat(inherited))
            if (!skip.Contains(d.Id) && seen.Add(d.Id)) output.Add(d);
        return output;
    }

    /// <summary>The rows that wait for this one — the reverse of <see cref="EffectiveDeps"/>.</summary>
    public List<string> WaitingOn(string id)
    {
        var work = Expand(id).Select(d => d.Id).ToHashSet();
        return rows.Where(r => InPlay(r) && r.Id != id && r.ParentTaskId != id && EffectiveDeps(r.Id).Any(d => work.Contains(d.Id))).Select(r => r.Id).ToList();
    }
}

/// <summary>
/// The TFS type of a task comes from the ROLE it plays in the tree: a leaf is a Task, a node over
/// Tasks a User Story, over Stories a Feature, over Features an Epic — counted from the bottom.
/// The requirement takes the rung above its top-level nodes when there are two or more and they are
/// stories or higher. Pure.
/// </summary>
public static class TaskTypes
{
    public static readonly string[] Rungs = ["Task", "User Story", "Feature", "Epic"];

    public sealed record Node(string Id, string? ParentId);

    private static Dictionary<string, int> Heights(IReadOnlyList<Node> nodes)
    {
        var ids = nodes.Select(n => n.Id).ToHashSet();
        var kids = new Dictionary<string, List<string>>();
        foreach (var n in nodes)
            if (n.ParentId is { } p && ids.Contains(p) && p != n.Id)
            {
                if (!kids.TryGetValue(p, out var list)) kids[p] = list = [];
                list.Add(n.Id);
            }
        var h = new Dictionary<string, int>();
        int Of(string id, HashSet<string> seen)
        {
            if (h.TryGetValue(id, out var known)) return known;
            if (!seen.Add(id)) return 0; // a ring in the parents — a leaf rather than recurse forever
            var c = kids.GetValueOrDefault(id) ?? [];
            var v = c.Count > 0 ? 1 + c.Max(k => Of(k, seen)) : 0;
            seen.Remove(id);
            h[id] = v;
            return v;
        }
        foreach (var n in nodes) Of(n.Id, []);
        return h;
    }

    /// <summary>The type of every node, by what it holds. Pass only real work — never a check.</summary>
    public static Dictionary<string, string> Structural(IReadOnlyList<Node> nodes)
    {
        var h = Heights(nodes);
        return nodes.ToDictionary(n => n.Id, n => Rungs[Math.Min(h.GetValueOrDefault(n.Id), Rungs.Length - 1)]);
    }

    public sealed record RequirementRung(string Type, int Over, string Of);

    /// <summary>The type the requirement takes above its top-level nodes, or null when it takes none.</summary>
    public static RequirementRung? RequirementRungFor(IReadOnlyList<Node> nodes)
    {
        var ids = nodes.Select(n => n.Id).ToHashSet();
        var top = nodes.Where(n => n.ParentId is null || !ids.Contains(n.ParentId) || n.ParentId == n.Id).ToList();
        if (top.Count < 2) return null;
        var h = Heights(nodes);
        var topHeight = top.Max(n => h.GetValueOrDefault(n.Id));
        if (topHeight < 1 || topHeight >= Rungs.Length - 1) return null;
        return new RequirementRung(Rungs[topHeight + 1], top.Count, Rungs[topHeight]);
    }
}
