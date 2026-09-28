using Microsoft.EntityFrameworkCore;

namespace Dcc.Infrastructure.Persistence;

/// <summary>
/// The EF Core view of the database. It never creates or migrates the schema —
/// the numbered SQL files under Server/db/migrations do (see DatabaseMigrator).
/// Snake_case column names come from UseSnakeCaseNamingConvention().
/// </summary>
public sealed class DccDbContext(DbContextOptions<DccDbContext> options) : DbContext(options)
{
    public DbSet<UserRow> Users => Set<UserRow>();
    public DbSet<UserIdentityRow> UserIdentities => Set<UserIdentityRow>();
    public DbSet<LocalCredentialRow> LocalCredentials => Set<LocalCredentialRow>();
    public DbSet<TeamRow> Teams => Set<TeamRow>();
    public DbSet<TeamMemberRow> TeamMembers => Set<TeamMemberRow>();
    public DbSet<PermissionRow> Permissions => Set<PermissionRow>();
    public DbSet<SecurityRoleRow> SecurityRoles => Set<SecurityRoleRow>();
    public DbSet<SecurityRolePermissionRow> SecurityRolePermissions => Set<SecurityRolePermissionRow>();
    public DbSet<SecurityRoleAssignmentRow> SecurityRoleAssignments => Set<SecurityRoleAssignmentRow>();
    public DbSet<AgentProfileRow> AgentProfiles => Set<AgentProfileRow>();
    public DbSet<UserTokenRow> UserTokens => Set<UserTokenRow>();
    public DbSet<AuditLogRow> AuditLog => Set<AuditLogRow>();
    public DbSet<ClientRow> Clients => Set<ClientRow>();
    public DbSet<WorkitemRow> Workitems => Set<WorkitemRow>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<UserRow>(e =>
        {
            e.ToTable("users");
            e.HasKey(x => x.Id);
        });
        b.Entity<UserIdentityRow>(e =>
        {
            e.ToTable("user_identity");
            e.HasKey(x => x.Id);
        });
        b.Entity<LocalCredentialRow>(e =>
        {
            e.ToTable("local_credential");
            e.HasKey(x => x.UserId);
        });
        b.Entity<TeamRow>(e =>
        {
            e.ToTable("team");
            e.HasKey(x => x.Id);
        });
        b.Entity<TeamMemberRow>(e =>
        {
            e.ToTable("team_member");
            e.HasKey(x => new { x.TeamId, x.UserId });
        });
        b.Entity<PermissionRow>(e =>
        {
            e.ToTable("permission");
            e.HasKey(x => x.Code);
        });
        b.Entity<SecurityRoleRow>(e =>
        {
            e.ToTable("security_role");
            e.HasKey(x => x.Id);
        });
        b.Entity<SecurityRolePermissionRow>(e =>
        {
            e.ToTable("security_role_permission");
            e.HasKey(x => new { x.SecurityRoleId, x.PermissionCode });
        });
        b.Entity<SecurityRoleAssignmentRow>(e =>
        {
            e.ToTable("security_role_assignment");
            e.HasKey(x => x.Id);
        });
        b.Entity<AgentProfileRow>(e =>
        {
            e.ToTable("agent_profile");
            e.HasKey(x => x.UserId);
        });
        b.Entity<UserTokenRow>(e =>
        {
            e.ToTable("user_token");
            e.HasKey(x => x.Id);
        });
        b.Entity<AuditLogRow>(e =>
        {
            e.ToTable("audit_log");
            e.HasKey(x => x.Id);
            e.Property(x => x.Before).HasColumnType("jsonb");
            e.Property(x => x.After).HasColumnType("jsonb");
        });
        b.Entity<ClientRow>(e =>
        {
            e.ToTable("client");
            e.HasKey(x => x.Id);
        });
        b.Entity<WorkitemRow>(e =>
        {
            e.ToTable("workitem");
            e.HasKey(x => x.Id);
        });

        // Foreign keys, declared so EF Core saves a parent before its children
        // (a new user before their password, a role before its permissions).
        b.Entity<UserIdentityRow>().HasOne<UserRow>().WithMany().HasForeignKey(x => x.UserId);
        b.Entity<LocalCredentialRow>().HasOne<UserRow>().WithOne().HasForeignKey<LocalCredentialRow>(x => x.UserId);
        b.Entity<TeamMemberRow>().HasOne<TeamRow>().WithMany().HasForeignKey(x => x.TeamId);
        b.Entity<TeamMemberRow>().HasOne<UserRow>().WithMany().HasForeignKey(x => x.UserId);
        b.Entity<SecurityRolePermissionRow>().HasOne<SecurityRoleRow>().WithMany().HasForeignKey(x => x.SecurityRoleId);
        b.Entity<SecurityRolePermissionRow>().HasOne<PermissionRow>().WithMany().HasForeignKey(x => x.PermissionCode);
        b.Entity<SecurityRoleAssignmentRow>().HasOne<SecurityRoleRow>().WithMany().HasForeignKey(x => x.SecurityRoleId);
        b.Entity<AgentProfileRow>().HasOne<UserRow>().WithOne().HasForeignKey<AgentProfileRow>(x => x.UserId);
        b.Entity<UserTokenRow>().HasOne<UserRow>().WithMany().HasForeignKey(x => x.UserId);

        // Defaults the database fills in (now(), gen_random_uuid()).
        foreach (var t in new[] { typeof(UserRow), typeof(UserIdentityRow), typeof(TeamRow), typeof(SecurityRoleRow),
                                  typeof(SecurityRoleAssignmentRow), typeof(UserTokenRow), typeof(AuditLogRow) })
            b.Entity(t).Property("Id").HasDefaultValueSql("gen_random_uuid()");
    }
}
