using Dcc.Infrastructure.Claude;
using Dcc.Infrastructure.Policy;
using Microsoft.Extensions.Options;

namespace Dcc.Tests.Unit;

/// <summary>
/// The routing rules (the old <c>routing.prove.ts</c>) against a copy of the global policy, <c>config/model-policy.json</c>:
/// which tier each capability gets, when a signal escalates or downgrades it, that a person's choice wins, and the list
/// prices an estimate reads. A copy, so nothing here can ever change the real file; the layout round trip is
/// <see cref="ModelPolicyLayoutTests"/>.
/// </summary>
public sealed class ModelRouterTests : IDisposable
{
    private readonly string _copy = Path.Combine(Path.GetTempPath(), $"dcc-model-policy-{Guid.NewGuid():N}.json");
    private readonly ModelRouter _router;

    public ModelRouterTests()
    {
        File.Copy(ModelPolicyLayoutTests.FindRepoFile("config/model-policy.json"), _copy);
        _router = new ModelRouter(new ModelPolicyStore(Options.Create(new ModelPolicyOptions { Path = _copy })));
    }

    public void Dispose() => File.Delete(_copy);

    [Fact]
    public void The_chat_is_always_cheap_low_effort_and_capped()
    {
        var d = _router.Route("chat");
        Assert.Equal("haiku", d.Tier);
        Assert.Equal("low", d.Effort);
        Assert.Equal(60_000, d.MaxInputTokens);
        // Reading code from the chat is a different capability, a tier up.
        Assert.Equal("sonnet", _router.Route("chat_code_read").Tier);
    }

    [Fact]
    public void A_signal_escalates_or_downgrades_one_tier_from_the_default()
    {
        Assert.Equal("sonnet", _router.Route("gap_detection", new RoutingSignals { Ambiguity = "low" }).Tier);
        Assert.Equal("opus", _router.Route("gap_detection", new RoutingSignals { Ambiguity = "high" }).Tier);
        Assert.Equal("sonnet", _router.Route("decomposition", new RoutingSignals { Breadth = 2, OpenGaps = 0 }).Tier);
        Assert.Equal("opus", _router.Route("decomposition", new RoutingSignals { Breadth = 5, OpenGaps = 4 }).Tier);
        Assert.Equal("sonnet", _router.Route("execution", new RoutingSignals { Ambiguity = "medium" }).Tier);
        Assert.Equal("haiku", _router.Route("execution", new RoutingSignals { Mechanical = true }).Tier);
        Assert.Equal("opus", _router.Route("execution", new RoutingSignals { Novelty = "high", Breadth = 6 }).Tier);
    }

    /// <summary>The decision says why, in the rule's own words, and carries the larger of the tier's and the capability's cap.</summary>
    [Fact]
    public void An_escalated_decision_names_the_rule_that_fired_and_its_budget()
    {
        var d = _router.Route("decomposition", new RoutingSignals { Breadth = 5, OpenGaps = 4 });
        Assert.Equal("default sonnet for decomposition; escalated (breadth)", d.Rationale);
        Assert.Equal("claude-opus-5", d.Model);
        Assert.Equal(4m, d.BudgetUsd);
    }

    [Fact]
    public void A_persons_choice_wins_and_a_tier_alias_resolves_to_its_model()
    {
        Assert.Equal("claude-opus-5", _router.Route("decomposition", chosenModel: "claude-opus-5").Model);
        // Choosing the tier the policy already picked is not an override.
        Assert.DoesNotContain("overridden", _router.Route("gap_detection", chosenModel: "sonnet").Rationale);
        var opus = _router.Route("gap_detection", chosenModel: "opus");
        Assert.Equal("claude-opus-5", opus.Model);
        Assert.Contains("model overridden by user (opus)", opus.Rationale);
    }

    [Fact]
    public void The_decision_names_the_policy_version()
    {
        Assert.True(_router.Route("chat").PolicyVersion > 0);
    }

    [Fact]
    public void An_estimate_uses_the_list_price_and_a_tier_alias_prices_like_its_model()
    {
        Assert.Equal("1.00", (_router.EstimateUsd("claude-haiku-4-5-20251001", input: 1_000_000) ?? 0).ToString("F2", System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal("10.00", (_router.EstimateUsd("sonnet", output: 1_000_000) ?? 0).ToString("F2", System.Globalization.CultureInfo.InvariantCulture));
    }
}
