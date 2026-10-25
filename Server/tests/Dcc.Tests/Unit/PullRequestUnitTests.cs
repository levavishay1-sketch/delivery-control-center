using Dcc.Domain.Git;
using Dcc.Domain.PullRequests;
using Dcc.Infrastructure.PullRequests;

namespace Dcc.Tests.Unit;

/// <summary>Phase 4.6: the decisions the pull-request centre makes from a host's answers — no host, no database.</summary>
public sealed class PullRequestRulesTests
{
    private static readonly Guid Repo = Guid.NewGuid();

    private static PullRequestRow Pr(int n, string head = "feature", string @base = "main", string state = "open", bool conflicts = false, bool? mergeable = true,
        string review = "none", string checks = "none", bool draft = false, int files = 3, string? updated = null) => new()
    {
        Id = $"github:{Repo}:{n}", Number = n, Title = $"PR {n}", Url = $"https://github.com/acme/shop/pull/{n}", State = state, Author = "dana",
        HeadBranch = head, BaseBranch = @base, CreatedAt = "2026-10-01T10:00:00Z", UpdatedAt = updated ?? DateTimeOffset.UtcNow.ToString("O"),
        Conflicts = conflicts, Mergeable = mergeable, Review = review, Checks = checks, Draft = draft, ChangedFiles = files,
        Repo = new PrRepo(Repo, "shop"), Client = new PrClient(null, null),
    };

    [Fact]
    public void The_checks_rollup_reads_failing_before_running_before_passing()
    {
        Assert.Equal("none", PullRequestRules.ChecksOf([]));
        Assert.Equal("failing", PullRequestRules.ChecksOf(["SUCCESS", "failure"]));
        Assert.Equal("running", PullRequestRules.ChecksOf(["SUCCESS", "IN_PROGRESS"]));
        Assert.Equal("passing", PullRequestRules.ChecksOf(["SUCCESS", "NEUTRAL"]));
    }

    [Fact]
    public void Flags_say_why_a_request_needs_a_person_in_the_order_that_matters()
    {
        var keys = PullRequestRules.FlagsFor(Pr(1, conflicts: true, checks: "failing", files: 41), 50, parentOpen: true).Select(f => f.Key).ToList();
        Assert.Equal(["conflict", "checks", "parent", "waiting", "big"], keys);
        Assert.Contains(PullRequestRules.FlagsFor(Pr(2, review: "approved", checks: "passing"), 1, false), f => f is { Key: "approved", Tone: "healthy" });
        Assert.Equal("ממתין 2 ימים", PullRequestRules.FlagsFor(Pr(3), 48, false).Single(f => f.Key == "waiting").Text);
        Assert.Equal("draft", PullRequestRules.FlagsFor(Pr(4, draft: true), 100, false)[0].Key);
    }

    [Fact]
    public void A_request_on_another_requests_branch_hangs_under_it_and_critical_ones_come_first()
    {
        var parent = Pr(1, head: "feature", updated: "2026-10-20T10:00:00Z");
        var child = Pr(2, head: "feature-2", @base: "feature", updated: "2026-10-21T10:00:00Z");
        var broken = Pr(3, head: "fix", conflicts: true, updated: "2026-10-22T10:00:00Z");
        var rows = PullRequestRules.Arrange([parent, child, broken], DateTimeOffset.Parse("2026-10-25T10:00:00Z"));
        Assert.Equal(3, rows[0].Number);
        Assert.Equal(parent.Id, rows.Single(r => r.Number == 2).ParentId);
        Assert.Null(rows.Single(r => r.Number == 1).ParentId);
        Assert.Contains(rows.Single(r => r.Number == 2).Flags, f => f.Key == "parent");
    }

    [Fact]
    public void Blockers_and_the_next_step_follow_the_old_rules()
    {
        Assert.Empty(PullRequestRules.BlockersFor(Pr(1, state: "merged"), false, false));
        var draft = PullRequestRules.BlockersFor(Pr(1, draft: true), false, false);
        Assert.Equal("draft", draft[0].Key);
        var unchecked_ = PullRequestRules.BlockersFor(Pr(1, mergeable: null), false, false);
        Assert.Null(unchecked_.Single(b => b.Key == "conflict").Ok);
        Assert.Null(unchecked_.Single(b => b.Key == "checks").Ok);

        Assert.Equal("update_branch", PullRequestRules.NextStepFor(Pr(1), PullRequestRules.BlockersFor(Pr(1), false, false), 4, 2).Action);
        Assert.Equal("request_review", PullRequestRules.NextStepFor(Pr(1), PullRequestRules.BlockersFor(Pr(1), false, false), 0, 0).Action);
        var approved = Pr(1, review: "approved", checks: "running");
        Assert.Equal("wait", PullRequestRules.NextStepFor(approved, PullRequestRules.BlockersFor(approved, false, true), 0, 0).Action);
        var ready = Pr(1, review: "approved", checks: "passing");
        Assert.Equal("merge", PullRequestRules.NextStepFor(ready, PullRequestRules.BlockersFor(ready, false, true), 0, 0).Action);
        Assert.Equal("done", PullRequestRules.NextStepFor(Pr(1, state: "closed"), [], 0, 0).Action);
    }

