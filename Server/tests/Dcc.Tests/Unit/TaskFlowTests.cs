using Dcc.Domain.Tasks;
using Dcc.Infrastructure.Tasks;

namespace Dcc.Tests.Unit;

/// <summary>The old task-flow-steps tests, one for one.</summary>
public sealed class TaskFlowStepsTests
{
    private static FlowBase Base(int[]? without = null, int? on = null, string? sha = null) => new(on is null ? null : new FlowBaseOn(on.Value, sha), without ?? []);
    private static readonly FlowChecks None = new(0, 0, 0, 0);

    private static FlowCycle Run(FlowBase? b = null, string state = "done", bool buildVerified = true, bool buildFailed = false, FlowChecks? checks = null, bool reviewed = false, string? runId = null, string startedAt = "2026-09-20T10:00:00Z") =>
        new() { State = state, StartedAt = startedAt, Base = b ?? Base(), BuildVerified = buildVerified, BuildFailed = buildFailed, Checks = checks ?? new FlowChecks(2, 2, 0, 0), Reviewed = reviewed, RunId = runId };

    private static FlowNow Now(string? running = null, bool closed = false, int[]? pending = null) => new(running, closed, pending ?? []);
    private static List<string> Shape(IEnumerable<FlowStep> steps) => steps.Select(s => $"{s.Kind}:{s.State}").ToList();

    [Fact]
    public void Three_steps_for_a_task_that_has_not_run() =>
        Assert.Equal(["develop:current", "checks:todo", "review:todo"], Shape(TaskFlowSteps.Steps([], Now())));

    [Fact]
    public void No_trace_of_a_dependency_there_before_the_start() =>
        Assert.Equal(["develop", "checks", "review"], TaskFlowSteps.Steps([Run(Base([], 3))], Now()).Select(s => s.Kind));

    [Fact]
    public void The_dependency_step_before_the_checks_when_it_arrived_before_they_ran()
    {
        var steps = TaskFlowSteps.Steps([Run(Base([3]), checks: None), Run(Base([], 3), startedAt: "2026-09-22T10:00:00Z")], Now());
        Assert.Equal(["develop:done", "dependency:done", "checks:done", "review:current"], Shape(steps));
        Assert.Equal([3], steps[1].Deps!);
    }

    [Fact]
    public void Checks_again_when_the_dependency_arrived_after_they_ran()
    {
        var steps = TaskFlowSteps.Steps([Run(Base([3])), Run(Base([], 3))], Now());
        Assert.Equal(["develop:done", "checks:done", "dependency:done", "checks:done", "review:current"], Shape(steps));
        Assert.Equal(["develop", "checks"], steps.Where(s => s.Past).Select(s => s.Kind));
    }

    [Fact]
    public void Checks_and_review_again_when_it_arrived_after_the_review() =>
        Assert.Equal(["develop", "checks", "review", "dependency", "checks", "review"],
            TaskFlowSteps.Steps([Run(Base([3]), reviewed: true), Run(Base([], 3))], Now()).Select(s => s.Kind));

    [Fact]
    public void The_dependency_step_is_next_the_moment_its_work_exists()
    {
        var steps = TaskFlowSteps.Steps([Run(Base([3]))], Now(pending: [3]));
        Assert.Equal(["develop:done", "checks:done", "dependency:current", "checks:done", "review:current"], Shape(steps));
        Assert.Contains("#3", steps[2].Note);
    }

    [Fact]
    public void Going_on_without_rebuilding_keeps_the_checks_state()
    {
        var failed = TaskFlowSteps.Steps([Run(Base([3]), checks: new FlowChecks(2, 1, 1, 0))], Now(pending: [3]));
        Assert.Equal(["develop:done", "checks:failed", "dependency:current", "checks:failed", "review:todo"], Shape(failed));
        Assert.True(failed[2].Pending);
        var unbuilt = TaskFlowSteps.Steps([Run(Base([3]), buildVerified: false, checks: None)], Now(pending: [3]));
        Assert.Equal(["checks:todo", "review:todo"], Shape(unbuilt).TakeLast(2));
    }

    [Fact]
    public void A_base_that_moved_on_is_the_dependency_coming_in_again()
    {
        Assert.Equal([3], TaskFlowSteps.GainedDeps(Base([], 3, "aaa"), Base([], 3, "bbb")));
        Assert.Empty(TaskFlowSteps.GainedDeps(Base([], 3, "aaa"), Base([], 3, "aaa")));
        Assert.Equal(["develop", "checks", "dependency", "checks", "review"],
            TaskFlowSteps.Steps([Run(Base([], 3, "aaa")), Run(Base([], 3, "bbb"))], Now()).Select(s => s.Kind));
    }

