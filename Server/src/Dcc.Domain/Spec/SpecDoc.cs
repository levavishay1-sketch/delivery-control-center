using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Dcc.Domain.Spec;

/// <summary>
/// The specification document as it arrived — its own headings, paragraphs and
/// tables — with an id on every piece, so a task can point at a row, a cell or a
/// single line. Nothing here is a model's reading: the same file always gives
/// the same blocks and the same ids. Stored as JSON in the shape the old server
/// wrote (<c>type</c>: heading / para / table). Pure: the unit tests drive it.
/// </summary>
public sealed record DocLine(string Id, string Text);

public sealed record DocCell(string Id, IReadOnlyList<DocLine> Lines);

public sealed record DocRow(string Id, IReadOnlyList<DocCell> Cells);

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(HeadingBlock), "heading")]
[JsonDerivedType(typeof(ParaBlock), "para")]
[JsonDerivedType(typeof(TableBlock), "table")]
public abstract record DocBlock(string Id);

public sealed record HeadingBlock(string Id, int Level, string Text) : DocBlock(Id);

public sealed record ParaBlock(string Id, IReadOnlyList<DocLine> Lines) : DocBlock(Id);

public sealed record TableBlock(string Id, IReadOnlyList<string> Head, IReadOnlyList<DocRow> Rows) : DocBlock(Id);

public sealed record SpecDocument(IReadOnlyList<DocBlock> Blocks);

/// <summary>What an id points at, and the words it holds.</summary>
public sealed record DocElement(string Id, string Kind, string Text);

/// <summary>Where a closed decision overrules the document: <c>From</c> (the document's words, in piece <c>Id</c>) no longer holds; <c>To</c> does.</summary>
public sealed record SpecCorrection(string Id, string Decision, string From, string To);

/// <summary>"Task #seq implements piece id — its own instruction says so, in these words."</summary>
public sealed record SpecLink(int Seq, string Id, string Evidence);

public sealed record SpecRequirement(string Id, string Title);

public sealed record SpecReadCorrection(string Id, string Decision, string? From, string To);

/// <summary>What the model is asked to produce.</summary>
public sealed record SpecRead(IReadOnlyList<SpecRequirement>? Requirements, IReadOnlyList<SpecLink>? Links, IReadOnlyList<SpecReadCorrection>? Corrections);

/// <summary>What is accepted of it; <c>Unsupported</c> links quote words not in the task — dropped, so the piece shows as the gap it may be.</summary>
public sealed record SpecReadAccepted(IReadOnlyList<SpecRequirement> Requirements, IReadOnlyList<SpecLink> Links, IReadOnlyList<SpecCorrection> Corrections, IReadOnlyList<SpecLink> Unsupported);

public static partial class SpecDocs
{
    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();
    [GeneratedRegex(@"^(\d+(?:\.\d+)*)\.?\s")] private static partial Regex HeadingNumber();
    [GeneratedRegex(@"^\d+(\.\d+)+\s")] private static partial Regex DottedNumber();
    [GeneratedRegex(@"\n\s*\n")] private static partial Regex BlankLine();

    public static string Clean(string s) => Spaces().Replace(s, " ").Trim();

    /// <summary>"3.9.2 שדות בישות" is a heading three deep. Without a number it is a top-level one.</summary>
    public static int HeadingLevel(string text)
    {
        var m = HeadingNumber().Match(text);
        return m.Success ? m.Groups[1].Value.Split('.').Length : 1;
    }

    /// <summary>A bold, short, single-line paragraph is how a .docx without heading styles writes a heading.</summary>
    public static bool LooksLikeHeading(IReadOnlyList<string> lines, bool allBold) => lines.Count == 1 && allBold && lines[0].Length <= 120;