    [Fact]
    public void Files_are_grouped_the_way_a_person_reads_them_and_topics_come_from_where_they_are()
    {
        HostFile F(string p, string status = "modified") => new(p, status, 1, 0);
        var groups = PullRequestRules.GroupFiles([F("src/app.ts"), F("CLAUDE.md"), F("docs/x.md"), F("bin/out.dll"), F("package.json"), F("Model.designer.cs"), F("x.bin", "renamed")]);
        Assert.Equal(["code", "instructions", "config", "docs", "other", "build"], groups.Select(g => g.Key));
        Assert.Equal("נוצר אוטומטית — לא לערוך ידנית", groups.Single(g => g.Key == "code").Files.Single(f => f.Path == "Model.designer.cs").Note);
        Assert.Equal("R", groups.Single(g => g.Key == "other").Files[0].Status);

        var topics = PullRequestRules.TopicsOf([F("openspec/changes/pull-request-center/tasks.md"), F("openspec/changes/pull-request-center/design.md"),
            F("openspec/changes/old-thing/tasks.md", "removed"), F("apps/web/src/a.ts"), F("README.md")]);
        Assert.Equal("Pull request center", topics[0].Title);
        Assert.Equal("OpenSpec change · 2 files", topics[0].Detail);
        Assert.Contains(topics, t => t.Title == "Code in apps/web");
        Assert.Contains(topics, t => t.Title == "Files in the repository root");
        Assert.Equal("Old OpenSpec changes removed", topics[^1].Title);
    }

    [Fact]
    public void Merge_tree_output_gives_the_tree_and_the_conflicted_paths()
    {
        var (tree, paths) = PullRequestRules.ReadMergeTree("abc123\nREADME.md\nsrc/a.ts\n\nAuto-merging README.md\n");
        Assert.Equal("abc123", tree);
        Assert.Equal(["README.md", "src/a.ts"], paths);
        Assert.Equal("acme/shop", PullRequestRules.SlugOf("https://github.com/acme/shop.git"));
    }

    [Fact]
    public void A_branch_gets_advice_from_what_it_holds_never_from_its_age()
    {
        Assert.Equal("default", BranchRules.AdviceFor(0, 0, null, "main", true).Status);
        Assert.Equal("open_pr", BranchRules.AdviceFor(3, 0, new BranchPr(7, "OPEN", false), "main", false).Status);
        Assert.Equal("merged", BranchRules.AdviceFor(0, 9, null, "main", false).Status);
        Assert.Equal("stale", BranchRules.AdviceFor(2, 0, new BranchPr(7, "CLOSED", false), "main", false).Status);
        var work = BranchRules.AdviceFor(2, 11, null, "main", false);
        Assert.Equal(("work", "warning"), (work.Status, work.Advice.Tone));
        Assert.StartsWith("נוצר אוטומטית על ידי סשן של Claude Code", BranchRules.OriginOf("claude/x"));
    }

    [Fact]
    public void Conflict_markers_split_into_text_and_choices_and_a_lone_equals_line_is_not_a_marker()
    {
        var segments = ConflictText.Split("a\n<<<<<<< ours\nmine\n||||||| base\nold\n=======\ntheirs\n>>>>>>> main\nz");
        Assert.Equal(3, segments.Count);
        Assert.Equal(new ConflictSegment("mine", "theirs"), segments[1]);
        Assert.Equal(new TextSegment("z"), segments[2]);
        // An unterminated marker is a line of the file.
        Assert.Single(ConflictText.Split("<<<<<<< not closed\nx"));
        Assert.True(ConflictText.HasMarkers("x\n<<<<<<< ours\n"));
        // A Markdown heading's underline is seven "=" — the file holding it must stay savable.
        Assert.False(ConflictText.HasMarkers("Title\n=======\ntext"));
    }

