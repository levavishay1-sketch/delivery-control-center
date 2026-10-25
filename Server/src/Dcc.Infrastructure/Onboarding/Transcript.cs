using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using static Dcc.Infrastructure.Onboarding.ComponentVerifier;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// One thing a person contributed to the draft session. <c>Kind</c>: prompt (<c>Text</c>), command (<c>Command</c>) or
/// answer (<c>Question</c>, <c>Answer</c>) — an answer to one of <c>/init</c>'s questions. <c>At</c> is the transcript's
/// timestamp.
/// </summary>
public sealed record TranscriptFact(string Kind, string? Text = null, string? Command = null, string? Question = null, string? Answer = null, string? At = null)
{
    public static TranscriptFact Prompt(string text, string? at) => new("prompt", Text: text, At: at);

    public static TranscriptFact CommandRun(string command, string? at) => new("command", Command: command, At: at);

    public static TranscriptFact AnswerGiven(string question, string answer, string? at) => new("answer", Question: question, Answer: answer, At: at);

    /// <summary>The event's payload, as the old server spread it (<c>const { kind, ...payload } = fact</c>): the kind's own fields, then <c>at</c>.</summary>
    public JsonObject Payload() => Kind switch
    {
        "prompt" => new JsonObject { ["text"] = Text, ["at"] = At },
        "command" => new JsonObject { ["command"] = Command, ["at"] = At },
        _ => new JsonObject { ["question"] = Question, ["answer"] = Answer, ["at"] = At },
    };
}

/// <summary>A pass over the transcript: the facts from line <c>Cursor</c> on, where the next pass starts, and how many model calls the new lines show.</summary>
public sealed record TranscriptScan(IReadOnlyList<TranscriptFact> Facts, int Cursor, int ApiCalls, string? LastMessageId);

/// <summary>The session's spend and settings as the status line last saw them (the run's <c>session.status</c>).</summary>
public sealed record SessionStatus(
    [property: JsonPropertyName("costUsd")] double CostUsd,
    [property: JsonPropertyName("apiDurationMs")] double ApiDurationMs,
    [property: JsonPropertyName("durationMs")] double DurationMs,
    [property: JsonPropertyName("inputTokens")] double InputTokens,
    [property: JsonPropertyName("outputTokens")] double OutputTokens,
    [property: JsonPropertyName("model")] string? Model,
    [property: JsonPropertyName("modelId")] string? ModelId,
    [property: JsonPropertyName("effort")] string? Effort,
    [property: JsonPropertyName("linesAdded")] double LinesAdded,
    [property: JsonPropertyName("linesRemoved")] double LinesRemoved,
    [property: JsonPropertyName("updatedAt")] string UpdatedAt);

/// <summary>The status-line snapshot, normalised, with the session id and the transcript path it names.</summary>
public sealed record StatusSnapshot(SessionStatus Status, string? SessionId, string? TranscriptPath);

/// <summary>The digest for the assistant: <c>Entries</c> is how many lines of it are new; <c>Cursor</c> is where the next digest starts.</summary>
public sealed record TranscriptDigest(string Text, int Cursor, int Entries);

/// <summary>
/// Reading the session back (repo-onboarding/transcript.ts). Claude Code writes every message of the conversation to
/// a JSONL transcript; DCC turns the parts a person contributed — what they typed, the commands they ran, and their
/// answers to <c>/init</c>'s questions — into events, so nothing that shaped the result is silent. A line cursor
/// makes the scan idempotent. The same file tells the assistant what happened, whether the session is waiting for
/// input, and which files the session wrote; the status-line snapshot (<c>statusline.mjs</c> keeps the latest copy
/// of the JSON Claude Code hands it) tells what the session cost.
///
/// The last line may still be being written, so every reader leaves it for the next pass. Each line is read the way
/// JSON.parse read it: a key written twice counts once (the last), a line that does not parse is skipped, and a
/// field of the wrong type reads as missing. The regular expressions use JavaScript's <c>\s</c>.
/// </summary>
public static partial class Transcript
{
    /// <summary>JavaScript's <c>\s</c>, not .NET's (the BOM in, U+0085 out).</summary>
    private const string JsSpace = @"[\t\n\v\f\r    -     　﻿]";

