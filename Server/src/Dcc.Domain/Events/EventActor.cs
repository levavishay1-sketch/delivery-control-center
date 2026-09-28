using System.Text.Json.Serialization;

namespace Dcc.Domain.Events;

/// <summary>
/// Who an event is attributed to (architecture decision 02 — identity is
/// always a person). Serialized into <c>event_log.actor</c> exactly as the
/// old server wrote it, discriminated by <c>kind</c>.
/// </summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(UserActor), "user")]
[JsonDerivedType(typeof(DelegatedActor), "delegated")]
[JsonDerivedType(typeof(SystemActor), "system")]
[JsonDerivedType(typeof(AgentActor), "agent")]
public abstract record EventActor
{
    /// <summary>A system actor is transport plumbing only; it may never author a reasoning event.</summary>
    [JsonIgnore]
    public virtual bool IsSystem => false;
}

/// <summary>A person, acting interactively.</summary>
public sealed record UserActor(Guid UserId) : EventActor
{
    public string IdentityType { get; init; } = "interactive";
}

/// <summary>
/// Background work on behalf of a named person — including a delegated AI
/// agent, which never exceeds its owner (<see cref="AgentId"/> names it).
/// </summary>
public sealed record DelegatedActor(Guid UserId, string TriggeredBy) : EventActor
{
    public string IdentityType { get; init; } = "delegated";

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Guid? AgentId { get; init; }
}

/// <summary>Transport plumbing (a sync, an ingestion) — never reasoning.</summary>
public sealed record SystemActor(string Process) : EventActor
{
    public override bool IsSystem => true;
}

/// <summary>
/// An independent AI agent, with the person accountable for it. Allowed only
/// once the decision-02 amendment is approved (see agent_profile).
/// </summary>
public sealed record AgentActor(Guid AgentId, Guid SponsorUserId) : EventActor;
