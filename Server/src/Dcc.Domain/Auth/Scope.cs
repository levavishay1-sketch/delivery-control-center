namespace Dcc.Domain.Auth;

/// <summary>
/// Where a security role is assigned, and where a permission is checked.
/// Follows the resolution order of architecture decision 05:
/// global → client → requirement, the most specific wins.
/// </summary>
public enum ScopeType
{
    Global,
    Client,
    Requirement,
}

public static class ScopeTypes
{
    public static string ToDb(this ScopeType s) => s switch
    {
        ScopeType.Global => "global",
        ScopeType.Client => "client",
        ScopeType.Requirement => "requirement",
        _ => throw new ArgumentOutOfRangeException(nameof(s)),
    };

    public static ScopeType Parse(string s) => s switch
    {
        "global" => ScopeType.Global,
        "client" => ScopeType.Client,
        "requirement" => ScopeType.Requirement,
        _ => throw new ArgumentException($"unknown scope type \"{s}\""),
    };
}

/// <summary>A place a permission applies: everywhere, one client, or one requirement (and its subtree).</summary>
public readonly record struct Scope(ScopeType Type, Guid? Id)
{
    public static readonly Scope Global = new(ScopeType.Global, null);

    public static Scope Client(Guid id) => new(ScopeType.Client, id);

    public static Scope Requirement(Guid id) => new(ScopeType.Requirement, id);

    /// <summary>The key used in the token's <c>perms</c> claim: <c>*</c>, <c>c:&lt;id&gt;</c>, <c>r:&lt;id&gt;</c>.</summary>
    public string ClaimKey => Type switch
    {
        ScopeType.Global => "*",
        ScopeType.Client => "c:" + Id,
        ScopeType.Requirement => "r:" + Id,
        _ => throw new InvalidOperationException(),
    };
}
