using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.Policy;

/// <summary>Bound from <c>ModelPolicy</c>.</summary>
public sealed class ModelPolicyOptions
{
    public const string Section = "ModelPolicy";

    /// <summary>The routing policy file (config-as-code, edited from the control centre).</summary>
    public string Path { get; set; } = "../../../config/model-policy.json";
}

/// <summary>
/// The model routing policy — <c>config/model-policy.json</c>, the global layer.
/// Every call to Claude declares a capability; the policy says which tier (and
/// so which model), which effort and which cost cap it runs with. Loaded once
/// and cached; the editor's save writes the file back in its own layout (so a
/// change reads as the changed lines, not a rewritten file), keeps its
/// <c>$comment</c> keys and bumps <c>version</c>.
/// </summary>
public sealed class ModelPolicyStore(IOptions<ModelPolicyOptions> options)
{
    private readonly object _gate = new();
    private JsonObject? _cached;

    public string FilePath => options.Value.Path;

    public JsonObject Load()
    {
        lock (_gate)
        {
            _cached ??= JsonNode.Parse(File.ReadAllText(FilePath))!.AsObject();
            return (JsonObject)_cached.DeepClone();
        }
    }

    public JsonObject Save(JsonObject next)
    {
        lock (_gate)
        {
            var raw = JsonNode.Parse(File.ReadAllText(FilePath))!.AsObject();
            var currentVersion = (_cached ?? raw)["version"]?.GetValue<int>() ?? 0;
            foreach (var (k, v) in next) raw[k] = v?.DeepClone();
            raw["version"] = currentVersion + 1;
            File.WriteAllText(FilePath, Format(raw) + "\n", new UTF8Encoding(false));
            _cached = null;
        }
        return Load();
    }

    public int Version => Load()["version"]?.GetValue<int>() ?? 0;

    /// <summary>A capability's recommendation — model and effort — before any per-call signal or override.</summary>
    public (string Model, string Tier, string Effort) Recommend(string capability)
    {
        var p = Load();
        var cap = p["capabilities"]?[capability] as JsonObject;
        var tier = cap?["default"]?.GetValue<string>() ?? "sonnet";
        var model = p["tiers"]?[tier]?["model"]?.GetValue<string>() ?? tier;
        return (model, tier, cap?["effort"]?.GetValue<string>() ?? "medium");
    }

    /// <summary>The chat values, with the defaults as the floor.</summary>
    public int ChatRetentionDays => Load()["chat"]?["retentionDays"]?.GetValue<int>() ?? 90;

    // ── the file's layout ────────────────────────────────────────────

    private static bool IsFlat(JsonNode? x) => x is JsonObject o && o.All(kv => kv.Value is null or JsonValue);

    /// <summary>Written on one line: a primitive, a flat object, or a list of those.</summary>
    private static bool Inlineable(JsonNode? x) => x switch
    {
        null or JsonValue => true,
        JsonArray a => a.All(y => y is null or JsonValue || IsFlat(y)),
        _ => IsFlat(x),
    };

    private static string Inline(JsonNode? v) => v switch
    {
        JsonArray a => "[" + string.Join(", ", a.Select(Inline)) + "]",
        JsonObject o => "{ " + string.Join(", ", o.Select(kv => $"{Str(kv.Key)}: {Inline(kv.Value)}")) + " }",
        _ => Primitive(v),
    };

    /// <summary>The root and its sections indented; every entry inside a section on one line when it can be.</summary>
    public static string Format(JsonNode? v, int depth = 0)
    {
        var indent = new string(' ', depth * 2);
        switch (v)
        {
            case JsonArray a:
                if (Inlineable(a)) return Inline(a);
                return "[\n" + string.Join(",\n", a.Select(x => $"{indent}  {Format(x, depth + 1)}")) + $"\n{indent}]";
            case JsonObject o:
                if (o.Count == 0) return "{}";
                if (depth >= 2 && o.All(kv => Inlineable(kv.Value))) return Inline(o);
                return "{\n" + string.Join(",\n", o.Select(kv => $"{indent}  {Str(kv.Key)}: {Format(kv.Value, depth + 1)}")) + $"\n{indent}}}";
            default:
                return Primitive(v);
        }
    }

    private static readonly JsonSerializerOptions Unescaped = new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private static string Str(string s) => JsonSerializer.Serialize(s, Unescaped);

    private static string Primitive(JsonNode? v) => v is null ? "null" : v.ToJsonString(Unescaped);
}
