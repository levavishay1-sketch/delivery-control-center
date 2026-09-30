using Dcc.Domain.Tasks;

namespace Dcc.Tests.Unit;

/// <summary>The old task-relations and task-types tests, one for one.</summary>
public sealed class TaskRelationsTests
{
    private static RelRow Row(string id, int seq, string kind = "task", string? parent = null, bool active = true, string state = "pending") =>
        new(id, seq, kind, parent, active, state);

    private static readonly RelRow[] Rows =
    [
        Row("G1", 1), Row("A", 2, parent: "G1"), Row("B", 3, parent: "G1"),
        Row("C1", 5, kind: "check", parent: "G1"),
        Row("G2", 6), Row("X", 7, parent: "G2"), Row("Y", 8, parent: "G2"),
        Row("L", 9),
    ];

    private static RelDep Dep(string t, string on) => new(t, on);

    [Fact]
    public void A_task_with_subtasks_is_a_group_one_without_is_developed()
    {
        var r = new TaskRelations(Rows, []);
        Assert.True(r.IsGroup("G1"));
        Assert.False(r.IsGroup("A"));
        Assert.False(r.IsGroup("L"));
        Assert.False(r.IsGroup("C1"));
    }

    [Fact]
    public void A_dropped_or_inactive_subtask_does_not_make_a_group() =>
        Assert.False(new TaskRelations([Row("P", 1), Row("S", 2, parent: "P", active: false)], []).IsGroup("P"));

    [Fact]
    public void Depending_on_a_group_means_each_of_its_subtasks() =>
        Assert.Equal([new EffectiveDep("A", new DepVia("group", 1)), new EffectiveDep("B", new DepVia("group", 1))],
            new TaskRelations(Rows, [Dep("L", "G1")]).EffectiveDeps("L"));

    [Fact]
    public void Depending_on_a_check_means_the_task_it_belongs_to() =>
        Assert.Equal([new EffectiveDep("T", new DepVia("check", 2))],
            new TaskRelations([Row("T", 1), Row("TC", 2, kind: "check", parent: "T"), Row("U", 3)], [Dep("U", "TC")]).EffectiveDeps("U"));

    [Fact]
    public void A_subtask_waits_for_whatever_its_group_waits_for()
    {
        var r = new TaskRelations(Rows, [Dep("G2", "B")]);
        Assert.Equal([new EffectiveDep("B", new DepVia("parent", 6))], r.EffectiveDeps("X"));
        Assert.Equal([new EffectiveDep("B", new DepVia("parent", 6))], r.EffectiveDeps("Y"));
    }

    [Fact]
    public void A_dependency_is_kept_once_and_never_on_itself_or_its_group() =>
        Assert.Equal([new EffectiveDep("B")], new TaskRelations(Rows, [Dep("X", "B"), Dep("G2", "B"), Dep("X", "G2")]).EffectiveDeps("X"));

    [Fact]
    public void Dropped_rows_are_not_waited_for() =>
        Assert.Empty(new TaskRelations([.. Rows, Row("Z", 20, state: "dropped")], [Dep("L", "Z")]).EffectiveDeps("L"));

    [Fact]
    public void Knows_who_waits_for_a_task_including_through_its_group()
    {
        var r = new TaskRelations(Rows, [Dep("L", "G1"), Dep("C1", "B")]);
        Assert.Equal(["C1", "L"], r.WaitingOn("B").Order());
        Assert.Equal(["L"], r.WaitingOn("G1"));
    }
}

public sealed class TaskTypesTests
{
    private static TaskTypes.Node N(string id, string? parent = null) => new(id, parent);

    [Fact]
    public void A_leaf_is_a_Task_and_a_node_over_Tasks_a_User_Story()
    {
        var t = TaskTypes.Structural([N("g"), N("a", "g"), N("b", "g")]);
        Assert.Equal(["User Story", "Task", "Task"], new[] { t["g"], t["a"], t["b"] });
    }

    [Fact]
    public void Goes_up_a_rung_per_level()
    {
        var t = TaskTypes.Structural([N("e"), N("f", "e"), N("s", "f"), N("t", "s")]);
        Assert.Equal(["Epic", "Feature", "User Story", "Task"], new[] { "e", "f", "s", "t" }.Select(id => t[id]));
    }

    [Fact]
    public void Types_a_ragged_tree_by_role_not_depth()
    {
        var t = TaskTypes.Structural([N("story"), N("t1", "story"), N("t2", "story"), N("bare")]);
        Assert.Equal(["User Story", "Task", "Task"], new[] { t["story"], t["t1"], t["bare"] });
    }

    [Fact]
    public void Stops_at_Epic() =>
        Assert.Equal("Epic", TaskTypes.Structural([N("a"), N("b", "a"), N("c", "b"), N("d", "c"), N("e", "d")])["a"]);

