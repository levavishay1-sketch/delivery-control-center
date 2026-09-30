using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Infrastructure.Ledger;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.Claude;

/// <summary>Bound from <c>Claude</c>.</summary>
public sealed class ClaudeOptions
{
    public const string Section = "Claude";

    /// <summary>The CLI. <c>DCC_CLAUDE_BIN</c> wins; a .cmd/.bat runs through cmd.exe.</summary>
    public string Bin { get; set; } = "claude";

    /// <summary>Arguments before the CLI's own — lets a test point <see cref="Bin"/> at an interpreter and a stand-in script.</summary>
    public List<string> BinArgs { get; set; } = [];
}

/// <summary>What one call actually cost — from the CLI's own final result line, never a separate estimate.</summary>
public sealed record RunMeta(string? Model, string? Effort, decimal? CostUsd, int? InputTokens, int? OutputTokens, int? CacheReadTokens, int? CacheWriteTokens, int? DurationMs, int? NumTurns);

/// <summary>Who, for whom and for what — required on every call (claude-in-dcc §8).</summary>
public sealed record LedgerContext
{
    public required Guid ClientId { get; init; }
    public required Guid UserId { get; init; }
    public required string Capability { get; init; }
    public required string Trigger { get; init; }
    public (string Kind, string Id)? Entity { get; init; }
    public Guid? WorkitemId { get; init; }
    public string? Screen { get; init; }
    public required string Label { get; init; }
    public Guid? ConversationId { get; init; }
    public Guid? MessageId { get; init; }
    public Guid? ParentCallId { get; init; }
    public RoutingSignals? Signals { get; init; }
    /// <summary>What the CLI already reported for this resumed session (cumulative) — the row is the difference.</summary>
    public (decimal CostUsd, int InputTokens, int OutputTokens)? Baseline { get; init; }
    public int? ExpectedInputTokens { get; init; }
    /// <summary>The model said it did not have what was asked (§7.2).</summary>
    public Func<string, bool>? Unanswered { get; init; }
    public object? Meta { get; init; }
}

public sealed record LeanOptions(string SystemPromptFile, string? Tools = null, (Guid Id, bool Resume)? Session = null, IReadOnlyList<string>? AddDirs = null);

public sealed record ClaudeCall
{
    public required LedgerContext Ledger { get; init; }
    public int TimeoutMs { get; init; } = 240_000;
    public int? MaxTurns { get; init; }
    /// <summary>A run tracked by id opens for input as stream-json — it can be stopped and handed more text.</summary>
    public Guid? RunId { get; init; }
    /// <summary>Implementation only, and only ever on DCC's own copy of the repository.</summary>
    public bool Write { get; init; }
    public string? Model { get; init; }
    /// <summary>No write access, but may run commands (a build, tests) — the checks.</summary>
    public bool Commands { get; init; }
    /// <summary>The exact <c>--allowed-tools</c> list; wins over Write/Commands.</summary>
    public string? Tools { get; init; }
    public string? Effort { get; init; }
    public LeanOptions? Lean { get; init; }
    public IReadOnlyDictionary<string, string>? Env { get; init; }
    public IReadOnlyList<string>? DenyRules { get; init; }
}

public sealed record ClaudeResult(string Text, RunMeta Meta, Guid? CallId, string AssistantText);

/// <summary>A refusal meant for the person — the API shows its message.</summary>
public sealed class ClaudeRunException(string message, string outcome) : Exception(message)
{
    public string Outcome { get; } = outcome;
    public bool Stopped => Outcome == "stopped";
}

/// <summary>
/// The one place that spawns the local <c>claude</c> CLI — the user's own logged-in session, no API
/// key (ai-assist.ts runClaudeRaw). Headless <c>-p</c>, stream-json out, the prompt on stdin (nothing to
/// quote). Read-only unless the call says write; the policy picks model and effort for every call; every
/// call — answered, failed, stopped or refused — writes one ledger row.
/// </summary>
public sealed partial class ClaudeRunner(IOptions<ClaudeOptions> options, ModelRouter router, FlowRunHub hub, ClaudeLedger ledger, ILogger<ClaudeRunner> log)
{
    // `--tools ""` loses its empty value through cmd.exe; a name that matches no tool leaves none.
    private const string NoTools = "NoTools";