    /// <summary>A document that is only text — a PDF, a plain note: a paragraph per blank-line gap, a line per line.</summary>
    public static SpecDocument FromText(string text)
    {
        var blocks = new List<DocBlock>();
        int p = 0, h = 0;
        foreach (var chunk in BlankLine().Split(text.Replace("\r\n", "\n")))
        {
            var lines = chunk.Split('\n').Select(Clean).Where(l => l.Length > 0).ToList();
            if (lines.Count == 0) continue;
            if (lines.Count == 1 && DottedNumber().IsMatch(lines[0]) && lines[0].Length <= 120)
            {
                blocks.Add(new HeadingBlock($"h{++h}", HeadingLevel(lines[0]), lines[0]));
                continue;
            }
            var id = $"p{++p}";
            blocks.Add(new ParaBlock(id, lines.Select((t, i) => new DocLine($"{id}.l{i + 1}", t)).ToList()));
        }
        return new SpecDocument(blocks);
    }

    /// <summary>Every piece that has an id, in reading order, with the words it holds.</summary>
    public static List<DocElement> Elements(SpecDocument doc)
    {
        var o = new List<DocElement>();
        foreach (var b in doc.Blocks)
        {
            switch (b)
            {
                case HeadingBlock h:
                    o.Add(new(h.Id, "heading", h.Text));
                    break;
                case ParaBlock p:
                    o.Add(new(p.Id, "para", string.Join("\n", p.Lines.Select(l => l.Text))));
                    o.AddRange(p.Lines.Select(l => new DocElement(l.Id, "line", l.Text)));
                    break;
                case TableBlock t:
                    o.Add(new(t.Id, "table", string.Join(" | ", t.Head)));
                    foreach (var r in t.Rows)
                    {
                        o.Add(new(r.Id, "row", string.Join(" | ", r.Cells.Select(c => string.Join(" ", c.Lines.Select(l => l.Text))).Where(s => s.Length > 0))));
                        foreach (var c in r.Cells)
                        {
                            o.Add(new(c.Id, "cell", string.Join("\n", c.Lines.Select(l => l.Text))));
                            o.AddRange(c.Lines.Select(l => new DocElement(l.Id, "line", l.Text)));
                        }
                    }
                    break;
            }
        }
        return o;
    }

    /// <summary>The document as the model reads it: every piece with its id in brackets.</summary>
    public static string ForPrompt(SpecDocument doc)
    {
        var o = new List<string>();
        foreach (var b in doc.Blocks)
        {
            switch (b)
            {
                case HeadingBlock h:
                    o.Add($"[{h.Id}] {new string('#', Math.Min(h.Level, 4))} {h.Text}");
                    break;
                case ParaBlock p when p.Lines.Count == 1:
                    o.Add($"[{p.Id}] {p.Lines[0].Text}");
                    break;
                case ParaBlock p:
                    o.Add($"[{p.Id}] paragraph:");
                    o.AddRange(p.Lines.Select(l => $"  [{l.Id}] {l.Text}"));
                    break;
                case TableBlock t:
                    o.Add($"[{t.Id}] table{(t.Head.Count > 0 ? $" — columns: {string.Join(" | ", t.Head)}" : "")}");
                    foreach (var r in t.Rows)
                    {
                        o.Add($"  [{r.Id}] row");
                        for (var i = 0; i < r.Cells.Count; i++)
                        {
                            var c = r.Cells[i];
                            if (c.Lines.Count == 0) continue;
                            var col = i < t.Head.Count && t.Head[i].Length > 0 ? $"({t.Head[i]}) " : "";
                            if (c.Lines.Count == 1) o.Add($"    [{c.Id}] {col}{c.Lines[0].Text}");
                            else
                            {
                                o.Add($"    [{c.Id}] {col}".TrimEnd());
                                o.AddRange(c.Lines.Select(l => $"      [{l.Id}] {l.Text}"));
                            }
                        }
                    }
                    break;
            }
        }
        return string.Join("\n", o);
    }

    /// <summary>Words compared the way a quote is: spacing, the kind of quote mark and of dash, and case do not count.</summary>
    public static string AsQuoted(string s)
    {
        var n = s.Normalize(NormalizationForm.FormC);
        n = Regex.Replace(n, "[\"'`׳״‘’“”]", "\"");
        n = Regex.Replace(n, "[‐-―-]", "-");
        return Spaces().Replace(n, " ").Trim().ToLowerInvariant();
    }