    [Fact]
    public void An_azure_devops_address_is_read_from_every_form_it_is_pasted_in()
    {
        Assert.Equal(new AdoRepoAddress("https://dev.azure.com/acme", "Shop", "web"), AdoRepoAddress.Parse("https://acme@dev.azure.com/acme/Shop/_git/web"));
        Assert.Equal(new AdoRepoAddress("https://dev.azure.com/acme", "Shop", "web"), AdoRepoAddress.Parse("git@ssh.dev.azure.com:v3/acme/Shop/web"));
        Assert.Equal(new AdoRepoAddress("https://tfs.local/tfs/Main", "Proj", "Repo"), AdoRepoAddress.Parse("https://tfs.local/tfs/Main/Proj/_git/Repo"));
        Assert.Null(AdoRepoAddress.Parse("https://github.com/acme/shop"));
    }
}

/// <summary>The code map drawn from facts: the base line in the order it changed, our line, the arrow.</summary>
public sealed class CodeMapTests
{
    private static CodeMapCommit C(string sha, string subject, string at, string[]? files = null, string[]? parents = null) =>
        new(sha, subject, "dana", at, files ?? [], null, (parents?.Length ?? 0) > 1, parents);

    [Fact]
    public void Git_log_records_parse_into_commits_with_their_files_and_parents()
    {
        // \u001e starts a record and \u001f separates its fields — fixed-width escapes, since \x would eat the hex after it.
        var log = "\u001eabc1234\u001fDana\u001f2026-10-01T10:00:00+03:00\u001fAdd cart\u001fwhy it matters\u001fp1 p2\u001f\nsrc/cart.ts\nsrc/x.ts\n\u001edef5678\u001fDana\u001f2026-10-02T10:00:00+03:00\u001fFix\u001f\u001fabc1234\u001f\n";
        var commits = CodeMaps.ParseLog(log);
        Assert.Equal(2, commits.Count);
        Assert.Equal(["src/cart.ts", "src/x.ts"], commits[0].Files);
        Assert.True(commits[0].Merge);
        Assert.Equal("why it matters", commits[0].Body);
        Assert.False(commits[1].Merge);
    }

    [Fact]
    public void A_merge_on_the_base_line_names_what_it_brought_and_the_newest_step_is_last()
    {
        var facts = new CodeMapFacts
        {
            BaseBranch = "main", Branch = "task/WI-1", BaselineSha = "b000000",
            BaselineCommit = C("b000000", "start", "2026-10-01T00:00:00Z"),
            BaseAfter =
            [
                C("f111111", "side work", "2026-10-02T00:00:00Z", ["src/shared.ts"], ["b000000"]),
                C("m222222", "Merge pull request #7 from acme/side", "2026-10-03T00:00:00Z", [], ["b000000", "f111111"]),
            ],
            OurCommits = [C("o333333", "our work", "2026-10-02T12:00:00Z", ["src/shared.ts"])],
            Behind = 2, BehindTouching = 1, Pushed = false, RepoUrl = "https://github.com/acme/shop", RepoId = Guid.Empty,
        };
        var map = CodeMaps.From(facts);
        var baseLane = map.Lanes[0];
        Assert.Equal(["branchPoint", "attention", "current"], baseLane.Nodes.Select(n => n.Kind));
        Assert.Equal("f111111", baseLane.Nodes[2].Brought![0].Sha);
        Assert.Equal($"#/pull-requests/{Guid.Empty}/7", baseLane.Nodes[2].DccPath);
        Assert.Equal("local", map.Lanes[1].Place);
        Assert.Equal("טרם הועלה ל-GitHub", map.Arrows.Single().Label);
        Assert.Contains("1 מהם נוגעים באותם קבצים", map.Caption);
    }

    [Fact]
    public void Without_each_commits_own_files_no_count_is_drawn_and_the_shared_files_are_named()
    {
        var facts = new CodeMapFacts
        {
            BaseBranch = "main", Branch = "feature", PerCommitFiles = false, SharedFiles = 2, Behind = 3, Pushed = true, PrUrl = "https://x/pull/4", PrNumber = 4,
            OurCommits = [C("o1", "ours", "2026-10-02T00:00:00Z", ["a.ts", "b.ts"])],
        };
        var map = CodeMaps.From(facts);
        Assert.All(map.Lanes.SelectMany(l => l.Nodes), n => Assert.Null(n.Files));
        Assert.Equal("3 שינויים נכנסו מאז · 2 קבצים משותפים", map.Lanes[0].Note);
        Assert.Equal("בקשה #4 · ממתינה למיזוג", map.Arrows.Single().Label);
    }

    [Fact]
    public void An_unreadable_folder_is_said_in_words_instead_of_a_drawing()
    {
        var map = CodeMaps.From(new CodeMapFacts { Unreadable = "git לא מזהה", Dir = "C:/x" });
        Assert.Empty(map.Lanes);
        Assert.Equal("C:/x", map.Problem!.Folder);
    }
}
