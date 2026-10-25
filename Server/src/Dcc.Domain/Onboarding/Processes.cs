using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Dcc.Domain.Onboarding;

/// <summary>A question of the interview bank (interview.json): the question itself, its rank (lower first) and the condition — rules.json's language — that asks it.</summary>
public sealed record InterviewBankQuestion(InterviewQuestion Question, double Priority, JsonNode? When);

/// <summary>What the code shows about processes before a model is asked. <c>Source</c>: as <see cref="DiscoveredProcess.Source"/>.</summary>
public sealed record ProcessEvidence(
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("lines")] IReadOnlyList<string> Lines);

/// <summary>
/// The repository's own processes — how a change of some kind is made HERE — and the agent test that decides, per
/// step, whether it needs an agent of its own, a skill, or nothing (repo-onboarding/processes.ts). The deterministic
/// part (evidence from the history, the CI, the contribution rules, the templates; the interview) is pure and tested;
/// the model breaks processes into steps and answers the five questions; the code decides from the answers. The run
/// engine wires the call; reading the contribution files from the isolated copy is Infrastructure's
/// (<c>ProcessEvidenceReader</c>), which hands this class a reader.
/// </summary>
public static partial class Processes
{
    // ── the interview: at most four questions, each with a default ─────

    public const int MaxQuestions = 4;

    /// <summary>The <c>questions</c> of interview.json. Parsed once by the caller and passed in — the domain reads no files.</summary>
    public static List<InterviewBankQuestion> ParseInterview(string interviewJson) =>
        (JsonNode.Parse(interviewJson)?["questions"] as JsonArray ?? [])
        .OfType<JsonObject>()
        .Select(q => new InterviewBankQuestion(q.Deserialize<InterviewQuestion>()!, Number(q["priority"]) ?? 0, q["when"]))
        .ToList();

    public static List<InterviewQuestion> InterviewFor(JsonObject profile, string interviewJson) => InterviewFor(profile, ParseInterview(interviewJson));

    /// <summary>The first four bank questions whose condition holds for this profile, by priority (a stable order, as JavaScript's sort).</summary>
    public static List<InterviewQuestion> InterviewFor(JsonObject profile, IReadOnlyList<InterviewBankQuestion> bank) =>
        bank.Where(q => !Truthy(q.When) || Rules.Evaluate(q.When!, profile)).ToList()
            .OrderBy(q => q.Priority)
            .Take(MaxQuestions)
            .Select(q => q.Question)
            .ToList();

    /// <summary>Every question answered: what the person chose, or the default recorded as an assumption.</summary>
    public static List<InterviewAnswer> ResolveAnswers(IReadOnlyList<InterviewQuestion> questions, IReadOnlyDictionary<string, string> given) =>
        questions.Select(q =>
        {
            var ok = given.TryGetValue(q.Key, out var v) && q.Options.Any(o => o.Value == v);
            return new InterviewAnswer(q.Key, ok ? v! : q.Default, !ok);
        }).ToList();

    public static string RenderInterview(IReadOnlyList<InterviewQuestion> questions, IReadOnlyList<InterviewAnswer> answers)
    {
        if (questions.Count == 0) return "(no questions were needed for this repository)";
        return string.Join("\n", questions.Select(q =>
        {
            var a = answers.FirstOrDefault(x => x.Key == q.Key);
            var label = q.Options.FirstOrDefault(o => o.Value == a?.Value)?.LabelHe ?? a?.Value ?? q.Default;
            return $"- {q.QuestionHe} → {label}{(a?.Assumed == true ? " (assumed — nobody answered)" : "")}";
        }));
    }

    // ── evidence the code gathers before the model is asked ────────────