    [Fact]
    public void Does_not_loop_on_a_ring_of_parents() => TaskTypes.Structural([N("a", "b"), N("b", "a")]);

    private static List<TaskTypes.Node> Stories(int count) =>
        Enumerable.Range(0, count).SelectMany(i => new[] { N($"s{i}"), N($"s{i}t1", $"s{i}"), N($"s{i}t2", $"s{i}") }).ToList();

    [Fact]
    public void Three_parallel_stories_make_the_requirement_a_Feature() =>
        Assert.Equal(new TaskTypes.RequirementRung("Feature", 3, "User Story"), TaskTypes.RequirementRungFor(Stories(3)));

    [Fact]
    public void A_single_story_needs_nothing_above_it() => Assert.Null(TaskTypes.RequirementRungFor(Stories(1)));

    [Fact]
    public void Loose_tasks_need_nothing_above_them() => Assert.Null(TaskTypes.RequirementRungFor([N("a"), N("b"), N("c")]));

    [Fact]
    public void Several_Features_make_an_Epic()
    {
        TaskTypes.Node[] F(int i) => [N($"f{i}"), N($"f{i}s", $"f{i}"), N($"f{i}t", $"f{i}s")];
        Assert.Equal(new TaskTypes.RequirementRung("Epic", 2, "Feature"), TaskTypes.RequirementRungFor([.. F(1), .. F(2)]));
    }

    [Fact]
    public void Nothing_goes_above_several_Epics()
    {
        TaskTypes.Node[] E(int i) => [N($"e{i}"), N($"e{i}f", $"e{i}"), N($"e{i}s", $"e{i}f"), N($"e{i}t", $"e{i}s")];
        Assert.Null(TaskTypes.RequirementRungFor([.. E(1), .. E(2)]));
    }

    [Fact]
    public void A_bare_task_counts_among_the_top_level() =>
        Assert.Equal(new TaskTypes.RequirementRung("Feature", 3, "User Story"), TaskTypes.RequirementRungFor([.. Stories(2), N("bare")]));
}

/// <summary>The old task-status tests, one for one.</summary>
public sealed class TaskStatusTests
{
    private static StatusFacts F(Func<StatusFacts, StatusFacts>? over = null)
    {
        var f = new StatusFacts { Kind = "task", State = "pending", Active = true, Approved = true, InTfs = true };
        return over is null ? f : over(f);
    }

    private static StatusCheck Check(int seq, string? kind, string? result, string? cause = null) => new(seq, kind, result, cause, true);
    private static StatusCheck[] Std(string? build, string? tests, string? regression) => [Check(10, "build", build), Check(11, "tests", tests), Check(12, "regression", regression)];
    private static TaskStatusView S(Func<StatusFacts, StatusFacts> over) => TaskStatuses.Of(F(over));

    [Fact]
    public void Waits_for_approval_first() => Assert.Equal("awaiting_approval", S(f => f with { Approved = false }).Key);

    [Fact]
    public void Cannot_start_before_it_is_in_TFS()
    {
        var s = S(f => f with { InTfs = false });
        Assert.Equal(("awaiting_tfs", "warning"), (s.Key, s.Tone));
        Assert.Equal("running", S(f => f with { InTfs = false, Running = "develop" }).Key);
        Assert.Equal("review", S(f => f with { InTfs = false, Developed = true, Checks = Std("passed", "passed", "passed") }).Key);
    }

    [Fact]
    public void A_dependency_is_a_tag_beside_the_phase_not_a_status()
    {
        Assert.Equal("ready", S(f => f with { OpenDeps = [new(2, false)] }).Key);
        Assert.Equal("running", S(f => f with { Running = "develop", OpenDeps = [new(2, false)] }).Key);
    }

    [Fact]
    public void Says_specifically_what_it_fell_on()
    {
        Assert.Equal("נפלה על ה-Build", S(f => f with { Developed = true, Checks = Std("failed", null, null) }).Label);
        Assert.Equal("נפלה על בדיקות הפיתוח", S(f => f with { Developed = true, Checks = Std("passed", "failed", "failed") }).Label);
        Assert.Equal("נפלה על בדיקות רגרסיה", S(f => f with { Developed = true, Checks = Std("passed", "passed", "failed") }).Label);
        Assert.Equal("נפלה על ה-Build", S(f => f with { Developed = true, Checks = [Check(10, "build", "failed", "environment")] }).Label);
    }

    [Fact]
    public void Names_a_dependency_with_no_code_as_the_likely_reason_for_ambiguity() =>
        Assert.Contains("#2 עוד לא פותחה", S(f => f with { Developed = true, Checks = [Check(11, "tests", "failed", "requirement_ambiguity")], OpenDeps = [new(2, false)] }).Reason);