    [Fact]
    public void N_dependencies_at_different_times_are_one_step_each()
    {
        var steps = TaskFlowSteps.Steps([Run(Base([2, 3])), Run(Base([2], 3)), Run(Base([], 3))], Now());
        Assert.Equal([[3], [2]], steps.Where(s => s.Kind == "dependency").Select(s => s.Deps!.ToArray()));
    }

    [Fact]
    public void A_plain_run_again_starts_no_round() =>
        Assert.Equal(["develop", "checks", "review"], TaskFlowSteps.Steps([Run(), Run(state: "error"), Run()], Now()).Select(s => s.Kind));

    [Fact]
    public void Follows_a_run_step_by_step()
    {
        Assert.Equal(["develop:current", "checks:todo", "review:todo"], Shape(TaskFlowSteps.Steps([Run(state: "running")], Now("build"))));
        Assert.Equal(["develop:done", "checks:current", "review:todo"], Shape(TaskFlowSteps.Steps([Run(state: "running")], Now("test"))));
    }

    [Fact]
    public void Marks_where_it_fell()
    {
        Assert.Equal(["develop:failed", "checks:todo", "review:todo"], Shape(TaskFlowSteps.Steps([Run(buildFailed: true, checks: None)], Now())));
        Assert.Equal(["develop:done", "checks:failed", "review:todo"], Shape(TaskFlowSteps.Steps([Run(checks: new FlowChecks(2, 1, 1, 0))], Now())));
        Assert.Equal(["develop:failed", "checks:todo", "review:todo"], Shape(TaskFlowSteps.Steps([Run(state: "error")], Now())));
    }

    [Fact]
    public void Development_is_not_done_before_a_run_finished()
    {
        Assert.Equal("current", TaskFlowSteps.Steps([], Now())[0].State);
        Assert.Equal("current", TaskFlowSteps.Steps([Run(state: "rolled_back")], Now())[0].State);
    }

    [Fact]
    public void Development_is_not_done_on_an_unverified_build() =>
        Assert.Equal(["develop:current", "checks:todo", "review:todo"], Shape(TaskFlowSteps.Steps([Run(buildVerified: false, checks: None)], Now())));

    [Fact]
    public void Done_when_the_task_was_closed() => Assert.Equal("done", TaskFlowSteps.Steps([Run()], Now(closed: true))[^1].State);

    [Fact]
    public void A_past_step_keeps_what_really_happened()
    {
        var b = TaskFlowSteps.Steps([Run(Base([3]), buildFailed: true, checks: None)], Now(pending: [3]));
        Assert.Equal(["develop:failed"], Shape(b.Where(x => x.Past)));
        var c = TaskFlowSteps.Steps([Run(Base([3]), checks: new FlowChecks(2, 1, 1, 0))], Now(pending: [3]));
        Assert.Equal(["develop:done", "checks:failed"], Shape(c.Where(x => x.Past)));
    }

    [Fact]
    public void A_past_step_knows_its_run()
    {
        var steps = TaskFlowSteps.Steps([Run(Base([3]), runId: "r1"), Run(Base([3]), runId: "r2")], Now(pending: [3]));
        Assert.Equal(["develop:r2", "checks:r2"], steps.Where(x => x.Past).Select(x => $"{x.Kind}:{x.RunId}"));
    }

    [Fact]
    public void Live_state_reads_the_build_checks_live_result()
    {
        LiveCheck[] live = [new("build", "passed", null), new("tests", "failed", null), new("regression", "failed", null)];
        var (v, f, k) = TaskFlowSteps.LiveCycleState(live);
        Assert.Equal((true, false, 2, 0, 2, 0), (v, f, k.Ran, k.Passed, k.Failed, k.Waiting));
        var stale = TaskFlowSteps.Steps([Run(buildFailed: true, checks: None)], Now());
        var overlaid = TaskFlowSteps.Steps([TaskFlowSteps.WithLive(Run(), live)], Now());
        Assert.Equal(["develop:done", "checks:failed", "review:todo"], Shape(overlaid));
        Assert.Equal("failed", stale[0].State);
    }

    [Fact]
    public void Live_state_with_nothing_run()
    {
        var (v, f, k) = TaskFlowSteps.LiveCycleState([new("build", null, null)]);
        Assert.Equal((false, false, 0), (v, f, k.Ran));
    }

