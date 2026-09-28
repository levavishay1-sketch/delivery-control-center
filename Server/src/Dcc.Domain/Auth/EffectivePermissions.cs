namespace Dcc.Domain.Auth;

/// <summary>
/// Where a check happens: the client and — for a requirement — the requirement
/// with its ancestors, nearest first. A grant on any ancestor covers the
/// whole subtree beneath it.
/// </summary>
public sealed record ScopeContext(ScopeType Type, Guid? ClientId, IReadOnlyList<Guid> RequirementChain)
{
    public static readonly ScopeContext Global = new(ScopeType.Global, null, []);

    public static ScopeContext ForClient(Guid clientId) => new(ScopeType.Client, clientId, []);

    public static ScopeContext ForRequirement(Guid clientId, IReadOnlyList<Guid> chainNearestFirst) =>
        new(ScopeType.Requirement, clientId, chainNearestFirst);
}

/// <summary>
/// What one principal may do, by scope. Pure: built from the principal's
/// assignments (direct and through teams), no database access — so the
/// rules below are unit-tested on their own.
///
/// Rules:
/// <list type="bullet">
/// <item>a global grant counts everywhere;</item>
/// <item>a client grant counts on that client and every requirement in it;</item>
/// <item>a requirement grant counts on that requirement and everything under it;</item>
/// <item>a global-only permission (users, roles, settings…) counts only when granted globally.</item>
/// </list>
/// </summary>
public sealed class EffectivePermissions
{
    private readonly Dictionary<string, HashSet<string>> _byScope;

    public EffectivePermissions(IEnumerable<(Scope Scope, string Code)> grants)
    {
        _byScope = new Dictionary<string, HashSet<string>>();
        foreach (var (scope, code) in grants)
        {
            if (Permissions.IsGlobalOnly(code) && scope.Type != ScopeType.Global) continue;
            if (!_byScope.TryGetValue(scope.ClaimKey, out var set)) _byScope[scope.ClaimKey] = set = [];
            set.Add(code);
        }
    }

    public static readonly EffectivePermissions None = new([]);

    /// <summary>The compact form carried in the token's <c>perms</c> claim — this user's own permissions only.</summary>
    public IReadOnlyDictionary<string, string[]> ToClaim() =>
        _byScope.ToDictionary(kv => kv.Key, kv => kv.Value.Order(StringComparer.Ordinal).ToArray());

    public bool IsEmpty => _byScope.Count == 0;

    public bool Has(string code, ScopeContext at)
    {
        if (Contains("*", code)) return true;
        if (Permissions.IsGlobalOnly(code)) return false;
        if (at.ClientId is { } c && Contains("c:" + c, code)) return true;
        foreach (var r in at.RequirementChain)
            if (Contains("r:" + r, code)) return true;
        return false;
    }

    /// <summary>Clients this principal can reach at all with <paramref name="code"/> (null = every client, via a global grant).</summary>
    public IReadOnlySet<Guid>? ClientsWith(string code)
    {
        if (Contains("*", code)) return null;
        var ids = new HashSet<Guid>();
        foreach (var (key, codes) in _byScope)
            if (key.StartsWith("c:", StringComparison.Ordinal) && codes.Contains(code)) ids.Add(Guid.Parse(key[2..]));
        return ids;
    }

    private bool Contains(string key, string code) => _byScope.TryGetValue(key, out var set) && set.Contains(code);
}
