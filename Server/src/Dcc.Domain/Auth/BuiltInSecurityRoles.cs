namespace Dcc.Domain.Auth;

/// <summary>
/// The security roles that ship with the system. Synced into
/// <c>security_role</c> on every start (by <c>key</c>); they cannot be edited
/// from the API. Custom roles sit beside them.
/// </summary>
public static class BuiltInSecurityRoles
{
    public sealed record Definition(string Key, string Name, string Description, ScopeType[] AssignableScopes, string[] Permissions);

    public const string AdminKey = "admin";
    public const string ClientManagerKey = "client_manager";
    public const string ContributorKey = "contributor";
    public const string ReaderKey = "reader";
    public const string GuestReaderKey = "guest_reader";

    private static readonly ScopeType[] Anywhere = [ScopeType.Global, ScopeType.Client, ScopeType.Requirement];

    public static readonly IReadOnlyList<Definition> All =
    [
        new(AdminKey, "Admin", "Everything, everywhere — including users, roles and settings.",
            [ScopeType.Global],
            [.. Auth.Permissions.All.Select(p => p.Code)]),

        new(ClientManagerKey, "מנהל לקוח", "Runs a client end to end: its requirements, tasks, repositories and budget.",
            [ScopeType.Global, ScopeType.Client],
            [
                Auth.Permissions.Clients.Read, Auth.Permissions.Clients.Manage,
                Auth.Permissions.Requirements.Read, Auth.Permissions.Requirements.Create, Auth.Permissions.Requirements.Edit, Auth.Permissions.Requirements.Delete,
                Auth.Permissions.Tasks.Read, Auth.Permissions.Tasks.Edit, Auth.Permissions.Tasks.RunAi,
                Auth.Permissions.Repos.Read, Auth.Permissions.Repos.Manage, Auth.Permissions.Repos.Onboard,
                Auth.Permissions.PullRequests.Read, Auth.Permissions.PullRequests.Merge,
                Auth.Permissions.Prompts.Read, Auth.Permissions.Claude.Chat,
                Auth.Permissions.Budgets.Read, Auth.Permissions.Budgets.Manage,
            ]),

        new(ContributorKey, "תורם", "Works on requirements and tasks, runs AI on them; does not delete or merge.",
            Anywhere,
            [
                Auth.Permissions.Clients.Read,
                Auth.Permissions.Requirements.Read, Auth.Permissions.Requirements.Create, Auth.Permissions.Requirements.Edit,
                Auth.Permissions.Tasks.Read, Auth.Permissions.Tasks.Edit, Auth.Permissions.Tasks.RunAi,
                Auth.Permissions.Repos.Read, Auth.Permissions.PullRequests.Read,
                Auth.Permissions.Prompts.Read, Auth.Permissions.Claude.Chat, Auth.Permissions.Budgets.Read,
            ]),

        new(ReaderKey, "צופה", "Sees everything in its scope; changes nothing.",
            Anywhere,
            [
                Auth.Permissions.Clients.Read, Auth.Permissions.Requirements.Read, Auth.Permissions.Tasks.Read,
                Auth.Permissions.Repos.Read, Auth.Permissions.PullRequests.Read, Auth.Permissions.Prompts.Read,
                Auth.Permissions.Budgets.Read,
            ]),

        new(GuestReaderKey, "אורח-צופה", "For a guest: sees the requirements and tasks of one client or requirement.",
            [ScopeType.Client, ScopeType.Requirement],
            [Auth.Permissions.Clients.Read, Auth.Permissions.Requirements.Read, Auth.Permissions.Tasks.Read]),
    ];
}
