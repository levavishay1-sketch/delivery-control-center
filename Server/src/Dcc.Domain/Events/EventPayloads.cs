using System.Text.Json;
using System.Text.Json.Nodes;

namespace Dcc.Domain.Events;

/// <summary>
/// Per-type payload schemas — the discipline that keeps <c>event_log.payload</c>
/// from becoming a junk drawer (architecture decision 01).
///
/// Every event type has an entry. Adding a type = adding an entry, not a
/// migration. Changing a payload shape = a new version beside the old, so
/// historical rows still validate against the version they were written with.
///
/// Validation normalizes as it goes: defaults are filled in, unknown fields
/// are dropped — the payload that is stored is exactly the schema's shape.
/// </summary>
public static class EventPayloads
{
    public const int CurrentVersion = 1;

    /// <summary>Reasoning, not transport: a system actor may never author one (decision 02).</summary>
    public static readonly IReadOnlySet<string> ReasoningTypes = new HashSet<string>
    {
        "gap.proposed", "tasks.proposed", "claude.call", "blocker.raised",
    };

    private static readonly Dictionary<string, Dictionary<int, Action<PayloadReader>>> Schemas = new()
    {
        ["message.ingested"] = new() { [1] = MessageIngested },
        ["message.match_confirmed"] = new() { [1] = MatchConfirmed },
        ["claude.session"] = new() { [1] = ClaudeSession },
        ["git.activity"] = new() { [1] = GitActivity },
        ["gap.proposed"] = new() { [1] = GapProposed },
        ["gap.verified"] = new() { [1] = GapVerified },
        ["tasks.proposed"] = new() { [1] = TasksProposed },
        ["task.progressed"] = new() { [1] = TaskProgressed },
        ["review.completed"] = new() { [1] = ReviewCompleted },
        ["blocker.raised"] = new() { [1] = BlockerRaised },
        ["blocker.answered"] = new() { [1] = BlockerAnswered },
        ["status.changed"] = new() { [1] = StatusChanged },
        ["claude.call"] = new() { [1] = ClaudeCall },
        ["ado.synced"] = new() { [1] = AdoSynced },
        ["note.added"] = new() { [1] = NoteAdded },
        ["requirement.updated"] = new() { [1] = RequirementUpdated },
        ["repo.linked"] = new() { [1] = RepoLinked },
        ["repo.unlinked"] = new() { [1] = RepoUnlinked },
        ["decision.made"] = new() { [1] = DecisionMade },
        ["policy.changed"] = new() { [1] = PolicyChanged },
    };

    public static bool IsKnownType(string type) => Schemas.ContainsKey(type);

    /// <summary>Validates <paramref name="payload"/> against the schema for (type, version) and returns the normalized form.</summary>
    public static JsonObject Validate(string type, int version, JsonElement payload)
    {
        if (!Schemas.TryGetValue(type, out var byVersion))
            throw new EventValidationException($"No payload schema registered for event type \"{type}\". Add one to EventPayloads.");
        if (!byVersion.TryGetValue(version, out var schema))
            throw new EventValidationException($"event type \"{type}\" has no schema for version {version}");
        var r = new PayloadReader(type, payload);
        schema(r);
        return r.Output;
    }

    private static readonly string[] Channels = ["email", "slack", "phone", "meeting"];

    private static void MessageIngested(PayloadReader r)
    {
        r.Enum("channel", Channels);
        r.String("from");
        r.String("excerpt");
        r.OptString("externalRef");
        // AI match suggestion, if any — a proposal, needs human confirm.
        r.OptObject("matchSuggestion", m =>
        {
            m.Uuid("workitemId");
            m.Number("confidence", 0, 1);
            m.String("rationale");
        }, defaultNull: true);
    }

    private static void MatchConfirmed(PayloadReader r)
    {
        r.Uuid("eventId");
        r.Uuid("workitemId");
        r.Bool("wasSuggested");
    }

    private static void ClaudeSession(PayloadReader r)
    {
        r.String("sessionId");
        r.OptString("transcriptPath");
        r.String("summary");
        r.OptString("model");
        r.OptInt("tokensIn", 0);
        r.OptInt("tokensOut", 0);
        r.OptNumber("costUsd", 0, null);
        r.OptInt("durationMs", 0);
        r.OptInt("numTurns", 0);
    }

