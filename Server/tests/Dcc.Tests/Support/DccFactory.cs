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
    /// <summary>
    /// The database the tests drop and recreate — never <c>dcc</c>. <c>DCC_TEST_DATABASE</c> may name another one that
    /// starts with <c>dcc_test</c>, so two test runs (two people, two agents) never recreate each other's database mid-run.
    /// </summary>
    public static readonly string TestDatabase =
        Environment.GetEnvironmentVariable("DCC_TEST_DATABASE") is { Length: > 0 } named && System.Text.RegularExpressions.Regex.IsMatch(named, "^dcc_test[a-z0-9_]*$")
            ? named : "dcc_test";

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
        // Claude is a stand-in script: a test never calls the real CLI (or spends anything). DCC_CLAUDE_BIN wins
        // over the settings, so it is set here too — a developer's own DCC_CLAUDE_BIN must not leak in.
        FakeClaudePath = Path.Combine(_tempDir, "fake-claude.cjs");
        File.WriteAllText(FakeClaudePath, FakeClaude.Script);
        Environment.SetEnvironmentVariable("DCC_CLAUDE_BIN", "node");
        Environment.SetEnvironmentVariable("Claude__BinArgs__0", FakeClaudePath);
        // GitHub is a stand-in script too: a test never reaches a real host or the operator's own gh login.
        File.WriteAllText(Path.Combine(_tempDir, "fake-gh.cjs"), FakeGh.Script);
        Environment.SetEnvironmentVariable("DCC_GH_BIN", "node");
        Environment.SetEnvironmentVariable("GitHub__BinArgs__0", Path.Combine(_tempDir, "fake-gh.cjs"));
        RepoCachePath = Path.Combine(_tempDir, "repos");
        Environment.SetEnvironmentVariable("Repos__CachePath", RepoCachePath);
        Environment.SetEnvironmentVariable("Repos__VerifyPath", Path.Combine(_tempDir, "verify"));
        Environment.SetEnvironmentVariable("Onboarding__WorkspaceRoot", Path.Combine(_tempDir, "onboarding"));
        Environment.SetEnvironmentVariable("Onboarding__CoachRecheck", "false");
        Environment.SetEnvironmentVariable("Chat__Dir", Path.Combine(_tempDir, "chat"));
    }

    public string FakeClaudePath { get; }

    /// <summary>What the stand-in claude answers to a read-only call (null = its default).</summary>
    public string? FakeReply
    {
        set
        {
            var file = Path.Combine(_tempDir, "reply.txt");
            if (value is null) File.Delete(file); else File.WriteAllText(file, value);
        }
    }

    /// <summary>Every call the stand-in received, oldest first: its arguments and its prompt.</summary>
    public List<JsonElement> FakeCalls()
    {
        var file = Path.Combine(_tempDir, "calls.log");
        return File.Exists(file) ? File.ReadAllLines(file).Select(l => JsonDocument.Parse(l).RootElement.Clone()).ToList() : [];
    }

    /// <summary>What the stand-in gh answers: the first rule whose regex matches the joined arguments. <c>Out</c> may be text or any object (sent as JSON).</summary>
    public void GhRules(params (string Match, object? Out, int Code, string? Err)[] rules) =>
        File.WriteAllText(Path.Combine(_tempDir, "gh-rules.json"), JsonSerializer.Serialize(rules.Select(r => new { match = r.Match, @out = r.Out, code = r.Code, err = r.Err })));

    /// <summary>Every call the stand-in gh received, oldest first: its arguments.</summary>
    public List<string[]> GhCalls()
    {
        var file = Path.Combine(_tempDir, "gh-calls.log");
        return File.Exists(file) ? File.ReadAllLines(file).Select(l => JsonSerializer.Deserialize<string[]>(l)!).ToList() : [];
    }

    /// <summary>A bare repository with one commit on main — the "remote" DCC clones from and pushes to — as a file:// address.</summary>
    public async Task<string> NewOriginAsync()
    {
        var root = Path.Combine(_tempDir, "origins", Guid.NewGuid().ToString("N")[..8]);
        var bare = Path.Combine(root, "origin.git");
        var work = Path.Combine(root, "work");
        Directory.CreateDirectory(bare);
        Directory.CreateDirectory(work);
        await Dcc.Infrastructure.Repos.Git.RunAsync(bare, "init", "--bare", "-b", "main");
        await Dcc.Infrastructure.Repos.Git.RunAsync(work, "init", "-b", "main");
        await File.WriteAllTextAsync(Path.Combine(work, "README.md"), "# shop\n");
        await Dcc.Infrastructure.Repos.Git.RunAsync(work, "add", "-A");
        await Dcc.Infrastructure.Repos.Git.RunAsync(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "first");
        await Dcc.Infrastructure.Repos.Git.RunAsync(work, "push", bare, "main");
        return "file:///" + bare.Replace('\\', '/');
    }

    /// <summary>A bare repository whose one commit on main holds exactly these files (path → text), as a file:// address.</summary>
    public async Task<string> NewOriginAsync(IReadOnlyDictionary<string, string> files)
    {
        var root = Path.Combine(_tempDir, "origins", Guid.NewGuid().ToString("N")[..8]);
        var bare = Path.Combine(root, "origin.git");
        var work = Path.Combine(root, "work");
        Directory.CreateDirectory(bare);
        Directory.CreateDirectory(work);
        await Dcc.Infrastructure.Repos.Git.RunAsync(bare, "init", "--bare", "-b", "main");
        await Dcc.Infrastructure.Repos.Git.RunAsync(work, "init", "-b", "main");
        foreach (var (path, text) in files)
        {
            var full = Path.Combine(work, path);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            await File.WriteAllTextAsync(full, text);
        }
        await Dcc.Infrastructure.Repos.Git.RunAsync(work, "add", "-A");
        await Dcc.Infrastructure.Repos.Git.RunAsync(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "base");
        await Dcc.Infrastructure.Repos.Git.RunAsync(work, "push", bare, "main");
        return "file:///" + bare.Replace('\\', '/');
    }

    /// <summary>
    /// The old prove kit's repository: <c>base.txt</c> and a real npm package whose build fails while <c>broken.txt</c> is in
    /// the tree — so a task's build check is a real <c>npm run build</c> that DCC runs itself (npm must be on PATH).
    /// </summary>
    public Task<string> NewPackageOriginAsync() => NewOriginAsync(new Dictionary<string, string>
    {
        ["base.txt"] = "base\n",
        ["package.json"] = """
            {
              "name": "prove-repo",
              "private": true,
              "scripts": {
                "build": "node -e \"process.exit(require('fs').existsSync('broken.txt') ? 1 : 0)\""
              }
            }

            """,
    });

    /// <summary>DCC's own clone of a repository (the cache every task run works in), whether or not it was cloned yet.</summary>
    public string CloneOf(Guid repoId) => Path.Combine(RepoCachePath, repoId.ToString());

    public async Task<Guid> LinkRepoAsync(Guid clientId, Guid reqId, string url)
    {
        var repoId = await ScalarAsync<Guid>("insert into repo(name, ado_repo_ref) values (@n, @u) returning id", ("n", "shop-" + Guid.NewGuid().ToString("N")[..6]), ("u", url));
        await ExecAsync("insert into workitem_repo(client_id, workitem_id, repo_id, link_kind) values (@c, @w, @r, 'declared')", ("c", clientId), ("w", reqId), ("r", repoId));
        return repoId;
    }
    public string RepoCachePath { get; }
    public string TempDir => _tempDir;

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
        if (dir is not null) return dir.FullName;
        // Built elsewhere (dotnet test --artifacts-path, while a dev server holds the usual bin folder): from this source file.
        var fromSource = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(ThisFile())!, "..", "..", ".."));
        return File.Exists(Path.Combine(fromSource, "DeliveryControlCenter.sln"))
            ? fromSource
            : throw new DirectoryNotFoundException("Server/ (DeliveryControlCenter.sln) not found above the test binaries.");
    }

    private static string ThisFile([System.Runtime.CompilerServices.CallerFilePath] string path = "") => path;

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try { Dcc.Infrastructure.Repos.RepoCheckouts.ForceDelete(_tempDir); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
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
