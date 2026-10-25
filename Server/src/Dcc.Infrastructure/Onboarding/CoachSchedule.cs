using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// The coach's weekly look at the world (coach.ts scheduleCoach): two minutes after the server starts, then every seven
/// days, every remembered marketplace source is fetched again — the dossiers of the repositories with that stack show
/// what changed as "new in the world". Each pass runs in its own scope; a failure is logged and the next pass tries again.
/// </summary>
public sealed class CoachSchedule(IServiceScopeFactory scopes, IOptions<OnboardingOptions> options, ILogger<CoachSchedule> log) : BackgroundService
{
    private static readonly TimeSpan FirstAfter = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan Every = TimeSpan.FromDays(7);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.CoachRecheck) return;
        try
        {
            await Task.Delay(FirstAfter, stoppingToken);
            using var timer = new PeriodicTimer(Every);
            do await RunOnceAsync(stoppingToken);
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var (checkedCount, changed) = await scope.ServiceProvider.GetRequiredService<CoachService>()
                .RecheckMarketplaceSourcesAsync(line => log.LogInformation("{Line}", line), ct);
            if (checkedCount > 0) log.LogInformation("coach: {Checked} marketplace source(s) rechecked, {Changed} changed", checkedCount, changed);
        }
        catch (Exception e) when (e is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            log.LogError(e, "coach: the weekly recheck of marketplace sources failed");
        }
    }
}
