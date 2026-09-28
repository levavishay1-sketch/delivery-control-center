using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dcc.Infrastructure.Persistence;

/// <summary>
/// Applies the numbered SQL files in Server/db/migrations in order, once each,
/// then re-asserts Server/db/guards.sql (idempotent) every time.
///
/// Works exactly as the old server's setup did, on purpose: a file is split on
/// the <c>--&gt; statement-breakpoint</c> marker and each piece runs as is. The
/// files use dollar-quoted <c>$tag$</c> bodies, which a general-purpose runner
/// with variable substitution would mangle. What ran is recorded in
/// <c>_dcc_migrations</c>, and each file runs in its own transaction.
/// </summary>
public sealed class DatabaseMigrator(string connectionString, string dbDirectory, ILogger logger)
{
    private const string Breakpoint = "--> statement-breakpoint";

    public async Task<int> MigrateAsync(CancellationToken ct = default)
    {
        var migrationsDir = Path.Combine(dbDirectory, "migrations");
        var guardsPath = Path.Combine(dbDirectory, "guards.sql");
        if (!Directory.Exists(migrationsDir)) throw new DirectoryNotFoundException($"migrations not found at {migrationsDir}");

        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync(ct);
        await Exec(conn, null, "create table if not exists _dcc_migrations (name text primary key, applied_at timestamptz not null default now())", ct);

        var applied = new HashSet<string>();
        await using (var cmd = new NpgsqlCommand("select name from _dcc_migrations", conn))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
            while (await r.ReadAsync(ct)) applied.Add(r.GetString(0));

        var count = 0;
        foreach (var file in Directory.GetFiles(migrationsDir, "*.sql").OrderBy(Path.GetFileName, StringComparer.Ordinal))
        {
            var name = Path.GetFileName(file);
            if (applied.Contains(name)) continue;

            var statements = Split(await File.ReadAllTextAsync(file, ct));
            await using var tx = await conn.BeginTransactionAsync(ct);
            foreach (var stmt in statements) await Exec(conn, tx, stmt, ct);
            await using (var rec = new NpgsqlCommand("insert into _dcc_migrations(name) values (@n)", conn, tx))
            {
                rec.Parameters.AddWithValue("n", name);
                await rec.ExecuteNonQueryAsync(ct);
            }
            await tx.CommitAsync(ct);
            logger.LogInformation("applied {Migration} ({Count} statements)", name, statements.Count);
            count++;
        }

        await Exec(conn, null, await File.ReadAllTextAsync(guardsPath, ct), ct);
        logger.LogInformation("guards.sql re-asserted ({Applied} new migrations)", count);
        return count;
    }

    private static List<string> Split(string sql) =>
        sql.Split(Breakpoint).Select(s => s.Trim()).Where(s => s.Length > 0 && !IsOnlyComments(s)).ToList();

    private static bool IsOnlyComments(string s) =>
        s.Split('\n').All(l => l.TrimStart().Length == 0 || l.TrimStart().StartsWith("--", StringComparison.Ordinal));

    private static async Task Exec(NpgsqlConnection conn, NpgsqlTransaction? tx, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, conn, tx);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
