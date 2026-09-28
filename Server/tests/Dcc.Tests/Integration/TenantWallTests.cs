using System.Text.Json;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Persistence;
using Dcc.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Dcc.Tests.Integration;

/// <summary>
/// The old server's <c>dev:prove</c> checks, against the C# server's own
/// database path: the RLS wall between clients (decision 03), the append-only
/// event log (decision 01) and its validation.
/// </summary>
[Collection(DbCollection.Name)]
public sealed class TenantWallTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private async Task<StoredEvent> AppendNoteAsync(Guid clientId, string body, Guid? supersedes = null)
    {
        using var scope = _f.Services.CreateScope();
        var writer = scope.ServiceProvider.GetRequiredService<IEventLogWriter>();
        var userId = await _f.ScalarAsync<Guid>("select id from users order by created_at limit 1");
        return await writer.AppendAsync(new NewEvent
        {
            ClientId = clientId, Source = "manual", Type = "note.added", Actor = new UserActor(userId),
            Payload = JsonSerializer.SerializeToElement(new { body }), Supersedes = supersedes,
        });
    }

    private async Task<long> CountEventsAsSeenBy(Guid tenant, Guid ofClient)
    {
        using var scope = _f.Services.CreateScope();
        var t = scope.ServiceProvider.GetRequiredService<ITenantScope>();
        return await t.RunAsync(tenant, db => db.Database.SqlQuery<long>($"select count(*) as \"Value\" from event_log where client_id = {ofClient}").SingleAsync());
    }

    [Fact]
    public async Task A_tenant_sees_its_own_events_and_never_another_tenants()
    {
        var a = await _f.NewClientAsync();
        var b = await _f.NewClientAsync();
        await AppendNoteAsync(a, "for A");

        Assert.Equal(1, await CountEventsAsSeenBy(a, a));
        Assert.Equal(0, await CountEventsAsSeenBy(b, a));
    }

    [Fact]
    public async Task A_tenant_cannot_write_events_for_another_tenant()
    {
        var a = await _f.NewClientAsync();
        var b = await _f.NewClientAsync();
        using var scope = _f.Services.CreateScope();
        var t = scope.ServiceProvider.GetRequiredService<ITenantScope>();
        var ex = await Assert.ThrowsAnyAsync<Exception>(() => t.RunAsync(b, db => db.Database.ExecuteSqlAsync(
            $"insert into event_log(client_id, occurred_at, source, type, actor, payload) values ({a}, now(), 'manual', 'note.added', '{{}}'::jsonb, '{{}}'::jsonb)")));
        Assert.Contains("row-level security", ex.ToString());
    }

    [Fact]
    public async Task The_event_log_refuses_update_and_delete_and_keeps_history()
    {
        var a = await _f.NewClientAsync();
        var e = await AppendNoteAsync(a, "original");
        var upd = await Assert.ThrowsAsync<PostgresException>(() => _f.ExecAsync("update event_log set type = 'x' where id = @id", ("id", e.Id)));
        Assert.Contains("append-only", upd.MessageText);
        var del = await Assert.ThrowsAsync<PostgresException>(() => _f.ExecAsync("delete from event_log where id = @id", ("id", e.Id)));
        Assert.Contains("append-only", del.MessageText);
        Assert.Equal(1L, await _f.ScalarAsync<long>("select count(*) from event_log where id = @id", ("id", e.Id)));
    }

    [Fact]
    public async Task A_correction_is_a_new_row_and_the_original_stays()
    {
        var a = await _f.NewClientAsync();
        var original = await AppendNoteAsync(a, "wrong");
        var fix = await AppendNoteAsync(a, "right", supersedes: original.Id);
        Assert.Equal(original.Id, fix.Supersedes);
        Assert.Equal(2, await CountEventsAsSeenBy(a, a));
    }

    [Fact]
    public async Task An_unknown_type_and_a_malformed_payload_are_rejected_before_the_database()
    {
        var a = await _f.NewClientAsync();
        using var scope = _f.Services.CreateScope();
        var writer = scope.ServiceProvider.GetRequiredService<IEventLogWriter>();
        var actor = new UserActor(Guid.NewGuid());
        await Assert.ThrowsAsync<EventValidationException>(() => writer.AppendAsync(new NewEvent
            { ClientId = a, Source = "manual", Type = "no.such", Actor = actor, Payload = JsonSerializer.SerializeToElement(new { }) }));
        await Assert.ThrowsAsync<EventValidationException>(() => writer.AppendAsync(new NewEvent
            { ClientId = a, Source = "manual", Type = "note.added", Actor = actor, Payload = JsonSerializer.SerializeToElement(new { body = 1 }) }));
        Assert.Equal(0, await CountEventsAsSeenBy(a, a));
    }

    [Fact]
    public async Task The_audit_log_is_append_only()
    {
        await _f.AdminTokenAsync();
        var id = await _f.ScalarAsync<Guid>("select id from audit_log limit 1");
        var ex = await Assert.ThrowsAsync<PostgresException>(() => _f.ExecAsync("delete from audit_log where id = @id", ("id", id)));
        Assert.Contains("append-only", ex.MessageText);
    }
}
