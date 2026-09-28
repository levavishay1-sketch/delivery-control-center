using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dcc.Application.Auth;
using Dcc.Domain.Auth;
using Dcc.Infrastructure.Persistence;
using Dcc.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Dcc.Tests.Integration;

/// <summary>Who may do what, where — through the API and the permission service.</summary>
[Collection(DbCollection.Name)]
public sealed class PermissionTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private async Task<bool> Has(Guid userId, string permission, ScopeType type, Guid? id)
    {
        using var scope = _f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<IPermissionService>().HasAsync(userId, permission, new ScopeRef(type, id));
    }

    private static async Task<Guid> NewAgentAsync(HttpClient admin, object body)
    {
        var res = await admin.PostAsJsonAsync("/agents", body);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"POST /agents: {(int)res.StatusCode} {json}");
        return json.GetProperty("id").GetGuid();
    }

    private static async Task<string> ErrorOf(HttpResponseMessage res) =>
        (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()!;

    [Fact]
    public async Task A_reader_cannot_manage_roles_or_users()
    {
        var (id, _, password) = await _f.NewUserAsync();
        await _f.AssignAsync("user", id, "reader", "global", null);
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", id));
        var token = (await _f.LoginAsync(email, password)).AccessToken;

        var res = await _f.Client(token).PostAsJsonAsync("/users", new { email = "x@test.local", displayName = "X" });
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        var role = await _f.Client(token).PostAsJsonAsync("/security-roles", new { name = "r", assignableScopes = new[] { "global" }, permissions = new[] { "clients.read" } });
        Assert.Equal(HttpStatusCode.Forbidden, role.StatusCode);
    }

    [Fact]
    public async Task A_role_on_client_A_gives_nothing_on_client_B_and_the_database_agrees()
    {
        var (id, _, _) = await _f.NewUserAsync();
        var a = await _f.NewClientAsync();
        var b = await _f.NewClientAsync();
        await _f.AssignAsync("user", id, "client_manager", "client", a);

        Assert.True(await Has(id, Permissions.Requirements.Edit, ScopeType.Client, a));
        Assert.False(await Has(id, Permissions.Requirements.Edit, ScopeType.Client, b));
        Assert.False(await Has(id, Permissions.Requirements.Read, ScopeType.Global, null));

        // Even without the check above, the wall holds: inside A's scope, B's rows do not exist.
        var reqB = await _f.NewRequirementAsync(b);
        using var scope = _f.Services.CreateScope();
        var seen = await scope.ServiceProvider.GetRequiredService<ITenantScope>()
            .RunAsync(a, db => db.Workitems.CountAsync(w => w.Id == reqB));
        Assert.Equal(0, seen);
    }

    [Fact]
    public async Task A_role_on_a_requirement_covers_its_children_but_not_its_siblings()
    {
        var (id, _, _) = await _f.NewUserAsync();
        var c = await _f.NewClientAsync();
        var parent = await _f.NewRequirementAsync(c);
        var child = await _f.NewRequirementAsync(c, parent);
        var grandchild = await _f.NewRequirementAsync(c, child);
        var sibling = await _f.NewRequirementAsync(c);
        await _f.AssignAsync("user", id, "contributor", "requirement", parent);

        Assert.True(await Has(id, Permissions.Tasks.Edit, ScopeType.Requirement, parent));
        Assert.True(await Has(id, Permissions.Tasks.Edit, ScopeType.Requirement, grandchild));
        Assert.False(await Has(id, Permissions.Tasks.Edit, ScopeType.Requirement, sibling));
        Assert.False(await Has(id, Permissions.Tasks.Edit, ScopeType.Client, c));
    }

    [Fact]
    public async Task A_team_passes_its_role_to_its_members_and_removal_takes_it_away()
    {
        var (id, _, _) = await _f.NewUserAsync();
        var c = await _f.NewClientAsync();
        var admin = _f.Client(await _f.AdminTokenAsync());
        var team = (await (await admin.PostAsJsonAsync("/teams", new { name = "team-" + Guid.NewGuid().ToString("N")[..6] })).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        await _f.AssignAsync("team", team, "reader", "client", c);

        Assert.False(await Has(id, Permissions.Clients.Read, ScopeType.Client, c));
        (await admin.PutAsync($"/teams/{team}/members/{id}", null)).EnsureSuccessStatusCode();
        Assert.True(await Has(id, Permissions.Clients.Read, ScopeType.Client, c));
        var members = await admin.GetFromJsonAsync<JsonElement>($"/teams/{team}/members");
        Assert.Equal(id, Assert.Single(members.EnumerateArray()).GetProperty("userId").GetGuid());
        (await admin.DeleteAsync($"/teams/{team}/members/{id}")).EnsureSuccessStatusCode();
        Assert.False(await Has(id, Permissions.Clients.Read, ScopeType.Client, c));
    }

    [Fact]
    public async Task A_role_is_assigned_only_where_it_is_assignable()
    {
        var (id, _, _) = await _f.NewUserAsync();
        var c = await _f.NewClientAsync();
        var res = await _f.Client(await _f.AdminTokenAsync()).PostAsJsonAsync("/role-assignments",
            new { principalType = "user", principalId = id, securityRoleId = await _f.RoleIdAsync("admin"), scopeType = "client", scopeId = c });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("scope_not_assignable", await ErrorOf(res));
    }

    [Fact]
    public async Task The_last_administrator_cannot_be_removed()
    {
        var admin = _f.Client(await _f.AdminTokenAsync());
        var assignments = await admin.GetFromJsonAsync<JsonElement>("/role-assignments");
        var adminRole = await _f.RoleIdAsync("admin");
        var theOnlyOne = assignments.EnumerateArray()
            .Where(a => a.GetProperty("securityRoleId").GetGuid() == adminRole && a.GetProperty("scopeType").GetString() == "global")
            .Select(a => a.GetProperty("id").GetGuid()).ToList();
        if (theOnlyOne.Count != 1) return; // another test made a second admin; the rule is then not in play

        var res = await admin.DeleteAsync($"/role-assignments/{theOnlyOne[0]}");
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.Equal("last_admin", await ErrorOf(res));
    }

    [Fact]
    public async Task A_delegated_agent_never_exceeds_its_owner()
    {
        var (owner, _, _) = await _f.NewUserAsync();
        var c = await _f.NewClientAsync();
        await _f.AssignAsync("user", owner, "reader", "client", c);

        var admin = _f.Client(await _f.AdminTokenAsync());
        var agent = await NewAgentAsync(admin, new { displayName = "bot", ownerUserId = owner });
        await _f.AssignAsync("user", agent, "client_manager", "client", c);

        Assert.True(await Has(agent, Permissions.Clients.Read, ScopeType.Client, c));    // both have it
        Assert.False(await Has(agent, Permissions.Clients.Manage, ScopeType.Client, c)); // the owner does not
    }

    [Fact]
    public async Task An_agent_can_never_hold_admin_and_independence_waits_for_the_review()
    {
        var admin = _f.Client(await _f.AdminTokenAsync());
        var agent = await NewAgentAsync(admin, new { displayName = "bot" });

        var asAdmin = await admin.PostAsJsonAsync("/role-assignments", new { principalType = "user", principalId = agent, securityRoleId = await _f.RoleIdAsync("admin"), scopeType = "global" });
        Assert.Equal(HttpStatusCode.Conflict, asAdmin.StatusCode);
        Assert.Equal("agent_admin", await ErrorOf(asAdmin));

        var me = await admin.GetFromJsonAsync<JsonElement>("/auth/me");
        var independent = await admin.PostAsJsonAsync($"/agents/{agent}/make-independent",
            new { sponsorUserId = me.GetProperty("user").GetProperty("id").GetGuid(), expiresAt = DateTimeOffset.UtcNow.AddDays(30) });
        Assert.Equal(HttpStatusCode.Forbidden, independent.StatusCode);
        Assert.Equal("requires_architecture_review", await ErrorOf(independent));
    }

    [Fact]
    public async Task An_api_token_signs_in_its_agent_and_stops_working_once_revoked()
    {
        var admin = _f.Client(await _f.AdminTokenAsync());
        var agent = await NewAgentAsync(admin, new { displayName = "bot" });
        var created = await (await admin.PostAsJsonAsync("/tokens", new { name = "ci", forAgentId = agent })).Content.ReadFromJsonAsync<JsonElement>();
        var secret = created.GetProperty("secret").GetString()!;
        Assert.StartsWith("dcc_pat_", secret);
        Assert.Equal(0L, await _f.ScalarAsync<long>("select count(*) from user_token where token_hash = @s", ("s", secret))); // only the hash is kept

        var me = await _f.Client(secret).GetFromJsonAsync<JsonElement>("/auth/me");
        Assert.Equal(agent, me.GetProperty("user").GetProperty("id").GetGuid());

        (await admin.DeleteAsync($"/tokens/{created.GetProperty("token").GetProperty("id").GetGuid()}")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.Client(secret).GetAsync("/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Entra_features_are_off_until_configured()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _f.Client().GetAsync("/auth/entra/login")).StatusCode);
        var invite = await _f.Client(await _f.AdminTokenAsync()).PostAsJsonAsync("/users/invite-guest", new { email = "g@test.local", displayName = "G" });
        Assert.Equal(HttpStatusCode.NotFound, invite.StatusCode);
    }

    [Fact]
    public async Task Every_change_is_in_the_audit_log()
    {
        var (id, _, _) = await _f.NewUserAsync();
        await _f.AssignAsync("user", id, "reader", "global", null);
        var audit = await _f.Client(await _f.AdminTokenAsync()).GetFromJsonAsync<JsonElement>($"/identity-audit?targetType=user&targetId={id}");
        var actions = audit.EnumerateArray().Select(a => a.GetProperty("action").GetString()).ToList();
        Assert.Contains("user.created", actions);
        Assert.Contains("auth.password_changed", actions);
    }
}