    [Fact]
    public void Names_the_phase_of_a_run()
    {
        Assert.Equal("בעבודה · בפיתוח", S(f => f with { Running = "develop" }).Label);
        Assert.Equal("בעבודה · מקמפלת", S(f => f with { Running = "build" }).Label);
        Assert.Equal("בעבודה · בבדיקות", S(f => f with { Running = "test" }).Label);
    }

    [Fact]
    public void Falls_with_its_reason_build_first()
    {
        Assert.Equal("ה-Build נכשל", S(f => f with { Developed = true, State = "failed_checks", Checks = Std("failed", null, null) }).Reason);
        Assert.Equal("בדיקות הפיתוח נכשלו (ועוד 1)", S(f => f with { Developed = true, Checks = Std("passed", "failed", "failed") }).Reason);
        Assert.Equal("אי אפשר לבנות כאן — חסר כלי או SDK", S(f => f with { Developed = true, Checks = [Check(10, "build", "failed", "environment")] }).Reason);
    }

    [Fact]
    public void Waits_for_its_dependency_once_developed()
    {
        var s = S(f => f with { Developed = true, Checks = Std("passed", "passed", "passed"), OpenDeps = [new(3, true)] });
        Assert.Equal(("waiting_dependency", "warning"), (s.Key, s.Tone));
        Assert.Equal("waiting_dependency", S(f => f with { Developed = true, Checks = [Check(10, "build", "passed"), Check(11, "tests", "waiting")], BuiltWithout = [new(2, false)] }).Key);
        Assert.Contains("#2 פותחה מאז", S(f => f with { Developed = true, Checks = Std("passed", "passed", "passed"), BuiltWithout = [new(2, true)] }).Reason);
        Assert.Contains("#3 השתנתה", S(f => f with { Developed = true, Checks = Std("passed", "passed", "passed"), OnMovedSeq = 3 }).Reason);
    }

    [Fact]
    public void Is_ready_for_review_when_everything_passed() =>
        Assert.Equal("review", S(f => f with { Developed = true, State = "in_progress", Checks = Std("passed", "passed", "passed") }).Key);

    [Fact]
    public void Is_still_in_development_while_the_build_never_ran()
    {
        var s = S(f => f with { Developed = true, Checks = Std(null, null, null) });
        Assert.Equal(("build_pending", "ממתינה להרצת Build", "warning"), (s.Key, s.Label, s.Tone));
        Assert.Equal("build_pending", S(f => f with { Developed = true, Checks = Std(null, null, null), OpenDeps = [new(2, false)] }).Key);
    }

    [Fact]
    public void Says_a_disabled_builds_last_result()
    {
        StatusCheck[] passed = [Check(10, "build", "passed") with { Active = false }, Check(11, "tests", null), Check(12, "regression", null)];
        var s = S(f => f with { Developed = true, Checks = passed });
        Assert.Equal(("build_pending", "ה-Build מושבת", "inactive"), (s.Key, s.Label, s.Tone));
        Assert.Contains("עברה", s.Reason);
        StatusCheck[] failed = [Check(10, "build", "failed") with { Active = false }, Check(11, "tests", null), Check(12, "regression", null)];
        Assert.Contains("נכשלה", S(f => f with { Developed = true, Checks = failed }).Reason);
    }

    [Fact]
    public void Checks_pending_only_once_the_build_passed_and_never_says_working()
    {
        var s = S(f => f with { Developed = true, Checks = Std("passed", null, null) });
        Assert.Equal("checks_pending", s.Key);
        Assert.DoesNotContain("בעבודה", s.Label);
        Assert.Equal(("ממתינה להרצת בדיקות", "warning"), (s.Label, s.Tone));
    }

    [Fact]
    public void Done_inactive_and_dropped()
    {
        Assert.Equal("done", S(f => f with { State = "done", OpenDeps = [new(2, false)] }).Key);
        Assert.Equal("inactive", S(f => f with { Active = false }).Key);
        Assert.Equal("dropped", S(f => f with { State = "dropped" }).Key);
    }

    [Fact]
    public void A_check_has_its_own_status()
    {
        Assert.Equal("מחכה לתלות", S(f => f with { Kind = "check", CheckResult = "waiting" }).Label);
        Assert.Equal("לא יכלה לרוץ כאן", S(f => f with { Kind = "check", CheckResult = "failed", CheckCause = "environment" }).Label);
        Assert.Equal("check_not_run", S(f => f with { Kind = "check" }).Key);
    }

