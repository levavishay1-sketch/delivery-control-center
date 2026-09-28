using System.Security.Cryptography;
using System.Text.Json;
using Npgsql;

namespace Dcc.Infrastructure.Persistence;

/// <summary>
/// One-time setup of a Postgres server for DCC, run as a superuser
/// (<c>dotnet run -- db-bootstrap</c>). Creates:
/// <list type="bullet">
/// <item><c>dcc_owner</c> — owns the schema; the API connects as this role. Never a superuser.</item>
/// <item><c>dcc_app</c> — NOSUPERUSER NOBYPASSRLS, never logs in. TenantScope switches to it so RLS is enforced.</item>
/// <item>the <c>dcc</c> database, owned by dcc_owner.</item>
/// </list>
/// The owner's password is random and is written, with the connection string,
/// to Server/.local/appsettings.local.json — outside git, never printed.
/// </summary>
public static class DatabaseBootstrapper
{
    public static async Task RunAsync(string superuserConnectionString, string localDir, string database = "dcc", CancellationToken ct = default)
    {
        var ownerPassword = RandomSecret(32);

        await using (var conn = new NpgsqlConnection(superuserConnectionString))
        {
            await conn.OpenAsync(ct);
            // CREATE/ALTER ROLE take no bind parameters; format(%L) quotes the literal on the server side.
            await Exec(conn, """
                do $$
                begin
                  if not exists (select 1 from pg_roles where rolname = 'dcc_owner') then
                    execute format('create role dcc_owner login password %L nosuperuser nobypassrls nocreatedb nocreaterole', current_setting('dcc.owner_password'));
                  else
                    execute format('alter role dcc_owner login password %L nosuperuser nobypassrls', current_setting('dcc.owner_password'));
                  end if;
                  if not exists (select 1 from pg_roles where rolname = 'dcc_app') then
                    create role dcc_app nologin nosuperuser nobypassrls nocreatedb nocreaterole;
                  end if;
                end $$;
                """, ct, ("dcc.owner_password", ownerPassword));
            await Exec(conn, "grant dcc_app to dcc_owner", ct);

            await using var check = new NpgsqlCommand("select 1 from pg_database where datname = @d", conn);
            check.Parameters.AddWithValue("d", database);
            if (await check.ExecuteScalarAsync(ct) is null)
                await Exec(conn, $"create database \"{database}\" owner dcc_owner encoding 'UTF8'", ct);
        }

        var csb = new NpgsqlConnectionStringBuilder(superuserConnectionString)
        {
            Database = database,
            Username = "dcc_owner",
            Password = ownerPassword,
        };
        Directory.CreateDirectory(localDir);
        var settings = new { ConnectionStrings = new { Dcc = csb.ConnectionString } };
        await File.WriteAllTextAsync(Path.Combine(localDir, "appsettings.local.json"),
            JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }), ct);
    }

    /// <summary>A superuser connection string from Server/.local/postgres-superuser.txt (written when Postgres was installed).</summary>
    public static string SuperuserConnectionFromFile(string path)
    {
        var kv = File.ReadAllLines(path)
            .Select(l => l.Split('=', 2))
            .Where(p => p.Length == 2)
            .ToDictionary(p => p[0].Trim(), p => p[1].Trim());
        return new NpgsqlConnectionStringBuilder
        {
            Host = "localhost",
            Port = int.Parse(kv.GetValueOrDefault("port", "5432")),
            Username = kv.GetValueOrDefault("user", "postgres"),
            Password = kv["password"],
            Database = "postgres",
        }.ConnectionString;
    }

    public static string RandomSecret(int length)
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
        return RandomNumberGenerator.GetString(alphabet, length);
    }

    private static async Task Exec(NpgsqlConnection conn, string sql, CancellationToken ct, params (string Name, string Value)[] settings)
    {
        foreach (var (name, value) in settings)
        {
            await using var set = new NpgsqlCommand("select set_config(@n, @v, false)", conn);
            set.Parameters.AddWithValue("n", name);
            set.Parameters.AddWithValue("v", value);
            await set.ExecuteNonQueryAsync(ct);
        }
        await using var cmd = new NpgsqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync(ct);
        foreach (var (name, _) in settings)
        {
            await using var reset = new NpgsqlCommand("select set_config(@n, '', false)", conn);
            reset.Parameters.AddWithValue("n", name);
            await reset.ExecuteNonQueryAsync(ct);
        }
    }
}
