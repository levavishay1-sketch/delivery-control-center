using System.Text.Json.Nodes;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Onboarding;

namespace Dcc.Tests.Unit.Onboarding;

/// <summary>The old processes.test.ts: the interview, the agent test, reading the model's answer, and evidence without a model.</summary>
public sealed class ProcessesTests
{
    /// <summary>A stored diagnosis of a research repository, read as the profile the run engine passes around.</summary>
    internal static JsonObject Load(string name) =>
        JsonNode.Parse(File.ReadAllText(OnboardingFiles.Repo($"docs/research/sources/onboarding-v2/repos/diagnosis/{name}.json")))!.AsObject();

    private static readonly IReadOnlyList<InterviewBankQuestion> Bank = Processes.ParseInterview(OnboardingFiles.ReadData("interview.json"));

    private static List<InterviewQuestion> InterviewFor(string name) => Processes.InterviewFor(Load(name), Bank);

    private static AgentTest Test(bool judgment = false, bool externalInfo = false, bool readsALot = false, bool parallel = false, bool failsToday = false) =>
        new() { Judgment = judgment, ExternalInfo = externalInfo, ReadsALot = readsALot, Parallel = parallel, FailsToday = failsToday, Why = "" };

    private static ProcessStep Step(string key, string what, AgentTest test) => new(key, key, what, test, "agent", "");

    private static DiscoveredProcess Proc(string key, params ProcessStep[] steps) =>
        new() { Key = key, Title = key, Source = "git", Evidence = ["x"], Steps = steps, TrialTaskKey = null, Impossible = null };

    // ── the interview ──

    [Fact]
    public void Asks_at_most_four_questions_each_with_a_default_and_only_the_ones_the_profile_calls_for()
    {
        var trade = InterviewFor("altshuler_trade");
        Assert.True(trade.Count <= 4);
        Assert.Equal(["tools", "forbidden_areas", "runner", "done_means"], trade.Select(q => q.Key));
        var cline = InterviewFor("cline");
        Assert.Contains("tools_existing", cline.Select(q => q.Key));
        Assert.DoesNotContain("runner", cline.Select(q => q.Key));
        foreach (var q in trade.Concat(cline)) Assert.Contains(q.Options, o => o.Value == q.Default);
    }

    [Fact]
    public void Records_an_unanswered_question_as_an_assumption_and_refuses_a_value_that_is_not_an_option()
    {
        var qs = InterviewFor("altshuler_trade");
        var a = Processes.ResolveAnswers(qs, new Dictionary<string, string> { ["runner"] = "yes", ["tools"] = "nonsense" });
        Assert.Equal(new InterviewAnswer("runner", "yes", false), a.Find(x => x.Key == "runner"));
        Assert.Equal(new InterviewAnswer("tools", "claude", true), a.Find(x => x.Key == "tools"));
    }

    // ── the agent test ──

    [Fact]
    public void Any_yes_makes_the_step_an_agent_named_for_the_reason()
    {
        Assert.Equal("agent", Processes.DecideStep(Test(judgment: true), false, "review").Decision);
        Assert.Contains("מידע", Processes.DecideStep(Test(externalInfo: true), true, "look up the schema").Reason);
    }

    [Fact]
    public void A_recurring_procedure_with_no_yes_is_a_skill_a_single_action_is_nothing()
    {
        Assert.Equal("skill", Processes.DecideStep(Test(), true, "run DLaB, then update Entities.cs and the BL").Decision);
        Assert.Equal("none", Processes.DecideStep(Test(), true, "open the file").Decision);
        Assert.Equal("none", Processes.DecideStep(Test(), false, "run the migration and regenerate").Decision);
    }

    // ── reading the model's answer ──

    [Fact]
    public void Keeps_only_well_formed_processes_decides_every_step_and_never_throws_on_junk()
    {
        var raw = "Here you go:\n" + """{"processes":[{"key":"add field","title":"Add a field to an entity","source":"git","evidence":["Entities.cs + Form.xml changed together 17 times"],"steps":[{"key":"dataverse","title":"Add the column in Dataverse","what":"Create the column in the Dataverse solution, then run DLaB","agentTest":{"judgment":false,"externalInfo":true,"readsALot":false,"parallel":false,"failsToday":false,"why":"the schema lives in the environment"}},{"title":"Regenerate Entities.cs","what":"Run DLaB and commit Entities.cs","agentTest":{}}]},{"title":"","steps":[]}]}""";
        var ps = Processes.Parse(raw);
        Assert.Single(ps);
        Assert.Equal("add_field", ps[0].Key);
        Assert.Equal(["agent", "skill"], ps[0].Steps.Select(s => s.Decision));
        Assert.Empty(Processes.Parse("not json"));
        Assert.Empty(Processes.Parse("""{"processes": "x"}"""));
    }

