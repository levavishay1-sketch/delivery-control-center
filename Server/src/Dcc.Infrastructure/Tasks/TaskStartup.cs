using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dcc.Infrastructure.Tasks;

/// <summary>
/// Once, at start: open tasks from before DCC added checks by itself get them, and every stored state is
/// brought to the rule "failed_checks only while a check failed". After the first time, one query each.
/// </summary>
public sealed class TaskStartup(IServiceScopeFactory scopes, ILogger<TaskStartup> log) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var runs = scope.ServiceProvider.GetRequiredService<TaskRunService>();
            var added = await runs.BackfillStandardChecksAsync(ct);
            if (added > 0) log.LogInformation("checks: added the required checks to {Count} task(s) from before they existed", added);
            var resynced = await runs.ResyncTaskStatesAsync(ct);
            if (resynced > 0) log.LogInformation("tasks: {Count} stored state(s) left in failed_checks with nothing failed — brought back in line", resynced);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogError(e, "tasks: the start-up pass failed");
        }
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
