using System.Text.Json.Nodes;
using Dcc.Domain.Onboarding;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// What onboarding decides from — data, not code (Server/onboarding): the rules table (<c>rules.json</c>), the interview
/// bank (<c>interview.json</c>), the trial task templates (<c>trial-tasks.json</c>) and the operator catalog's templates.
/// Read once, on first use, from <see cref="OnboardingOptions.DataPath"/> — relative to the API project, as the glossary
/// and the policy are; an edit there is picked up by the next start.
/// </summary>
public sealed class OnboardingData
{
    private readonly Lazy<IReadOnlyList<JsonObject>> _rules;
    private readonly Lazy<IReadOnlyList<InterviewBankQuestion>> _interview;
    private readonly Lazy<IReadOnlyList<TrialTemplate>> _trials;
    private readonly Lazy<OnboardingCatalog> _catalog;

    public OnboardingData(IOptions<OnboardingOptions> options, IHostEnvironment env)
    {
        var data = options.Value.DataPath;
        Dir = Path.IsPathRooted(data) ? data : Path.GetFullPath(Path.Combine(env.ContentRootPath, data));
        _rules = new(() => Dcc.Domain.Onboarding.Rules.Parse(Read("rules.json")));
        _interview = new(() => Processes.ParseInterview(Read("interview.json")));
        _trials = new(() => Trials.ParseTemplates(Read("trial-tasks.json")));
        _catalog = new(() => new OnboardingCatalog(Path.Combine(Dir, "catalog", "templates")));
    }

    /// <summary>The data folder, resolved.</summary>
    public string Dir { get; }

    public IReadOnlyList<JsonObject> Rules => _rules.Value;
    public IReadOnlyList<InterviewBankQuestion> Interview => _interview.Value;
    public IReadOnlyList<TrialTemplate> TrialTemplates => _trials.Value;
    public OnboardingCatalog Catalog => _catalog.Value;

    private string Read(string file) => File.ReadAllText(Path.Combine(Dir, file));
}