    [GeneratedRegex(JsSpace + "+")] private static partial Regex Spaces();
    [GeneratedRegex(@"^<local-command-(stdout|stderr|caveat)>")] private static partial Regex LocalCommandOutput();
    [GeneratedRegex("<command-name>([^<]+)</command-name>")] private static partial Regex CommandName();
    [GeneratedRegex(@"<command-args>([\s\S]*?)</command-args>")] private static partial Regex CommandArgs();
    [GeneratedRegex("\"([^\"]+)\"=\"([^\"]*)\"")] private static partial Regex QuotedAnswer();

    private static readonly HashSet<string> WriteTools = new(StringComparer.Ordinal) { "Write", "Edit", "MultiEdit", "NotebookEdit" };

    /// <summary>A transcript can nest deeper than System.Text.Json's default of 64; JSON.parse has no such limit.</summary>
    private static readonly JsonDocumentOptions LineOptions = new() { MaxDepth = 4096 };

    private static string Clip(string s, int n = 300) => s.Length > n ? $"{s[..(n - 1)]}…" : s;

    // ── the decision log ───────────────────────────────────────────────

    /// <summary>
    /// The person's contributions from line <paramref name="cursor"/> on, and the number of model calls the new lines
    /// show (one per distinct assistant message id — a message is written as several lines). A missing file changes
    /// nothing.
    /// </summary>
    public static TranscriptScan Scan(string file, int cursor, string? lastMessageId)
    {
        if (!Exists(file)) return new TranscriptScan([], cursor, 0, lastMessageId);
        var lines = ReadText(file).Split('\n');
        // The last line may still be being written; leave it for the next pass.
        var complete = lines.Length - 1;
        var facts = new List<TranscriptFact>();
        var apiCalls = 0;
        var last = lastMessageId;
        for (var i = Math.Max(cursor, 0); i < complete; i++)
        {
            if (Parse(lines[i]) is not { } e) continue;
            var at = StringOf(Prop(e, "timestamp"));
            if (Is(Prop(e, "type"), "assistant"))
            {
                var id = StringOf(Prop(Prop(e, "message"), "id"));
                if (!string.IsNullOrEmpty(id) && id != last)
                {
                    apiCalls++;
                    last = id;
                }
                continue;
            }
            if (!Is(Prop(e, "type"), "user") || Truthy(Prop(e, "isMeta"))) continue;
            var answers = AnswersOf(e);
            if (answers.Count > 0)
            {
                foreach (var (q, a) in answers) facts.Add(TranscriptFact.AnswerGiven(Clip(q, 200), Clip(a, 200), at));
                continue;
            }
            var text = JsTrim(TextOf(Prop(Prop(e, "message"), "content")));
            if (text.Length == 0 || LocalCommandOutput().IsMatch(text)) continue;
            var cmd = CommandName().Match(text);
            if (cmd.Success)
            {
                var args = ArgsOf(text);
                facts.Add(TranscriptFact.CommandRun(Clip($"{JsTrim(cmd.Groups[1].Value)}{(string.IsNullOrEmpty(args) ? "" : $" {args}")}", 200), at));
                continue;
            }
            if (text.StartsWith('<')) continue;
            facts.Add(TranscriptFact.Prompt(Clip(text), at));
        }
        return new TranscriptScan(facts, complete, apiCalls, last);
    }

    /// <summary>
    /// The status-line JSON Claude Code handed to <c>statusline.mjs</c>, normalised: a figure that is not a finite
    /// number is 0, a name that is not a string is null. null when there is no snapshot yet, it does not parse or it is
    /// a bare JSON null.
    /// </summary>
    public static StatusSnapshot? ReadStatusSnapshot(string file)
    {
        if (!Exists(file)) return null;
        JsonElement s;
        try
        {
            using var doc = JsonDocument.Parse(ReadText(file), LineOptions);
            s = doc.RootElement.Clone();
        }
        catch (Exception e) when (e is JsonException or ArgumentException or IOException or UnauthorizedAccessException) { return null; }
        // A bare `null` made the old reader throw (the poll tried again on its next tick); here it is no snapshot yet.
        if (s.ValueKind == JsonValueKind.Null) return null;
        double N(JsonElement? v) => v is { ValueKind: JsonValueKind.Number } x && x.TryGetDouble(out var d) && double.IsFinite(d) ? d : 0;
        var cost = Prop(s, "cost");
        var context = Prop(s, "context_window");
        return new StatusSnapshot(
            new SessionStatus(
                CostUsd: N(Prop(cost, "total_cost_usd")),
                ApiDurationMs: N(Prop(cost, "total_api_duration_ms")),
                DurationMs: N(Prop(cost, "total_duration_ms")),
                InputTokens: N(Prop(context, "total_input_tokens")),
                OutputTokens: N(Prop(context, "total_output_tokens")),
                Model: StringOf(Prop(Prop(s, "model"), "display_name")),
                ModelId: StringOf(Prop(Prop(s, "model"), "id")),
                Effort: StringOf(Prop(Prop(s, "effort"), "level")),
                LinesAdded: N(Prop(cost, "total_lines_added")),
                LinesRemoved: N(Prop(cost, "total_lines_removed")),
                UpdatedAt: IsoNow()),
            StringOf(Prop(s, "session_id")),
            StringOf(Prop(s, "transcript_path")));
    }

