using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Dcc.Tests.Support;

/// <summary>
/// The whole API over a fresh database of its own (<c>dcc_test</c>), dropped and
/// recreated once per test run on the local Postgres. Settings reach the app as
/// environment variables, which Program.cs loads last — after the developer's
/// Server/.local settings — so the tests never touch the real <c>dcc</c> database.
/// </summary>
public sealed class DccFactory : WebApplicationFactory<Program>
{
    public const string TestDatabase = "dcc_test";

    public string OwnerConnectionString { get; }
    public string PolicyPath { get; }
    public string AdminEmail => "admin@dcc.local";
    public string AdminPassword { get; private set; } = "";

    private readonly string _tempDir = Path.Combine(Path.GetTempPath(), "dcc-tests-" + Guid.NewGuid().ToString("N"));

    public DccFactory()
    {
        var serverDir = FindServerDir();
        var local = Path.Combine(serverDir, ".local");
        var ownerCs = JsonNode.Parse(File.ReadAllText(Path.Combine(local, "appsettings.local.json")))!["ConnectionStrings"]!["Dcc"]!.GetValue<string>();
        OwnerConnectionString = new NpgsqlConnectionStringBuilder(ownerCs) { Database = TestDatabase, Pooling = false }.ConnectionString;

        RecreateDatabase(Infrastructure.Persistence.DatabaseBootstrapper.SuperuserConnectionFromFile(Path.Combine(local, "postgres-superuser.txt")));

        Directory.CreateDirectory(_tempDir);
        Environment.SetEnvironmentVariable("ConnectionStrings__Dcc", OwnerConnectionString);
        Environment.SetEnvironmentVariable("Auth__SigningKeyPath", Path.Combine(_tempDir, "jwt.pem"));
        Environment.SetEnvironmentVariable("Bootstrap__InitialAdminPasswordFile", Path.Combine(_tempDir, "initial-admin.txt"));
        Environment.SetEnvironmentVariable("Auth__WebSocket__AuthTimeoutSeconds", "2");
        Environment.SetEnvironmentVariable("Auth__WebSocket__CheckIntervalSeconds", "1");
        Environment.SetEnvironmentVariable("Auth__WebSocket__ReauthGraceSeconds", "2");
        // A copy of the routing policy: a test that saves it must never touch config/model-policy.json.
        PolicyPath = Path.Combine(_tempDir, "model-policy.json");
        File.Copy(Path.Combine(serverDir, "..", "config", "model-policy.json"), PolicyPath);
        Environment.SetEnvironmentVariable("ModelPolicy__Path", PolicyPath);
        Environment.SetEnvironmentVariable("Entra__TenantId", "");
        Environment.SetEnvironmentVariable("Entra__ClientId", "");
        Environment.SetEnvironmentVariable("Entra__ClientSecret", "");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        // Azure DevOps is answered by FakeAdo — the tests never reach the internet.
        builder.ConfigureServices(s => s.AddHttpClient(Dcc.Infrastructure.Ado.AdoClient.HttpClientName)
            .ConfigurePrimaryHttpMessageHandler(() => new FakeAdo()));
    }

    /// <summary>Starts the app (runs migrations and seeding) and reads the admin's one-time password.</summary>
    public async Task InitializeAsync()
    {
        _ = Server; // forces startup
        var file = await File.ReadAllLinesAsync(Path.Combine(_tempDir, "initial-admin.txt"));
        AdminPassword = file.First(l => l.StartsWith("password=")).Split('=', 2)[1];
    }

    // ── HTTP helpers ─────────────────────────────────────────────────

