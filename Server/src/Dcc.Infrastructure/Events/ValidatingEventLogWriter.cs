using System.Text.Json;
using Dcc.Domain.Events;

namespace Dcc.Infrastructure.Events;

/// <summary>
/// The front door that keeps every event honest, whatever store sits behind
/// it: the envelope (source, actor, links), the decision-02 rule that a system
/// actor never authors reasoning, and the per-type payload schema. The payload
/// handed on is the normalized one — defaults filled, unknown fields dropped.
/// </summary>
public sealed class ValidatingEventLogWriter(IEventLogWriter inner) : IEventLogWriter
{
    public Task<StoredEvent> AppendAsync(NewEvent e, CancellationToken ct = default)
    {
        if (e.ClientId == Guid.Empty) throw new EventValidationException("clientId is required");
        if (!EventSources.All.Contains(e.Source)) throw new EventValidationException($"unknown source \"{e.Source}\"");
        if (string.IsNullOrWhiteSpace(e.Type)) throw new EventValidationException("type is required");
        foreach (var l in e.Links)
        {
            if (!EventLink.Rels.Contains(l.Rel)) throw new EventValidationException($"unknown link rel \"{l.Rel}\"");
            if (string.IsNullOrEmpty(l.Ref)) throw new EventValidationException("a link needs a ref");
        }
        ValidateActor(e.Actor);
        if (e.Actor.IsSystem && EventPayloads.ReasoningTypes.Contains(e.Type))
            throw new EventValidationException($"event \"{e.Type}\" is reasoning — a system actor may not author it (decision 02)");

        var version = e.SchemaVersion ?? EventPayloads.CurrentVersion;
        var normalized = EventPayloads.Validate(e.Type, version, e.Payload);
        var payload = JsonSerializer.SerializeToElement(normalized);

        return inner.AppendAsync(e with { Payload = payload, SchemaVersion = version, OccurredAt = e.OccurredAt ?? DateTimeOffset.UtcNow }, ct);
    }

    private static void ValidateActor(EventActor actor)
    {
        switch (actor)
        {
            case UserActor u when u.UserId == Guid.Empty:
            case DelegatedActor d when d.UserId == Guid.Empty || string.IsNullOrWhiteSpace(d.TriggeredBy):
            case SystemActor s when string.IsNullOrWhiteSpace(s.Process):
            case AgentActor a when a.AgentId == Guid.Empty || a.SponsorUserId == Guid.Empty:
                throw new EventValidationException("the actor is incomplete");
        }
    }
}