    // ── for the assistant ──────────────────────────────────────────────

    /// <summary>Every line that is complete; one that does not parse is an empty entry, so the indexes stay the line numbers.</summary>
    private static (List<JsonElement?> Entries, int LineCount) ReadEntries(string file)
    {
        if (!Exists(file)) return ([], 0);
        // The last line may still be being written; it is left for the next pass, like Scan.
        var lines = ReadText(file).Split('\n');
        var entries = new List<JsonElement?>(lines.Length - 1);
        for (var i = 0; i < lines.Length - 1; i++) entries.Add(Parse(lines[i]));
        return (entries, lines.Length - 1);
    }

    /// <summary>What a tool call was, in a few words.</summary>
    private static string ToolSummary(JsonElement b)
    {
        var i = Prop(b, "input");
        string One(JsonElement? v, int n = 140) => Clip(JsTrim(Spaces().Replace(Nullish(v) ? "" : JsString(v!.Value), " ")), n);
        var name = Prop(b, "name");
        switch (StringOf(name))
        {
            case "Bash" or "PowerShell": return $"{StringOf(name)}: {One(Prop(i, "command"))}";
            case "Write" or "Edit" or "Read" or "NotebookEdit": return $"{StringOf(name)}: {One(Coalesce(Prop(i, "file_path"), Prop(i, "notebook_path")))}";
            case "Grep" or "Glob": return $"{StringOf(name)}: {One(Prop(i, "pattern"))}";
            case "Task" or "Agent": return $"{StringOf(name)}: {One(Prop(i, "description"))}";
            case "AskUserQuestion":
                // (questions)?.map((q) => q.question).join(" / ") — a missing list prints nothing.
                var questions = Prop(i, "questions");
                var joined = questions is { ValueKind: JsonValueKind.Array } qs
                    ? string.Join(" / ", qs.EnumerateArray().Select(q => Prop(q, "question") is { } x && !Nullish(x) ? JsString(x) : ""))
                    : "";
                return $"AskUserQuestion: {Clip(JsTrim(Spaces().Replace(joined, " ")), 220)}";
            default: return Nullish(name) ? "tool" : JsString(name!.Value);
        }
    }

