using System.Globalization;
using System.Text;
using Dcc.Domain.Spec;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using UglyToad.PdfPig;

namespace Dcc.Infrastructure.Requirements;

/// <summary>
/// Turns an attached file into what DCC reads out of it: the text Claude gets
/// (<see cref="ExtractText"/>) and, for a specification, its blocks
/// (<see cref="SpecFromDocx"/>). A file that cannot be read as text (an image,
/// a zip) is not an error — it is stored and listed, and says plainly why it
/// was not read, so nobody assumes it was.
/// </summary>
public static class DocumentReader
{
    /// <summary>Beyond this the prompt stops being about the requirement.</summary>
    public const int MaxChars = 120_000;

    private static readonly HashSet<string> Plain =
    [
        "txt", "md", "markdown", "csv", "tsv", "json", "xml", "html", "htm",
        "yml", "yaml", "log", "sql", "cs", "ts", "js", "py", "java", "sh",
    ];

    public sealed record Extraction(string? Text, string? Reason);

    private static string Ext(string name) => name.Contains('.') ? name[(name.LastIndexOf('.') + 1)..].ToLowerInvariant() : "";

    private static string Clamp(string s)
    {
        var clean = System.Text.RegularExpressions.Regex.Replace(s.Replace("\r\n", "\n"), @"\n{4,}", "\n\n\n").Trim();
        return clean.Length <= MaxChars
            ? clean
            : $"{clean[..MaxChars]}\n\n[הקובץ ארוך מ-{MaxChars.ToString("N0", CultureInfo.GetCultureInfo("he-IL"))} תווים — נקטע כאן]";
    }

    public static Extraction ExtractText(string name, byte[] bytes)
    {
        var e = Ext(name);
        try
        {
            if (Plain.Contains(e))
            {
                var text = Clamp(new UTF8Encoding(false).GetString(bytes));
                return text.Length > 0 ? new(text, null) : new(null, "הקובץ ריק");
            }
            if (e == "docx")
            {
                using var doc = WordprocessingDocument.Open(new MemoryStream(bytes), false);
                var body = doc.MainDocumentPart?.Document?.Body;
                var sb = new StringBuilder();
                foreach (var p in body?.Descendants<Paragraph>() ?? []) sb.Append(ParagraphText(p)).Append('\n');
                var text = Clamp(sb.ToString());
                return text.Length > 0 ? new(text, null) : new(null, "המסמך ריק מטקסט");
            }
            if (e == "pdf")
            {
                using var pdf = PdfDocument.Open(bytes);
                var text = Clamp(string.Join("\n\n", pdf.GetPages().Select(p => p.Text)));
                return text.Length > 0 ? new(text, null) : new(null, "ה-PDF סרוק כתמונה — אין בו טקסט לקריאה");
            }
            return new(null, $"סוג הקובץ ({(e.Length > 0 ? e : "ללא סיומת")}) אינו נקרא כטקסט");
        }
        catch (Exception ex)
        {
            return new(null, $"קריאת הקובץ נכשלה: {ex.Message}");
        }
    }

