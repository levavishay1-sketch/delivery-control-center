namespace Dcc.Tests.Unit.Onboarding;

/// <summary>The onboarding data files (Server/onboarding/…) and the research fixtures (docs/research/…), found from the repository.</summary>
internal static class OnboardingFiles
{
    public static string Data(string relative) => ModelPolicyLayoutTests.FindRepoFile(Path.Combine("Server", "onboarding", relative));

    public static string Repo(string relative) => ModelPolicyLayoutTests.FindRepoFile(relative);

    public static string ReadData(string relative) => File.ReadAllText(Data(relative));
}
