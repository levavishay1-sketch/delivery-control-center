using System.Text.Json.Nodes;
using Dcc.Infrastructure.Policy;

namespace Dcc.Infrastructure.Claude;

/// <summary>Per-call facts the policy's escalate/downgrade rules read (routing.ts RoutingSignals).</summary>
public sealed record RoutingSignals
{
    public string? Ambiguity { get; init; }
    public int? Breadth { get; init; }
    public bool? Reversible { get; init; }
    public int? OpenGaps { get; init; }
    public string? Novelty { get; init; }
    public int? RecentEvents { get; init; }
    public bool? Mechanical { get; init; }

    internal object? Get(string key) => key switch
    {
        "ambiguity" => Ambiguity, "breadth" => Breadth, "reversible" => Reversible, "openGaps" => OpenGaps,
        "novelty" => Novelty, "recentEvents" => RecentEvents, "mechanical" => Mechanical, _ => null,
    };
}

public sealed record RoutingDecision(string Capability, string Tier, string Model, string Effort, decimal BudgetUsd, int? MaxInputTokens, string Rationale, int PolicyVersion);

/// <summary>
/// Model routing (architecture §6, claude-in-dcc §8.3): EVERY call to Claude goes through
/// <see cref="Route"/>, and the decision — tier, model, effort, cap, the rule that fired, the
/// policy version — is written on the call's ledger row. Deterministic rules, not a model.
/// </summary>
public sealed class ModelRouter(ModelPolicyStore store)
{
    private const string DefaultEffort = "medium";
    private static readonly Dictionary<string, int> Order = new() { ["low"] = 0, ["medium"] = 1, ["high"] = 2 };

    private static bool Meets(RoutingSignals s, JsonObject cond)
    {
        foreach (var (k, v) in cond)
        {
            var got = s.Get(k);
            if (k is "ambiguity" or "novelty")
            {
                if (got is not string g || !Order.TryGetValue(g, out var have) || !Order.TryGetValue(v?.GetValue<string>() ?? "", out var want) || have < want) return false;
            }
            else if (v is JsonValue jv && jv.TryGetValue<double>(out var n))
            {
                if (got is not int i || i < n) return false;
            }
            else if (v is JsonValue jb && jb.TryGetValue<bool>(out var b))
            {
                if (got is not bool gb || gb != b) return false;
            }
        }
        return true;
    }

    private static string Bump(string t) => t == "haiku" ? "sonnet" : "opus";
    private static string Drop(string t) => t == "opus" ? "sonnet" : "haiku";

    public RoutingDecision Route(string capability, RoutingSignals? signals = null, string? chosenModel = null, string? chosenEffort = null)
    {
        signals ??= new RoutingSignals();
        var policy = store.Load();
        var cap = policy["capabilities"]?[capability] as JsonObject ?? new JsonObject { ["default"] = "sonnet" };
        var tier = cap["default"]?.GetValue<string>() ?? "sonnet";
        var why = new List<string> { $"default {tier} for {capability}" };
        var hit = (cap["escalateOn"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(c => Meets(signals, c));
        var low = (cap["downgradeOn"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(c => Meets(signals, c));
        if (hit is not null) { tier = Bump(tier); why.Add($"escalated ({string.Join("+", hit.Select(kv => kv.Key))})"); }
        else if (low is not null) { tier = Drop(tier); why.Add($"downgraded ({string.Join("+", low.Select(kv => kv.Key))})"); }

        var t = policy["tiers"]?[tier] as JsonObject;
        var budget = Math.Max(t?["maxUsdPerCall"]?.GetValue<decimal>() ?? 0, cap["maxUsdPerCall"]?.GetValue<decimal>() ?? 0);
        var model = t?["model"]?.GetValue<string>() ?? tier;
        var effort = cap["effort"]?.GetValue<string>() ?? DefaultEffort;
        // A choice may name a tier ("sonnet"); the same model as the policy's is not an override.
        var chosen = chosenModel is { Length: > 0 } ? policy["tiers"]?[chosenModel]?["model"]?.GetValue<string>() ?? chosenModel : null;
        if (chosen is not null && chosen != model) { model = chosen; why.Add($"model overridden by user ({chosenModel})"); }
        if (chosenEffort is { Length: > 0 } && chosenEffort != effort) { effort = chosenEffort; why.Add($"effort overridden by user ({chosenEffort})"); }
        return new RoutingDecision(capability, tier, model, effort, budget, cap["maxInputTokens"]?.GetValue<int>(), string.Join("; ", why), policy["version"]?.GetValue<int>() ?? 0);
    }

    /// <summary>List price for a model id, or a tier alias the CLI accepts.</summary>
    public JsonObject? PriceFor(string? model)
    {
        if (string.IsNullOrEmpty(model)) return null;
        var policy = store.Load();
        var id = policy["tiers"]?[model]?["model"]?.GetValue<string>() ?? model;
        if (policy["prices"]?[id] is JsonObject exact) return exact;
        foreach (var (k, v) in policy["prices"]?.AsObject() ?? [])
            if (v is JsonObject o && id.StartsWith(System.Text.RegularExpressions.Regex.Replace(k, @"-\d{8}$", ""), StringComparison.Ordinal)) return o;
        return null;
    }

    /// <summary>What a call would cost from its tokens, at list price.</summary>
    public double? EstimateUsd(string? model, int input = 0, int output = 0, int cacheRead = 0, int cacheWrite = 0)
    {
        var p = PriceFor(model);
        if (p is null) return null;
        double P(string k) => p[k]?.GetValue<double>() ?? 0;
        return (input * P("input") + cacheRead * P("cacheRead") + cacheWrite * P("cacheWrite") + output * P("output")) / 1_000_000;
    }
}