    /// <summary>Shorter than this, a "quote" (כן, 5) is found in almost any instruction and proves nothing.</summary>
    public const int MinEvidence = 6;

    /// <summary>
    /// Accepts what the model returned, or says exactly what is wrong with it. Every id must be
    /// a piece of THIS document or one of this requirement's decisions. A link must quote words
    /// that are really in the task's own instruction; one that does not is dropped, not trusted.
    /// </summary>
    public static (SpecReadAccepted? Value, string? Why) Check(SpecRead raw, SpecDocument doc, IReadOnlyList<(int Seq, string Text)> tasks, IReadOnlyList<string> decisionAnchors)
    {
        var elements = Elements(doc).ToDictionary(e => e.Id);
        var requirements = raw.Requirements ?? [];
        if (requirements.Count == 0) return (null, "לא סומנה אף דרישה באפיון");
        var seen = new HashSet<string>();
        foreach (var r in requirements)
        {
            if (!elements.TryGetValue(r.Id, out var el)) return (null, $"דרישה מצביעה על חלק שלא קיים במסמך: \"{r.Id}\"");
            if (el.Kind is "heading" or "table") return (null, $"{r.Id} הוא {(el.Kind == "heading" ? "כותרת" : "טבלה שלמה")}, לא דרישה");
            if (!seen.Add(r.Id)) return (null, $"אותה דרישה סומנה פעמיים: {r.Id}");
            if (string.IsNullOrWhiteSpace(r.Title)) return (null, $"אין שם לדרישה {r.Id}");
        }
        var instruction = tasks.ToDictionary(t => t.Seq, t => AsQuoted(t.Text));
        var decisions = decisionAnchors.ToHashSet();
        var linkable = seen.Concat(decisionAnchors).ToHashSet();
        var links = new List<SpecLink>();
        var unsupported = new List<SpecLink>();
        foreach (var l in raw.Links ?? [])
        {
            if (!instruction.TryGetValue(l.Seq, out var said)) return (null, $"אין משימה #{l.Seq}");
            if (!linkable.Contains(l.Id)) return (null, $"משימה #{l.Seq} מפנה לחלק שאינו דרישה: {l.Id}");
            var quote = AsQuoted(l.Evidence ?? "").Trim('"').Trim();
            (quote.Length >= MinEvidence && said.Contains(quote, StringComparison.Ordinal) ? links : unsupported).Add(l);
        }
        var corrections = new List<SpecCorrection>();
        foreach (var c in raw.Corrections ?? [])
        {
            if (!elements.TryGetValue(c.Id, out var el)) return (null, $"תיקון מפנה לחלק שלא קיים במסמך: {c.Id}");
            if (!decisions.Contains(c.Decision)) return (null, $"תיקון מפנה להחלטה שאינה של הדרישה: {c.Decision}");
            if (string.IsNullOrWhiteSpace(c.To)) return (null, $"תיקון ב-{c.Id} בלי מה שתקף במקומו");
            var from = (c.From ?? "").Trim();
            corrections.Add(new SpecCorrection(c.Id, c.Decision, from.Length > 0 && el.Text.Contains(from, StringComparison.Ordinal) ? from : "", c.To.Trim()));
        }
        return (new SpecReadAccepted(requirements, links, corrections, unsupported), null);
    }

    /// <summary>Requirements a closed decision struck out entirely — shown struck through, never as a gap.</summary>
    public static HashSet<string> Overruled(SpecDocument doc, IEnumerable<SpecCorrection> corrections)
    {
        var text = Elements(doc).ToDictionary(e => e.Id, e => AsQuoted(e.Text));
        return corrections.Where(c => c.From.Length > 0 && text.TryGetValue(c.Id, out var t) && AsQuoted(c.From) == t).Select(c => c.Id).ToHashSet();
    }

    /// <summary>A decision is part of the spec too, and a task can point at it — this is the id it gets, everywhere.</summary>
    public static string DecisionAnchor(Guid gapId) => $"d.{gapId.ToString()[..8]}";
}