    [Fact]
    public void A_check_still_to_do_keeps_the_checks_step_open()
    {
        LiveCheck[] live = [new("build", "passed", null), new("tests", "passed", null), new("regression", null, null)];
        var k = TaskFlowSteps.LiveCycleState(live).Checks;
        Assert.Equal((1, 1, 1), (k.Ran, k.Passed, k.NotRun));
        Assert.Equal(["develop:done", "checks:current", "review:todo"], Shape(TaskFlowSteps.Steps([TaskFlowSteps.WithLive(Run(), live)], Now())));
        var all = live.Select(c => c with { Result = "passed" }).ToList();
        Assert.Equal(["develop:done", "checks:done", "review:current"], Shape(TaskFlowSteps.Steps([TaskFlowSteps.WithLive(Run(), all)], Now())));
    }

    [Fact]
    public void A_check_waiting_on_a_dependency_is_not_failed()
    {
        var k = TaskFlowSteps.LiveCycleState([new("build", "passed", null), new("tests", "waiting", "dependency_missing")]).Checks;
        Assert.Equal((1, 0, 0, 1), (k.Ran, k.Passed, k.Failed, k.Waiting));
    }
}

/// <summary>The old task-base, task-branch and task-overlap tests.</summary>
public sealed class TaskBranchesTests
{
    private static DependencyFacts Dep(string id, string state = "in_progress", string? branch = "", bool merged = false) =>
        new(id, int.TryParse(new string(id.Where(char.IsDigit).ToArray()), out var n) ? n : 1, $"task {id}", state, branch == "" ? $"task/R-{id}" : branch, merged);

    private static bool None(DependencyFacts a, DependencyFacts b) => false;

    [Fact]
    public void Default_branch_when_nothing_is_open()
    {
        var empty = TaskBranches.ChooseBase([], None);
        Assert.Null(empty.On);
        Assert.Empty(empty.Missing);
        var p = TaskBranches.ChooseBase([Dep("a1", merged: true)], None);
        Assert.Null(p.On);
        Assert.Empty(p.Missing);
    }

    [Fact]
    public void Builds_on_the_one_dependency_that_has_code()
    {
        var a = Dep("a1");
        var p = TaskBranches.ChooseBase([a], None);
        Assert.Same(a, p.On);
        Assert.Empty(p.Missing);
    }

    [Fact]
    public void Never_developed_is_missing_done_without_code_is_nothing()
    {
        var a = Dep("a1", state: "pending", branch: null);
        var b = Dep("b2", state: "done", branch: null);
        var p = TaskBranches.ChooseBase([a, b], None);
        Assert.Null(p.On);
        Assert.Equal([new MissingDep(a, "not_developed")], p.Missing);
    }

    [Fact]
    public void Stacks_on_the_last_link_of_a_chain()
    {
        var a = Dep("a1");
        var b = Dep("b2");
        var p = TaskBranches.ChooseBase([a, b], (x, y) => ReferenceEquals(x, b) && ReferenceEquals(y, a));
        Assert.Same(b, p.On);
        Assert.Empty(p.Missing);
    }

    [Fact]
    public void Two_lines_of_work_are_both_missing()
    {
        var a = Dep("a1");
        var b = Dep("b2");
        var p = TaskBranches.ChooseBase([a, b], None);
        Assert.Null(p.On);
        Assert.Equal([new MissingDep(a, "parallel"), new MissingDep(b, "parallel")], p.Missing);
    }

    [Fact]
    public void Builds_on_the_developed_one_and_names_the_other()
    {
        var a = Dep("a1");
        var b = Dep("b2", branch: null);
        var p = TaskBranches.ChooseBase([a, b], None);
        Assert.Same(a, p.On);
        Assert.Equal([new MissingDep(b, "not_developed")], p.Missing);
    }

    [Fact]
    public void Names_a_new_branch()
    {
        Assert.Equal("task/WI-1001-t7-make-it-inactive", TaskBranches.TaskBranchName("WI-1001", 7, "Make it inactive"));
        Assert.Equal("task/REQ-t2", TaskBranches.TaskBranchName(null, 2, ""));
    }

    [Fact]
    public void Reads_the_recorded_branch_and_falls_back_only_when_none()
    {
        Assert.Equal("task/REQ-t7-5", TaskBranches.BranchOf("WI-1001", 7, "edited wording", "task/REQ-t7-5"));
        Assert.Equal("task/WI-1001-t7-make-it-inactive", TaskBranches.BranchOf("WI-1001", 7, "Make it inactive", null));
    }

