using System.Text.Json;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Events;

namespace Dcc.Tests.Unit;

/// <summary>
/// The validation layer, over a store that only remembers what it was given —
/// which is also the proof that the store is swappable: nothing here touches
/// Postgres, and the validation behaves the same.
/// </summary>
public sealed class EventLogValidationTests
{
    private sealed class MemoryStore : IEventLogWriter
    {
        public List<NewEvent> Written { get; } = [];

        public Task<StoredEvent> AppendAsync(NewEvent e, CancellationToken ct = default)
        {
            Written.Add(e);
            return Task.FromResult(new StoredEvent(Guid.NewGuid(), e.ClientId, e.WorkitemId, e.OccurredAt!.Value, DateTimeOffset.UtcNow, e.Source, e.Type,
                e.SchemaVersion!.Value, JsonSerializer.SerializeToNode(e.Actor)!, JsonSerializer.SerializeToNode(e.Payload)!, e.Supersedes, JsonSerializer.SerializeToNode(e.Links)!));
        }
    }

    private static NewEvent Note(object payload, EventActor? actor = null, string type = "note.added") => new()
    {
        ClientId = Guid.NewGuid(),
        Source = "manual",
        Type = type,
        Actor = actor ?? new UserActor(Guid.NewGuid()),
        Payload = JsonSerializer.SerializeToElement(payload),
    };

    [Fact]
    public async Task A_valid_event_reaches_the_store_normalized()
    {
        var store = new MemoryStore();
        await new ValidatingEventLogWriter(store).AppendAsync(Note(new { body = "hello", junk = 1 }));
        var written = Assert.Single(store.Written);
        Assert.Equal("hello", written.Payload.GetProperty("body").GetString());
        Assert.False(written.Payload.TryGetProperty("junk", out _)); // unknown fields dropped
        Assert.Equal(1, written.SchemaVersion);
        Assert.NotNull(written.OccurredAt);
    }

    [Fact]
    public async Task Defaults_are_filled_in()
    {
        var store = new MemoryStore();
        await new ValidatingEventLogWriter(store).AppendAsync(Note(new { from = "a", to = "b" }, type: "status.changed"));
        Assert.False(store.Written[0].Payload.GetProperty("viaAdo").GetBoolean());
    }

    [Fact]
    public async Task An_unknown_type_is_rejected() =>
        await Assert.ThrowsAsync<EventValidationException>(() => new ValidatingEventLogWriter(new MemoryStore()).AppendAsync(Note(new { body = "x" }, type: "made.up")));

    [Fact]
    public async Task A_malformed_payload_is_rejected() =>
        await Assert.ThrowsAsync<EventValidationException>(() => new ValidatingEventLogWriter(new MemoryStore()).AppendAsync(Note(new { body = 42 })));

    [Fact]
    public async Task A_system_actor_may_not_author_reasoning() =>
        await Assert.ThrowsAsync<EventValidationException>(() => new ValidatingEventLogWriter(new MemoryStore())
            .AppendAsync(Note(new { description = "d", blocking = false, confidence = 0.5 }, new SystemActor("sync"), "gap.proposed")));

    [Fact]
    public void The_actor_is_stored_in_the_old_servers_shape()
    {
        var id = Guid.NewGuid();
        var json = JsonSerializer.Serialize<EventActor>(new UserActor(id), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal($"{{\"kind\":\"user\",\"userId\":\"{id}\",\"identityType\":\"interactive\"}}", json);
    }
}
