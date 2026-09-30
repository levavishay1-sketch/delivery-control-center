using System.Collections.Concurrent;
using Npgsql;

namespace Dcc.Infrastructure.Persistence;

/// <summary>
/// "Every column of this table" as the old server's ORM returned a whole row:
/// each column under its camelCase name (<c>client_id as "clientId"</c>), a
/// Postgres enum cast to text. Read once from the database's own catalogue, so
/// a column a migration adds shows up without touching the code — exactly as it
/// did before. (All 468 columns of the old schema were checked to follow the
/// camelCase rule.) Binary columns are left out: a row never carried file bytes.
/// </summary>
public static class TableColumns
{
    private static readonly ConcurrentDictionary<string, IReadOnlyList<(string Column, string Udt, bool IsEnum)>> Cache = new();

    /// <summary>The select list for <paramref name="table"/>, optionally qualified by <paramref name="alias"/>.</summary>
    public static async Task<string> SelectAsync(DccDbContext db, string table, string? alias = null, CancellationToken ct = default)
    {
        var cols = await ColumnsAsync(db, table, ct);
        var p = alias is null ? "" : alias + ".";
        return string.Join(", ", cols.Select(c =>
        {
            var expr = c.IsEnum ? $"{p}{c.Column}::text" : $"{p}{c.Column}";
            var name = Camel(c.Column);
            return name == c.Column && !c.IsEnum ? expr : $"{expr} as \"{name}\"";
        }));
    }

    public static string Camel(string snake)
    {
        var parts = snake.Split('_');
        return parts[0] + string.Concat(parts.Skip(1).Select(s => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..]));
    }

    private static async Task<IReadOnlyList<(string Column, string Udt, bool IsEnum)>> ColumnsAsync(DccDbContext db, string table, CancellationToken ct)
    {
        if (Cache.TryGetValue(table, out var hit)) return hit;
        var rows = await SqlJson.QueryAsync(db, """
            select column_name as "c", udt_name as "u", data_type = 'USER-DEFINED' as "e"
            from information_schema.columns
            where table_schema = 'public' and table_name = @t and udt_name <> 'bytea'
            order by ordinal_position
            """, new { t = table }, ct);
        if (rows.Count == 0) throw new InvalidOperationException($"table {table} has no columns (does it exist?)");
        var list = rows.Select(r => (r["c"]!.GetValue<string>(), r["u"]!.GetValue<string>(), r["e"]!.GetValue<bool>())).ToList();
        Cache[table] = list;
        return list;
    }
}