    /// <summary>
    /// What the code can show about processes without a model: repeated change shapes and co-changes from the history,
    /// what CI runs, the contribution rules, the pull-request template, the docs that describe a procedure.
    /// <paramref name="read"/> returns a repository file's text cut to the given length, or null when it is not there;
    /// null when there is no copy to read from (the contribution rules are then only named).
    /// </summary>
    public static List<ProcessEvidence> GatherEvidence(JsonObject profile, Func<string, int, string?>? read)
    {
        var output = new List<ProcessEvidence>();
        var git = At(profile, "git");
        var ci = At(profile, "ci");
        var docs = At(profile, "docs");

        var sh = Rules.Shapes(profile);
        if (sh.Count > 0)
            output.Add(new("git", "Change shapes repeated in the history",
                sh.Take(6).Select(s => $"{Join(Items(At(s, "files")).Take(8), " + ")} — changed together {Field(s, "times")} times").ToList()));
        var pairs = Items(At(git, "cochange_pairs")).Take(6).ToList();
        if (pairs.Count > 0)
            output.Add(new("git", "Files that change together", pairs.Select(p => $"{Field(p, "a")} + {Field(p, "b")} ({Field(p, "times")} times)").ToList()));
        var hot = Items(At(git, "hot_dirs")).Where(h => !IsString(At(h, "dir"), ".")).Take(4).ToList();
        if (hot.Count > 0)
            output.Add(new("git", "Hot directories", hot.Select(h => $"{Field(h, "dir")}: {Field(h, "changes")} changes by {Field(h, "authors")} authors").ToList()));
        if (Truthy(At(ci, "present")))
            output.Add(new("ci", $"CI ({Join(Items(At(ci, "systems")), ", ")})",
            [
                .. Items(At(ci, "workflows")).Take(8).Select(w => $"{Field(w, "file")}{(Truthy(At(w, "name")) ? $" — {Text(At(w, "name"))}" : "")}"),
                .. Items(At(ci, "commands")).Take(8).Select(c => $"runs: {Text(c)}"),
            ]));
        foreach (var c in Items(At(docs, "contributing")).Take(1).Select(Text))
        {
            var text = read?.Invoke(c, 6000);
            output.Add(new("contributing", c, string.IsNullOrEmpty(text) ? ["(present; read it in the repository)"] : NonBlankLines(text, 60)));
        }
        foreach (var t in Items(At(docs, "pr_template")).Take(1).Select(Text))
        {
            var text = read?.Invoke(t, 3000);
            output.Add(new("pr_template", t, string.IsNullOrEmpty(text) ? ["(present)"] : NonBlankLines(text, 40)));
        }
        var procDocs = Items(At(docs, "architecture_docs")).Concat(Items(At(docs, "adrs"))).Take(4).Select(Text).ToList();
        var docsFiles = At(docs, "docs_files");
        if (procDocs.Count > 0 || Truthy(docsFiles))
            output.Add(new("docs", "Documentation that may describe procedures", [.. procDocs, .. Truthy(docsFiles) ? [$"docs/ ({Text(docsFiles)} files)"] : Array.Empty<string>()]));
        var external = At(profile, "external_systems");
        if (Truthy(At(external, "Azure DevOps")) || Truthy(At(external, "Jira")))
            output.Add(new("tracker", "Work tracker referenced in the code",
                (external as JsonObject ?? []).Select(kv => kv.Key).Where(k => k is "Azure DevOps" or "Jira").ToList()));
        var build = Items(At(At(profile, "build"), "commands"));
        if (build.Count > 0) output.Add(new("docs", "Build and packaging", build.Take(3).Select(Text).ToList()));
        return output;
    }

    public static string RenderEvidence(IReadOnlyList<ProcessEvidence> evidence) => evidence.Count > 0
        ? string.Join("\n\n", evidence.Select(e => $"## {e.Title} ({e.Source})\n{string.Join("\n", e.Lines.Select(l => $"- {l}"))}"))
        : "(the code found no process evidence: no history shapes, no CI, no CONTRIBUTING, no PR template)";

    private static List<string> NonBlankLines(string text, int max) => text.Split('\n').Where(l => JsTrim(l).Length > 0).Take(max).ToList();

    // ── reading the model's answer, and the decision the code makes ────

    /// <summary>The decision word when a step needs neither an agent nor a skill.</summary>
    public const string NoHelper = "אין צורך בסוכן או סקיל";

    private static readonly string[] Criteria = ["judgment", "externalInfo", "readsALot", "parallel", "failsToday"];

    private static readonly Dictionary<string, string> CriterionHe = new()
    {
        ["judgment"] = "צריך שיפוט עצמאי",
        ["externalInfo"] = "צריך מידע או גישה שאין לסוכן הראשי",
        ["readsALot"] = "צריך לקרוא הרבה",
        ["parallel"] = "יכול לרוץ במקביל",
        ["failsToday"] = "כבר נכשל בפועל",
    };