    private static void GitActivity(PayloadReader r)
    {
        r.String("repo");
        r.String("branch");
        r.Enum("kind", ["commit", "push", "branch_created", "pull_request"]);
        r.OptInt("count", 1);
        r.OptInt("prNumber", 1);
        r.OptStringArray("shas");
    }

    private static void GapProposed(PayloadReader r)
    {
        r.String("description");
        r.Bool("blocking");
        r.Number("confidence", 0, 1);
    }

    private static void GapVerified(PayloadReader r)
    {
        r.Uuid("gapId");
        r.Enum("outcome", ["verified", "resolved", "dismissed", "spun_off"]);
        r.OptUuid("spunOffTo");
    }

    private static void TasksProposed(PayloadReader r)
    {
        r.OptString("openspecChangeId");
        r.Int("taskCount", 1);
        r.Int("dependencyCount", 0);
        r.Enum("appetite", ["small", "standard", "large"]);
    }

    private static void BlockerRaised(PayloadReader r)
    {
        r.String("questionType");
        r.String("question");
        r.OptUuid("taskId");
    }

    private static void TaskProgressed(PayloadReader r)
    {
        r.Uuid("taskId");
        r.String("from");
        r.String("to");
        r.OptString("intent");
    }

    private static void BlockerAnswered(PayloadReader r)
    {
        r.Uuid("blockerId");
        r.String("answer");
    }

    private static void StatusChanged(PayloadReader r)
    {
        r.String("from");
        r.String("to");
        // true when the change was made directly in ADO and mirrored back
        r.Bool("viaAdo", defaultValue: false);
    }

    private static void ClaudeCall(PayloadReader r)
    {
        r.Uuid("callId");
        r.String("capability");
        r.String("label", defaultValue: "");
        r.String("outcome", defaultValue: "ok");
    }

    private static void ReviewCompleted(PayloadReader r)
    {
        r.Enum("verdict", ["pass", "changes_requested"]);
        r.Int("findingCount", 0);
        r.Int("blockingCount", 0);
        r.StringArray("overlapFocus", defaultEmpty: true);
    }

    private static void AdoSynced(PayloadReader r)
    {
        r.Enum("direction", ["to_ado", "from_ado"]);
        r.Int("adoId", 1);
        r.Enum("operation", ["create_workitem", "update_state", "create_link", "reconcile"]);
        r.OptString("url");
    }

    private static void NoteAdded(PayloadReader r)
    {
        r.String("body");
        r.OptUuid("corrects");
    }

    private static void RequirementUpdated(PayloadReader r)
    {
        r.String("summary");
        r.StringArray("fields", defaultEmpty: true);
    }

    private static void RepoLinked(PayloadReader r)
    {
        r.String("repoName");
        r.Enum("linkKind", ["declared", "auto"], defaultValue: "declared");
    }

    private static void RepoUnlinked(PayloadReader r) => r.String("repoName");

    private static void DecisionMade(PayloadReader r)
    {
        r.Enum("trigger", ["rebreakdown", "task_closed_override", "task_reopened", "requirement_reopened", "direction_changed"]);
        r.String("reason");
    }

    private static void PolicyChanged(PayloadReader r)
    {
        r.Int("fromVersion", 0);
        r.Int("toVersion", 0);
        r.ObjectArray("changes", c =>
        {
            c.String("path", minLength: 1);
            c.OptAny("from");
            c.OptAny("to");
        });
    }
}

/// <summary>Reads one payload object field by field, checking types and filling defaults into <see cref="Output"/>.</summary>
public sealed class PayloadReader
{
    private readonly string _where;
    private readonly JsonElement _src;

    public JsonObject Output { get; } = [];

    public PayloadReader(string where, JsonElement src)
    {
        _where = where;
        if (src.ValueKind != JsonValueKind.Object) throw Bad("", "an object");
        _src = src;
    }