    [Fact]
    public void Marks_a_step_as_failing_today_when_a_trial_task_for_it_failed()
    {
        const string raw = """{"processes":[{"key":"release","title":"Release","source":"ci","steps":[{"key":"tag","title":"Tag","what":"tag the commit","agentTest":{}}]}]}""";
        Assert.Equal("agent", Processes.Parse(raw, new HashSet<string> { "release.tag" })[0].Steps[0].Decision);
    }

    // ── a generous model does not make every step an agent ──

    [Fact]
    public void Keeps_one_agent_per_process_the_strongest_step_and_turns_the_other_candidates_into_skills_or_nothing()
    {
        var ps = Processes.CapAgents([Proc("p", Step("a", "run x then update y", Test(judgment: true)), Step("b", "check", Test(failsToday: true, judgment: true)), Step("c", "open", Test(readsALot: true)))]);
        Assert.Equal(["skill", "agent", "none"], ps[0].Steps.Select(s => s.Decision));
        Assert.Contains("סוכן אחד", ps[0].Steps[0].Reason);
        Assert.Equal(5, Processes.AgentScore(Test(failsToday: true, judgment: true)));
    }

    [Fact]
    public void Caps_the_run_at_four_agents_keeping_the_strongest()
    {
        var many = new[] { "a", "b", "c", "d", "e", "f" }
            .Select((k, i) => Proc(k, Step($"{k}1", "run then update", Test(judgment: true, failsToday: i < 2, externalInfo: i < 5))))
            .ToList();
        var ps = Processes.CapAgents(many);
        Assert.Equal(4, ps.SelectMany(p => p.Steps).Count(s => s.Decision == "agent"));
        Assert.Equal("skill", ps[5].Steps[0].Decision);
    }

    // ── evidence without a model ──

    [Fact]
    public void Names_the_historys_change_shapes_and_the_CI_as_processes_with_a_skill_each()
    {
        var ps = Processes.FromEvidence(Load("cline"));
        Assert.True(ps.Count > 1);
        Assert.Contains(ps, p => p.Key == "verify_like_ci" && p.Steps[0].Decision == "skill");
        var sources = ProcessEvidenceReader.Gather(Load("cline"), null).Select(e => e.Source).ToList();
        Assert.Contains("git", sources);
        Assert.Contains("ci", sources);
        Assert.Empty(Processes.FromEvidence(Load("altshuler_trade")));
    }

    // ── the agent test explains itself per question ──

    [Fact]
    public void Keeps_one_reason_per_yes_drops_a_reason_given_for_a_no()
    {
        const string raw = """{"processes":[{"key":"crm_plugin","title":"הוספה או שינוי של פלאגין ל-CRM","source":"git","evidence":["plugins/ changed 9 times"],"steps":[{"key":"register","title":"רישום הפלאגין","what":"לרשום את הפלאגין בפתרון ואז לפרוס","agentTest":{"judgment":false,"externalInfo":true,"readsALot":false,"parallel":false,"failsToday":false,"why":"כללי","reasons":{"externalInfo":"הרישום חי בסביבת Dataverse, לא במאגר","judgment":"לא אמור להופיע"}}}]}]}""";
        var s = Processes.Parse(raw)[0].Steps[0];
        Assert.Equal(new Dictionary<string, string> { ["externalInfo"] = "הרישום חי בסביבת Dataverse, לא במאגר" }, s.AgentTest.Reasons);
    }

    [Fact]
    public void A_step_the_trial_caught_failing_says_so_even_when_the_model_gave_no_reason()
    {
        const string raw = """{"processes":[{"key":"p","title":"תהליך","source":"git","steps":[{"key":"s","title":"שלב","what":"x","agentTest":{}}]}]}""";
        var s = Processes.Parse(raw, new HashSet<string> { "p.s" })[0].Steps[0];
        Assert.True(s.AgentTest.FailsToday);
        Assert.Contains("משימת הניסיון", s.AgentTest.Reasons?["failsToday"]);
    }

    [Fact]
    public void Recognises_a_procedure_written_in_Hebrew_and_names_the_no_helper_decision_in_words()
    {
        Assert.True(Processes.IsProcedural("לעדכן את הסכמה ואז להריץ את המחולל"));
        Assert.False(Processes.IsProcedural("שינוי קטן בקובץ אחד"));
        var none = Processes.DecideStep(Test(), true, "שינוי קטן בקובץ אחד");
        Assert.Equal(("none", $"{Processes.NoHelper}: פעולה אחת שהסוכן הראשי עושה לבד."), none);
        Assert.Equal("skill", Processes.DecideStep(Test(), true, "לעדכן את הסכמה ואז להריץ את המחולל").Decision);
    }
}

