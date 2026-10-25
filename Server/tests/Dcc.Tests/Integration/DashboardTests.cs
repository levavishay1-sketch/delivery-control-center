using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dcc.Tests.Support;

namespace Dcc.Tests.Integration;

/// <summary>Phase 4.8: the dashboard, alerts, budgets, the activity log and resolving a branch — each narrowed to what the person may see.</summary>
[Collection(DbCollection.Name)]
public sealed class DashboardTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    private async Task<HttpClient> Admin() => _f.Client(await _f.AdminTokenAsync());

    private async Task<HttpClient> UserWith(string roleKey, Guid clientId)
    {
        var (id, _, password) = await _f.NewUserAsync();
        await _f.AssignAsync("user", id, roleKey, "client", clientId);
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", id));
        return _f.Client((await _f.LoginAsync(email, password)).AccessToken);
    }

    [Fact]
    public async Task The_dashboard_shows_the_tiles_the_recent_work_and_only_the_clients_a_person_may_read()
    {
        var admin = await Admin();
        var mine = await _f.NewClientAsync();
        var other = await _f.NewClientAsync();
        var a = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId = mine, title = "Mine top", budgetUsd = 100 }));
        await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId = other, title = "Other top" }));
        await _f.ExecAsync("insert into client_budget (client_id, monthly_usd) values (@c, 200)", ("c", mine));

        var d = await Ok(await admin.GetAsync("/dashboard"));
        foreach (var k in new[] { "initiatives", "initiativesDelta", "openItems", "itemsDelta", "blockedItems", "aiCostUsd", "aiBudgetUsd", "aiBudgetPct" })
            Assert.True(d.GetProperty("stats").TryGetProperty(k, out _), k);
        Assert.True(d.GetProperty("recentWorkItems").GetArrayLength() > 0);
        var top = d.GetProperty("initiatives").EnumerateArray().First(i => i.GetProperty("id").GetString() == a.GetProperty("id").GetString());
        Assert.Equal(100, top.GetProperty("budgetUsd").GetDouble());
        Assert.Equal(0, top.GetProperty("aiCostUsd").GetDouble());

        var reader = await UserWith("reader", mine);
        var seen = await Ok(await reader.GetAsync("/dashboard"));
        Assert.All(seen.GetProperty("recentWorkItems").EnumerateArray(), w => Assert.NotEqual("Other top", w.GetProperty("title").GetString()));
        Assert.Contains(seen.GetProperty("recentWorkItems").EnumerateArray(), w => w.GetProperty("title").GetString() == "Mine top");
        Assert.Equal(200, seen.GetProperty("stats").GetProperty("aiBudgetUsd").GetDouble());
    }

    [Fact]
    public async Task Alerts_are_the_persons_own_and_budgets_show_the_months_spend()
    {
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        var adminId = await _f.ScalarAsync<Guid>("select id from users where email = 'admin@dcc.local'");
        await _f.ExecAsync("insert into notification (client_id, for_user_id, kind, severity, title) values (@c, @u, 'budget', 'warn', 'Budget at 80%')", ("c", clientId), ("u", adminId));
        await _f.ExecAsync("insert into client_budget (client_id, monthly_usd) values (@c, 50)", ("c", clientId));

        var alerts = await Ok(await admin.GetAsync("/list/alerts"));
        var alert = alerts.GetProperty("alerts").EnumerateArray().First(x => x.GetProperty("title").GetString() == "Budget at 80%");
        Assert.Equal("warn", alert.GetProperty("severity").GetString());
        Assert.Equal(clientId.ToString(), alert.GetProperty("clientId").GetString());

        var budgets = await Ok(await admin.GetAsync("/list/budgets"));
        var b = budgets.GetProperty("budgets").EnumerateArray().First(x => x.GetProperty("clientId").GetString() == clientId.ToString());
        Assert.Equal(50, b.GetProperty("monthlyUsd").GetDouble());
        Assert.Equal(0, b.GetProperty("spentUsd").GetDouble());
        Assert.Equal(0, b.GetProperty("pct").GetInt32());

        // a stranger sees no alert that is not theirs
        var (_, token, _) = await _f.NewUserAsync();
        Assert.Equal(0, (await Ok(await _f.Client(token).GetAsync("/list/alerts"))).GetProperty("alerts").GetArrayLength());
    }

    [Fact]
    public async Task The_activity_log_pages_through_events_and_needs_audit_read()
    {
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        var req = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "Logged" }));
        await Ok(await admin.PatchAsJsonAsync($"/workitems/{req.GetProperty("id").GetString()}", new { title = "Logged again" }));

        var page = await Ok(await admin.GetAsync("/audit?type=requirement.updated&actorKind=user"));
        Assert.Equal(1, page.GetProperty("page").GetInt32());
        var row = page.GetProperty("rows").EnumerateArray().First(r => r.GetProperty("workitemId").GetString() == req.GetProperty("id").GetString());
        Assert.Equal("Logged again", row.GetProperty("wiTitle").GetString());
        Assert.Equal("user", row.GetProperty("actor").GetProperty("kind").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/audit?from=not-a-date")).StatusCode);

        var reader = await UserWith("reader", clientId);
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.GetAsync("/audit")).StatusCode);
    }

    [Fact]
    public async Task A_branch_resolves_to_its_requirement_by_the_key_in_its_name()
    {
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        var key = "WI-" + Random.Shared.Next(10000, 99999);
        var req = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "Discounts", key }));
        var r = await Ok(await admin.GetAsync($"/resolve?clientId={clientId}&branch=task/{key}-tiered-discount"));
        Assert.Equal(req.GetProperty("id").GetString(), r.GetProperty("workitemId").GetString());
        Assert.Equal(key, r.GetProperty("key").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/resolve?clientId={clientId}&branch=main")).StatusCode);
    }
}