    [Fact]
    public void The_dependency_tag_is_there_while_a_dependency_is_not_done()
    {
        Assert.Null(TaskStatuses.DependencyTagFor(F()));
        var t = TaskStatuses.DependencyTagFor(F(f => f with { OpenDeps = [new(2, false)] }))!;
        Assert.Equal(("critical", "🔗 קיימת תלות · #2"), (t.Tone, t.Label));
        Assert.NotNull(TaskStatuses.DependencyTagFor(F(f => f with { Running = "test", OpenDeps = [new(2, false)] })));
    }

    [Fact]
    public void The_tag_is_orange_once_every_dependency_has_code()
    {
        Assert.Equal("warning", TaskStatuses.DependencyTagFor(F(f => f with { OpenDeps = [new(3, true)] }))!.Tone);
        var t = TaskStatuses.DependencyTagFor(F(f => f with { OpenDeps = [new(3, true), new(5, false)] }))!;
        Assert.Equal(("critical", "🔗 קיימת תלות · #3, #5"), (t.Tone, t.Label));
    }

    [Fact]
    public void No_tag_on_a_check_or_a_task_set_aside()
    {
        Assert.Null(TaskStatuses.DependencyTagFor(F(f => f with { Kind = "check", OpenDeps = [new(2, false)] })));
        Assert.Null(TaskStatuses.DependencyTagFor(F(f => f with { Active = false, OpenDeps = [new(2, false)] })));
    }

    [Fact]
    public void Names_what_keeps_a_dependent_task_from_closing()
    {
        Assert.Empty(TaskStatuses.DependencyBlockers(F()));
        var b = TaskStatuses.DependencyBlockers(F(f => f with { OpenDeps = [new(2, true)], BuiltWithout = [new(2, true)], OnMovedSeq = 3 }));
        Assert.Equal(3, b.Count);
        Assert.Contains("#2 עוד לא הושלמה", b[0]);
    }

    private static StatusSubtask Sub(int seq, bool developed, bool done = false) => new(seq, developed, done);
    private static StatusCheck[] Integration(string? result) => [Check(5, null, result)];

    [Fact]
    public void A_group_follows_its_subtasks_while_any_is_not_developed()
    {
        var s = S(f => f with { Subtasks = [Sub(2, false), Sub(3, false)], Checks = Integration(null) });
        Assert.Equal(("group_open", "0/2 תת-משימות הסתיימו", "neutral"), (s.Key, s.Label, s.Tone));
        Assert.Contains("#2, #3 עוד לא פותחה", s.Reason);
        Assert.Equal("active", S(f => f with { Subtasks = [Sub(2, true), Sub(3, false)], Developed = true }).Tone);
    }

    [Fact]
    public void A_group_waits_for_its_integration_check()
    {
        var s = S(f => f with { Subtasks = [Sub(2, true), Sub(3, true)], Developed = true, Checks = Integration(null) });
        Assert.Equal(("checks_pending", "ממתינה לבדיקת השילוב"), (s.Key, s.Label));
    }

    [Fact]
    public void A_group_falls_on_its_integration_check()
    {
        var s = S(f => f with { Subtasks = [Sub(2, true)], Developed = true, Checks = Integration("failed") });
        Assert.Equal(("failed", "נפלה בבדיקת השילוב"), (s.Key, s.Label));
    }

    [Fact]
    public void A_group_is_ready_to_close_only_when_every_subtask_is_done()
    {
        Assert.Equal("group_open", S(f => f with { Subtasks = [Sub(2, true, true), Sub(3, true)], Developed = true, Checks = Integration("passed") }).Key);
        var s = S(f => f with { Subtasks = [Sub(2, true, true), Sub(3, true, true)], Developed = true, Checks = Integration("passed") });
        Assert.Equal(("review", "ממתינה לסגירה"), (s.Key, s.Label));
    }

    [Fact]
    public void A_group_goes_through_the_same_gates_first()
    {
        Assert.Equal("awaiting_approval", S(f => f with { Approved = false, Subtasks = [Sub(2, false)] }).Key);
        Assert.Equal("awaiting_tfs", S(f => f with { InTfs = false, Subtasks = [Sub(2, false)] }).Key);
    }

    [Fact]
    public void Stored_state_moves_to_failed_checks_only_on_a_real_failure()
    {
        Assert.Equal(("failed_checks", false), TaskStatuses.StoredStateAfterChecks("in_progress", false, 1));
        Assert.Null(TaskStatuses.StoredStateAfterChecks("in_progress", false, 0));
        Assert.Equal(("in_progress", false), TaskStatuses.StoredStateAfterChecks("failed_checks", false, 0));
        Assert.Equal(("failed_checks", true), TaskStatuses.StoredStateAfterChecks("done", false, 1));
        Assert.Equal(("done", false), TaskStatuses.StoredStateAfterChecks("failed_checks", true, 0));
        Assert.Null(TaskStatuses.StoredStateAfterChecks("dropped", false, 3));
    }
}
