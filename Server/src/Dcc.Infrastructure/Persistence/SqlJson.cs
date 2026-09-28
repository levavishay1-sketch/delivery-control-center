using System.Collections;
using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace Dcc.Infrastructure.Persistence;

/// <summary>
/// Runs SQL and returns each row as a JSON object — the way the old server's
/// driver (node-postgres) handed rows to the web client, so a rewritten
/// endpoint answers with the same JSON the client already reads:
/// <list type="bullet">
/// <item>keys are the column aliases, exactly as written (<c>as "adoRepoRef"</c>);</item>
/// <item><c>numeric</c> and <c>bigint</c> come back as strings (node-postgres did not
/// turn them into numbers — cast to <c>::int</c> / <c>::float</c> in SQL for a number);</item>
/// <item>timestamps are ISO strings in UTC with milliseconds, <c>json</c>/<c>jsonb</c> is
/// JSON, arrays are arrays;</item>
/// <item>a Postgres enum column must be cast to <c>::text</c> in the SQL.</item>
/// </list>
/// Inside a <see cref="TenantScope"/> it runs on the scope's transaction, so RLS applies.
/// </summary>
public static class SqlJson
{
    public static async Task<List<JsonObject>> QueryAsync(DccDbContext db, string sql, object? args = null, CancellationToken ct = default)
    {
        await using var cmd = await CommandAsync(db, sql, args, ct);
        var rows = new List<JsonObject>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) rows.Add(Row(r));
        return rows;
    }

    public static async Task<JsonObject?> QuerySingleAsync(DccDbContext db, string sql, object? args = null, CancellationToken ct = default) =>
        (await QueryAsync(db, sql, args, ct)).FirstOrDefault();

    public static async Task<int> ExecuteAsync(DccDbContext db, string sql, object? args = null, CancellationToken ct = default)
    {
        await using var cmd = await CommandAsync(db, sql, args, ct);
        return await cmd.ExecuteNonQueryAsync(ct);
    }

    public static async Task<T?> ScalarAsync<T>(DccDbContext db, string sql, object? args = null, CancellationToken ct = default)
    {
        await using var cmd = await CommandAsync(db, sql, args, ct);
        var v = await cmd.ExecuteScalarAsync(ct);
        return v is null or DBNull ? default : (T)Convert.ChangeType(v, Nullable.GetUnderlyingType(typeof(T)) ?? typeof(T), CultureInfo.InvariantCulture);
    }

    /// <summary>A JSON value for a jsonb parameter: <c>new { config = SqlJson.Jsonb(obj) }</c>.</summary>
    public static JsonbValue Jsonb(object? value) => new(JsonSerializer.Serialize(value, JsonSerializerOptions.Web));

    public sealed record JsonbValue(string Json);

    private static async Task<NpgsqlCommand> CommandAsync(DccDbContext db, string sql, object? args, CancellationToken ct)
    {
        var conn = (NpgsqlConnection)db.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await db.Database.OpenConnectionAsync(ct);
        var cmd = new NpgsqlCommand(sql, conn, (NpgsqlTransaction?)db.Database.CurrentTransaction?.GetDbTransaction());
        if (args is null) return cmd;
        var pairs = args is IDictionary<string, object?> d
            ? d.Select(kv => (kv.Key, kv.Value))
            : args.GetType().GetProperties().Select(p => (p.Name, p.GetValue(args)));
        foreach (var (name, value) in pairs)
        {
            cmd.Parameters.Add(value switch
            {
                JsonbValue j => new NpgsqlParameter(name, NpgsqlDbType.Jsonb) { Value = j.Json },
                null => new NpgsqlParameter(name, DBNull.Value),
                _ => new NpgsqlParameter(name, value),
            });
        }
        return cmd;
    }

    private static JsonObject Row(DbDataReader r)
    {
        var o = new JsonObject();
        for (var i = 0; i < r.FieldCount; i++)
            o[r.GetName(i)] = r.IsDBNull(i) ? null : Value(r, i);
        return o;
    }

    private static JsonNode? Value(DbDataReader r, int i)
    {
        var type = r.GetDataTypeName(i);
        if (type is "json" or "jsonb") return JsonNode.Parse(r.GetString(i));
        var v = r.GetValue(i);
        return v switch
        {
            string s => s,
            bool b => b,
            int n => n,
            short n => n,
            long n => n.ToString(CultureInfo.InvariantCulture),       // int8: a string, as node-postgres gave it
            decimal m => m.ToString(CultureInfo.InvariantCulture),    // numeric: a string, as node-postgres gave it
            double d => d,
            float f => f,
            Guid g => g.ToString(),
            DateTime dt => Iso(dt),
            DateTimeOffset dto => Iso(dto.UtcDateTime),
            DateOnly day => day.ToString("yyyy-MM-dd'T'00:00:00.000'Z'", CultureInfo.InvariantCulture),
            IEnumerable e when v is not string => new JsonArray(e.Cast<object?>().Select(x => x switch
            {
                null => null,
                string s => (JsonNode?)s,
                Guid g => g.ToString(),
                int n => n,
                _ => JsonValue.Create(x.ToString()),
            }).ToArray()),
            _ => JsonValue.Create(v.ToString()),
        };
    }

    private static string Iso(DateTime dt) =>
        DateTime.SpecifyKind(dt.Kind == DateTimeKind.Local ? dt.ToUniversalTime() : dt, DateTimeKind.Utc)
            .ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
