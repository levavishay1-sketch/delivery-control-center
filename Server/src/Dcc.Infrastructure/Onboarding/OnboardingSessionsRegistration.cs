using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// The interactive half of repository onboarding: the run's terminal (session.ts), the <c>/init</c> draft session
/// (draft.ts), the coach (coach.ts) with its weekly recheck, and opening a DCC folder on this machine (local-folder.ts).
/// Calling this a second time (a test host may, after the engine did) changes nothing. What it
/// needs from the engine is registered there: <see cref="RepoAiEvents"/>, <see cref="ICoachRunStarter"/> (the engine
/// itself), and the restart and shutdown (<c>OnboardingStartup</c>, which calls <see cref="IDraftSessions.KillAll"/>).
/// </summary>
public static class OnboardingSessionsRegistration
{
    public static IServiceCollection AddOnboardingSessions(this IServiceCollection services)
    {
        // Called a second time it adds nothing: binding the options twice would list Onboarding:Terminal:BinArgs twice.
        if (services.Any(d => d.ServiceType == typeof(OnboardingTerminal))) return services;
        services.AddOptions<OnboardingOptions>().BindConfiguration(OnboardingOptions.Section);
        services.AddOptions<OnboardingTerminalOptions>().BindConfiguration(OnboardingTerminalOptions.Section);

        // One terminal and one set of draft sessions for the whole server: a session outlives the request that opened it.
        services.TryAddSingleton<OnboardingTerminal>();
        services.TryAddSingleton<IOnboardingTerminal>(sp => sp.GetRequiredService<OnboardingTerminal>());
        services.TryAddSingleton<DraftSessions>();
        services.TryAddSingleton<IDraftSessions>(sp => sp.GetRequiredService<DraftSessions>());

        services.TryAddScoped<CoachService>();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, CoachSchedule>());

        services.TryAddSingleton<IFolderLauncher, ShellFolderLauncher>();
        services.TryAddScoped<LocalFolder>();
        return services;
    }
}

