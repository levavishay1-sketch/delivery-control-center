namespace Dcc.Domain.Auth;

/// <summary>
/// The permission catalog. Every permission is a thing the server checks
/// somewhere (<c>[RequirePermission(Permissions.Requirements.Edit)]</c>), so the
/// list lives here in code and is synced into the <c>permission</c> table on
/// every start. Security roles are composed from this list; nobody invents a
/// permission from the UI, because a permission no code checks means nothing.
///
/// A code is <c>area.action</c>. <see cref="Definition.DescriptionKey"/> points at
/// the plain-Hebrew explanation in the glossary (the "i").
/// </summary>
public static class Permissions
{
    public sealed record Definition(string Code, string Area, bool GlobalOnly)
    {
        public string DescriptionKey => "perm_" + Code.Replace('.', '_');
    }

    public static class Clients
    {
        public const string Read = "clients.read";
        public const string Manage = "clients.manage";
    }

    public static class Requirements
    {
        public const string Read = "requirements.read";
        public const string Create = "requirements.create";
        public const string Edit = "requirements.edit";
        public const string Delete = "requirements.delete";
    }

    public static class Tasks
    {
        public const string Read = "tasks.read";
        public const string Edit = "tasks.edit";
        public const string RunAi = "tasks.run_ai";
    }

    public static class Repos
    {
        public const string Read = "repos.read";
        public const string Manage = "repos.manage";
        public const string Onboard = "repos.onboard";
    }

    public static class PullRequests
    {
        public const string Read = "pullrequests.read";
        public const string Merge = "pullrequests.merge";
    }

    public static class Prompts
    {
        public const string Read = "prompts.read";
        public const string Manage = "prompts.manage";
    }

    public static class Claude
    {
        public const string Chat = "claude.chat";
        public const string Manage = "claude.manage";
    }

    public static class Budgets
    {
        public const string Read = "budgets.read";
        public const string Manage = "budgets.manage";
    }

    public static class Settings
    {
        public const string Read = "settings.read";
        public const string Manage = "settings.manage";
    }

    public static class Audit
    {
        public const string Read = "audit.read";
    }

    public static class Users
    {
        public const string Read = "users.read";
        public const string Manage = "users.manage";
        public const string InviteGuest = "users.invite_guest";
    }

    public static class Teams
    {
        public const string Manage = "teams.manage";
    }

    public static class Roles
    {
        /// <summary>Create and edit security roles, and assign them.</summary>
        public const string Manage = "roles.manage";
    }

    public static class Agents
    {
        public const string Manage = "agents.manage";
        public const string MakeIndependent = "agents.make_independent";
    }

    public static class Tokens
    {
        /// <summary>Create and revoke your own API tokens.</summary>
        public const string ManageOwn = "tokens.manage_own";
    }

    /// <summary>
    /// Every permission. <c>GlobalOnly</c>: it means something only across the
    /// whole system (managing users, roles, settings), so it counts only when
    /// granted at global scope.
    /// </summary>
    public static readonly IReadOnlyList<Definition> All =
    [
        new(Clients.Read, "clients", false),
        new(Clients.Manage, "clients", false),
        new(Requirements.Read, "requirements", false),
        new(Requirements.Create, "requirements", false),
        new(Requirements.Edit, "requirements", false),
        new(Requirements.Delete, "requirements", false),
        new(Tasks.Read, "tasks", false),
        new(Tasks.Edit, "tasks", false),
        new(Tasks.RunAi, "tasks", false),
        new(Repos.Read, "repos", false),
        new(Repos.Manage, "repos", false),
        new(Repos.Onboard, "repos", false),
        new(PullRequests.Read, "pullrequests", false),
        new(PullRequests.Merge, "pullrequests", false),
        new(Prompts.Read, "prompts", false),
        new(Prompts.Manage, "prompts", true),
        new(Claude.Chat, "claude", false),
        new(Claude.Manage, "claude", true),
        new(Budgets.Read, "budgets", false),
        new(Budgets.Manage, "budgets", false),
        new(Settings.Read, "settings", true),
        new(Settings.Manage, "settings", true),
        new(Audit.Read, "audit", true),
        new(Users.Read, "users", true),
        new(Users.Manage, "users", true),
        new(Users.InviteGuest, "users", true),
        new(Teams.Manage, "teams", true),
        new(Roles.Manage, "roles", true),
        new(Agents.Manage, "agents", true),
        new(Agents.MakeIndependent, "agents", true),
        new(Tokens.ManageOwn, "tokens", true),
    ];

    private static readonly Dictionary<string, Definition> ByCode = All.ToDictionary(d => d.Code);

    public static bool Exists(string code) => ByCode.ContainsKey(code);

    public static bool IsGlobalOnly(string code) => ByCode.TryGetValue(code, out var d) && d.GlobalOnly;
}
