namespace Dcc.Infrastructure.Onboarding;

/// <summary>Bound from <c>Onboarding</c>.</summary>
public sealed class OnboardingOptions
{
    public const string Section = "Onboarding";

    /// <summary>Server/onboarding: the rules table, the interview, the trial tasks and the operator catalog's templates — data, not code.</summary>
    public string DataPath { get; set; } = "../../onboarding";

    /// <summary>
    /// Where each run's isolated copy (a worktree on its own ai/onboarding/&lt;run&gt; branch) and its runtime folder live. Under
    /// the home folder, not TEMP: TEMP can resolve to an 8.3 short name, which Claude Code's write check refuses.
    /// </summary>
    public string WorkspaceRoot { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dcc-repos-onboarding");

    /// <summary>The coach's weekly recheck of the remembered marketplace sources. Off in the tests, which never reach the internet.</summary>
    public bool CoachRecheck { get; set; } = true;
}