    private static bool Answer(AgentTest t, string criterion) => criterion switch
    {
        "judgment" => t.Judgment,
        "externalInfo" => t.ExternalInfo,
        "readsALot" => t.ReadsALot,
        "parallel" => t.Parallel,
        "failsToday" => t.FailsToday,
        _ => false,
    };

    /// <summary>
    /// JavaScript's whitespace — what <c>\s</c> and <c>trim()</c> meant in the old server: the space separators, the
    /// line and paragraph separators, the ASCII controls and U+FEFF. .NET's own adds U+0085 and leaves out U+FEFF.
    /// </summary>
    internal const string JsSpace = @"[\t\n\v\f\r\p{Zs}\p{Zl}\p{Zp}\uFEFF]";

    private static readonly char[] JsSpaceChars =
    [
        (char)0x09, (char)0x0A, (char)0x0B, (char)0x0C, (char)0x0D, (char)0x20, (char)0xA0, (char)0x1680, (char)0x2000, (char)0x2001, (char)0x2002,
        (char)0x2003, (char)0x2004, (char)0x2005, (char)0x2006, (char)0x2007, (char)0x2008, (char)0x2009, (char)0x200A, (char)0x2028, (char)0x2029,
        (char)0x202F, (char)0x205F, (char)0x3000, (char)0xFEFF,
    ];

    internal static string JsTrim(string s) => s.Trim(JsSpaceChars);

    /// <summary>A prefix by UTF-16 code units, as JavaScript's <c>slice(0, max)</c>.</summary>
    internal static string Slice(string s, int max) => s.Length <= max ? s : s[..max];

    /// <summary>
    /// A step that is a procedure — several actions in order — in either language: the model now writes <c>what</c> in
    /// Hebrew, the history-only fallback may still carry English. The word boundary is JavaScript's (ASCII letters,
    /// digits and underscore), so an English verb glued to a Hebrew word still counts.
    /// </summary>
    [GeneratedRegex(@"(?<![A-Za-z0-9_])(?i:then|after|before|run|update|regenerate|register|deploy|bump|sync|generate|migrat|import|export|publish|release|apply|commit|push)(?![A-Za-z0-9_])|(?:^|" + JsSpace + @")(?i:ואז|אחרי|לפני|להריץ|הרצת|לעדכן|עדכון|ליצור|לייצר|לרשום|רישום|לפרוס|פריסה|לפרסם|פרסום|לשחרר|שחרור|לסנכרן|לייבא|לייצא|מיגרציה|להעלות|לבנות|commit|push)", RegexOptions.CultureInvariant)]
    private static partial Regex Procedural();

    /// <summary>Two or more parts: separated by a comma, a semicolon (Latin or Arabic), " and " or " ואז ".</summary>
    [GeneratedRegex("[,;،]| and | ואז ")]
    private static partial Regex Parts();

    public static bool IsProcedural(string what) => Procedural().IsMatch(what) || Parts().IsMatch(what);

    /// <summary>
    /// Any yes on the five questions makes the step an agent candidate, named after the step; a step that is a
    /// recurring, well-defined procedure with no yes becomes a skill; a one-line action gets nothing. Recurring = the
    /// process came from the history, the CI or a written rule (it repeats), or the step names a procedure of several actions.
    /// </summary>
    public static (string Decision, string Reason) DecideStep(AgentTest test, bool recurring, string what)
    {
        var yes = Criteria.Where(k => Answer(test, k)).ToList();
        if (yes.Count > 0) return ("agent", $"סוכן: {string.Join(", ", yes.Select(k => CriterionHe[k]))}.");
        if (recurring && IsProcedural(what)) return ("skill", "skill: נוהל חוזר עם כמה פעולות, בלי צורך בשיפוט נפרד.");
        return ("none", $"{NoHelper}: פעולה אחת שהסוכן הראשי עושה לבד.");
    }

    /// <summary>How strongly a step's answers call for an agent of its own: what fails today and what needs judgment or access weigh most.</summary>
    public static int AgentScore(AgentTest t) => (t.FailsToday ? 3 : 0) + (t.Judgment ? 2 : 0) + (t.ExternalInfo ? 2 : 0) + (t.ReadsALot ? 1 : 0) + (t.Parallel ? 1 : 0);