    private static RunMeta EmptyMeta(RoutingDecision d) => new(d.Model, d.Effort, null, null, null, null, null, null, null);

    private (string File, List<string> Prefix) Command()
    {
        var bin = Environment.GetEnvironmentVariable("DCC_CLAUDE_BIN") is { Length: > 0 } env ? env : options.Value.Bin;
        var prefix = new List<string>(options.Value.BinArgs);
        if (OperatingSystem.IsWindows() && (bin.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase) || bin.EndsWith(".bat", StringComparison.OrdinalIgnoreCase)))
            return ("cmd.exe", ["/c", bin, .. prefix]);
        return (bin, prefix);
    }

    public async Task<ClaudeResult> RunRawAsync(string cwd, string prompt, ClaudeCall o, CancellationToken ct = default)
    {
        var steerable = o.RunId is not null;
        var args = new List<string> { "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--allowed-tools" };
        args.Add(o.Tools ?? (o.Write ? "Read,Grep,Glob,Edit,Write,Bash" : o.Commands ? "Read,Grep,Glob,Bash" : "Read,Grep,Glob"));
        args.AddRange(["--max-turns", (o.MaxTurns ?? (o.Write || o.Commands ? 80 : 40)).ToString(CultureInfo.InvariantCulture)]);
        if (steerable) args.AddRange(["--input-format", "stream-json"]);
        var decision = router.Route(o.Ledger.Capability, o.Ledger.Signals, o.Model, o.Effort);
        args.AddRange(["--model", decision.Model, "--effort", decision.Effort]);
        var startedAt = DateTimeOffset.UtcNow;

        // A call whose input would pass the capability's cap is refused before it costs anything — and recorded.
        var expected = o.Ledger.ExpectedInputTokens ?? (int)Math.Round(prompt.Length / 3.0);
        if (decision.MaxInputTokens is { } cap && expected > cap)
        {
            var why = $"הקלט (~{expected.ToString("N0", CultureInfo.InvariantCulture)} טוקנים) עובר את התקרה של {o.Ledger.Capability} ({cap.ToString("N0", CultureInfo.InvariantCulture)}) — השיחה צריכה להתגלגל להמשך";
            await RecordAsync(o.Ledger, decision, startedAt, EmptyMeta(decision), "refused", why, null, ct);
            throw new ClaudeRunException(why, "refused");
        }
        if (o.Lean is { } lean)
        {
            args.AddRange(["--system-prompt-file", lean.SystemPromptFile, "--tools", lean.Tools is { Length: > 0 } t ? t : NoTools,
                "--disable-slash-commands", "--strict-mcp-config", "--setting-sources", "local"]);
            if (lean.Session is { } s) args.AddRange([s.Resume ? "--resume" : "--session-id", s.Id.ToString()]);
            else args.Add("--no-session-persistence");
            foreach (var d in lean.AddDirs ?? []) args.AddRange(["--add-dir", d]);
        }
        // A settings FILE, not inline JSON — cmd.exe mangles quotes and braces.
        string? settingsFile = null;
        if (o.DenyRules is { Count: > 0 })
        {
            settingsFile = Path.Combine(Path.GetTempPath(), $"dcc-claude-settings-{Guid.NewGuid()}.json");
            await File.WriteAllTextAsync(settingsFile, JsonSerializer.Serialize(new { permissions = new { deny = o.DenyRules } }), ct);
            args.AddRange(["--settings", settingsFile]);
        }

        string raw;
        try
        {
            raw = await SpawnAsync(cwd, args, prompt, o, ct);
        }
        catch (ClaudeRunException e)
        {
            await RecordAsync(o.Ledger, decision, startedAt, EmptyMeta(decision), e.Outcome, e.Message.Length > 500 ? e.Message[..500] : e.Message, null, ct);
            throw;
        }
        finally
        {
            if (settingsFile is not null) try { File.Delete(settingsFile); } catch (IOException) { }
        }

        // stream-json: the answer is the last {"type":"result",...} line, which also carries cost and usage.
        var text = raw.Trim();
        var resultLine = raw.Split('\n').Reverse().FirstOrDefault(l => l.Contains("\"type\":\"result\"", StringComparison.Ordinal));
        var meta = EmptyMeta(decision);
        JsonObject? env = null;
        try { env = JsonNode.Parse((resultLine ?? text).Trim()) as JsonObject; } catch (JsonException) { }
        if (env is not null)
        {
            if (env["result"] is JsonValue rv && rv.TryGetValue<string>(out var r)) text = r;
            // A failed run (auth, budget, retries exhausted) exits 0 with is_error — not an answer.
            if (env["is_error"] is JsonValue ev && ev.TryGetValue<bool>(out var isErr) && isErr)
            {
                var msg = $"claude run failed ({env["subtype"]?.GetValue<string>() ?? "error"}): {(text.Length > 300 ? text[..300] : text)}";
                await RecordAsync(o.Ledger, decision, startedAt, meta, "error", msg.Length > 500 ? msg[..500] : msg, null, ct);
                throw new ClaudeRunException(msg, "error");
            }
            // The model that carried the run is the one that cost the most — the CLI lists its own helpers too.
            string? modelFromUsage = null;
            if (env["modelUsage"] is JsonObject mu)
                modelFromUsage = mu.Select(kv => (kv.Key, Cost: Num(kv.Value?["costUSD"]) ?? 0)).OrderByDescending(x => x.Cost).Select(x => x.Key).FirstOrDefault();
            var usage = env["usage"] as JsonObject;
            meta = new RunMeta(modelFromUsage ?? decision.Model, decision.Effort, (decimal?)Num(env["total_cost_usd"]),
                Int(usage?["input_tokens"]), Int(usage?["output_tokens"]), Int(usage?["cache_read_input_tokens"]), Int(usage?["cache_creation_input_tokens"]),
                Int(env["duration_ms"]), Int(env["num_turns"]));
        }
        var callId = await RecordAsync(o.Ledger, decision, startedAt, meta, "ok", null, text, ct);
        return new ClaudeResult(text, meta, callId, AssistantTexts(raw));
    }

    /// <summary>Expects one JSON object or array back — pulled out of whatever the model wrapped it in.</summary>
    public async Task<JsonNode> RunJsonAsync(string cwd, string prompt, ClaudeCall o, CancellationToken ct = default)
    {
        var r = await RunRawAsync(cwd, prompt, o, ct);
        return ExtractJson(r.Text);
    }

    [GeneratedRegex(@"```(?:json)?\s*([\s\S]*?)```")] private static partial Regex Fenced();

    public static JsonNode ExtractJson(string text)
    {
        var m = Fenced().Match(text);
        var jsonText = (m.Success ? m.Groups[1].Value : text).Trim();
        var start = jsonText.IndexOfAny(['[', '{']);
        if (start < 0) throw new ClaudeRunException($"no JSON in claude output: {Cut(text, 300)}", "error");
        var body = jsonText[start..];
        try { return JsonNode.Parse(body)!; }
        catch (JsonException)
        {
            // One complete value followed by prose — read just the value.
            try
            {
                var reader = new Utf8JsonReader(Encoding.UTF8.GetBytes(body));
                using var doc = JsonDocument.ParseValue(ref reader);
                return JsonNode.Parse(doc.RootElement.GetRawText())!;
            }
            catch (JsonException e) { throw new ClaudeRunException($"could not parse claude JSON ({e.Message}): {Cut(jsonText, 300)}", "error"); }
        }
    }

    private async Task<string> SpawnAsync(string cwd, List<string> args, string prompt, ClaudeCall o, CancellationToken ct)
    {
        var (file, prefix) = Command();
        var psi = new ProcessStartInfo(file)
        {
            WorkingDirectory = cwd, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, StandardInputEncoding = new UTF8Encoding(false),
        };
        foreach (var a in prefix.Concat(args)) psi.ArgumentList.Add(a);
        if (o.Env is not null) foreach (var (k, v) in o.Env) psi.Environment[k] = v;

        Process p;
        try { p = Process.Start(psi) ?? throw new InvalidOperationException("no process"); }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            throw new ClaudeRunException($"cannot run \"{file}\" — האם claude מותקן ומחובר? ({e.Message})", "error");
        }
        using (p)
        {
            var runId = o.RunId;
            if (runId is { } id) hub.Attach(id, p);
            var err = p.StandardError.ReadToEndAsync(CancellationToken.None);
            try
            {
                if (runId is not null) { await p.StandardInput.WriteLineAsync(FlowRunHub.UserMessage(prompt)); await p.StandardInput.FlushAsync(ct); }
                else { await p.StandardInput.WriteAsync(prompt); p.StandardInput.Close(); }
            }
            catch (IOException) { /* the process already went away — its exit says why */ }

            using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
            limit.CancelAfter(o.TimeoutMs);
            var output = new StringBuilder();
            try
            {
                while (await p.StandardOutput.ReadLineAsync(limit.Token) is { } line)
                {
                    output.Append(line).Append('\n');
                    if (runId is null) continue;
                    var trimmed = line.Trim();
                    if (Describe(trimmed, cwd) is { } desc) foreach (var s in desc.Split('\n')) hub.PushLine(runId, s);
                    // The agentic run is done once its result is through — let it exit rather than hold stdin open.
                    if (trimmed.Contains("\"type\":\"result\"", StringComparison.Ordinal)) hub.CloseStdin(runId.Value);
                }
                await p.WaitForExitAsync(limit.Token);
            }
            catch (OperationCanceledException)
            {
                try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                if (runId is { } rid) hub.Detach(rid);
                throw new ClaudeRunException($"claude timed out after {o.TimeoutMs / 1000}s", "timeout");
            }
            var stopped = runId is { } sid && hub.WasStopped(sid);
            if (runId is { } did) hub.Detach(did);
            if (stopped) throw new ClaudeRunException("STOPPED_BY_USER", "stopped");
            if (p.ExitCode != 0)
            {
                var e = await err;
                throw new ClaudeRunException($"claude exited {p.ExitCode}: {Cut(e.Length > 0 ? e : output.ToString(), 400)}", "error");
            }
            return output.ToString();
        }
    }

    /// <summary>One stream-json line as a readable transcript line, or null to skip.</summary>
    [GeneratedRegex(@"^.*[/\\]\.?dcc-repos[/\\][0-9a-f-]+[/\\]", RegexOptions.IgnoreCase)] private static partial Regex CachePrefix();
    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();

    public static string? Describe(string line, string? cwd = null)
    {
        JsonObject? e;
        try { e = JsonNode.Parse(line) as JsonObject; } catch (JsonException) { return null; }
        if (e is null) return null;
        var type = e["type"]?.GetValueKind() == JsonValueKind.String ? e["type"]!.GetValue<string>() : null;
        if (type == "assistant" && e["message"]?["content"] is JsonArray content)
        {
            var bits = new List<string>();
            foreach (var c in content.OfType<JsonObject>())
            {
                var ct = c["type"]?.GetValue<string>();
                if (ct == "text" && c["text"]?.GetValue<string>() is { } raw && raw.Trim().Length > 0)
                {
                    var t = raw.Trim();
                    // the final answer is the raw JSON payload — not dumped into the log
                    if ((t[0] is '[' or '{') && (t[^1] is '"' or '}' or ']')) continue;
                    bits.Add($"💭 {Cut(Spaces().Replace(t, " "), 600)}");
                }
                else if (ct == "tool_use")
                {
                    var inp = c["input"] as JsonObject;
                    var rawArg = inp?["file_path"] ?? inp?["path"] ?? inp?["pattern"] ?? inp?["query"] ?? inp?["command"];
                    var argText = rawArg is JsonValue v && v.TryGetValue<string>(out var sv) ? sv : rawArg?.ToJsonString() ?? "";
                    // paths read as repository-relative: the run's own folder, or DCC's cache, stripped
                    var arg = argText.Replace('\\', '/');
                    var root = cwd?.Replace('\\', '/').TrimEnd('/');
                    arg = root is { Length: > 0 } && arg.StartsWith(root + "/", StringComparison.OrdinalIgnoreCase) ? arg[(root.Length + 1)..] : CachePrefix().Replace(arg, "");
                    bits.Add($"🔧 {c["name"]} {Cut(arg, 160)}".Trim());
                }
            }
            return bits.Count > 0 ? string.Join("\n", bits) : null;
        }
        if (type == "result")
        {
            var cost = Num(e["total_cost_usd"]) is { } usd ? $" · ${usd.ToString("0.000", CultureInfo.InvariantCulture)}" : "";
            var turns = Int(e["num_turns"]) is { } n ? $"{n} צעדים" : "";
            return $"✓ Claude סיים{(turns.Length > 0 ? $" ({turns}{cost})" : "")}";
        }
        return null;
    }

    /// <summary>Everything the model wrote along the way, not only its last message.</summary>
    public static string AssistantTexts(string raw)
    {
        var parts = new List<string>();
        foreach (var line in raw.Split('\n'))
        {
            if (!line.Contains("\"type\":\"assistant\"", StringComparison.Ordinal)) continue;
            try
            {
                if (JsonNode.Parse(line) is not JsonObject ev || ev["type"]?.GetValue<string>() != "assistant") continue;
                foreach (var c in (ev["message"]?["content"] as JsonArray ?? []).OfType<JsonObject>())
                    if (c["type"]?.GetValue<string>() == "text" && c["text"]?.GetValue<string>() is { } t && t.Trim().Length > 0) parts.Add(t.Trim());
            }
            catch (JsonException) { }
        }
        return string.Join("\n\n", parts);
    }

    /// <summary>The one writer of the ledger from a CLI call — best-effort: a row failing must never fail the run it describes.</summary>
    private async Task<Guid?> RecordAsync(LedgerContext l, RoutingDecision d, DateTimeOffset startedAt, RunMeta m, string outcome, string? errorText, string? text, CancellationToken ct)
    {
        try
        {
            return await ledger.RecordAsync(new ClaudeCallInput
            {
                ClientId = l.ClientId, UserId = l.UserId,
                EntityKind = l.Entity?.Kind ?? (l.WorkitemId is not null ? "workitem" : "none"), EntityId = l.Entity?.Id ?? l.WorkitemId?.ToString(),
                WorkitemId = l.WorkitemId, Screen = l.Screen, Capability = l.Capability, Trigger = l.Trigger, Label = l.Label,
                ConversationId = l.ConversationId, MessageId = l.MessageId, ParentCallId = l.ParentCallId,
                StartedAt = startedAt, FinishedAt = DateTimeOffset.UtcNow,
                DurationMs = m.DurationMs ?? (int)Math.Max(0, (DateTimeOffset.UtcNow - startedAt).TotalMilliseconds),
                ModelRequested = d.Model, ModelUsed = m.Model ?? d.Model, Effort = d.Effort, PolicyVersion = d.PolicyVersion, PolicyRule = d.Rationale,
                NumTurns = m.NumTurns,
                InputTokens = Math.Max(0, (m.InputTokens ?? 0) - (l.Baseline?.InputTokens ?? 0)),
                CacheReadTokens = m.CacheReadTokens ?? 0, CacheWriteTokens = m.CacheWriteTokens ?? 0,
                OutputTokens = Math.Max(0, (m.OutputTokens ?? 0) - (l.Baseline?.OutputTokens ?? 0)),
                CostUsd = Math.Max(0, (m.CostUsd ?? 0) - (l.Baseline?.CostUsd ?? 0)), PriceListVersion = d.PolicyVersion,
                Outcome = outcome, ErrorText = errorText,
                Unanswered = text is not null && l.Unanswered is not null && l.Unanswered(text),
                Meta = l.Meta ?? new { },
            }, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogError(e, "[ledger] a {Capability} call was NOT recorded", l.Capability);
            return null;
        }
    }

    private static double? Num(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? d : null;
    private static int? Int(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? (int)d : null;
    private static string Cut(string s, int n) => s.Length > n ? s[..n] : s;
}
