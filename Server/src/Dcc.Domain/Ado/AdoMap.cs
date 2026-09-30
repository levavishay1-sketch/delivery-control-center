using System.Text;
using System.Text.RegularExpressions;

namespace Dcc.Domain.Ado;

/// <summary>Azure DevOps / TFS ↔ DCC field mapping, shared by the import and the sync (ado-map.ts). Pure.</summary>
public static partial class AdoMap
{
    public static readonly IReadOnlyDictionary<string, string> AdoTypeToDcc = new Dictionary<string, string>
    {
        ["epic"] = "epic", ["feature"] = "feature", ["user story"] = "story", ["product backlog item"] = "story", ["requirement"] = "story",
        ["change request"] = "story", ["bug"] = "bug", ["issue"] = "task", ["task"] = "task", ["test case"] = "task", ["test plan"] = "task", ["test suite"] = "task",
    };

    /// <summary>DCC type → the work-item type to create (Agile process).</summary>
    public static readonly IReadOnlyDictionary<string, string> DccTypeToAdo = new Dictionary<string, string>
    {
        ["epic"] = "Epic", ["feature"] = "Feature", ["story"] = "User Story", ["bug"] = "Bug", ["task"] = "Task", ["spike"] = "Task",
    };

    public static readonly IReadOnlyDictionary<string, string> AdoStateToPhase = new Dictionary<string, string>
    {
        ["new"] = "intake", ["proposed"] = "intake", ["to do"] = "intake", ["approved"] = "shaping", ["design"] = "shaping", ["committed"] = "shaping",
        ["active"] = "building", ["in progress"] = "building", ["in development"] = "building", ["doing"] = "building",
        ["resolved"] = "review", ["qa test"] = "review", ["prod ready"] = "review", ["ready for prod"] = "review",
        ["released"] = "done", ["closed"] = "done", ["done"] = "done", ["completed"] = "done", ["removed"] = "archived",
    };

    /// <summary>DCC phase → an ADO state to try (Agile). Best-effort; a transition can be rejected.</summary>
    public static readonly IReadOnlyDictionary<string, string> PhaseToAdoState = new Dictionary<string, string>
    {
        ["intake"] = "New", ["shaping"] = "New", ["building"] = "Active", ["review"] = "Resolved", ["done"] = "Closed", ["archived"] = "Removed",
    };

    /// <summary>DCC task state → an ADO state to try. A plain Task has no "Resolved"; a rejected transition is ignored by the caller.</summary>
    public static readonly IReadOnlyDictionary<string, string> TaskStateToAdoState = new Dictionary<string, string>
    {
        ["pending"] = "New", ["in_progress"] = "Active", ["failed_checks"] = "Active", ["blocked"] = "Active", ["done"] = "Closed", ["dropped"] = "Removed",
    };

    /// <summary>The Agile process has four rungs — how deep a task tree may go.</summary>
    public const int MaxTaskDepth = 4;

    public static string MapType(string raw) => AdoTypeToDcc.GetValueOrDefault(raw.Trim().ToLowerInvariant(), "task");
    public static string MapState(string raw) => AdoStateToPhase.GetValueOrDefault(raw.Trim().ToLowerInvariant(), "intake");

    [GeneratedRegex(@"<br\s*/?>", RegexOptions.IgnoreCase)] private static partial Regex Br();
    [GeneratedRegex(@"</(div|p|li|h[1-6])>", RegexOptions.IgnoreCase)] private static partial Regex BlockEnd();
    [GeneratedRegex("<[^>]+>")] private static partial Regex Tag();
    [GeneratedRegex(@"\n{3,}")] private static partial Regex BlankRuns();
    [GeneratedRegex("&#39;|&apos;")] private static partial Regex Apos();

    public static string HtmlToText(string s)
    {
        var t = Br().Replace(s, "\n");
        t = BlockEnd().Replace(t, "\n");
        t = Tag().Replace(t, "");
        t = t.Replace("&nbsp;", " ").Replace("&quot;", "\"");
        t = Apos().Replace(t, "'");
        t = t.Replace("&amp;", "&").Replace("&lt;", "<").Replace("&gt;", ">");
        return BlankRuns().Replace(t, "\n\n").Trim();
    }

    /// <summary>RFC-4180 CSV: quotes, "" escapes, embedded newlines and commas. Rows with nothing in them are dropped.</summary>
    public static List<List<string>> ParseCsv(string text)
    {
        var rows = new List<List<string>>();
        var field = new StringBuilder();
        var row = new List<string>();
        var inQuotes = false;
        var src = text.Replace("\r\n", "\n").Replace('\r', '\n');
        for (var i = 0; i < src.Length; i++)
        {
            var c = src[i];
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < src.Length && src[i + 1] == '"') { field.Append('"'); i++; }
                    else inQuotes = false;
                }
                else field.Append(c);
            }
            else if (c == '"') inQuotes = true;
            else if (c == ',') { row.Add(field.ToString()); field.Clear(); }
            else if (c == '\n') { row.Add(field.ToString()); field.Clear(); rows.Add(row); row = []; }
            else field.Append(c);
        }
        if (field.Length > 0 || row.Count > 0) { row.Add(field.ToString()); rows.Add(row); }
        return rows.Where(r => r.Any(v => v.Trim().Length > 0)).ToList();
    }
}