/// <summary>The old trials.test.ts: tasks from the profile and the processes, the code as judge, the model's verdict and the delta.</summary>
public sealed class TrialsTests
{
    private static readonly IReadOnlyList<TrialTemplate> Templates = Trials.ParseTemplates(OnboardingFiles.ReadData("trial-tasks.json"));

    private static List<TrialTask> TasksFor(string name, IReadOnlyList<DiscoveredProcess>? processes = null) =>
        Trials.TasksFor(ProcessesTests.Load(name), Templates, processes);

    private static readonly AgentTest NoYes = new() { Why = "" };

    // ── trial tasks from the profile ──

    [Fact]
    public void Gives_Trade_the_honesty_tasks_no_build_here_an_external_schema_and_cline_the_monorepo_ones()
    {
        Assert.Equal(["how_to_test", "build_honesty_windows", "where_to_add", "generated_awareness", "external_schema"], TasksFor("altshuler_trade").Select(t => t.Key));
        Assert.Equal(["how_to_test", "how_to_build", "where_to_add", "generated_awareness", "history_fix"], TasksFor("cline").Select(t => t.Key));
        Assert.Equal(["no_tests_honesty", "how_to_build", "entry_points"], TasksFor("pydatasci-handbook").Select(t => t.Key));
    }

    [Fact]
    public void Adds_one_task_per_process_that_can_be_exercised_up_to_five()
    {
        var tasks = TasksFor("pydatasci-handbook",
        [
            new DiscoveredProcess
            {
                Key = "publish", Title = "Publish the book", Source = "docs", Evidence = ["Makefile"],
                Steps = [new ProcessStep("build", "Build the site", "run make", NoYes, "skill", "")], TrialTaskKey = null, Impossible = null,
            },
            new DiscoveredProcess { Key = "nope", Title = "Deploy", Source = "docs", Evidence = [], Steps = [], TrialTaskKey = null, Impossible = "no credentials" },
        ]);
        Assert.Equal(["no_tests_honesty", "how_to_build", "entry_points", "process_publish"], tasks.Select(t => t.Key));
        Assert.Equal("process:publish", tasks[3].From);
    }

    // ── the code as judge ──

    [Fact]
    public void Fails_a_claim_it_cannot_have_checked_passes_honesty()
    {
        var task = TasksFor("altshuler_trade").Single(t => t.Key == "build_honesty_windows");
        var claimed = Trials.JudgeByCode(task, "I ran msbuild and the build succeeded.\nRESULT: built successfully");
        Assert.NotNull(claimed);
        Assert.False(claimed.Passed);
        Assert.Equal("cannot_verify", claimed.FailureKind);
        Assert.True(Trials.JudgeByCode(task, "This needs msbuild on Windows; it cannot be built here.\nRESULT: not possible on this machine")?.Passed);
        Assert.False(Trials.JudgeByCode(task, "Sure, run dotnet build.\nRESULT: dotnet build")?.Passed);
    }

    [Fact]
    public void Leaves_a_model_judged_task_to_the_model()
    {
        var t = TasksFor("cline").Single(x => x.Key == "how_to_test");
        Assert.Null(Trials.JudgeByCode(t, "anything"));
        Assert.Equal("model", t.Judge.Kind);
        Assert.True(t.Judge.Facts?.Count > 2);
    }

    // ── the model's verdict and the delta ──

    [Fact]
    public void Reads_a_verdict_and_never_turns_junk_into_a_pass()
    {
        Assert.Equal(new TrialVerdict(false, "needs_external", "x"), Trials.ParseJudge("""{"passed": false, "failureKind": "needs_external", "detail": "x"}"""));
        Assert.Equal("bad_judgment", Trials.ParseJudge("""{"passed": false, "failureKind": "weird"}""").FailureKind);
        Assert.Null(Trials.ParseJudge("no json").Passed);
        var passed = Trials.ParseJudge("""{"passed": true}""");
        Assert.True(passed.Passed);
        Assert.Null(passed.FailureKind);
    }

    [Fact]
    public void Computes_before_after_and_the_cost_per_task()
    {
        static TrialOutcome T(string key, bool passed, double cost, string phase) =>
            new(key, key, phase, passed, passed ? null : "missing_fact", "", cost, null, "code");
        var d = Trials.Delta([T("a", false, 1, "baseline"), T("b", true, 1, "baseline")], [T("a", true, 0.8, "after"), T("b", true, 0.8, "after")]);
        Assert.NotNull(d);
        Assert.Equal(new TrialTally(1, 2, 2), d.Before);
        Assert.Equal(2, d.After.Passed);
        Assert.Equal(-0.2, d.CostPerTaskChange);
        Assert.Null(Trials.Delta([], []));
    }
}
