using Dcc.Domain.Auth;

namespace Dcc.Tests.Unit;

/// <summary>The scope rules, on their own — no database.</summary>
public sealed class EffectivePermissionsTests
{
    private static readonly Guid ClientA = Guid.NewGuid(), ClientB = Guid.NewGuid();
    private static readonly Guid Parent = Guid.NewGuid(), Child = Guid.NewGuid(), Sibling = Guid.NewGuid();

    [Fact]
    public void A_global_grant_counts_everywhere()
    {
        var p = new EffectivePermissions([(Scope.Global, Permissions.Requirements.Read)]);
        Assert.True(p.Has(Permissions.Requirements.Read, ScopeContext.Global));
        Assert.True(p.Has(Permissions.Requirements.Read, ScopeContext.ForClient(ClientA)));
        Assert.True(p.Has(Permissions.Requirements.Read, ScopeContext.ForRequirement(ClientB, [Child, Parent])));
    }

    [Fact]
    public void A_client_grant_counts_on_that_client_and_its_requirements_only()
    {
        var p = new EffectivePermissions([(Scope.Client(ClientA), Permissions.Requirements.Edit)]);
        Assert.True(p.Has(Permissions.Requirements.Edit, ScopeContext.ForClient(ClientA)));
        Assert.True(p.Has(Permissions.Requirements.Edit, ScopeContext.ForRequirement(ClientA, [Child, Parent])));
        Assert.False(p.Has(Permissions.Requirements.Edit, ScopeContext.ForClient(ClientB)));
        Assert.False(p.Has(Permissions.Requirements.Edit, ScopeContext.Global));
    }

    [Fact]
    public void A_requirement_grant_covers_its_subtree_but_not_its_siblings()
    {
        var p = new EffectivePermissions([(Scope.Requirement(Parent), Permissions.Tasks.Edit)]);
        Assert.True(p.Has(Permissions.Tasks.Edit, ScopeContext.ForRequirement(ClientA, [Parent])));
        Assert.True(p.Has(Permissions.Tasks.Edit, ScopeContext.ForRequirement(ClientA, [Child, Parent])));
        Assert.False(p.Has(Permissions.Tasks.Edit, ScopeContext.ForRequirement(ClientA, [Sibling])));
        Assert.False(p.Has(Permissions.Tasks.Edit, ScopeContext.ForClient(ClientA)));
    }

    [Fact]
    public void A_global_only_permission_granted_on_a_client_counts_nowhere()
    {
        var p = new EffectivePermissions([(Scope.Client(ClientA), Permissions.Users.Manage)]);
        Assert.False(p.Has(Permissions.Users.Manage, ScopeContext.ForClient(ClientA)));
        Assert.False(p.Has(Permissions.Users.Manage, ScopeContext.Global));
        Assert.True(p.IsEmpty);
    }

    [Fact]
    public void The_claim_holds_the_users_own_permissions_by_scope()
    {
        var p = new EffectivePermissions([(Scope.Global, "audit.read"), (Scope.Client(ClientA), "clients.read"), (Scope.Requirement(Child), "tasks.read")]);
        var claim = p.ToClaim();
        Assert.Equal(["audit.read"], claim["*"]);
        Assert.Equal(["clients.read"], claim["c:" + ClientA]);
        Assert.Equal(["tasks.read"], claim["r:" + Child]);
    }

    [Fact]
    public void Every_builtin_role_uses_only_catalog_permissions()
    {
        foreach (var role in BuiltInSecurityRoles.All)
            Assert.All(role.Permissions, code => Assert.True(Permissions.Exists(code), $"{role.Key}: {code}"));
        Assert.Equal(Permissions.All.Count, BuiltInSecurityRoles.All.Single(r => r.Key == BuiltInSecurityRoles.AdminKey).Permissions.Length);
    }
}
