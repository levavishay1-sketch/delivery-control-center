using System.Data.Common;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace Dcc.Infrastructure.Events;

/// <summary>
/// The event log kept in Postgres (<c>event_log</c>), behind the tenant wall.
/// Expects an already-validated event: validation is <see cref="ValidatingEventLogWriter"/>,
/// wrapped around this in <see cref="EventLogRegistration.AddEventLog"/>.
/// Append-only is also enforced in the database (guards.sql).
/// </summary>
public sealed class PostgresEventLogWriter(ITenantScope tenant) : IEventLogWriter
{
    public Task<StoredEvent> AppendAsync(NewEvent e, CancellationToken ct = default) =>
        tenant.RunAsync(e.ClientId, async db =>
        {
            await using var cmd = Command(db, """
                insert into event_log (client_id, workitem_id, occurred_at, source, type, schema_version, actor, payload, supersedes, links)
                values (@client, @workitem, @occurred, @source::event_source, @type, @version, @actor, @payload, @supersedes, @links)
                returning id, client_id, workitem_id, occurred_at, recorded_at, source::text, type, schema_version, actor, payload, supersedes, links
                """);
            cmd.Parameters.AddWithValue("client", e.ClientId);
            cmd.Parameters.AddWithValue("workitem", (object?)e.WorkitemId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("occurred", e.OccurredAt ?? DateTimeOffset.UtcNow);
            cmd.Parameters.AddWithValue("source", e.Source);
            cmd.Parameters.AddWithValue("type", e.Type);
            cmd.Parameters.AddWithValue("version", e.SchemaVersion ?? EventPayloads.CurrentVersion);
            cmd.Parameters.Add(new NpgsqlParameter("actor", NpgsqlDbType.Jsonb) { Value = JsonSerializer.Serialize(e.Actor, EventJson.Options) });
            cmd.Parameters.Add(new NpgsqlParameter("payload", NpgsqlDbType.Jsonb) { Value = e.Payload.GetRawText() });
            cmd.Parameters.AddWithValue("supersedes", (object?)e.Supersedes ?? DBNull.Value);
            cmd.Parameters.Add(new NpgsqlParameter("links", NpgsqlDbType.Jsonb) { Value = JsonSerializer.Serialize(e.Links, EventJson.Options) });
            await using var r = await cmd.ExecuteReaderAsync(ct);
            await r.ReadAsync(ct);
            return EventJson.Read(r);
        }, ct);

    internal static NpgsqlCommand Command(DccDbContext db, string sql) =>
        new(sql, (NpgsqlConnection)db.Database.GetDbConnection(), (NpgsqlTransaction?)db.Database.CurrentTransaction?.GetDbTransaction());
}

public sealed class PostgresEventLogReader(ITenantScope tenant) : IEventLogReader
{
    private const string Columns = "id, client_id, workitem_id, occurred_at, recorded_at, source::text, type, schema_version, actor, payload, supersedes, links";

    public Task<IReadOnlyList<StoredEvent>> TimelineAsync(Guid clientId, Guid workitemId, int limit = 200, CancellationToken ct = default) =>
        Query(clientId, $"select {Columns} from event_log where workitem_id = @w order by occurred_at desc limit @limit",
            c => { c.Parameters.AddWithValue("w", workitemId); c.Parameters.AddWithValue("limit", limit); }, ct);

    public Task<IReadOnlyList<StoredEvent>> UnassignedAsync(Guid clientId, int limit = 100, CancellationToken ct = default) =>
        Query(clientId, $"select {Columns} from event_log where workitem_id is null order by recorded_at desc limit @limit",
            c => c.Parameters.AddWithValue("limit", limit), ct);

    private Task<IReadOnlyList<StoredEvent>> Query(Guid clientId, string sql, Action<NpgsqlCommand> bind, CancellationToken ct) =>
        tenant.RunAsync<IReadOnlyList<StoredEvent>>(clientId, async db =>
        {
            await using var cmd = PostgresEventLogWriter.Command(db, sql);
            bind(cmd);
            var list = new List<StoredEvent>();
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) list.Add(EventJson.Read(r));
            return list;
        }, ct);
}

internal static class EventJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public static StoredEvent Read(DbDataReader r) => new(
        r.GetGuid(0),
        r.GetGuid(1),
        r.IsDBNull(2) ? null : r.GetGuid(2),
        r.GetFieldValue<DateTimeOffset>(3),
        r.GetFieldValue<DateTimeOffset>(4),
        r.GetString(5),
        r.GetString(6),
        r.GetInt32(7),
        JsonNode.Parse(r.GetString(8))!,
        JsonNode.Parse(r.GetString(9))!,
        r.IsDBNull(10) ? null : r.GetGuid(10),
        JsonNode.Parse(r.GetString(11))!);
}
