using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Infrastructure.Claude;
using Microsoft.Extensions.DependencyInjection;

namespace Dcc.Infrastructure.Actions;

/// <summary>What an action acts on: a requirement (wi / gaps), a task, or an onboarding run.</summary>
public sealed record ActionEntity(string Kind, Guid Id, Guid ClientId, Guid? WorkitemId, Guid? RepoId = null);

public sealed record ActionParam(string Name, string Explain, bool Required = false);

public sealed record ActionEstimate(string Capability, string Model, string Effort, double? Usd);

/// <summary>A refusal of an action, in the person's words — the API shows its message.</summary>
public sealed class ActionRefused(string reason) : AppException(409, "action_refused", reason);

/// <summary>
/// One action a screen offers, described once (actions/index.ts): what it is, what it will do, who may do it,
/// what it costs and how it runs. The screen's button and the chat's proposal are two doors to the same
/// <see cref="RunAsync"/>; the chat never runs one without the person's click.
/// </summary>
public abstract class ActionDef
{
    public abstract string Key { get; }
    public abstract string Title { get; }
    /// <summary>Changes something outside the conversation → always behind the person's approval.</summary>
    public virtual bool Consequential => true;
    public abstract string Topic { get; }
    public virtual IReadOnlyList<ActionParam> Params => [];
    public virtual string? ApproveLabel => null;
    public virtual string? CostNote => null;
    public abstract Task<string> DescribeAsync(JsonObject p, ActionEntity e, CancellationToken ct);
    /// <summary>Null = allowed; otherwise why not.</summary>
    public abstract Task<string?> RefusalAsync(Guid by, ActionEntity e, JsonObject p, CancellationToken ct);
    public abstract Task<ActionEstimate?> EstimateAsync(JsonObject p, ActionEntity e, CancellationToken ct);
    /// <summary>The exact prompt — the same "what will be sent" gate every button opens.</summary>
    public virtual Task<(string Prompt, string PromptHe)?> PreviewAsync(JsonObject p, ActionEntity e, CancellationToken ct) => Task.FromResult<(string, string)?>(null);
    public abstract Task<JsonNode?> RunAsync(JsonObject p, ActionEntity e, Guid by, string trigger, CancellationToken ct);

    protected static string? Str(JsonObject p, string k) => p[k] is JsonValue v && v.TryGetValue<string>(out var s) && s.Trim().Length > 0 ? s.Trim() : null;
}

/// <summary>The registry: every action, by key; the one implementation behind every button and every approved proposal.</summary>
public sealed class ActionRegistry(IEnumerable<ActionDef> defs)
{
    private readonly Dictionary<string, ActionDef> _byKey = defs.ToDictionary(d => d.Key);

    public ActionDef? Get(string key) => _byKey.GetValueOrDefault(key);

    /// <summary>The actions a topic may propose, narrowed to what the screen declared.</summary>
    public IEnumerable<ActionDef> For(string topic, IReadOnlyCollection<string>? declared = null) =>
        _byKey.Values.Where(a => a.Topic == topic && (declared is null || declared.Contains(a.Key)));

    /// <summary>What a typical call of this capability costs at list price — the estimate on a proposal card.</summary>
    public static ActionEstimate Typical(ModelRouter router, string capability, int input, int output)
    {
        var d = router.Route(capability);
        return new ActionEstimate(capability, d.Model, d.Effort, router.EstimateUsd(d.Model, input, output));
    }

    /// <summary>Run an action in a person's name.</summary>
    public async Task<JsonNode?> RunAsync(string key, JsonObject p, ActionEntity e, Guid by, string trigger, CancellationToken ct)
    {
        var def = Get(key) ?? throw AppException.BadRequest("bad_request", $"unknown action {key}");
        if (await def.RefusalAsync(by, e, p, ct) is { } why) throw new ActionRefused(why);
        return await def.RunAsync(p, e, by, trigger, ct);
    }
}

public static class ActionRegistration
{
    public static IServiceCollection AddAction<T>(this IServiceCollection s) where T : ActionDef => s.AddScoped<ActionDef, T>();
}