    private static Func<string, bool> Has(params string[] names) => names.Contains;

    [Fact]
    public void Branch_to_record_prefers_the_newest_run_that_still_exists()
    {
        Assert.Equal("task/WI-1001-t7-x", TaskBranches.BranchToRecord(["task/WI-1001-t7-x", "task/REQ-t7-5"], "task/WI-1001-t7-y", Has("task/WI-1001-t7-x", "task/REQ-t7-5")));
        Assert.Equal("task/REQ-t7-5", TaskBranches.BranchToRecord(["task/new", "task/REQ-t7-5"], "task/d", Has("task/REQ-t7-5")));
        Assert.Equal("task/d", TaskBranches.BranchToRecord(["gone"], "task/d", Has("task/d")));
        Assert.Null(TaskBranches.BranchToRecord(["a"], "b", _ => false));
        Assert.Null(TaskBranches.BranchToRecord([], "b", _ => false));
        Assert.Equal("task/a", TaskBranches.BranchToRecord(["", "task/a"], "task/d", Has("task/a")));
    }

    [Fact]
    public void Shared_files()
    {
        Assert.Equal(["a.js", "c.cs"], TaskBranches.SharedFiles(["a.js", "b.cs", "c.cs"], ["c.cs", "a.js", "z"]));
        Assert.Empty(TaskBranches.SharedFiles(["a"], ["b"]));
    }

    [Fact]
    public void Reads_merge_tree()
    {
        Assert.Equal(new TaskBranches.MergePreview(true), TaskBranches.ReadMergeTree(0, "abc123"));
        var p = TaskBranches.ReadMergeTree(1, "abc123\nsrc/a.js\nsrc/b.cs\n\nAuto-merging src/a.js\nCONFLICT (content): Merge conflict in src/a.js")!;
        Assert.False(p.Clean);
        Assert.Equal(["src/a.js", "src/b.cs"], p.ConflictFiles!);
        Assert.Null(TaskBranches.ReadMergeTree(128, "fatal: not a git repository"));
    }
}

/// <summary>The old build-recipe and manual-report tests.</summary>
public sealed class BuildAndManualTests
{
    private const string Sdk = "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>";
    private const string Legacy = "<Project ToolsVersion=\"15.0\" xmlns=\"http://schemas.microsoft.com/developer/msbuild/2003\"><PropertyGroup><TargetFrameworkVersion>v4.6.2</TargetFrameworkVersion></PropertyGroup></Project>";
    private const string Ambiguous = "<Project><PropertyGroup><TargetFramework>net472</TargetFramework></PropertyGroup></Project>";

    [Fact]
    public void Classifies_a_csproj()
    {
        Assert.Equal("sdk", BuildRecipes.ClassifyCsproj(Sdk, false));
        Assert.Equal("legacy", BuildRecipes.ClassifyCsproj(Legacy, false));
        Assert.Equal("legacy", BuildRecipes.ClassifyCsproj(Ambiguous, true));
        Assert.Equal("sdk", BuildRecipes.ClassifyCsproj(Ambiguous, false));
    }

    private const string Core = "Shared/DataModel/Crm/Alt.DataModel.Crm.Core/Alt.DataModel.Crm.Core.csproj";
    private const string Plugin = "CrmEntryPoints/Plugins/Alt.Crm.Plugins.AuthorizationManagement/Alt.Crm.Plugins.AuthorizationManagement.csproj";
    private const string Web = "Client/Webresources/Alt.Client.Webresources/Alt.Client.Webresources.csproj";

    private static readonly Dictionary<string, string> Repo = new()
    {
        [Core] = Sdk,
        [Plugin] = Legacy,
        ["CrmEntryPoints/Plugins/Alt.Crm.Plugins.AuthorizationManagement/packages.config"] = "<packages />",
        [Web] = Legacy,
        ["tools/site/package.json"] = """{"name":"site","scripts":{"build":"vite build"}}""",
        ["tools/lint/package.json"] = """{"name":"lint-rules"}""",
        ["docs/guide.md"] = "",
    };

    private static Task<BuildPlan> Plan(string[] changed, string[]? declared = null, string? msbuild = "/opt/msbuild/MSBuild.exe") =>
        BuildRecipes.PlanAsync(new BuildPlanInput("/repo", Repo.Keys.ToList(), changed, declared ?? [], p => Task.FromResult(Repo.GetValueOrDefault(p)), msbuild));

