using System.Text.Json;
using System.Text.Json.Nodes;

namespace Dcc.Domain.Events;

public sealed record EventLink(string Rel, string Ref)
{
    public static readonly IReadOnlySet<string> Rels = new HashSet<string>
    {
        "supersedes", "pull_request", "ado_workitem", "gap", "task", "blocker", "commit", "session", "thread",
        // a row of the claude_call ledger — the event carries no cost, the row does
        "claude_call",
    };
}

public static class EventSources
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>
    {
        "email", "slack", "phone", "meeting", "claude_session", "git", "ado", "manual", "system",
    };
}

/// <summary>An event about to be appended. <c>Payload</c> is validated per type before it is written.</summary>
public sealed record NewEvent
{
    public required Guid ClientId { get; init; }

    /// <summary>null ⇒ lands in the unassigned bucket.</summary>
    public Guid? WorkitemId { get; init; }

    public DateTimeOffset? OccurredAt { get; init; }
    public required string Source { get; init; }
    public required string Type { get; init; }
    public required EventActor Actor { get; init; }
    public required JsonElement Payload { get; init; }
    public Guid? Supersedes { get; init; }
    public IReadOnlyList<EventLink> Links { get; init; } = [];
    public int? SchemaVersion { get; init; }
}

/// <summary>A row of the event log as read back.</summary>
public sealed record StoredEvent(
    Guid Id,
    Guid ClientId,
    Guid? WorkitemId,
    DateTimeOffset OccurredAt,
    DateTimeOffset RecordedAt,
    string Source,
    string Type,
    int SchemaVersion,
    JsonNode Actor,
    JsonNode Payload,
    Guid? Supersedes,
    JsonNode Links);

/// <summary>
/// The ONE way to write an event (architecture decision 01). Every caller
/// depends on this interface, never on a table — so where the log is kept is
/// chosen in exactly one place: <c>AddEventLog()</c> in Dcc.Infrastructure.
/// Validation is a separate layer wrapped around whichever store is chosen,
/// so it survives a change of store.
/// </summary>
public interface IEventLogWriter
{
    Task<StoredEvent> AppendAsync(NewEvent e, CancellationToken ct = default);
}

public interface IEventLogReader
{
    /// <summary>A WorkItem's timeline, newest first. Superseded rows are included — history as it was.</summary>
    Task<IReadOnlyList<StoredEvent>> TimelineAsync(Guid clientId, Guid workitemId, int limit = 200, CancellationToken ct = default);

    /// <summary>Events with no WorkItem yet — the unassigned inbox.</summary>
    Task<IReadOnlyList<StoredEvent>> UnassignedAsync(Guid clientId, int limit = 100, CancellationToken ct = default);
}

public sealed class EventValidationException(string message) : Exception(message);