    public const int MaxAgentsPerRun = 4;

    /// <summary>
    /// A model answers "yes" generously. The rule of the design holds — any yes makes a step a candidate — but a
    /// candidate is not yet an agent: one agent per process (its strongest step, the first of equals), at most four per
    /// run, and every other candidate becomes a skill when it is a procedure, or nothing. The person sees the answers
    /// either way and can ask for more. Returns the processes with their steps re-decided (the records are immutable;
    /// the old server changed them in place).
    /// </summary>
    public static List<DiscoveredProcess> CapAgents(IReadOnlyList<DiscoveredProcess> processes, int max = MaxAgentsPerRun)
    {
        var steps = processes.Select(p => p.Steps.ToArray()).ToList();
        void Demote(int pi, int si, string why)
        {
            var s = steps[pi][si];
            var recurring = processes[pi].Source != "model" && processes[pi].Source != "interview";
            var decision = recurring && IsProcedural(s.What) ? "skill" : "none";
            steps[pi][si] = s with { Decision = decision, Reason = $"{(decision == "skill" ? "skill" : NoHelper)}: {why}" };
        }
        var winners = new List<(int P, int S, int Score)>();
        for (var pi = 0; pi < processes.Count; pi++)
        {
            var row = steps[pi];
            var candidates = Enumerable.Range(0, row.Length).Where(si => row[si].Decision == "agent").ToList();
            if (candidates.Count == 0) continue;
            var best = candidates.OrderByDescending(si => AgentScore(row[si].AgentTest)).First();
            foreach (var si in candidates)
                if (si != best) Demote(pi, si, $"מועמד לסוכן, אבל התהליך מקבל סוכן אחד — הצעד \"{row[best].Title}\" חזק יותר.");
            winners.Add((pi, best, AgentScore(row[best].AgentTest)));
        }
        foreach (var w in winners.OrderByDescending(w => w.Score).Skip(max).ToList())
            Demote(w.P, w.S, $"מועמד לסוכן, אבל הרצה מקבלת עד {max} סוכנים והצעדים האחרים חזקים יותר.");
        return processes.Select((p, i) => p with { Steps = steps[i] }).ToList();
    }

    private static readonly string[] Sources = ["git", "ci", "contributing", "pr_template", "docs", "tracker", "interview", "model"];

