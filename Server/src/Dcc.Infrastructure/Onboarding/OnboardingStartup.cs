using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// Onboarding across a restart (server.ts recoverOnboardingRuns / killAllSessions). At start, what was mid-flight when
/// the server stopped is marked so — a running step failed with "run it again", a running scan of the draft failed, a
/// live draft session disconnected — and waits for a person's click: nothing spends money by itself after a restart. At
/// stop, every draft session is killed, so no claude.exe outlives the server and keeps spending.
/// </summary>
public sealed class OnboardingStartup(IServiceScopeFactory scopes, IDraftSessions drafts, ILogger<OnboardingStartup> log) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var touched = await scope.ServiceProvider.GetRequiredService<OnboardingRuns>().RecoverAsync(ct);
            if (touched > 0) log.LogInformation("onboarding: {Count} step(s), scan(s) or draft session(s) were mid-flight when the server stopped — marked, waiting for a click", touched);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogError(e, "onboarding: the start-up recovery failed");
        }
    }

    public Task StopAsync(CancellationToken ct)
    {
        try { drafts.KillAll(); }
        catch (Exception e) { log.LogError(e, "onboarding: the draft sessions could not all be killed at shutdown"); }
        return Task.CompletedTask;
    }
}