    /// <summary>
    /// A compact reading of the transcript from line <paramref name="cursor"/> on, for the assistant: what the person
    /// said, what Claude said, which tools it ran (one line each, no output), what failed, and — last — a tool call that
    /// is still waiting. Only what is new is returned, so a follow-up question does not pay for what the assistant
    /// already read; when the digest is longer than <paramref name="maxChars"/> the oldest part is left out and says so.
    /// </summary>
    public static TranscriptDigest Digest(string file, int cursor, int maxChars)
    {
        var (entries, lineCount) = ReadEntries(file);
        var output = new List<string>();
        var count = 0;
        for (var i = Math.Max(cursor, 0); i < entries.Count; i++)
        {
            var e = entries[i];
            if (Truthy(Prop(e, "isSidechain")) || Truthy(Prop(e, "isMeta"))) continue;
            var content = Prop(Prop(e, "message"), "content");
            if (Is(Prop(e, "type"), "user"))
            {
                var answers = AnswersOf(e!.Value);
                if (answers.Count > 0)
                {
                    foreach (var (q, a) in answers) output.Add($"התשובה שלך: {Clip(q, 160)} → {Clip(a, 160)}");
                    count++;
                    continue;
                }
                if (content is { ValueKind: JsonValueKind.Array } blocks)
                {
                    foreach (var b in blocks.EnumerateArray())
                    {
                        if (!Is(Prop(b, "type"), "tool_result") || !Truthy(Prop(b, "is_error"))) continue;
                        var body = Prop(b, "content");
                        var said = body is { ValueKind: JsonValueKind.String } str ? Text(str) : TextOf(body);
                        output.Add($"✗ שגיאה בכלי: {Clip(Spaces().Replace(said, " "), 160)}");
                    }
                }
                var text = JsTrim(TextOf(content));
                if (text.Length == 0 || LocalCommandOutput().IsMatch(text)) continue;
                var cmd = CommandName().Match(text);
                if (cmd.Success)
                {
                    var args = ArgsOf(text);
                    output.Add($"אתה הרצת: {JsTrim(cmd.Groups[1].Value)}{(string.IsNullOrEmpty(args) ? "" : $" {Clip(args, 200)}")}");
                    count++;
                    continue;
                }
                if (text.StartsWith('<')) continue;
                output.Add($"אתה: {Clip(text, 700)}");
                count++;
            }
            else if (Is(Prop(e, "type"), "assistant") && content is { ValueKind: JsonValueKind.Array } blocks)
            {
                foreach (var b in blocks.EnumerateArray())
                {
                    if (Is(Prop(b, "type"), "text") && StringOf(Prop(b, "text")) is { } said && JsTrim(said).Length > 0)
                    {
                        output.Add($"Claude: {Clip(JsTrim(said), 1400)}");
                        count++;
                    }
                    else if (Is(Prop(b, "type"), "tool_use"))
                    {
                        output.Add($"→ {ToolSummary(b)}");
                        count++;
                    }
                }
            }
        }
        // A tool call after the last "user" entry has no result yet: Claude is running it or waiting for an approval.
        var lastUser = -1;
        for (var i = 0; i < entries.Count; i++) if (Is(Prop(entries[i], "type"), "user") && !Truthy(Prop(entries[i], "isSidechain"))) lastUser = i;
        var pending = new List<string>();
        for (var i = lastUser + 1; i < entries.Count; i++)
        {
            var e = entries[i];
            if (!Is(Prop(e, "type"), "assistant") || Truthy(Prop(e, "isSidechain")) || Prop(Prop(e, "message"), "content") is not { ValueKind: JsonValueKind.Array } blocks) continue;
            foreach (var b in blocks.EnumerateArray()) if (Is(Prop(b, "type"), "tool_use")) pending.Add(ToolSummary(b));
        }
        if (pending.Count > 0) output.Add($"⏳ עדיין ממתין (אישור שלך או פעולה שרצה): {string.Join(" ; ", pending.TakeLast(3))}");

        var digest = string.Join("\n", output);
        if (digest.Length > maxChars)
        {
            int kept = 0, n = 0;
            for (var i = output.Count - 1; i >= 0 && kept + output[i].Length + 1 <= maxChars; i--)
            {
                kept += output[i].Length + 1;
                n++;
            }
            digest = $"[… {(output.Count - n).ToString(CultureInfo.InvariantCulture)} שורות ישנות יותר הושמטו]\n{string.Join("\n", output.Skip(output.Count - n))}";
        }
        return new TranscriptDigest(digest, lineCount, count);
    }

    /// <summary>The user and assistant entries that are the conversation itself — not a meta line, not a subagent's.</summary>
    private static JsonElement? LastReal(List<JsonElement?> entries) =>
        entries.LastOrDefault(e => (Is(Prop(e, "type"), "user") || Is(Prop(e, "type"), "assistant")) && !Truthy(Prop(e, "isMeta")) && !Truthy(Prop(e, "isSidechain")));

    private static bool EndedTurn(JsonElement? e) => Is(Prop(e, "type"), "assistant") && Is(Prop(Prop(e, "message"), "stop_reason"), "end_turn");

    /// <summary>Whether the session looks ready for typed input: its last real entry is a finished answer. <c>Why</c>, when not, in a sentence for the person.</summary>
    public static (bool Idle, string Why) SessionIdle(string file)
    {
        var last = LastReal(ReadEntries(file).Entries);
        if (last is null) return (false, "הסשן עוד לא התחיל לעבוד");
        if (EndedTurn(last)) return (true, "");
        if (Is(Prop(last, "type"), "assistant")) return (false, "Claude ממתין לאישור שלך או מריץ פעולה");
        return (false, "Claude עובד עכשיו");
    }