    [Fact]
    public async Task Builds_the_project_of_each_changed_file_and_the_named_components()
    {
        var p = await Plan(["Shared/DataModel/Crm/Alt.DataModel.Crm.Core/Enums/ControlStageStatusCode.cs"], ["Alt.Crm.Plugins.AuthorizationManagement"]);
        Assert.Equal("build", p.Kind);
        Assert.Equal([("dotnet", Core), ("msbuild", Plugin)], p.Recipes!.Select(r => (r.Tool, r.Project)));
    }

    [Fact]
    public async Task Builds_a_changed_script_inside_a_compiled_project() =>
        Assert.Equal([Web], (await Plan(["Client/Webresources/Alt.Client.Webresources/alt_/js/forms/AuthorizationManagementMain.js"])).Recipes!.Select(r => r.Project));

    [Fact]
    public async Task Nothing_to_build_when_no_file_changed()
    {
        var p = await Plan([], ["Alt.Crm.Plugins.AuthorizationManagement"]);
        Assert.Equal("nothing", p.Kind);
        Assert.Contains("לא שינתה אף קובץ", p.Reason);
        Assert.Contains("אין מה לבנות", BuildRecipes.Describe(p));
    }

    [Fact]
    public async Task Nothing_to_build_outside_a_compiled_project()
    {
        Assert.Equal("nothing", (await Plan(["docs/guide.md"])).Kind);
        Assert.Equal("nothing", (await Plan(["tools/lint/rules.ts"])).Kind);
    }

    [Fact]
    public async Task Builds_a_package_with_a_build_script_with_npm() =>
        Assert.Equal([("npm", "tools/site/package.json")], (await Plan(["tools/site/src/main.ts"])).Recipes!.Select(r => (r.Tool, r.Project)));

    [Fact]
    public async Task Says_it_cannot_rather_than_guess()
    {
        var p = await Plan(["services/api/main.go"]);
        Assert.Equal("cannot", p.Kind);
        Assert.Contains("services/api/main.go", p.Reason);
        Assert.Equal("cannot", (await Plan(["CrmEntryPoints/Plugins/Alt.Crm.Plugins.AuthorizationManagement/X.cs"], [], null)).Kind);
    }

    [Fact]
    public async Task Notes_a_named_component_that_is_not_there() =>
        Assert.Contains("Alt.NoSuchThing", (await Plan(["Shared/DataModel/Crm/Alt.DataModel.Crm.Core/A.cs"], ["Alt.NoSuchThing"])).Notes![0]);

    [Fact]
    public void Reads_customisations()
    {
        Assert.Equal(["FormCancellation", "ControlStageStatus"], ManualReport.ReadCustomisations($"{ManualReport.CustomisationTemplate}FormCancellation\nControlStageStatus"));
        Assert.Equal(["FormCancellation", "ControlStageStatus", "Third"], ManualReport.ReadCustomisations("CUSTOMISATION:\n\n- FormCancellation\n• ControlStageStatus\n\n1. Third"));
        Assert.Equal(["One"], ManualReport.ReadCustomisations("customisation : One"));
        Assert.Equal(["One", "Two"], ManualReport.ReadCustomisations("One\nTwo"));
        Assert.Empty(ManualReport.ReadCustomisations(ManualReport.CustomisationTemplate));
        Assert.Empty(ManualReport.ReadCustomisations(null));
        Assert.Equal(["One"], ManualReport.ReadCustomisations("הערה\nCUSTOMISATION:\nOne"));
    }

    [Fact]
    public void Checks_a_manual_report()
    {
        var (v, _) = ManualReport.Check(new("עודכן הסקריפט"));
        Assert.Equal(("עודכן הסקריפט", 0, 0, (string?)null), (v!.Summary, v.Customisations.Count, v.Components.Count, v.Reference));
        Assert.NotNull(ManualReport.Check(new("  ")).Why);
        Assert.NotNull(ManualReport.Check(new("x")).Why);
        var (w, _) = ManualReport.Check(new("הוקם שדה", "CUSTOMISATION:\nFormCancellation", "Alt.BL\nAlt.Plugins", " branch/x "));
        Assert.Equal(["FormCancellation"], w!.Customisations);
        Assert.Equal(["Alt.BL", "Alt.Plugins"], w.Components);
        Assert.Equal("branch/x", w.Reference);
    }

    [Fact]
    public void The_manual_report_note() =>
        Assert.Equal("✍ משימה #7 דווחה ידנית — פותחה בלי Claude: הוקם שדה\nCUSTOMISATION: A · B",
            ManualReport.Note(7, new ManualReportValue("הוקם שדה", ["A", "B"], [], null)));
}
