using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Tests.Support;

namespace Dcc.Tests.Integration;

/// <summary>Phase 4.1: clients, repositories, Azure DevOps connections, prompts, the model policy, the glossary.</summary>
[Collection(DbCollection.Name)]
public sealed class ClientsAndLibraryTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<JsonElement> Json(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        return body;
    }

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await Json(res);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    private async Task<HttpClient> Admin() => _f.Client(await _f.AdminTokenAsync());

    /// <summary>A signed-in user holding one role on one client.</summary>
    private async Task<(Guid Id, HttpClient Client)> UserWith(string roleKey, Guid clientId)
    {
        var (id, _, password) = await _f.NewUserAsync();
        await _f.AssignAsync("user", id, roleKey, "client", clientId);
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", id));
        return (id, _f.Client((await _f.LoginAsync(email, password)).AccessToken));
    }

    // ── glossary ─────────────────────────────────────────────────────

    [Fact]
    public async Task The_glossary_is_open_without_signing_in_so_the_login_screen_has_its_i()
    {
        var body = await Ok(await _f.Client().GetAsync("/claude/glossary"));
        var concepts = body.GetProperty("concepts").EnumerateArray().ToList();
        Assert.True(concepts.Count >= 300);
        Assert.Contains(concepts, c => c.GetProperty("key").GetString() == "page_login");
        Assert.DoesNotContain(concepts, c => c.TryGetProperty("press", out var p) && p.ValueKind == JsonValueKind.Null); // absent, not null
    }

    [Fact]
    public async Task A_screen_glossary_answers_for_a_known_screen_and_404_otherwise()
    {
        var admin = await Admin();
        var g = await Ok(await admin.GetAsync("/claude/glossary/requirement"));
        Assert.False(string.IsNullOrEmpty(g.GetProperty("about").GetString()));
        Assert.NotEmpty(g.GetProperty("entries").EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/claude/glossary/nowhere")).StatusCode);
    }

    [Fact]
    public async Task Health_is_open() => Assert.Equal(HttpStatusCode.OK, (await _f.Client().GetAsync("/health")).StatusCode);

    // ── clients ──────────────────────────────────────────────────────

    [Fact]
    public async Task Setting_up_a_client_creates_it_with_its_repository_and_first_requirement()
    {
        var admin = await Admin();
        var name = "Setup " + Guid.NewGuid().ToString("N")[..6];
        var res = await admin.PostAsJsonAsync("/admin/setup-client", new
        {
            clientName = name,
            repo = new { name = "repo-" + Guid.NewGuid().ToString("N")[..6], gitUrl = "https://github.com/x/y.git" },
            firstRequirement = new { key = "WI-" + Random.Shared.Next(10000, 99999), title = "First", type = "feature", dueInDays = 7 },
        });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var created = await Json(res);
        var clientId = created.GetProperty("clientId").GetString()!;

        var detail = await Ok(await admin.GetAsync($"/clients/{clientId}"));
        Assert.Equal(name, detail.GetProperty("client").GetProperty("name").GetString());
        Assert.Equal("manual", detail.GetProperty("client").GetProperty("connectorType").GetString());
        var req = Assert.Single(detail.GetProperty("requirements").EnumerateArray());
        Assert.Equal("feature", req.GetProperty("type").GetString());
        Assert.Equal("intake", req.GetProperty("phase").GetString());
        Assert.Equal(0, req.GetProperty("openBlockers").GetInt32());
        Assert.Single(detail.GetProperty("repos").EnumerateArray());

        var list = await Ok(await admin.GetAsync("/clients"));
        var row = list.GetProperty("clients").EnumerateArray().Single(c => c.GetProperty("id").GetString() == clientId);
        Assert.Equal(1, row.GetProperty("initiatives").GetInt32());
        Assert.Equal(300, row.GetProperty("budget").GetDouble());
    }

    [Fact]
    public async Task A_user_sees_only_the_clients_they_were_given()
    {
        var a = await _f.NewClientAsync();
        var b = await _f.NewClientAsync();
        var (_, user) = await UserWith("reader", a);

        var ids = (await Ok(await user.GetAsync("/clients"))).GetProperty("clients").EnumerateArray().Select(c => c.GetProperty("id").GetGuid()).ToList();
        Assert.Contains(a, ids);
        Assert.DoesNotContain(b, ids);
        Assert.Equal(HttpStatusCode.OK, (await user.GetAsync($"/clients/{a}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync($"/clients/{b}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.PatchAsJsonAsync($"/clients/{a}", new { name = "x" })).StatusCode); // a reader changes nothing
    }

    [Fact]
    public async Task A_client_manager_edits_their_client_but_only_a_global_manager_deletes()
    {
        var a = await _f.NewClientAsync();
        var (_, manager) = await UserWith("client_manager", a);
        var patched = await Ok(await manager.PatchAsJsonAsync($"/clients/{a}", new { name = "Renamed " + a.ToString()[..6], adoProjectRef = "Proj" }));
        Assert.True(patched.GetProperty("updated").GetBoolean());
        Assert.Equal("Proj", await _f.ScalarAsync<string>("select ado_project_ref from client where id = @id", ("id", a)));
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.DeleteAsync($"/clients/{a}")).StatusCode);
    }

    [Fact]
    public async Task A_client_with_requirements_is_not_deleted_and_an_empty_one_is()
    {
        var admin = await Admin();
        var busy = await _f.NewClientAsync();
        await _f.NewRequirementAsync(busy);
        var refused = await admin.DeleteAsync($"/clients/{busy}");
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Contains("דרישות", (await Json(refused)).GetProperty("message").GetString());

        var empty = await _f.NewClientAsync();
        Assert.True((await Ok(await admin.DeleteAsync($"/clients/{empty}"))).GetProperty("deleted").GetBoolean());
        Assert.Equal(0L, await _f.ScalarAsync<long>("select count(*) from client where id = @id and archived_at is null", ("id", empty)));
    }

    // ── repositories ─────────────────────────────────────────────────

    [Fact]
    public async Task Linking_a_repository_by_name_creates_it_and_unlinking_keeps_it()
    {
        var a = await _f.NewClientAsync();
        var (_, manager) = await UserWith("client_manager", a);
        var name = "repo-" + Guid.NewGuid().ToString("N")[..8];
        var res = await manager.PostAsJsonAsync($"/clients/{a}/repos", new { name, gitUrl = "https://github.com/x/r.git" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var repo = await Json(res);
        Assert.Equal("main", repo.GetProperty("defaultBranch").GetString());
        var repoId = repo.GetProperty("id").GetString();

        var list = await Ok(await manager.GetAsync("/repos"));
        Assert.Contains(list.GetProperty("repos").EnumerateArray(), r => r.GetProperty("id").GetString() == repoId && r.GetProperty("linkedClients").GetInt32() == 1);

        Assert.True((await Ok(await manager.DeleteAsync($"/clients/{a}/repos/{repoId}"))).GetProperty("unlinked").GetBoolean());
        Assert.Equal(1L, await _f.ScalarAsync<long>("select count(*) from repo where id = @id", ("id", Guid.Parse(repoId!))));
    }

    [Fact]
    public async Task A_shared_repository_is_edited_only_with_a_global_permission()
    {
        var a = await _f.NewClientAsync();
        var (_, manager) = await UserWith("client_manager", a);
        var shared = await _f.ScalarAsync<Guid>("insert into repo(name) values (@n) returning id", ("n", "shared-" + Guid.NewGuid().ToString("N")[..6]));
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.PatchAsJsonAsync($"/repos/{shared}", new { defaultBranch = "dev" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await Admin()).PatchAsJsonAsync($"/repos/{shared}", new { defaultBranch = "dev" })).StatusCode);
    }

    // ── Azure DevOps connections ─────────────────────────────────────

    [Fact]
    public async Task Adding_a_connection_checks_it_live_and_never_returns_the_pat()
    {
        FakeAdo.Respond = req => req.RequestUri!.AbsolutePath.EndsWith("/_apis/projects/Trade")
            ? FakeAdo.Json("{\"name\":\"Trade\"}")
            : FakeAdo.Json("{}", HttpStatusCode.NotFound);
        var a = await _f.NewClientAsync();
        var admin = await Admin();

        var res = await admin.PostAsJsonAsync($"/clients/{a}/connections/ado", new { orgUrl = "https://dev.azure.com/acme/Trade/_git/app", pat = "secret-pat-123456" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var body = await Json(res);
        Assert.True(body.GetProperty("check").GetProperty("ok").GetBoolean());
        Assert.Contains("\"Trade\"", body.GetProperty("check").GetProperty("detail").GetString());

        var detail = await Ok(await admin.GetAsync($"/clients/{a}"));
        var conn = Assert.Single(detail.GetProperty("connections").EnumerateArray());
        Assert.Equal("https://dev.azure.com/acme", conn.GetProperty("config").GetProperty("orgUrl").GetString());
        Assert.Equal("Azure DevOps — Trade", conn.GetProperty("displayName").GetString());
        Assert.DoesNotContain("secret-pat", detail.GetRawText());
        Assert.DoesNotContain("secret-pat", (await admin.GetStringAsync("/connections")));
    }

    [Fact]
    public async Task A_rejected_pat_is_reported_in_words()
    {
        FakeAdo.Respond = _ => new HttpResponseMessage(HttpStatusCode.Unauthorized);
        var a = await _f.NewClientAsync();
        var body = await Json(await (await Admin()).PostAsJsonAsync($"/clients/{a}/connections/ado", new { orgUrl = "https://dev.azure.com/acme", pat = "wrong-pat-123456" }));
        Assert.False(body.GetProperty("check").GetProperty("ok").GetBoolean());
        Assert.Contains("PAT", body.GetProperty("check").GetProperty("detail").GetString());
    }

    [Fact]
    public async Task Listing_projects_reads_the_names_the_pat_can_see()
    {
        FakeAdo.Respond = _ => FakeAdo.Json("{\"value\":[{\"name\":\"Beta\"},{\"name\":\"Alpha\"}]}");
        var body = await Ok(await (await Admin()).PostAsJsonAsync("/connections/ado/projects", new { orgUrl = "https://dev.azure.com/acme", pat = "some-pat-123456" }));
        Assert.Equal(["Alpha", "Beta"], body.GetProperty("projects").EnumerateArray().Select(p => p.GetString()!).ToArray());
    }

    // ── prompts ──────────────────────────────────────────────────────

    [Fact]
    public async Task Every_prompt_the_migrations_seed_keeps_its_contract()
    {
        var items = (await Ok(await (await Admin()).GetAsync("/prompts"))).GetProperty("items").EnumerateArray().ToList();
        Assert.NotEmpty(items);
        Assert.All(items, i => Assert.Empty(i.GetProperty("problems").EnumerateArray()));
        var breakdown = items.Single(i => i.GetProperty("key").GetString() == "breakdown.tasks");
        Assert.Equal("decomposition", breakdown.GetProperty("use").GetProperty("capability").GetString());
        Assert.False(string.IsNullOrEmpty(breakdown.GetProperty("use").GetProperty("policy").GetProperty("model").GetString()));
    }

    [Fact]
    public async Task An_edit_that_would_break_its_caller_is_refused_with_every_reason()
    {
        var admin = await Admin();
        var items = (await Ok(await admin.GetAsync("/prompts"))).GetProperty("items").EnumerateArray();
        var id = items.Single(i => i.GetProperty("key").GetString() == "breakdown.tasks").GetProperty("id").GetString();

        var res = await admin.PatchAsJsonAsync($"/prompts/{id}", new { body = "no placeholders at all" });
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        var message = (await Json(res)).GetProperty("message").GetString()!;
        Assert.Contains("{{REQUIREMENT}}", message);
        Assert.Contains("\"seq\"", message);

        Assert.True((await Ok(await admin.PatchAsJsonAsync($"/prompts/{id}", new { title = "Breakdown (renamed)" }))).GetProperty("updated").GetBoolean());
    }

    // ── model policy ─────────────────────────────────────────────────

    [Fact]
    public async Task Changing_the_policy_bumps_its_version_and_records_who_changed_what()
    {
        var admin = await Admin();
        await _f.NewClientAsync("DCC Internal " + Guid.NewGuid().ToString("N")[..4]);
        var before = await Ok(await admin.GetAsync("/claude/policy"));
        var version = before.GetProperty("policy").GetProperty("version").GetInt32();
        var days = before.GetProperty("policy").GetProperty("chat").GetProperty("retentionDays").GetInt32();

        var saved = await Ok(await admin.PutAsJsonAsync("/claude/policy", new { chat = new { retentionDays = days + 1 } }));
        Assert.Equal(version + 1, saved.GetProperty("policy").GetProperty("version").GetInt32());
        var change = Assert.Single(saved.GetProperty("changes").EnumerateArray());
        Assert.Equal("chat.retentionDays", change.GetProperty("path").GetString());

        var file = JsonNode.Parse(File.ReadAllText(_f.PolicyPath))!;
        Assert.Equal(days + 1, file["chat"]!["retentionDays"]!.GetValue<int>());
        var after = await Ok(await admin.GetAsync("/claude/policy"));
        Assert.Equal(version + 1, after.GetProperty("lastChange").GetProperty("toVersion").GetInt32());
    }

    [Fact]
    public async Task The_policy_refuses_an_unknown_capability_and_an_out_of_range_value()
    {
        var admin = await Admin();
        var unknown = await admin.PutAsJsonAsync("/claude/policy", new { capabilities = new { no_such = new { effort = "high" } } });
        Assert.Equal(HttpStatusCode.Conflict, unknown.StatusCode);
        var range = await admin.PutAsJsonAsync("/claude/policy", new { chat = new { retentionDays = 0 } });
        Assert.Equal(HttpStatusCode.Conflict, range.StatusCode);
        Assert.Contains("הערכים לא תקינים", (await Json(range)).GetProperty("message").GetString());
    }

    [Fact]
    public async Task A_clients_retention_is_set_and_out_of_range_is_refused()
    {
        var admin = await Admin();
        var a = await _f.NewClientAsync();
        Assert.Equal(30, (await Ok(await admin.PutAsJsonAsync($"/clients/{a}/claude-retention", new { days = 30 }))).GetProperty("days").GetInt32());
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync($"/clients/{a}/claude-retention", new { days = 0 })).StatusCode);
    }

    // ── compatibility with the web client ────────────────────────────

    [Fact]
    public async Task The_owner_picker_list_answers_in_the_old_shape_for_everyone()
    {
        var (_, token, _) = await _f.NewUserAsync();
        var users = (await Ok(await _f.Client(token).GetAsync("/users"))).GetProperty("users").EnumerateArray().ToList();
        Assert.NotEmpty(users);
        Assert.All(users, u => Assert.True(u.TryGetProperty("displayName", out _)));
        Assert.False(users[0].TryGetProperty("providers", out _)); // no directory details for a plain user
    }
}