    /// <summary>
    /// Whether Claude's last real entry is a finished answer, and how long the transcript is. <c>/init</c> has no end
    /// marker of its own, so "it is over" is decided by the caller from this plus the worktree: Claude ended a turn (no
    /// tool running, no question waiting) AND the copy has changed. Checked against three real runs: the turns that
    /// ended before any file was written were a background survey and a plain-text question; the first one after the
    /// writes was the summary.
    /// </summary>
    public static (bool Ended, int LineCount) TurnEnded(string file)
    {
        var (entries, lineCount) = ReadEntries(file);
        return (EndedTurn(LastReal(entries)), lineCount);
    }

    /// <summary>
    /// Every file the session wrote or edited inside <paramref name="dir"/>, relative to it with forward slashes,
    /// sorted by UTF-16 code unit — what the scan of the draft reads and the build sets aside. A path is resolved the
    /// way Node's path.resolve does (a rooted path without a drive takes the copy's drive), and compared case-blind on
    /// Windows as path.relative is.
    /// </summary>
    public static List<string> WrittenPaths(string file, string dir)
    {
        var root = Path.GetFullPath(dir);
        var output = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in ReadEntries(file).Entries)
        {
            if (!Is(Prop(e, "type"), "assistant") || Prop(Prop(e, "message"), "content") is not { ValueKind: JsonValueKind.Array } blocks) continue;
            foreach (var b in blocks.EnumerateArray())
            {
                if (!Is(Prop(b, "type"), "tool_use")) continue;
                var name = Prop(b, "name");
                if (!WriteTools.Contains(name is null ? "undefined" : JsString(name.Value))) continue;
                var input = Prop(b, "input");
                var p = JsTrim(Coalesce(Prop(input, "file_path"), Prop(input, "notebook_path")) is { } v && !Nullish(v) ? JsString(v) : "");
                if (p.Length == 0) continue;
                string rel;
                try { rel = Path.GetRelativePath(root, Path.GetFullPath(p, root)).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar); }
                catch (Exception x) when (x is ArgumentException or NotSupportedException or PathTooLongException) { continue; }
                if (rel.Length > 0 && rel != "." && !rel.StartsWith("..", StringComparison.Ordinal) && !Path.IsPathRooted(rel))
                    output.Add(rel.Replace(Path.DirectorySeparatorChar, '/'));
            }
        }
        return output.Order(StringComparer.Ordinal).ToList();
    }

    /// <summary>The number of complete lines in the transcript now (where a later <see cref="PromptSeenAfter"/> starts looking).</summary>
    public static int LineCount(string file) => Exists(file) ? ReadText(file).AsSpan().Count('\n') : 0;

    /// <summary>
    /// Whether the person spoke, after line <paramref name="from"/>, a message that holds the first 40 characters of
    /// <paramref name="needle"/>, white space folded — how DCC checks that a text it typed into the session was really
    /// received.
    /// </summary>
    public static bool PromptSeenAfter(string file, int from, string needle)
    {
        string Norm(string s) => JsTrim(Spaces().Replace(s, " "));
        var normNeedle = Norm(needle);
        var want = normNeedle.Length > 40 ? normNeedle[..40] : normNeedle;
        var entries = ReadEntries(file).Entries;
        for (var i = Math.Max(from, 0); i < entries.Count; i++)
        {
            var e = entries[i];
            if (Is(Prop(e, "type"), "user") && !Truthy(Prop(e, "isMeta")) && !Truthy(Prop(e, "isSidechain"))
                && Norm(TextOf(Prop(Prop(e, "message"), "content"))).Contains(want, StringComparison.Ordinal)) return true;
        }
        return false;
    }

    // ── shared readings ────────────────────────────────────────────────

    private static string? ArgsOf(string text)
    {
        var m = CommandArgs().Match(text);
        return m.Success ? JsTrim(m.Groups[1].Value) : null;
    }

    /// <summary>A message's text: the string itself, or its text blocks joined by newlines.</summary>
    private static string TextOf(JsonElement? content)
    {
        if (content is { ValueKind: JsonValueKind.String } s) return Text(s);
        if (content is not { ValueKind: JsonValueKind.Array } blocks) return "";
        return string.Join("\n", blocks.EnumerateArray()
            .Where(b => Is(Prop(b, "type"), "text"))
            .Select(b => Prop(b, "text") is { } t && !Nullish(t) ? JsString(t) : ""));
    }

    /// <summary>
    /// Answers to an <c>AskUserQuestion</c>: the structured result when present (even an empty one), otherwise the
    /// <c>"question"="answer"</c> pairs of the tool-result text.
    /// </summary>
    private static List<(string Question, string Answer)> AnswersOf(JsonElement e)
    {
        var answers = Prop(Prop(e, "toolUseResult"), "answers");
        if (answers is { ValueKind: JsonValueKind.Object or JsonValueKind.Array } r)
            return Entries(r).Select(kv => (kv.Key, kv.Value.ValueKind == JsonValueKind.Array
                ? string.Join(", ", kv.Value.EnumerateArray().Select(x => Nullish(x) ? "" : JsString(x)))
                : JsString(kv.Value))).ToList();
        var output = new List<(string, string)>();
        if (Prop(Prop(e, "message"), "content") is not { ValueKind: JsonValueKind.Array } blocks) return output;
        foreach (var b in blocks.EnumerateArray())
        {
            if (!Is(Prop(b, "type"), "tool_result")) continue;
            var body = Prop(b, "content");
            var t = body is { ValueKind: JsonValueKind.String } s ? Text(s) : TextOf(body);
            // /answered your question/i — ASCII letters only, as JavaScript's case folding has it.
            if (!AsciiLower(t).Contains("answered your question", StringComparison.Ordinal)) continue;
            foreach (Match m in QuotedAnswer().Matches(t)) output.Add((m.Groups[1].Value, m.Groups[2].Value));
        }
        return output;
    }

    /// <summary>
    /// Object.entries: an array's items by index; an object's keys with the array-index ones first in numeric order,
    /// then the rest as written — a key written twice keeps its first place and its last value, as JSON.parse does.
    /// </summary>
    private static List<KeyValuePair<string, JsonElement>> Entries(JsonElement v)
    {
        if (v.ValueKind == JsonValueKind.Array) return v.EnumerateArray().Select((x, i) => KeyValuePair.Create(i.ToString(CultureInfo.InvariantCulture), x)).ToList();
        var order = new List<string>();
        var values = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var p in v.EnumerateObject())
        {
            var name = NameOf(p);
            if (!values.ContainsKey(name)) order.Add(name);
            values[name] = p.Value;
        }
        var indexes = order.Where(IsArrayIndex).OrderBy(k => uint.Parse(k, CultureInfo.InvariantCulture));
        return indexes.Concat(order.Where(k => !IsArrayIndex(k))).Select(k => KeyValuePair.Create(k, values[k])).ToList();
    }

    private static bool IsArrayIndex(string k) =>
        k.Length is > 0 and <= 10 && k.All(char.IsAsciiDigit) && (k == "0" || k[0] != '0') && ulong.Parse(k, CultureInfo.InvariantCulture) < uint.MaxValue;

    private static string AsciiLower(string s)
    {
        var chars = s.ToCharArray();
        for (var i = 0; i < chars.Length; i++) if (chars[i] is >= 'A' and <= 'Z') chars[i] = (char)(chars[i] + 32);
        return new string(chars);
    }

    // ── JavaScript's reading of a line ─────────────────────────────────

    /// <summary>JSON.parse of one line; null when it does not parse.</summary>
    private static JsonElement? Parse(string line)
    {
        try
        {
            using var doc = JsonDocument.Parse(line, LineOptions);
            return doc.RootElement.Clone();
        }
        catch (Exception e) when (e is JsonException or ArgumentException) { return null; }
    }

    /// <summary><c>e?.name</c>: the field of an object; anything else has none.</summary>
    private static JsonElement? Prop(JsonElement? e, string name) =>
        e is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) ? v : null;

    private static bool Nullish(JsonElement? v) => v is null or { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined };

    /// <summary><c>a ?? b</c>.</summary>
    private static JsonElement? Coalesce(JsonElement? a, JsonElement? b) => Nullish(a) ? b : a;

    /// <summary><c>x === "text"</c>.</summary>
    private static bool Is(JsonElement? v, string text) => v is { ValueKind: JsonValueKind.String } s && Text(s) == text;

    /// <summary>The value when it is a string (<c>typeof x === "string"</c>), else null.</summary>
    private static string? StringOf(JsonElement? v) => v is { ValueKind: JsonValueKind.String } s ? Text(s) : null;

    /// <summary>JavaScript truthiness.</summary>
    private static bool Truthy(JsonElement? v) => v switch
    {
        null => false,
        { ValueKind: JsonValueKind.String } s => Text(s).Length > 0,
        { ValueKind: JsonValueKind.Number } n => double.Parse(n.GetRawText(), NumberStyles.Float, CultureInfo.InvariantCulture) is var d && d != 0 && !double.IsNaN(d),
        { ValueKind: JsonValueKind.True } => true,
        { ValueKind: JsonValueKind.Object or JsonValueKind.Array } => true,
        _ => false,
    };

    /// <summary>JavaScript's <c>String(x)</c> for a JSON value (null → "null"; an array joins its items with commas, a null item as "").</summary>
    private static string JsString(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => Text(v),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "null",
        JsonValueKind.Number => JsNumber(double.Parse(v.GetRawText(), NumberStyles.Float, CultureInfo.InvariantCulture)),
        JsonValueKind.Array => string.Join(",", v.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.Null ? "" : JsString(x))),
        JsonValueKind.Object => "[object Object]",
        _ => "",
    };

    /// <summary>
    /// JavaScript's <c>Number.prototype.toString()</c>: the shortest digits that round-trip, plain notation from 1e-6 up
    /// to 1e21 and exponent notation ("1e+21", "1.5e-7") outside it; -0 is "0", and 2**60 is "1152921504606847000",
    /// not the exact digits .NET's "F0" writes.
    /// </summary>
    private static string JsNumber(double d)
    {
        if (double.IsNaN(d)) return "NaN";
        if (double.IsInfinity(d)) return d > 0 ? "Infinity" : "-Infinity";
        if (d == 0) return "0";
        var r = Math.Abs(d).ToString("R", CultureInfo.InvariantCulture);
        var e = r.IndexOf('E');
        var mantissa = e < 0 ? r : r[..e];
        var exponent = e < 0 ? 0 : int.Parse(r[(e + 1)..], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
        var dot = mantissa.IndexOf('.');
        var all = dot < 0 ? mantissa : mantissa.Remove(dot, 1);
        var lead = all.Length - all.TrimStart('0').Length;
        var s = all.Trim('0');
        var n = (dot < 0 ? mantissa.Length : dot) + exponent - lead;
        var k = s.Length;
        var text = k <= n && n <= 21 ? s + new string('0', n - k)
            : 0 < n && n <= 21 ? $"{s[..n]}.{s[n..]}"
            : -6 < n && n <= 0 ? $"0.{new string('0', -n)}{s}"
            : $"{s[0]}{(k > 1 ? "." + s[1..] : "")}e{(n - 1 >= 0 ? "+" : "-")}{Math.Abs(n - 1)}";
        return d < 0 ? "-" + text : text;
    }

    /// <summary>
    /// A JSON string's text. JavaScript keeps a lone surrogate (<c>"\ud83d"</c> — an emoji a tool cut in half); .NET
    /// refuses to read one, so such a string is unescaped here by hand — the same text JSON.parse gives.
    /// </summary>
    private static string Text(JsonElement v)
    {
        try { return v.GetString()!; }
        catch (InvalidOperationException) { return Unescape(v.GetRawText()); }
    }

    /// <summary>A key's text, with the same care: its raw form is the start of the property's raw text.</summary>
    private static string NameOf(JsonProperty p)
    {
        try { return p.Name; }
        catch (InvalidOperationException) { return Unescape(p.ToString()); }
    }

    /// <summary>The JSON string literal at the start of <paramref name="raw"/>, unescaped.</summary>
    private static string Unescape(string raw)
    {
        var sb = new StringBuilder();
        for (var i = 1; i < raw.Length && raw[i] != '"'; i++)
        {
            var c = raw[i];
            if (c != '\\') { sb.Append(c); continue; }
            c = raw[++i];
            sb.Append(c switch
            {
                'b' => '\b', 'f' => '\f', 'n' => '\n', 'r' => '\r', 't' => '\t',
                'u' => (char)int.Parse(raw.AsSpan(i + 1, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture),
                _ => c,
            });
            if (c == 'u') i += 4;
        }
        return sb.ToString();
    }
}