    /// <summary>
    /// The model's answer → processes, every step decided by the code. Only well-formed processes are kept (a title and
    /// at least one titled step), at most twelve of eight steps each; junk gives an empty list, never an exception. A
    /// step whose trial task failed (<c>process.step</c> in <paramref name="trialsFailingSteps"/>) fails today.
    /// </summary>
    public static List<DiscoveredProcess> Parse(string raw, IReadOnlySet<string>? trialsFailingSteps = null)
    {
        var start = raw.IndexOf('{');
        var end = raw.LastIndexOf('}');
        if (start < 0 || end <= start) return [];
        JsonDocument doc;
        // JsonDocument rather than JsonNode: on a repeated key it keeps the last one, as JSON.parse does.
        try { doc = JsonDocument.Parse(raw.AsMemory(start, end - start + 1), JsonOptions); }
        catch (Exception e) when (e is JsonException or ArgumentException) { return []; }
        using (doc)
        {
            if (Prop(doc.RootElement, "processes") is not { ValueKind: JsonValueKind.Array } list) return [];
            var output = new List<DiscoveredProcess>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var p in list.EnumerateArray())
            {
                var title = Str(Prop(p, "title"), 120);
                if (title.Length == 0) continue;
                var keyText = Str(Prop(p, "key"));
                var key = Slug(keyText.Length > 0 ? keyText : title);
                while (seen.Contains(key)) key = $"{key}_2";
                seen.Add(key);
                var sourceValue = Prop(p, "source") is { ValueKind: JsonValueKind.String } sv ? JsonText(sv) : null;
                var source = Sources.FirstOrDefault(s => s == sourceValue) ?? "model";
                var recurring = source != "model" && source != "interview";
                var steps = new List<ProcessStep>();
                foreach (var s in Prop(p, "steps") is { ValueKind: JsonValueKind.Array } sa ? sa.EnumerateArray() : Enumerable.Empty<JsonElement>())
                {
                    var st = Str(Prop(s, "title"), 120);
                    if (st.Length == 0) continue;
                    var t = Prop(s, "agentTest");
                    var stepKeyText = Str(Prop(s, "key"));
                    var stepKey = Slug(stepKeyText.Length > 0 ? stepKeyText : st);
                    var failedInTrial = trialsFailingSteps?.Contains($"{key}.{stepKey}") == true;
                    var r = Prop(t, "reasons");
                    var reasons = new Dictionary<string, string>();
                    foreach (var c in Criteria)
                    {
                        var v = Str(Prop(r, c), 400);
                        if (v.Length > 0 && Bool(Prop(t, c))) reasons[c] = v;
                    }
                    if (failedInTrial && !reasons.ContainsKey("failsToday")) reasons["failsToday"] = "משימת הניסיון שבודקת את התהליך הזה נכשלה.";
                    var test = new AgentTest
                    {
                        Judgment = Bool(Prop(t, "judgment")), ExternalInfo = Bool(Prop(t, "externalInfo")), ReadsALot = Bool(Prop(t, "readsALot")),
                        Parallel = Bool(Prop(t, "parallel")), FailsToday = Bool(Prop(t, "failsToday")) || failedInTrial, Why = Str(Prop(t, "why"), 400), Reasons = reasons,
                    };
                    var what = Str(Prop(s, "what"), 400);
                    var (decision, reason) = DecideStep(test, recurring, what);
                    steps.Add(new ProcessStep(stepKey, st, what, test, decision, reason));
                }
                if (steps.Count == 0) continue;
                var evidence = Prop(p, "evidence") is { ValueKind: JsonValueKind.Array } ea
                    ? ea.EnumerateArray().Select(e => Str(e, 300)).Where(e => e.Length > 0).Take(8).ToList()
                    : [];
                output.Add(new DiscoveredProcess { Key = key, Title = title, Source = source, Evidence = evidence, Steps = steps.Take(8).ToList(), TrialTaskKey = null, Impossible = null });
            }
            return CapAgents(output.Take(12).ToList());
        }
    }

    /// <summary>
    /// When the code itself can name a process without a model: the history's change shapes, and checking a change the
    /// way the CI does. Used when the model call fails, so the step is never empty by accident.
    /// </summary>
    public static List<DiscoveredProcess> FromEvidence(JsonObject profile)
    {
        var output = new List<DiscoveredProcess>();
        foreach (var s in Rules.Shapes(profile).Take(3))
        {
            var files = Items(At(s, "files")).Take(6).Select(Text).ToList();
            var steps = files.Select(f => new ProcessStep(
                Slug($"edit_{BaseName(f)}"), $"עדכון {BaseName(f)}", $"לעדכן את {f} כך שיתאים לשאר הקבצים שמשתנים איתו",
                new AgentTest { Why = "מההיסטוריה בלבד" }, "none", $"{NoHelper}: חלק מהמתכון.")).ToList();
            // The recipe is the skill: the process as a whole repeats, so its first step carries the decision.
            steps[0] = steps[0] with { Decision = "skill", Reason = "skill: נוהל חוזר מההיסטוריה." };
            output.Add(new DiscoveredProcess
            {
                Key = Slug($"change_{BaseName(files[0])}"), Title = $"שינוי שנוגע יחד ב-{string.Join(", ", files.Select(BaseName))}", Source = "git",
                Evidence = [$"{string.Join(" + ", files)} changed together {Field(s, "times")} times"], Steps = steps, TrialTaskKey = null, Impossible = null,
            });
        }
        var ci = At(profile, "ci");
        var commands = Items(At(ci, "commands"));
        if (Truthy(At(ci, "present")) && commands.Count > 0)
        {
            output.Add(new DiscoveredProcess
            {
                Key = "verify_like_ci", Title = "בדיקת שינוי כמו שה-CI בודק", Source = "ci", Evidence = commands.Take(4).Select(Text).ToList(),
                Steps =
                [
                    new ProcessStep("run_ci_commands", "הרצת פקודות ה-CI מקומית", $"להריץ {Join(commands.Take(3), "; ")} לפני שמכריזים שהשינוי גמור",
                        new AgentTest { Why = "ה-CI מגדיר מה נחשב תקין" }, "skill", "skill: נוהל חוזר מה-CI."),
                ],
                TrialTaskKey = null, Impossible = null,
            });
        }
        return output;
    }

    public static string RenderProcesses(IReadOnlyList<DiscoveredProcess> processes) => processes.Count > 0
        ? string.Join("\n", processes.Select(p =>
            $"- {p.Title} [{p.Source}]{(string.IsNullOrEmpty(p.Impossible) ? "" : $" — impossible here: {p.Impossible}")}\n" +
            string.Join("\n", p.Steps.Select(s => $"    {s.Title}: {s.Decision}{(string.IsNullOrEmpty(s.AgentTest.Why) ? "" : $" ({s.AgentTest.Why})")}"))))
        : "(no processes found)";

    // ── small helpers: the model's JSON, and the profile read the way the old server read it ──

    [GeneratedRegex("[^a-z0-9]+")] private static partial Regex NotSlug();
    [GeneratedRegex("^_|_$")] private static partial Regex EdgeUnderscore();

    private static string Slug(string s)
    {
        var slug = Slice(EdgeUnderscore().Replace(NotSlug().Replace(JsLower(s), "_"), ""), 48);
        return slug.Length > 0 ? slug : "process";
    }

    /// <summary>
    /// JavaScript's <c>toLowerCase()</c>. .NET's invariant casing leaves İ (U+0130) as it is, where JavaScript writes
    /// "i" and a combining dot above; every other difference lowercases to a letter outside ASCII either way.
    /// </summary>
    internal static string JsLower(string s) => s.Replace(((char)0x130).ToString(), "i" + (char)0x307).ToLowerInvariant();

    /// <summary>
    /// JSON.parse reads any depth; JsonDocument refuses more than 64 levels by default, and its cost grows with the
    /// square of the depth. A thousand is far beyond any answer a model writes and still quick to refuse.
    /// </summary>
    internal static readonly JsonDocumentOptions JsonOptions = new() { MaxDepth = 1000 };

    /// <summary>
    /// A JSON string as JSON.parse reads it. Half of a surrogate pair written as an escape with no partner is a valid
    /// JavaScript string that <see cref="JsonElement.GetString"/> refuses (it throws), so its escapes are read here.
    /// </summary>
    internal static string JsonText(JsonElement e)
    {
        try { return e.GetString()!; }
        catch (InvalidOperationException) { return Unescape(e.GetRawText()); }
    }

    /// <summary>A JSON string literal, quotes included, already validated by the parser → its text, unit by unit.</summary>
    private static string Unescape(string literal)
    {
        var text = new StringBuilder(literal.Length);
        for (var i = 1; i < literal.Length - 1; i++)
        {
            if (literal[i] != '\\') { text.Append(literal[i]); continue; }
            var e = literal[++i];
            if (e == 'u') { text.Append((char)int.Parse(literal.AsSpan(i + 1, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture)); i += 4; }
            else text.Append(e switch { 'b' => '\b', 'f' => '\f', 'n' => '\n', 'r' => '\r', 't' => '\t', _ => e });
        }
        return text.ToString();
    }

    private static string BaseName(string path) => path[(path.LastIndexOf('/') + 1)..];

    /// <summary>A property of the model's JSON; on a repeated name the last one, as JSON.parse keeps it.</summary>
    internal static JsonElement? Prop(JsonElement? o, string name)
    {
        if (o is not { ValueKind: JsonValueKind.Object } obj) return null;
        try { return obj.TryGetProperty(name, out var v) ? v : null; }
        catch (InvalidOperationException)
        {
            // A name holding half a surrogate pair stops TryGetProperty; JSON.parse reads it, so the names are read here.
            JsonElement? found = null;
            foreach (var p in obj.EnumerateObject()) if (NameOf(p) == name) found = p.Value;
            return found;
        }
    }

    private static string NameOf(JsonProperty p)
    {
        try { return p.Name; }
        catch (InvalidOperationException)
        {
            var raw = p.ToString(); // the raw text, from the name's opening quote to the end of the value
            var end = 1;
            while (raw[end] != '"') end += raw[end] == '\\' ? 2 : 1;
            return Unescape(raw[..(end + 1)]);
        }
    }

    /// <summary>A string of the model's JSON, trimmed and cut; anything that is not a string is empty.</summary>
    private static string Str(JsonElement? v, int max = 300) => v is { ValueKind: JsonValueKind.String } s ? Slice(JsTrim(JsonText(s)), max) : "";

    private static bool Bool(JsonElement? v) => v is { ValueKind: JsonValueKind.True } || v is { ValueKind: JsonValueKind.String } s && JsonText(s) is "true" or "yes";

    internal static JsonNode? At(JsonNode? node, string key) => node is JsonObject o && o.TryGetPropertyValue(key, out var v) ? v : null;

    internal static List<JsonNode?> Items(JsonNode? node) => node is JsonArray a ? [.. a] : [];

    private static bool IsString(JsonNode? node, string value) => node is JsonValue v && v.GetValueKind() == JsonValueKind.String && v.GetValue<string>() == value;

    private static double? Number(JsonNode? node) =>
        node is JsonValue v && v.GetValueKind() == JsonValueKind.Number ? double.Parse(v.ToJsonString(), CultureInfo.InvariantCulture) : null;

    /// <summary>JavaScript's truthiness: null, false, 0, NaN and "" are false; any object or array — even empty — is true.</summary>
    internal static bool Truthy(JsonNode? node) => node switch
    {
        null => false,
        JsonValue v => v.GetValueKind() switch
        {
            JsonValueKind.True => true,
            JsonValueKind.String => v.GetValue<string>().Length > 0,
            JsonValueKind.Number => Number(v) is double d && d != 0 && !double.IsNaN(d),
            _ => false,
        },
        _ => true,
    };

    /// <summary>A value as a JavaScript template string printed it (<c>String(v)</c>): a whole number without a decimal point, null as "null".</summary>
    internal static string Text(JsonNode? node) => node switch
    {
        null => "null",
        JsonArray a => Join(a, ","),
        JsonObject => "[object Object]",
        JsonValue v => v.GetValueKind() switch
        {
            JsonValueKind.String => v.GetValue<string>(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Number => NumberText(Number(v)!.Value),
            _ => "null",
        },
        _ => "null",
    };

    /// <summary>
    /// JavaScript's <c>String(number)</c>: the shortest digits that read back as the same number, written out in full
    /// from 1e-7 up to 1e21 and as d.ddde±n beyond (1e+21, 1.5e-7) — .NET's round-trip format would write "1E+21".
    /// </summary>
    private static string NumberText(double d)
    {
        if (double.IsNaN(d)) return "NaN";
        if (double.IsInfinity(d)) return d > 0 ? "Infinity" : "-Infinity";
        if (d == 0) return "0";
        var r = Math.Abs(d).ToString("R", CultureInfo.InvariantCulture);
        var e = r.IndexOf('E');
        var exponent = e < 0 ? 0 : int.Parse(r[(e + 1)..], CultureInfo.InvariantCulture);
        var mantissa = e < 0 ? r : r[..e];
        var dot = mantissa.IndexOf('.');
        var whole = (dot < 0 ? mantissa : mantissa[..dot]).TrimStart('0');
        var fraction = dot < 0 ? "" : mantissa[(dot + 1)..];
        // |d| = 0.digits × 10^n
        var n = exponent + (whole.Length > 0 ? whole.Length : -(fraction.Length - fraction.TrimStart('0').Length));
        var digits = (whole + fraction).TrimStart('0').TrimEnd('0');
        var k = digits.Length;
        var text = k <= n && n <= 21 ? digits + new string('0', n - k)
            : 0 < n && n <= 21 ? $"{digits[..n]}.{digits[n..]}"
            : -6 < n && n <= 0 ? $"0.{new string('0', -n)}{digits}"
            : $"{digits[0]}{(k > 1 ? "." + digits[1..] : "")}e{(n > 0 ? "+" : "-")}{Math.Abs(n - 1)}";
        return d < 0 ? "-" + text : text;
    }

    /// <summary>A field of a profile object as a template string printed it — "undefined" when the field is not there.</summary>
    private static string Field(JsonNode? node, string key) => node is JsonObject o && o.TryGetPropertyValue(key, out var v) ? Text(v) : "undefined";

    /// <summary>Array.join: null elements are empty.</summary>
    private static string Join(IEnumerable<JsonNode?> items, string separator) => string.Join(separator, items.Select(n => n is null ? "" : Text(n)));
}
