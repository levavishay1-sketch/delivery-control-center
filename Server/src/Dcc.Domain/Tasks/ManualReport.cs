using System.Text.RegularExpressions;

namespace Dcc.Domain.Tasks;

/// <summary>What a person tells DCC about a task they developed themselves, not with Claude.</summary>
public sealed record ManualReportInput(string? Summary, string? Customisation = null, string? Components = null, string? Reference = null);

public sealed record ManualReportValue(string Summary, IReadOnlyList<string> Customisations, IReadOnlyList<string> Components, string? Reference);

/// <summary>
/// A task somebody developed themselves — recorded as a development run marked manual, so status,
/// steps and checks read it as they read Claude's work. The customisations are text under a heading
/// until DCC is connected to the system they live in. Pure (manual-report.ts).
/// </summary>
public static partial class ManualReport
{
    public const string CustomisationHeading = "CUSTOMISATION:";
    public const string CustomisationTemplate = CustomisationHeading + "\n";

    [GeneratedRegex(@"^\s*(?:[-*•·]|\d+[.)])\s*")] private static partial Regex Bullet();
    [GeneratedRegex(@"^\s*CUSTOMISATION\s*:", RegexOptions.IgnoreCase | RegexOptions.Multiline)] private static partial Regex HeadingLine();
    [GeneratedRegex(@"^\s*CUSTOMISATION\s*:", RegexOptions.IgnoreCase)] private static partial Regex HeadingAtStart();

    private static List<string> Items(string? text) =>
        (text ?? "").Replace("\r\n", "\n").Split('\n').Select(l => Bullet().Replace(l, "", 1).Trim()).Where(l => l.Length > 0).ToList();

    /// <summary>Everything after the CUSTOMISATION: heading, one per line; a box without the heading is read whole.</summary>
    public static List<string> ReadCustomisations(string? text)
    {
        var t = (text ?? "").Replace("\r\n", "\n");
        var m = HeadingLine().Match(t);
        if (!m.Success) return Items(t);
        return Items(HeadingAtStart().Replace(t[m.Index..], "", 1));
    }

    /// <summary>The report accepted, or why not (<c>value</c> null).</summary>
    public static (ManualReportValue? Value, string? Why) Check(ManualReportInput input)
    {
        var summary = (input.Summary ?? "").Trim();
        if (summary.Length < 3) return (null, "כתבו מה נעשה במשימה — שורה אחת מספיקה");
        var reference = (input.Reference ?? "").Trim();
        return (new ManualReportValue(summary, ReadCustomisations(input.Customisation), Items(input.Components), reference.Length > 0 ? reference : null), null);
    }

    /// <summary>The report as one note for the requirement's timeline.</summary>
    public static string Note(int seq, ManualReportValue r) => string.Join("\n", new[]
    {
        $"✍ משימה #{seq} דווחה ידנית — פותחה בלי Claude: {r.Summary}",
        r.Customisations.Count > 0 ? $"{CustomisationHeading} {string.Join(" · ", r.Customisations)}" : null,
        r.Components.Count > 0 ? $"רכיבים: {string.Join(", ", r.Components)}" : null,
        r.Reference is not null ? $"מקור: {r.Reference}" : null,
    }.Where(x => x is not null));
}