    /// <summary>
    /// A .docx as blocks: heading styles and bold one-liners become headings, lists become
    /// paragraphs of "• " / "1. " lines, tables stay tables with the customer's own columns
    /// (a header row, when the document marks one). Null when it holds nothing.
    /// </summary>
    public static SpecDocument? SpecFromDocx(byte[] bytes)
    {
        using var doc = WordprocessingDocument.Open(new MemoryStream(bytes), false);
        var body = doc.MainDocumentPart?.Document?.Body;
        if (body is null) return null;
        var styles = doc.MainDocumentPart!.StyleDefinitionsPart?.Styles;

        var blocks = new List<DocBlock>();
        int h = 0, p = 0, t = 0;
        var listLines = new List<string>();
        var listCounters = new Dictionary<int, int>();

        void FlushList()
        {
            if (listLines.Count == 0) return;
            var id = $"p{++p}";
            blocks.Add(new ParaBlock(id, listLines.Select((text, i) => new DocLine($"{id}.l{i + 1}", text)).ToList()));
            listLines.Clear();
            listCounters.Clear();
        }

        foreach (var el in body.ChildElements)
        {
            if (el is Paragraph para)
            {
                var text = SpecDocs.Clean(ParagraphText(para));
                var level = HeadingStyleLevel(para, styles);
                var numbered = para.ParagraphProperties?.NumberingProperties is { } num;

                if (level is { } lv && text.Length > 0)
                {
                    FlushList();
                    blocks.Add(new HeadingBlock($"h{++h}", lv, text));
                    continue;
                }
                if (numbered && text.Length > 0)
                {
                    var numId = para.ParagraphProperties!.NumberingProperties!.NumberingId?.Val?.Value ?? 0;
                    var ordered = IsOrdered(doc, para);
                    listCounters[numId] = listCounters.GetValueOrDefault(numId) + 1;
                    listLines.Add(ordered ? $"{listCounters[numId]}. {text}" : $"• {text}");
                    continue;
                }
                FlushList();
                if (text.Length == 0) continue;
                var lines = ParagraphLines(para);
                if (SpecDocs.LooksLikeHeading(lines, AllBold(para)))
                {
                    blocks.Add(new HeadingBlock($"h{++h}", SpecDocs.HeadingLevel(lines[0]), lines[0]));
                    continue;
                }
                var pid = $"p{++p}";
                blocks.Add(new ParaBlock(pid, lines.Select((l, i) => new DocLine($"{pid}.l{i + 1}", l)).ToList()));
            }
            else if (el is Table table)
            {
                FlushList();
                var rows = table.Elements<TableRow>().ToList();
                var headRow = rows.FirstOrDefault(r => r.TableRowProperties?.GetFirstChild<TableHeader>() is not null);
                var head = headRow?.Elements<TableCell>().Select(c => string.Join(" ", CellLines(c))).ToList() ?? [];
                var id = $"t{++t}";
                var docRows = rows.Where(r => r != headRow).Select((r, ri) =>
                {
                    var rid = $"{id}.r{ri + 1}";
                    return new DocRow(rid, r.Elements<TableCell>().Select((c, ci) =>
                    {
                        var cid = $"{rid}.c{ci + 1}";
                        return new DocCell(cid, CellLines(c).Select((l, li) => new DocLine($"{cid}.l{li + 1}", l)).ToList());
                    }).ToList());
                }).ToList();
                if (docRows.Count > 0 || head.Count > 0) blocks.Add(new TableBlock(id, head, docRows));
            }
        }
        FlushList();
        return blocks.Count > 0 ? new SpecDocument(blocks) : null;
    }

    private static string ParagraphText(Paragraph p)
    {
        var sb = new StringBuilder();
        foreach (var node in p.Descendants())
        {
            switch (node)
            {
                case Text x: sb.Append(x.Text); break;
                case TabChar: sb.Append(' '); break;
                case Break or CarriageReturn: sb.Append('\n'); break;
            }
        }
        return sb.ToString();
    }

    private static List<string> ParagraphLines(Paragraph p) =>
        ParagraphText(p).Split('\n').Select(SpecDocs.Clean).Where(l => l.Length > 0).ToList();

    private static List<string> CellLines(TableCell c) =>
        c.Elements<Paragraph>().SelectMany(ParagraphLines).ToList();

    private static bool AllBold(Paragraph p)
    {
        var runs = p.Elements<Run>().Where(r => r.InnerText.Trim().Length > 0).ToList();
        return runs.Count > 0 && runs.All(r => r.RunProperties?.Bold is { } b && (b.Val is null || b.Val.Value));
    }

    /// <summary>Heading 1–6 (or Title) by the paragraph's style, following the style's "based on" chain.</summary>
    private static int? HeadingStyleLevel(Paragraph p, Styles? styles)
    {
        var styleId = p.ParagraphProperties?.ParagraphStyleId?.Val?.Value;
        for (var guard = 0; styleId is not null && guard < 10; guard++)
        {
            var style = styles?.Elements<Style>().FirstOrDefault(s => s.StyleId?.Value == styleId);
            var name = (style?.StyleName?.Val?.Value ?? styleId).ToLowerInvariant().Replace(" ", "");
            if (name == "title") return 1;
            if (name.StartsWith("heading") && int.TryParse(name["heading".Length..], out var n) && n is >= 1 and <= 6) return n;
            styleId = style?.BasedOn?.Val?.Value;
        }
        return null;
    }

    private static bool IsOrdered(WordprocessingDocument doc, Paragraph p)
    {
        var props = p.ParagraphProperties!.NumberingProperties!;
        var numId = props.NumberingId?.Val?.Value;
        var ilvl = props.NumberingLevelReference?.Val?.Value ?? 0;
        var numbering = doc.MainDocumentPart?.NumberingDefinitionsPart?.Numbering;
        var instance = numbering?.Elements<NumberingInstance>().FirstOrDefault(n => n.NumberID?.Value == numId);
        var abstractId = instance?.AbstractNumId?.Val?.Value;
        var level = numbering?.Elements<AbstractNum>().FirstOrDefault(a => a.AbstractNumberId?.Value == abstractId)
            ?.Elements<Level>().FirstOrDefault(l => l.LevelIndex?.Value == ilvl);
        var format = level?.NumberingFormat?.Val?.Value;
        return format is not null && format != NumberFormatValues.Bullet && format != NumberFormatValues.None;
    }
}