    public HttpClient Client(string? token = null)
    {
        var c = CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false, AllowAutoRedirect = false });
        if (token is not null) c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    public sealed record Session(string AccessToken, string RefreshCookie, JsonElement Body);

    public async Task<HttpResponseMessage> LoginRawAsync(string email, string password) =>
        await Client().PostAsJsonAsync("/auth/login", new { email, password });

    public async Task<Session> LoginAsync(string email, string password)
    {
        var res = await LoginRawAsync(email, password);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"login failed: {(int)res.StatusCode} {body}");
        return new Session(body.GetProperty("accessToken").GetString()!, RefreshCookieOf(res), body);
    }

    /// <summary>Signs in as the admin, changing the one-time password on the first call.</summary>
    public async Task<string> AdminTokenAsync()
    {
        var s = await LoginAsync(AdminEmail, AdminPassword);
        if (!s.Body.GetProperty("mustChangePassword").GetBoolean()) return s.AccessToken;
        var newPassword = "admin-" + Guid.NewGuid().ToString("N");
        var res = await Client(s.AccessToken).PostAsJsonAsync("/auth/change-password", new { currentPassword = AdminPassword, newPassword });
        res.EnsureSuccessStatusCode();
        AdminPassword = newPassword;
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
    }

    /// <summary>Creates a person with a password and signs them in past the first-sign-in password change.</summary>
    public async Task<(Guid Id, string Token, string Password)> NewUserAsync(string? kind = "person")
    {
        var admin = await AdminTokenAsync();
        var email = $"u{Guid.NewGuid():N}@test.local";
        var initial = "initial-" + Guid.NewGuid().ToString("N");
        var res = await Client(admin).PostAsJsonAsync("/users", new { email, displayName = "Test " + email[..6], kind, password = initial });
        res.EnsureSuccessStatusCode();
        var id = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var first = await LoginAsync(email, initial);
        var password = "chosen-" + Guid.NewGuid().ToString("N");
        var changed = await Client(first.AccessToken).PostAsJsonAsync("/auth/change-password", new { currentPassword = initial, newPassword = password });
        changed.EnsureSuccessStatusCode();
        var token = (await changed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        return (id, token, password);
    }

    public async Task<Guid> RoleIdAsync(string key)
    {
        var roles = await Client(await AdminTokenAsync()).GetFromJsonAsync<JsonElement>("/security-roles");
        return roles.EnumerateArray().First(r => r.GetProperty("key").GetString() == key).GetProperty("id").GetGuid();
    }

    public async Task<Guid> AssignAsync(string principalType, Guid principalId, string roleKey, string scopeType, Guid? scopeId)
    {
        var res = await Client(await AdminTokenAsync()).PostAsJsonAsync("/role-assignments",
            new { principalType, principalId, securityRoleId = await RoleIdAsync(roleKey), scopeType, scopeId });
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"assign failed: {body}");
        return body.GetProperty("id").GetGuid();
    }

    public static string RefreshCookieOf(HttpResponseMessage res) =>
        res.Headers.GetValues("Set-Cookie").First(c => c.StartsWith("dcc_refresh=")).Split(';')[0];

    // ── database helpers (as the owning role: RLS does not apply) ─────

    public async Task<Guid> NewClientAsync(string? name = null) =>
        await ScalarAsync<Guid>("insert into client(name) values (@n) returning id", ("n", name ?? "client-" + Guid.NewGuid().ToString("N")[..8]));

    public async Task<Guid> NewRequirementAsync(Guid clientId, Guid? parentId = null)
    {
        var owner = await ScalarAsync<Guid>("select id from users order by created_at limit 1");
        return await ScalarAsync<Guid>("insert into workitem(client_id, owner_id, title, parent_id) values (@c, @o, @t, @p) returning id",
            ("c", clientId), ("o", owner), ("t", "req " + Guid.NewGuid().ToString("N")[..6]), ("p", (object?)parentId ?? DBNull.Value));
    }

    public async Task<T> ScalarAsync<T>(string sql, params (string Name, object Value)[] args)
    {
        await using var conn = new NpgsqlConnection(OwnerConnectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, v);
        return (T)(await cmd.ExecuteScalarAsync())!;
    }

    public async Task ExecAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var conn = new NpgsqlConnection(OwnerConnectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, v);
        await cmd.ExecuteNonQueryAsync();
    }

    private static void RecreateDatabase(string superuser)
    {
        using var conn = new NpgsqlConnection(superuser);
        conn.Open();
        using (var drop = new NpgsqlCommand($"drop database if exists \"{TestDatabase}\" with (force)", conn)) drop.ExecuteNonQuery();
        using (var create = new NpgsqlCommand($"create database \"{TestDatabase}\" owner dcc_owner encoding 'UTF8'", conn)) create.ExecuteNonQuery();
    }

    private static string FindServerDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "DeliveryControlCenter.sln"))) dir = dir.Parent;
        return dir?.FullName ?? throw new DirectoryNotFoundException("Server/ (DeliveryControlCenter.sln) not found above the test binaries.");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try { Directory.Delete(_tempDir, recursive: true); } catch (IOException) { }
    }
}

/// <summary>All database tests share one app and one database, and run one at a time.</summary>
[CollectionDefinition(Name)]
public sealed class DbCollection : ICollectionFixture<DbFixture>
{
    public const string Name = "database";
}

public sealed class DbFixture : IAsyncLifetime
{
    public DccFactory Factory { get; } = new();

    public Task InitializeAsync() => Factory.InitializeAsync();

    public Task DisposeAsync()
    {
        Factory.Dispose();
        return Task.CompletedTask;
    }
}