    private EventValidationException Bad(string field, string expected) =>
        new($"payload of \"{_where}\": {(field.Length > 0 ? $"\"{field}\" must be " : "must be ")}{expected}");

    private bool TryGet(string name, out JsonElement v) =>
        _src.TryGetProperty(name, out v) && v.ValueKind != JsonValueKind.Undefined;

    public void String(string name, string? defaultValue = null, int minLength = 0)
    {
        if (!TryGet(name, out var v))
        {
            if (defaultValue is null) throw Bad(name, "a string");
            Output[name] = defaultValue;
            return;
        }
        if (v.ValueKind != JsonValueKind.String) throw Bad(name, "a string");
        var s = v.GetString()!;
        if (s.Length < minLength) throw Bad(name, $"at least {minLength} characters");
        Output[name] = s;
    }

    public void OptString(string name)
    {
        if (!TryGet(name, out var v)) return;
        if (v.ValueKind != JsonValueKind.String) throw Bad(name, "a string");
        Output[name] = v.GetString();
    }

    public void Enum(string name, string[] values, string? defaultValue = null)
    {
        if (!TryGet(name, out var v))
        {
            if (defaultValue is null) throw Bad(name, "one of " + string.Join(", ", values));
            Output[name] = defaultValue;
            return;
        }
        if (v.ValueKind != JsonValueKind.String || !values.Contains(v.GetString())) throw Bad(name, "one of " + string.Join(", ", values));
        Output[name] = v.GetString();
    }

    public void Uuid(string name)
    {
        if (!TryGet(name, out var v) || v.ValueKind != JsonValueKind.String || !Guid.TryParse(v.GetString(), out _)) throw Bad(name, "a uuid");
        Output[name] = v.GetString();
    }

    public void OptUuid(string name)
    {
        if (!TryGet(name, out _)) return;
        Uuid(name);
    }

    public void Bool(string name, bool? defaultValue = null)
    {
        if (!TryGet(name, out var v))
        {
            if (defaultValue is null) throw Bad(name, "true or false");
            Output[name] = defaultValue.Value;
            return;
        }
        if (v.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw Bad(name, "true or false");
        Output[name] = v.GetBoolean();
    }

    public void Int(string name, long min)
    {
        if (!TryGet(name, out var v) || v.ValueKind != JsonValueKind.Number || !v.TryGetInt64(out var n)) throw Bad(name, "a whole number");
        if (n < min) throw Bad(name, $"at least {min}");
        Output[name] = n;
    }

    public void OptInt(string name, long min)
    {
        if (!TryGet(name, out _)) return;
        Int(name, min);
    }

    public void Number(string name, double? min, double? max)
    {
        if (!TryGet(name, out var v) || v.ValueKind != JsonValueKind.Number) throw Bad(name, "a number");
        var n = v.GetDouble();
        if (min is { } lo && n < lo) throw Bad(name, $"at least {lo}");
        if (max is { } hi && n > hi) throw Bad(name, $"at most {hi}");
        Output[name] = n;
    }

    public void OptNumber(string name, double? min, double? max)
    {
        if (!TryGet(name, out _)) return;
        Number(name, min, max);
    }

    public void StringArray(string name, bool defaultEmpty = false)
    {
        if (!TryGet(name, out var v))
        {
            if (!defaultEmpty) throw Bad(name, "a list of strings");
            Output[name] = new JsonArray();
            return;
        }
        if (v.ValueKind != JsonValueKind.Array || v.EnumerateArray().Any(x => x.ValueKind != JsonValueKind.String)) throw Bad(name, "a list of strings");
        Output[name] = new JsonArray(v.EnumerateArray().Select(x => (JsonNode?)JsonValue.Create(x.GetString())).ToArray());
    }

    public void OptStringArray(string name)
    {
        if (!TryGet(name, out _)) return;
        StringArray(name);
    }

    public void OptObject(string name, Action<PayloadReader> inner, bool defaultNull)
    {
        if (!TryGet(name, out var v) || v.ValueKind == JsonValueKind.Null)
        {
            if (defaultNull) Output[name] = null;
            return;
        }
        var r = new PayloadReader($"{_where}.{name}", v);
        inner(r);
        Output[name] = r.Output;
    }

    public void ObjectArray(string name, Action<PayloadReader> inner)
    {
        if (!TryGet(name, out var v) || v.ValueKind != JsonValueKind.Array) throw Bad(name, "a list");
        var arr = new JsonArray();
        var i = 0;
        foreach (var item in v.EnumerateArray())
        {
            var r = new PayloadReader($"{_where}.{name}[{i++}]", item);
            inner(r);
            arr.Add(r.Output);
        }
        Output[name] = arr;
    }

    /// <summary>Any JSON value, kept as is (zod <c>unknown().optional()</c>).</summary>
    public void OptAny(string name)
    {
        if (!TryGet(name, out var v)) return;
        Output[name] = JsonNode.Parse(v.GetRawText());
    }
}
