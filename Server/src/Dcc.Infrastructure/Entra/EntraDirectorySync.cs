using Dcc.Application.Auth;
using Dcc.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Graph.Models;

namespace Dcc.Infrastructure.Entra;

/// <summary>
/// Keeps teams that mirror an Entra group (team.source = 'entra') in step with
/// the group's members, and mirrors "account disabled" in Entra onto the
/// linked DCC user. Runs every <see cref="EntraOptions.DirectorySyncMinutes"/>;
/// does nothing at all while Entra is not configured.
/// </summary>
public sealed class EntraDirectorySync(IServiceScopeFactory scopes, IOptions<EntraOptions> options, ILogger<EntraDirectorySync> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.IsConfigured)
        {
            logger.LogInformation("Entra is not configured — the directory sync is off.");
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Max(1, options.Value.DirectorySyncMinutes)));
        do
        {
            try
            {
                await SyncOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Entra directory sync failed; will retry on the next round.");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task SyncOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DccDbContext>();
        var bumper = scope.ServiceProvider.GetRequiredService<IPermissionVersionBumper>();
        var graph = scope.ServiceProvider.GetRequiredService<GraphClientFactory>().Create();
        var now = DateTimeOffset.UtcNow;

        foreach (var team in await db.Teams.Where(t => t.Source == "entra" && t.ArchivedAt == null).ToListAsync(ct))
        {
            var members = new List<User>();
            var page = await graph.Groups[team.ExternalId].Members.GraphUser.GetAsync(r => r.QueryParameters.Select = ["id", "displayName", "mail", "userPrincipalName", "userType", "accountEnabled"], ct);
            while (page is not null)
            {
                members.AddRange(page.Value ?? []);
                page = page.OdataNextLink is { } next ? await graph.Groups[team.ExternalId].Members.GraphUser.WithUrl(next).GetAsync(cancellationToken: ct) : null;
            }

            var wanted = new HashSet<Guid>();
            foreach (var m in members.Where(m => m.Id is not null))
            {
                var user = await EnsureUserAsync(db, m, now, ct);
                wanted.Add(user.Id);
            }

            var current = await db.TeamMembers.Where(x => x.TeamId == team.Id).ToListAsync(ct);
            var removed = current.Where(x => !wanted.Contains(x.UserId)).ToList();
            var added = wanted.Where(id => current.All(x => x.UserId != id)).ToList();
            db.TeamMembers.RemoveRange(removed);
            db.TeamMembers.AddRange(added.Select(id => new TeamMemberRow { TeamId = team.Id, UserId = id, Source = "entra", AddedAt = now }));
            await db.SaveChangesAsync(ct);
            await bumper.BumpUsersAsync(removed.Select(r => r.UserId).Concat(added), ct);
            if (removed.Count + added.Count > 0)
                logger.LogInformation("Entra team {Team}: +{Added} −{Removed} members", team.Name, added.Count, removed.Count);
        }
    }

    private static async Task<UserRow> EnsureUserAsync(DccDbContext db, User m, DateTimeOffset now, CancellationToken ct)
    {
        var email = (m.Mail ?? m.UserPrincipalName ?? $"{m.Id}@entra.local").ToLowerInvariant();
        var identity = await db.UserIdentities.FirstOrDefaultAsync(i => i.Provider == "entra" && i.Subject == m.Id, ct);
        var user = identity is not null
            ? await db.Users.FirstAsync(u => u.Id == identity.UserId, ct)
            : await db.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == email, ct);

        if (user is null)
        {
            user = new UserRow { Id = Guid.NewGuid(), Email = email, DisplayName = m.DisplayName ?? email, Kind = m.UserType == "Guest" ? "guest" : "person", CreatedAt = now };
            db.Users.Add(user);
        }
        user.EntraOid ??= m.Id;
        if (m.DisplayName is { Length: > 0 } name) user.DisplayName = name;
        if (m.AccountEnabled == false && user.DisabledAt is null) user.DisabledAt = now;
        if (identity is null)
            db.UserIdentities.Add(new UserIdentityRow { UserId = user.Id, Provider = "entra", Subject = m.Id!, Email = email, CreatedAt = now });
        await db.SaveChangesAsync(ct);
        return user;
    }
}
