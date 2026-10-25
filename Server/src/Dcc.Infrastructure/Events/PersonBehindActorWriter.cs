using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Dcc.Infrastructure.Events;

/// <summary>
/// Decision 02 at the one door every event goes through: identity is always a person. A route builds its actor from
/// the caller's id — for an API token that belongs to an agent, that id is the agent's own users row, and an event
/// written as <c>UserActor(agentId)</c> would name no person. So an agent here becomes who stands behind it: a
/// delegated agent is recorded as its owner, with the agent named (<c>DelegatedActor(owner, …) { AgentId }</c>); an
/// independent agent as itself with its sponsor (<c>AgentActor</c>). An agent with nobody behind it records nothing.
/// A person's actor passes through unchanged; the lookups are remembered for the request.
/// </summary>
public sealed class PersonBehindActorWriter(IEventLogWriter inner, DccDbContext db) : IEventLogWriter
{
    private readonly Dictionary<Guid, EventActor?> _agents = [];

    public async Task<StoredEvent> AppendAsync(NewEvent e, CancellationToken ct = default)
    {
        var actor = e.Actor switch
        {
            UserActor u => await BehindAsync(u.UserId, null, ct) ?? e.Actor,
            DelegatedActor { AgentId: null } d => await BehindAsync(d.UserId, d.TriggeredBy, ct) ?? e.Actor,
            _ => e.Actor,
        };
        return await inner.AppendAsync(ReferenceEquals(actor, e.Actor) ? e : e with { Actor = actor }, ct);
    }

    /// <summary>The actor that names the person behind an agent; null when the id is a person's.</summary>
    private async Task<EventActor?> BehindAsync(Guid userId, string? triggeredBy, CancellationToken ct)
    {
        if (!_agents.TryGetValue(userId, out var mapped))
        {
            var user = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.Kind, u.DisplayName }).FirstOrDefaultAsync(ct);
            mapped = null;
            if (user?.Kind == "agent")
            {
                var profile = await db.AgentProfiles.AsNoTracking().FirstOrDefaultAsync(a => a.UserId == userId, ct);
                mapped = profile switch
                {
                    { Mode: "independent", SponsorUserId: { } sponsor } => new AgentActor(userId, sponsor),
                    { Mode: "delegated", OwnerUserId: { } owner } => new DelegatedActor(owner, $"agent:{user.DisplayName}") { AgentId = userId },
                    _ => throw AppException.Forbidden("forbidden", "This agent has no person behind it, so nothing it does can be recorded."),
                };
            }
            _agents[userId] = mapped;
        }
        // A delegated write keeps what triggered it (a skill, a session); the agent is named by its id.
        return mapped is DelegatedActor d && triggeredBy is not null ? d with { TriggeredBy = triggeredBy } : mapped;
    }
}
