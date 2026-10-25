using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Infrastructure.Actions;
using Dcc.Infrastructure.Chat;
using Dcc.Infrastructure.Onboarding;
using Dcc.Infrastructure.Repos;
using Dcc.Tests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace Dcc.Tests.Integration;

/// <summary>
/// Phase 4.7, the run engine: a whole onboarding of a repository on a local bare origin (the stand-in claude answers every
/// model call by the instruction it carries; the stand-in gh opens the pull request), the gates of each automation level,
/// the decisions on cards, the build and the delivery to the origin — and the refusals: permissions, a cancelled run, a
/// step that is not yet available, an empty delivery, the draft session outside the plan, and the restart.
/// </summary>
[Collection(DbCollection.Name)]
public sealed class OnboardingTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    /// <summary>A 409 with the engine's sentence for the person.</summary>
    private static async Task<string> Refused(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(res.StatusCode == HttpStatusCode.Conflict, $"expected 409, got {(int)res.StatusCode}: {body}");
        return body.GetProperty("message").GetString()!;
    }

    private async Task<HttpClient> Admin() => _f.Client(await _f.AdminTokenAsync());

    private async Task<HttpClient> UserWith(string roleKey, Guid clientId, string kind = "person")
    {
        var (id, _, password) = await _f.NewUserAsync(kind);
        await _f.AssignAsync("user", id, roleKey, "client", clientId);
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", id));
        return _f.Client((await _f.LoginAsync(email, password)).AccessToken);
    }

    /// <summary>A client's repository whose remote is a fresh bare origin with one commit on main.</summary>
    private async Task<(Guid ClientId, Guid RepoId, string Origin)> RepoAsync(string? origin = null)
    {
        var clientId = await _f.NewClientAsync();
        origin ??= await _f.NewOriginAsync();
        var repoId = await _f.ScalarAsync<Guid>("insert into repo(name, ado_repo_ref, client_id) values (@n, @u, @c) returning id",
            ("n", "shop-" + Guid.NewGuid().ToString("N")[..6]), ("u", origin), ("c", clientId));
        return (clientId, repoId, origin);
    }

    private static string Run(Guid repoId, Guid runId) => $"/repos/{repoId}/onboarding/runs/{runId}";

    private static JsonElement Step(JsonElement view, string key) =>
        view.GetProperty("steps").EnumerateArray().First(s => s.GetProperty("stepKey").GetString() == key);

    private static string StepStatus(JsonElement view, string key) => Step(view, key).GetProperty("status").GetString()!;

    private static string Summary(JsonElement view) => view.ValueKind != JsonValueKind.Object ? "(no view)" :
        $"run {view.GetProperty("run").GetProperty("status")}; steps: "
        + string.Join(", ", view.GetProperty("steps").EnumerateArray().Select(s => $"{s.GetProperty("stepKey")}={s.GetProperty("status")}{(s.GetProperty("errors").GetArrayLength() > 0 ? $" ({s.GetProperty("errors")})" : "")}"))
        + "; last events: " + string.Join(", ", view.GetProperty("events").EnumerateArray().TakeLast(6).Select(e => e.GetProperty("type").GetString()));

    /// <summary>Polls the run's view — what the screen does — until <paramref name="until"/> holds; a run that fails meanwhile fails the test at once.</summary>
    private static async Task<JsonElement> WaitAsync(HttpClient c, Guid repoId, Guid runId, Func<JsonElement, bool> until, string what, bool failureExpected = false, int seconds = 180)
    {
        var deadline = DateTime.UtcNow.AddSeconds(seconds);
        JsonElement view = default;
        while (DateTime.UtcNow < deadline)
        {
            view = await Ok(await c.GetAsync(Run(repoId, runId)));
            if (until(view)) return view;
            if (!failureExpected && view.GetProperty("run").GetProperty("status").GetString() == "Failed")
                throw new Xunit.Sdk.XunitException($"the run failed while waiting for {what}: {Summary(view)}");
            await Task.Delay(250);
        }
        throw new Xunit.Sdk.XunitException($"timed out waiting for {what}: {Summary(view)}");
    }

    private static HashSet<string> Keys(JsonElement o) => o.EnumerateObject().Select(p => p.Name).ToHashSet();

    /// <summary>Each key is in the object, by exactly that name.</summary>
    private static void Has(JsonElement o, params string[] keys)
    {
        var present = Keys(o);
        var missing = keys.Where(k => !present.Contains(k)).ToList();
        Assert.True(missing.Count == 0, $"missing {string.Join(", ", missing)} in {o}");
    }

    /// <summary>Every key Client/src/api.ts reads from OnboardingRunView and the types under it — present, by name.</summary>
    private static void AssertViewShape(JsonElement view)
    {
        Has(view, "repo", "run", "steps", "definitions", "automation", "levels", "profile", "interview", "processes", "trials", "components", "plan",
            "readiness", "build", "deliver", "events", "codeMap", "cost", "recommended", "coach");
        Has(view.GetProperty("repo"), "id", "name");
        Has(view.GetProperty("run"), "id", "repoId", "clientId", "kind", "status", "currentStepKey", "workspacePath", "defaultBranch", "baselineSha", "branchName", "session",
            "triggeredBy", "startedAt", "completedAt", "cancelledAt", "automation");
        Assert.Contains("state", Keys(view.GetProperty("run").GetProperty("session")));
        foreach (var s in view.GetProperty("steps").EnumerateArray())
            Has(s, "id", "stepKey", "stepOrder", "status", "startedAt", "completedAt", "result", "errors", "updatedAt");
        Assert.Equal(7, view.GetProperty("definitions").GetArrayLength());
        Has(view.GetProperty("definitions")[0], "key", "order", "kind", "gate", "title_he", "short_he", "why_he", "what_he", "output_he", "cost_he", "you_he");
        Assert.Contains("level", Keys(view.GetProperty("automation")));
        Has(view.GetProperty("interview"), "questions", "answers");
        Has(view.GetProperty("trials"), "baseline", "after", "delta", "waiting");
        Has(view.GetProperty("cost"), "totalCostUsd", "liveUsd", "calls", "inputTokens", "outputTokens", "chat", "byStep", "rows");
        Has(view.GetProperty("recommended").GetProperty("draft"), "model", "effort");
        Assert.Contains("openProposals", Keys(view.GetProperty("coach")));
        foreach (var e in view.GetProperty("events").EnumerateArray())
        {
            Has(e, "id", "type", "payload", "actorUserId", "occurredAt");
            Assert.True(e.GetProperty("payload").TryGetProperty("runId", out _), $"{e.GetProperty("type")} carries no runId");
        }
        if (view.GetProperty("profile").ValueKind == JsonValueKind.Object)
        {
            Has(view.GetProperty("profile"), "id", "facts", "corrections", "summary", "tags", "raw");
            Has(view.GetProperty("profile").GetProperty("facts")[0], "path", "concept", "label_he", "value_he", "tone", "corrected");
        }
        foreach (var c in view.GetProperty("components").EnumerateArray())
            Has(c, "id", "key", "kind", "family", "title_he", "why_he", "what_he", "source", "sourceRef", "group", "risk", "contextTokens", "verifyHow_he",
                "status", "params", "files", "validation", "delta", "questions", "decidedBy", "decidedAt", "declineReason");
        foreach (var p in view.GetProperty("processes").EnumerateArray())
            Has(p, "key", "title", "source", "evidence", "steps", "trialTaskKey", "impossible");
        foreach (var t in view.GetProperty("trials").GetProperty("baseline").EnumerateArray())
            Has(t, "taskKey", "title_he", "phase", "passed", "failureKind", "detail", "costUsd", "callId", "judgedBy");
        if (view.GetProperty("readiness").ValueKind == JsonValueKind.Object) Has(view.GetProperty("readiness"), "ready", "items", "honesty");
        if (view.GetProperty("build").ValueKind == JsonValueKind.Object)
            Has(view.GetProperty("build"), "installed", "verified", "failed", "skipped", "files", "delta", "jointCheck", "costUsd");
        if (view.GetProperty("deliver").ValueKind == JsonValueKind.Object)
            Has(view.GetProperty("deliver"), "branch", "base", "commitSha", "filesCommitted", "remote", "pushed", "prNumber", "prUrl", "compareUrl", "localOnly", "report");
    }

    private static List<string> EventTypes(JsonElement view) => view.GetProperty("events").EnumerateArray().Select(e => e.GetProperty("type").GetString()!).ToList();

    [Fact]
    public async Task A_whole_onboarding_waits_where_a_person_decides_and_delivers_the_approved_files_to_the_origin()
    {
        var admin = await Admin();
        var (clientId, repoId, origin) = await RepoAsync();

        // Before a run: the catalogue, and no latest run (JSON null, not an empty answer).
        var catalogue = await Ok(await admin.GetAsync("/onboarding/steps"));
        Assert.Equal(7, catalogue.GetProperty("steps").GetArrayLength());
        Assert.Equal(new[] { "reversible_auto", "all_approval", "locked" }, catalogue.GetProperty("levels").EnumerateArray().Select(l => l.GetString()!).ToArray());
        Assert.False(string.IsNullOrEmpty(catalogue.GetProperty("recommended").GetProperty("draft").GetProperty("model").GetString()));
        var none = await admin.GetAsync($"/repos/{repoId}/onboarding/latest-run");
        Assert.Equal(HttpStatusCode.OK, none.StatusCode);
        Assert.Equal("null", (await none.Content.ReadAsStringAsync()).Trim());

        // Start at "every component waits": connect and diagnose run by themselves; the interview waits.
        var runId = (await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/onboarding/runs", new { automation = new { level = "all_approval" } }))).GetProperty("runId").GetGuid();
        Assert.Equal("כבר יש הרצה פעילה לריפו הזה — סיימו או בטלו אותה קודם", await Refused(await admin.PostAsJsonAsync($"/repos/{repoId}/onboarding/runs", new { })));
        var view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "processes") == "WaitingForUser", "the interview");
        var connect = Step(view, "connect").GetProperty("result");
        Assert.StartsWith("ai/onboarding/", connect.GetProperty("branch").GetString());
        Assert.Equal("main", connect.GetProperty("defaultBranch").GetString());
        Assert.Equal("remote", connect.GetProperty("baseFrom").GetString());
        Assert.Equal("all_approval", connect.GetProperty("level").GetString());
        Assert.Equal("Completed", StepStatus(view, "diagnose"));
        Assert.Equal(JsonValueKind.Object, view.GetProperty("profile").ValueKind);
        Assert.Equal("WaitingForUser", view.GetProperty("run").GetProperty("status").GetString());
        Assert.Equal("processes", view.GetProperty("run").GetProperty("currentStepKey").GetString());
        AssertViewShape(view);
        var latest = await Ok(await admin.GetAsync($"/repos/{repoId}/onboarding/latest-run"));
        Assert.Equal(runId, latest.GetProperty("runId").GetGuid());
        var list = await Ok(await admin.GetAsync($"/repos/{repoId}/onboarding/runs"));
        Assert.Equal(runId, list.GetProperty("runs")[0].GetProperty("id").GetGuid());
        Has(list.GetProperty("runs")[0], "id", "kind", "status", "currentStepKey", "startedAt", "completedAt", "branchName");

        // The draft session is a window inside the plan step only (defect 4: the old server also opened it during the trial, the build, the delivery).
        Assert.Equal("טיוטת /init נפתחת כשהתוכנית פתוחה לאישור", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/draft/start", new { })));
        // A step whose turn has not come.
        Assert.Equal("הצעד הזה עוד לא זמין — הצעדים שלפניו צריכים להסתיים קודם", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/steps/build/run", new { })));
        Assert.Equal("צעד לא מוכר", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/steps/nope/run", new { })));

        // The interview: nothing answered — every default is recorded as an assumption; the model maps the processes; the trial waits for its cost.
        var answered = await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/interview", new { answers = new Dictionary<string, string>() }));
        Assert.All(answered.GetProperty("answers").EnumerateArray(), a => Assert.True(a.GetProperty("assumed").GetBoolean()));
        view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "trial") == "WaitingForUser", "the trial's approval");
        Assert.True(view.GetProperty("processes").GetArrayLength() >= 1);
        Assert.Equal("Add a feature", view.GetProperty("processes")[0].GetProperty("title").GetString());
        var waiting = view.GetProperty("trials").GetProperty("waiting");
        Assert.True(waiting.GetProperty("tasks").GetArrayLength() >= 3);
        Assert.True(waiting.GetProperty("estimateUsd").GetDouble() >= 0);
        Assert.Equal("טיוטת /init נפתחת כשהתוכנית פתוחה לאישור", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/draft/start", new { })));

        // Approved: the tasks run without components, are judged, and the plan waits for decisions.
        Assert.True((await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/trial/approve", new { }))).GetProperty("approved").GetBoolean());
        view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "plan") == "WaitingForUser", "the plan");
        Assert.True(view.GetProperty("trials").GetProperty("baseline").GetArrayLength() >= 3);
        Assert.Equal(JsonValueKind.Object, view.GetProperty("readiness").ValueKind);
        var plan = view.GetProperty("plan");
        Has(plan, "rulesFired", "rulesSuppressed", "components", "byGroup", "marketplace", "reviewer", "costUsd", "firings", "suppressed", "redundant");
        var cards = view.GetProperty("components").EnumerateArray().ToList();
        var reviewerCard = cards.Single(c => c.GetProperty("key").GetString() == "reviewer_1_rule");
        Assert.Equal("approval", reviewerCard.GetProperty("group").GetString());
        Assert.Equal("proposed", reviewerCard.GetProperty("status").GetString());
        AssertViewShape(view);
        // Nothing approved yet at this level: no build; and nothing written in the copy yet: no draft to scan.
        Assert.Equal("שום רכיב לא אושר — אשרו לפחות אחד, או בטלו את ההרצה", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/build", new { })));
        Assert.Equal("סשן הטיוטה עוד לא כתב כלום בעותק — אין מה לסרוק", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/draft/scan", new { })));
        Assert.Equal("WaitingForUser", StepStatus(await Ok(await admin.GetAsync(Run(repoId, runId))), "plan"));

        // The /init draft (here written straight into the copy, as a session would): the scan takes one line of it, which waits for a person.
        var copy = view.GetProperty("run").GetProperty("workspacePath").GetString()!;
        await File.WriteAllTextAsync(Path.Combine(copy, "CLAUDE.md"), "# Drafted by /init\n\nKeep the README short.\n");
        var scanAnswer = Path.Combine(_f.TempDir, "onboarding-init_scan.txt");
        await File.WriteAllTextAsync(scanAnswer, """
            {"verdict":"partial","summary":"one line worth taking","compare":[{"topic":"docs","ours":"none","theirs":"a line","better":"theirs","why":"it is specific"}],
             "items":[{"decision":"take","form":"line","title":"Keep the README short","target":"AGENTS.md","text":"Keep the README short.","origin":"theirs",
                       "need":"the README is the only document","evidence":"README.md","alternative":"none","verify":"read it","cost":"one line"}],
             "drop_ours":[],"reject":[{"what":"a long introduction","why":"generic"}]}
            """);
        try
        {
            var scanning = await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/draft/scan", new { }));
            Assert.True(scanning.GetProperty("scanning").GetBoolean());
            Assert.Equal(1, scanning.GetProperty("files").GetInt32());
            view = await WaitAsync(admin, repoId, runId, v => Step(v, "plan").GetProperty("result").TryGetProperty("initScan", out var s) && s.GetProperty("state").GetString() == "done", "the scan");
        }
        finally { File.Delete(scanAnswer); }
        var initScan = Step(view, "plan").GetProperty("result").GetProperty("initScan");
        Assert.Equal("partial", initScan.GetProperty("verdict").GetString());
        Assert.Equal("take", initScan.GetProperty("cards")[0].GetProperty("decision").GetString());
        Assert.Equal(1, initScan.GetProperty("reject").GetArrayLength());
        Assert.Equal("CLAUDE.md", initScan.GetProperty("files")[0].GetString());
        var initCard = view.GetProperty("components").EnumerateArray().Single(c => c.GetProperty("source").GetString() == "init");
        Assert.Equal("approval", initCard.GetProperty("group").GetString());
        Assert.Equal("proposed", initCard.GetProperty("status").GetString());
        Assert.Contains("onboarding.draft.scanned", EventTypes(view));

        // "That is not right" on a fact while the plan waits: recorded, and the plan is drawn again.
        var corrected = await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/profile/correct", new { path = "tests.frameworks", note = "we do have tests" }));
        Assert.Equal("tests.frameworks", corrected.GetProperty("corrections")[0].GetProperty("path").GetString());
        Assert.Equal(0, (await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/profile/correct", new { path = "tests.frameworks", undo = true }))).GetProperty("corrections").GetArrayLength());
        Assert.Equal("עובדה לא מוכרת", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/profile/correct", new { path = "../x" })));

        // A person's request becomes a card with its question — from the screen, and from the chat's action.
        var requested = await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/request", new { text = "keep answers short" }));
        var requestedKey = requested.GetProperty("key").GetString()!;
        Assert.Matches("^user_[0-9a-z]+_rule$", requestedKey);
        Assert.Equal("tone", requested.GetProperty("questions")[0].GetProperty("key").GetString());
        var adminId = await _f.ScalarAsync<Guid>("select id from users where email = @e", ("e", _f.AdminEmail));
        await using (var scope = _f.Services.CreateAsyncScope())
        {
            var actions = scope.ServiceProvider.GetRequiredService<ActionRegistry>();
            var viaChat = await actions.RunAsync("request_component", new JsonObject { ["text"] = "a second request" }, new ActionEntity("run", runId, clientId, null), adminId, "chat", CancellationToken.None);
            Assert.StartsWith("user_", viaChat!["key"]!.GetValue<string>());
            var refused = await Assert.ThrowsAsync<ActionRefused>(() => actions.RunAsync("send_to_session", new JsonObject { ["text"] = "hello" }, new ActionEntity("run", runId, clientId, null), adminId, "chat", CancellationToken.None));
            Assert.Equal("סשן הטיוטה לא פעיל — פתחו אותו מכרטיס הטיוטה במסך ההטמעה ואז שלחו", refused.Message);
        }

        // Decisions: one card with its answer, one declined with a reason, then the rest as a set.
        var decided = await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/{Uri.EscapeDataString(requestedKey)}/decide", new { decision = "approve", answers = new { tone = "short" } }));
        Assert.Equal("approved", decided.GetProperty("status").GetString());
        await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/reviewer_1_rule/decide", new { decision = "decline", reason = "not needed here" }));
        Assert.Equal("הכרטיס לא נמצא", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/no_such_card/decide", new { decision = "approve" })));
        var set = await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/decide-set", new { decision = "approve" }));
        Assert.True(set.GetProperty("decided").GetInt32() >= 1);
        view = await Ok(await admin.GetAsync(Run(repoId, runId)));
        var byKey = view.GetProperty("components").EnumerateArray().ToDictionary(c => c.GetProperty("key").GetString()!);
        Assert.Equal("short", byKey[requestedKey].GetProperty("questions")[0].GetProperty("answer").GetString());
        Assert.Equal("declined", byKey["reviewer_1_rule"].GetProperty("status").GetString());
        Assert.Equal("not needed here", byKey["reviewer_1_rule"].GetProperty("declineReason").GetString());
        Assert.DoesNotContain(byKey.Values, c => c.GetProperty("status").GetString() == "proposed" && c.GetProperty("kind").GetString() != "report"
            && !(c.GetProperty("params").TryGetProperty("decision", out var d) && d.GetString() == "ask"));

        // Who may do what: a reader sees the run but cannot build; a stranger cannot even see it; a guest never runs anything on the server's machine.
        var reader = await UserWith("reader", clientId);
        await Ok(await reader.GetAsync(Run(repoId, runId)));
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.PostAsJsonAsync($"{Run(repoId, runId)}/build", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.PostAsJsonAsync($"{Run(repoId, runId)}/components/decide-set", new { decision = "decline" })).StatusCode);
        var stranger = _f.Client((await _f.NewUserAsync()).Token);
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.GetAsync(Run(repoId, runId))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.GetAsync($"/repos/{repoId}/onboarding/latest-run")).StatusCode);
        var guest = await UserWith("client_manager", clientId, "guest");
        await Ok(await guest.GetAsync(Run(repoId, runId)));
        var guestBuild = await guest.PostAsJsonAsync($"{Run(repoId, runId)}/build", new { });
        Assert.Equal(HttpStatusCode.Forbidden, guestBuild.StatusCode);
        Assert.Equal("guest_refused", (await guestBuild.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        // A model call runs Claude on the server's machine too: the draft's scan and a request are not a guest's either.
        foreach (var (path, body) in new (string, object)[] { ("draft/scan", new { }), ("components/request", new { text = "a skill" }) })
        {
            var res = await guest.PostAsJsonAsync($"{Run(repoId, runId)}/{path}", body);
            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
            Assert.Equal("guest_refused", (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        }

        // The build: the plan completes with what was decided, the approved cards are written and verified, the trial runs again; the delivery waits.
        var building = await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/build", new { }));
        Assert.True(building.GetProperty("building").GetInt32() >= 1);
        view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "deliver") == "WaitingForUser", "the delivery's click");
        var planDone = Step(view, "plan").GetProperty("result");
        Assert.True(planDone.GetProperty("approved").GetInt32() >= 1);
        Assert.Equal(0, planDone.GetProperty("undecided").GetInt32());
        Assert.Equal("done", planDone.GetProperty("initScan").GetProperty("state").GetString());
        var build = view.GetProperty("build");
        Assert.True(build.GetProperty("installed").GetInt32() >= 1, build.ToString());
        // The draft was set aside before the build wrote anything: kept in the run's own folder, gone from the copy.
        var aside = view.GetProperty("events").EnumerateArray().Single(e => e.GetProperty("type").GetString() == "onboarding.draft.set_aside").GetProperty("payload");
        Assert.Equal("CLAUDE.md", aside.GetProperty("files")[0].GetString());
        Assert.Equal("# Drafted by /init\n\nKeep the README short.\n", await File.ReadAllTextAsync(Path.Combine(_f.TempDir, "onboarding", "_runtime", runId.ToString(), "init-draft", "CLAUDE.md")));
        Assert.Contains(".dcc/profile.json", build.GetProperty("files").EnumerateArray().Select(f => f.GetString()));
        Assert.True(view.GetProperty("trials").GetProperty("after").GetArrayLength() >= 1);
        Assert.Contains(".dcc/components.json", Step(view, "deliver").GetProperty("result").GetProperty("files").EnumerateArray().Select(f => f.GetString()));
        Assert.Equal("declined", view.GetProperty("components").EnumerateArray().Single(c => c.GetProperty("key").GetString() == "reviewer_1_rule").GetProperty("status").GetString());
        AssertViewShape(view);

        // The copy's files: what the run changed, before and after; a path out of the copy is refused.
        var files = await Ok(await admin.GetAsync($"{Run(repoId, runId)}/files"));
        Assert.Contains(files.GetProperty("files").EnumerateArray(), f => f.GetProperty("path").GetString() == ".dcc/profile.json" && f.GetProperty("status").GetString() == "A");
        var profileFile = await Ok(await admin.GetAsync($"{Run(repoId, runId)}/file?path=.dcc/profile.json"));
        Assert.Equal(JsonValueKind.Null, profileFile.GetProperty("before").ValueKind);
        Assert.Contains("\"runId\"", profileFile.GetProperty("after").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"{Run(repoId, runId)}/file?path=../outside.txt")).StatusCode);

        // The delivery: a commit of the approved files in the person's name, a push to the origin, a pull request.
        _f.GhRules(("pr create", "https://github.com/acme/shop/pull/7\n", 0, null));
        Assert.True((await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/deliver", new { }))).GetProperty("delivering").GetBoolean());
        view = await WaitAsync(admin, repoId, runId, v => v.GetProperty("run").GetProperty("status").GetString() == "Completed", "the run's end");
        var deliver = view.GetProperty("deliver");
        Assert.True(deliver.GetProperty("pushed").GetBoolean());
        Assert.False(deliver.GetProperty("localOnly").GetBoolean());
        Assert.Equal(7, deliver.GetProperty("prNumber").GetInt32());
        Assert.Equal("main", deliver.GetProperty("base").GetString());
        Assert.False(string.IsNullOrEmpty(deliver.GetProperty("commitSha").GetString()));
        Assert.Contains("DCC", deliver.GetProperty("report").GetString());
        var branch = connect.GetProperty("branch").GetString()!;
        var bare = new Uri(origin).LocalPath;
        Assert.Contains(branch, (await Git.RunAsync(bare, "branch", "--list", branch)).Out);
        var committed = (await Git.RunAsync(bare, "show", "--name-only", "--format=%an%n%s", branch)).Out;
        Assert.Contains("DCC onboarding: Claude Code setup for", committed);
        Assert.Contains(".dcc/profile.json", committed);
        // What was approved is in the commit — the requested line and the line taken from the draft; the draft itself is not.
        var agents = (await Git.RunAsync(bare, "show", $"{branch}:AGENTS.md")).Out;
        Assert.Contains("Answer in short sentences", agents);
        Assert.Contains("Keep the README short.", agents);
        Assert.DoesNotContain("Keep the README current", agents);
        Assert.Equal("@AGENTS.md", (await Git.RunAsync(bare, "show", $"{branch}:CLAUDE.md")).Out);
        AssertViewShape(view);

        var types = EventTypes(view);
        foreach (var t in new[] { "onboarding.run.started", "onboarding.step.started", "onboarding.step.waiting", "onboarding.step.completed", "onboarding.profile.written",
            "onboarding.interview.answered", "onboarding.processes.mapped", "onboarding.trial.approved", "onboarding.trial.task", "onboarding.plan.drawn",
            "onboarding.profile.corrected", "onboarding.plan.redrawn", "onboarding.card.requested", "onboarding.card.decided", "onboarding.cards.decided_set",
            "onboarding.build.component", "onboarding.build.done", "onboarding.delivered", "onboarding.run.completed" })
            Assert.Contains(t, types);
        var cost = view.GetProperty("cost");
        Assert.True(cost.GetProperty("calls").GetInt32() > 0);
        Assert.Contains(cost.GetProperty("byStep").EnumerateArray(), b => b.GetProperty("stepKey").GetString() == "trial");
        Assert.Equal("Completed", StepStatus(view, "deliver"));
        Assert.Equal("ההרצה הסתיימה", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/decide-set", new { decision = "approve" })));

        // What the chat knows of the run.
        await using (var scope = _f.Services.CreateAsyncScope())
        {
            var (facts, _) = await scope.ServiceProvider.GetRequiredService<IChatRunFacts>().RunFactsAsync(runId, 0, CancellationToken.None);
            Assert.Equal("Completed", facts["מצב ההרצה"]!.GetValue<string>());
            Assert.Equal("לא נפתח", facts["סשן טיוטת /init"]!.GetValue<string>());
            Assert.True(facts["כרטיסי הרכיבים"] is JsonArray { Count: > 0 });
        }
    }

    [Fact]
    public async Task At_the_reversible_level_the_trial_runs_by_itself_and_reversible_cards_are_built_and_reported()
    {
        var admin = await Admin();
        var (_, repoId, _) = await RepoAsync();
        var runId = (await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/onboarding/runs", new { automation = new { level = "nonsense" } }))).GetProperty("runId").GetGuid();
        await WaitAsync(admin, repoId, runId, v => StepStatus(v, "processes") == "WaitingForUser", "the interview");
        Assert.Equal("reversible_auto", (await Ok(await admin.GetAsync(Run(repoId, runId)))).GetProperty("automation").GetProperty("level").GetString());
        await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/interview", new { }));
        var view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "plan") == "WaitingForUser", "the plan");
        Assert.Equal("Completed", StepStatus(view, "trial"));
        Assert.DoesNotContain("onboarding.trial.approved", EventTypes(view));
        Assert.True(view.GetProperty("trials").GetProperty("baseline").GetArrayLength() >= 3);
        var reviewerCard = view.GetProperty("components").EnumerateArray().Single(c => c.GetProperty("key").GetString() == "reviewer_1_rule");
        Assert.Equal("auto", reviewerCard.GetProperty("group").GetString());
        Assert.Equal("approved", reviewerCard.GetProperty("status").GetString());

        // A level for what is still ahead.
        var level = await Ok(await admin.PatchAsJsonAsync($"{Run(repoId, runId)}/automation", new { automation = new { level = "locked" } }));
        Assert.Equal("locked", level.GetProperty("level").GetString());
        Assert.Contains("onboarding.automation.updated", EventTypes(await Ok(await admin.GetAsync(Run(repoId, runId)))));
        // Not an object with a level — a bare word — is the default, as the old server read it; not a 500.
        Assert.Equal("reversible_auto", (await Ok(await admin.PatchAsJsonAsync($"{Run(repoId, runId)}/automation", new { automation = "locked" }))).GetProperty("level").GetString());

        // An empty delivery is refused before anything moves: here the plan, the build and the delivery are put by hand
        // where a run would be with no card built and no dossier written.
        await _f.ExecAsync("update repository_onboarding_step set status = 'Completed' where run_id = @r and step_key in ('plan', 'build')", ("r", runId));
        await _f.ExecAsync("update repository_onboarding_step set status = 'WaitingForUser', result = '{\"files\":[]}'::jsonb where run_id = @r and step_key = 'deliver'", ("r", runId));
        await _f.ExecAsync("update onboarding_component set status = 'declined' where run_id = @r", ("r", runId));
        var empty = await admin.PostAsJsonAsync($"{Run(repoId, runId)}/deliver", new { });
        Assert.Equal("אין קבצים מאושרים למסירה — רק קבצים של רכיבים שאושרו נכנסים ל-commit, ולא כל מה שנמצא בעותק.", await Refused(empty));
        Assert.Equal("WaitingForUser", StepStatus(await Ok(await admin.GetAsync(Run(repoId, runId))), "deliver"));
        await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/cancel", new { }));
    }

    [Fact]
    public async Task A_coach_run_reuses_the_last_runs_processes_and_trials_and_builds_the_approved_proposal_by_itself()
    {
        var admin = await Admin();
        var (clientId, repoId, _) = await RepoAsync();
        var adminId = await _f.ScalarAsync<Guid>("select id from users where email = @e", ("e", _f.AdminEmail));
        // The repository's last finished onboarding, as it left its processes and its baseline trial.
        var prev = await _f.ScalarAsync<Guid>("""
            insert into repository_onboarding_run (repo_id, client_id, kind, status, automation, triggered_by, completed_at)
            values (@r, @c, 'onboarding', 'Completed', '{"level":"all_approval"}'::jsonb, @u, now()) returning id
            """, ("r", repoId), ("c", clientId), ("u", adminId));
        await _f.ExecAsync("""
            insert into onboarding_process (run_id, client_id, key, title, source, evidence, steps) values (@p, @c, 'release', 'Cut a release', 'git', '["CHANGELOG.md"]'::jsonb, '[]'::jsonb)
            """, ("p", prev), ("c", clientId));
        await _f.ExecAsync("""
            insert into onboarding_trial (run_id, client_id, phase, task_key, title, prompt, passed, failure_kind, detail, answer, judged_by, cost_usd)
            values (@p, @c, 'baseline', 'tests', 'Where are the tests?', 'the prompt', false, 'missing_fact', 'it guessed', 'an answer', 'code', 0.25)
            """, ("p", prev), ("c", clientId));
        var proposal = await _f.ScalarAsync<Guid>("""
            insert into repo_coach_proposal (repo_id, client_id, kind, component_key, title, why)
            values (@r, @c, 'add', 'coach_short_answers', 'Answer in short sentences', 'long answers were rewritten by hand') returning id
            """, ("r", repoId), ("c", clientId));

        // An approved proposal opens a coach run: no interview, no trial and no plan to wait on — it runs to the delivery's click.
        var runId = (await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/onboarding/runs", new { kind = "coach", proposalIds = new[] { proposal } }))).GetProperty("runId").GetGuid();
        var view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "deliver") == "WaitingForUser", "the coach run's delivery");
        Assert.Equal("coach", view.GetProperty("run").GetProperty("kind").GetString());
        foreach (var key in new[] { "processes", "trial" })
        {
            var reused = Step(view, key).GetProperty("result");
            Assert.True(reused.GetProperty("reused").GetBoolean());
            Assert.Equal(prev, reused.GetProperty("from").GetGuid());
        }
        Assert.Equal("Cut a release", view.GetProperty("processes").EnumerateArray().Single().GetProperty("title").GetString());
        var trial = view.GetProperty("trials").GetProperty("baseline").EnumerateArray().Single();
        Assert.Equal("tests", trial.GetProperty("taskKey").GetString());
        Assert.Equal("it guessed", trial.GetProperty("detail").GetString());
        Assert.Equal(0.25, trial.GetProperty("costUsd").GetDouble());
        Assert.Equal(JsonValueKind.Null, trial.GetProperty("callId").ValueKind);
        Assert.Equal("(reused)", await _f.ScalarAsync<string>("select prompt from onboarding_trial where run_id = @r", ("r", runId)));
        // A coach run does not pay for the trial again.
        Assert.Equal(0, view.GetProperty("trials").GetProperty("after").GetArrayLength());

        // The plan completed by itself, its one card the proposal's — approved, built.
        Assert.Equal("Completed", StepStatus(view, "plan"));
        var plan = Step(view, "plan").GetProperty("result");
        Assert.Equal(1, plan.GetProperty("components").GetInt32());
        Assert.Equal(JsonValueKind.Null, plan.GetProperty("reviewer").ValueKind);
        Assert.False(plan.GetProperty("marketplace").GetProperty("searched").GetBoolean());
        var card = view.GetProperty("components").EnumerateArray().Single();
        Assert.Equal("coach_short_answers", card.GetProperty("key").GetString());
        Assert.Equal("coach", card.GetProperty("source").GetString());
        Assert.Equal(proposal.ToString(), card.GetProperty("sourceRef").GetString());
        Assert.Contains(card.GetProperty("status").GetString(), new[] { "installed", "verified" });
        Assert.Equal("approved", await _f.ScalarAsync<string>("select status from repo_coach_proposal where id = @p", ("p", proposal)));
        Assert.Equal(runId, await _f.ScalarAsync<Guid>("select run_id from repo_coach_proposal where id = @p", ("p", proposal)));
        var types = EventTypes(view);
        Assert.DoesNotContain("onboarding.trial.approved", types);
        Assert.DoesNotContain("onboarding.interview.answered", types);
        var started = view.GetProperty("events").EnumerateArray().First(e => e.GetProperty("type").GetString() == "onboarding.run.started").GetProperty("payload");
        Assert.Equal("coach", started.GetProperty("kind").GetString());
        Assert.Equal(proposal.ToString(), started.GetProperty("proposals")[0].GetString());
        AssertViewShape(view);
        await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/cancel", new { }));
    }

    [Fact]
    public async Task A_cancelled_run_keeps_its_copy_and_refuses_what_comes_after()
    {
        var admin = await Admin();
        var (_, repoId, _) = await RepoAsync();
        var runId = (await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/onboarding/runs", new { }))).GetProperty("runId").GetGuid();
        var view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "processes") == "WaitingForUser", "the interview");
        var dir = view.GetProperty("run").GetProperty("workspacePath").GetString()!;
        // Before the plan, a card is neither asked for nor decided, the draft is not scanned and nothing is built.
        Assert.Equal("בקשה לרכיב אפשרית כשהתוכנית פתוחה לאישור", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/request", new { text = "a skill" })));
        Assert.Equal("התוכנית לא ממתינה להחלטות", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/decide-set", new { decision = "approve" })));
        Assert.Equal("סריקת הטיוטה אפשרית כשהתוכנית פתוחה לאישור", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/draft/scan", new { })));
        Assert.Equal("התוכנית לא ממתינה", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/build", new { })));
        Assert.Equal("המסירה לא ממתינה", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/deliver", new { })));
        Assert.Equal("ריצת הניסיון לא ממתינה לאישור", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/trial/approve", new { })));

        Assert.True((await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/cancel", new { }))).GetProperty("cancelled").GetBoolean());
        view = await Ok(await admin.GetAsync(Run(repoId, runId)));
        Assert.Equal("Cancelled", view.GetProperty("run").GetProperty("status").GetString());
        Assert.False(string.IsNullOrEmpty(view.GetProperty("run").GetProperty("cancelledAt").GetString()));
        Assert.Equal("Completed", StepStatus(view, "connect"));
        Assert.All(new[] { "processes", "trial", "plan", "build", "deliver" }, k => Assert.Equal("Cancelled", StepStatus(view, k)));
        Assert.Contains("onboarding.run.cancelled", EventTypes(view));
        Assert.True(Directory.Exists(dir));

        Assert.Equal("ההרצה כבר הסתיימה", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/cancel", new { })));
        Assert.Equal("הראיון לא ממתין לתשובות", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/interview", new { })));
        Assert.Equal("ההרצה הסתיימה", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/steps/processes/run", new { })));
        Assert.Equal("ההרצה הסתיימה", await Refused(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/draft/start", new { resume = false })));
        Assert.Equal("ההרצה הסתיימה", await Refused(await admin.PatchAsJsonAsync($"{Run(repoId, runId)}/automation", new { automation = new { level = "locked" } })));

        // A new run may start once the last one is over.
        var next = (await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/onboarding/runs", new { }))).GetProperty("runId").GetGuid();
        await WaitAsync(admin, repoId, next, v => StepStatus(v, "processes") == "WaitingForUser", "the second run's interview");
        await Ok(await admin.PostAsJsonAsync($"{Run(repoId, next)}/cancel", new { }));
    }

    [Fact]
    public async Task A_failed_step_is_run_again_by_a_click()
    {
        var admin = await Admin();
        var (_, repoId, _) = await RepoAsync("file:///" + Path.Combine(_f.TempDir, "no-such-origin", Guid.NewGuid().ToString("N")).Replace('\\', '/'));
        var runId = (await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/onboarding/runs", new { }))).GetProperty("runId").GetGuid();
        var view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "connect") == "Failed", "the connect step to fail", failureExpected: true);
        Assert.Equal("Failed", view.GetProperty("run").GetProperty("status").GetString());
        Assert.Equal("connect", view.GetProperty("run").GetProperty("currentStepKey").GetString());
        Assert.True(Step(view, "connect").GetProperty("errors").GetArrayLength() == 1);
        Assert.Contains("onboarding.step.failed", EventTypes(view));
        // A failed run does not move by itself, and holds the repository: no second run beside it.
        Assert.Equal("Pending", StepStatus(view, "diagnose"));

        // The remote is fixed; the same step runs again from its button.
        await _f.ExecAsync("update repo set ado_repo_ref = @u where id = @id", ("u", await _f.NewOriginAsync()), ("id", repoId));
        Assert.Equal("connect", (await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/steps/connect/run", new { }))).GetProperty("started").GetString());
        view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "processes") == "WaitingForUser", "the interview after the rerun");
        Assert.Empty(Step(view, "connect").GetProperty("errors").EnumerateArray());
        await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/cancel", new { }));
    }

    [Fact]
    public async Task Only_a_clients_repository_is_onboarded_and_an_unknown_one_is_a_refusal_not_a_404()
    {
        var admin = await Admin();
        var shared = await _f.ScalarAsync<Guid>("insert into repo(name, ado_repo_ref) values (@n, @u) returning id", ("n", "shared-" + Guid.NewGuid().ToString("N")[..6]), ("u", "https://github.com/acme/shared"));
        Assert.Equal("הטמעה אפשרית רק לריפו ששייך ללקוח", await Refused(await admin.GetAsync($"/repos/{shared}/onboarding/latest-run")));
        Assert.Equal("הטמעה אפשרית רק לריפו ששייך ללקוח", await Refused(await admin.PostAsJsonAsync($"/repos/{shared}/onboarding/runs", new { })));
        Assert.Equal("הריפו לא נמצא", await Refused(await admin.GetAsync($"/repos/{Guid.NewGuid()}/onboarding/runs")));
        var (clientId, repoId, _) = await RepoAsync();
        Assert.Equal("ההרצה לא נמצאה", await Refused(await admin.GetAsync(Run(repoId, Guid.NewGuid()))));

        // A reader may read the (empty) history but not start a run.
        var reader = await UserWith("reader", clientId);
        Assert.Equal(0, (await Ok(await reader.GetAsync($"/repos/{repoId}/onboarding/runs"))).GetProperty("runs").GetArrayLength());
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.PostAsJsonAsync($"/repos/{repoId}/onboarding/runs", new { })).StatusCode);
        // Someone else's client's repository is not theirs to read.
        var (_, otherRepo, _) = await RepoAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.GetAsync($"/repos/{otherRepo}/onboarding/runs")).StatusCode);
    }

    [Fact]
    public async Task After_a_restart_a_step_that_was_mid_flight_fails_and_a_running_scan_says_it_stopped()
    {
        var admin = await Admin();
        var (_, repoId, _) = await RepoAsync();
        var runId = (await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/onboarding/runs", new { }))).GetProperty("runId").GetGuid();
        await WaitAsync(admin, repoId, runId, v => StepStatus(v, "processes") == "WaitingForUser", "the interview");

        // As the server would have left it: the processes step mid-flight, and a scan of the draft running in a waiting plan.
        await _f.ExecAsync("update repository_onboarding_step set status = 'Running' where run_id = @r and step_key = 'processes'", ("r", runId));
        await _f.ExecAsync("""
            update repository_onboarding_step set status = 'WaitingForUser',
              result = '{"initScan":{"state":"running","startedAt":"2026-10-25T10:00:00.000Z","by":"someone","files":["CLAUDE.md"]}}'::jsonb
            where run_id = @r and step_key = 'plan'
            """, ("r", runId));
        await _f.ExecAsync("update repository_onboarding_run set status = 'Running' where id = @r", ("r", runId));

        int touched;
        await using (var scope = _f.Services.CreateAsyncScope())
            touched = await scope.ServiceProvider.GetRequiredService<OnboardingRuns>().RecoverAsync();
        Assert.True(touched >= 2);

        var view = await Ok(await admin.GetAsync(Run(repoId, runId)));
        Assert.Equal("Failed", StepStatus(view, "processes"));
        Assert.Equal("הצעד הופסק כשהשרת הופעל מחדש — הריצו אותו שוב", Step(view, "processes").GetProperty("errors")[0].GetString());
        Assert.Equal("Failed", view.GetProperty("run").GetProperty("status").GetString());
        var scan = Step(view, "plan").GetProperty("result").GetProperty("initScan");
        Assert.Equal("failed", scan.GetProperty("state").GetString());
        Assert.Equal("הסריקה הופסקה כשהשרת הופעל מחדש — אפשר לסרוק שוב", scan.GetProperty("error").GetString());
        Assert.Equal("CLAUDE.md", scan.GetProperty("files")[0].GetString());
        var failed = view.GetProperty("events").EnumerateArray().Last(e => e.GetProperty("type").GetString() == "onboarding.draft.scan_failed");
        Assert.Equal("api_restart", failed.GetProperty("payload").GetProperty("reason").GetString());
        Assert.Equal(JsonValueKind.Null, failed.GetProperty("actorUserId").ValueKind);

        await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/cancel", new { }));
    }

    // ── the old onboarding.prove.ts: what the run decides, with answers that steer every decision ──

    /// <summary>What the stand-in answers to every call of one kind.</summary>
    private void StandIn(string kind, object answer) =>
        File.WriteAllText(Path.Combine(_f.TempDir, $"onboarding-{kind}.txt"), answer as string ?? JsonSerializer.Serialize(answer));

    /// <summary>What the stand-in answers to a call of one kind, by the first regex its instruction matches.</summary>
    private void StandIn(string kind, params (string When, object Answer)[] rules) =>
        File.WriteAllText(Path.Combine(_f.TempDir, $"onboarding-{kind}.rules.json"), JsonSerializer.Serialize(rules.Select(r => new { when = r.When, answer = r.Answer })));

    private void StandInsGone()
    {
        foreach (var f in Directory.GetFiles(_f.TempDir, "onboarding-*.txt").Concat(Directory.GetFiles(_f.TempDir, "onboarding-*.rules.json"))) File.Delete(f);
    }

    /// <summary>A call's whole instruction — a lean call carries it in its system prompt file.</summary>
    private static string InstructionOf(JsonElement call) =>
        (call.TryGetProperty("system", out var s) ? s.GetString() + "\n" : "") + call.GetProperty("prompt").GetString();

    /// <summary>
    /// The old <c>onboarding.prove.ts</c>, for what the run above does not show: with the old prove kit's answers — two
    /// processes, a trial that is honest about tests, right about the build and lost on entry points, an open search that
    /// finds the vendor's LSP and a stranger's MCP, a reviewer's gap, a /init draft with a section, a line, a permission, a
    /// settings file and a section about paths the code does not have — every decision the code makes is the right one:
    /// a corrected fact holds its rule back, the agent test, the code as the judge, the trust grading, what the scan may
    /// take, the draft set aside (its commit undone, its shell edit put back), each component validated its own way, only
    /// the approved files delivered, and a coach with honest zeros.
    /// </summary>
    [Fact]
    public async Task With_the_old_prove_kits_answers_every_decision_the_run_makes_is_the_right_one()
    {
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        var origin = await _f.NewOriginAsync(new Dictionary<string, string>
        {
            ["base.txt"] = "base\n",
            ["package.json"] = """
                {
                  "name": "prove-repo",
                  "private": true,
                  "scripts": {
                    "build": "node -e \"process.exit(require('fs').existsSync('broken.txt') ? 1 : 0)\""
                  }
                }

                """,
            // a lock file, so the stack has a tag ("npm") for the open search to be asked about
            ["package-lock.json"] = "{\n  \"name\": \"prove-repo\",\n  \"lockfileVersion\": 3\n}",
        });
        var (_, repoId, _) = await RepoAsync(origin);
        // A stranger's MCP at an address the page fetcher refuses without connecting: the test never reaches the internet.
        const string strangerUrl = "https://192.0.2.1/someone/random-mcp";
        const string lspUrl = "https://github.com/anthropics/claude-plugins-official/tree/main/plugins/typescript-lsp";
        StandIn("processes", new
        {
            processes = new object[]
            {
                new { key = "release", title = "Release a version", source = "docs", evidence = new[] { "package.json build script" }, steps = new object[]
                {
                    new { key = "build", title = "Build the package", what = "run npm run build, then check the output", agentTest = new { judgment = false, externalInfo = false, readsALot = false, parallel = false, failsToday = false, why = "a fixed procedure" } },
                    new { key = "publish", title = "Publish", what = "publish to the registry", agentTest = new { judgment = false, externalInfo = true, readsALot = false, parallel = false, failsToday = false, why = "needs registry credentials" } },
                } },
                new { key = "edit_base", title = "Change base.txt", source = "git", evidence = new[] { "base.txt in every commit" }, steps = new object[]
                {
                    new { key = "edit", title = "Edit base.txt", what = "edit the file", agentTest = new { judgment = false, externalInfo = false, readsALot = false, parallel = false, failsToday = false, why = "one action" } },
                } },
            },
        });
        StandIn("trial",
            (@"TASK:\r?\n[^\r\n]*automated tests", "I looked for a test runner. There is no test framework in this repository.\nRESULT: there are no automated tests"),
            (@"TASK:\r?\n[^\r\n]*build", "package.json has a build script.\nRESULT: npm run build"),
            (@"TASK:\r?\n[^\r\n]*entry points", "I could not find any entry point.\nRESULT: could not find"),
            (@"[\s\S]", "Looked around.\nRESULT: done"));
        StandIn("judge",
            ("could not find", new { passed = false, failureKind = "missing_fact", detail = "הסוכן לא מצא את נקודת הכניסה" }),
            (@"[\s\S]", new { passed = true, failureKind = (string?)null, detail = "עבר" }));
        StandIn("marketplace", new
        {
            sources = new object[]
            {
                new { kind = "lsp", name = "typescript-lsp", url = lspUrl, publisher = "Anthropic", description = "Language server plugin", tags = new[] { "npm", "typescript" }, official = true, why = "navigation", toolCount = (int?)null, readOnly = (bool?)null, license = "MIT", lastActivity = "2026-09" },
                new { kind = "mcp", name = "Random MCP", url = strangerUrl, publisher = "someone", description = "73 tools", tags = new[] { "npm" }, official = true, why = "everything", toolCount = (int?)73, readOnly = (bool?)false, license = (string?)null, lastActivity = "2020-01" },
            },
        });
        StandIn("review", new { missing = new[] { new { kind = "doc", title = "מסמך הרצה", why = "אין README ואין הוראות הרצה" } }, redundant = Array.Empty<object>() });
        StandIn("request", new { kind = "skill", title = "skill: עדכון base.txt", what = "נוהל לעדכון הקובץ", questions = new[] { new { key = "when", question_he = "מתי מריצים?", @default = "אחרי כל שינוי" } } });
        StandIn("author",
            (@"FORMAT REQUIRED:[\s\S]*SKILL\.md", "---\nname: update-base\ndescription: Updates base.txt the way this repository does it. Use whenever base.txt must change.\nallowed-tools: Read, Grep, Glob, Bash\n---\n\n# Update base.txt\n\n1. Open `base.txt`.\n2. Change the line.\n3. Run `npm run build` and make sure it passes.\n4. Do not touch `package.json`.\n\nThis skill exists because base.txt is in every commit of the history, and the build is the only gate.\n"),
            (@"FORMAT REQUIRED:[\s\S]*subagent definition", "---\nname: publish-checker\ndescription: Checks a release before it is published; call it when a version is about to go out.\ntools: Glob, Grep, Read, Bash\nmodel: sonnet\n---\n\nYou check a release.\n\n- [ ] `package.json` version bumped\n- [ ] `npm run build` passes\n- [ ] `base.txt` unchanged\n- [ ] no `broken.txt` present\n\nOutput: a JSON array of findings {file, line, severity, note}.\n"),
            (@"FORMAT REQUIRED:[\s\S]*One paragraph", "A small package used to prove DCC's onboarding: one file, base.txt, and a build script that fails while broken.txt exists."),
            (@"FORMAT REQUIRED:[\s\S]*body of the Markdown document", "## Layout\n\n- `base.txt` — the one file\n- `package.json` — the build script\n\n## Run\n\n`npm run build`\n"),
            (@"FORMAT REQUIRED:[\s\S]*checklist", "- [ ] `base.txt` unchanged unless the task says so\n- [ ] `npm run build` passes\n- [ ] no `broken.txt`\n- [ ] `package.json` version bumped when releasing\n- [ ] the change is small\n- [ ] no secrets"),
            (@"[\s\S]", "content"));
        StandIn("init_scan", """
            {"verdict": "merge", "summary": "הטיוטה מדויקת יותר על מבנה הריפו; ההנחיה הכללית שלה לא נלקחה.",
             "compare": [{"topic": "מבנה", "ours": "רשימת תיקיות", "theirs": "הקובץ היחיד והפקודה", "better": "theirs", "why": "base.txt ו-npm run build קיימים"}],
             "items": [
               {"decision": "take", "form": "section", "title": "איפה הדברים", "target": "AGENTS.md", "heading": "Where things are", "text": "The one file is `base.txt`; build with `npm run build`.", "origin": "theirs", "need": "ניסיון נקודות הכניסה נכשל", "evidence": "base.txt", "alternative": "אין בשלנו", "verify": "ניסיון חוזר", "cost": "שתי שורות"},
               {"decision": "take", "form": "line", "title": "build לפני סיום", "target": "AGENTS.md", "text": "Run `npm run build` before saying a change is done", "origin": "merged", "need": "אין CI", "evidence": "package.json", "alternative": "סקריפט האימות", "verify": "ה-build gate", "cost": "שורה", "replaces": ["reviewer_1_doc", "no_such_card"]},
               {"decision": "ask", "form": "line", "title": "פרסום אחרי מיזוג", "target": "AGENTS.md", "text": "Publish to the npm registry after every merge", "origin": "theirs", "need": "תהליך release", "evidence": "תהליך release", "alternative": "ידני", "verify": "—", "cost": "הרשאת פרסום", "question": "מותר לסוכן לפרסם ל-npm? ידוע: יש תהליך release. חסר: מדיניות"},
               {"decision": "take", "form": "file", "title": "הגדרות", "target": ".claude/settings.json", "text": "{}", "origin": "theirs"},
               {"decision": "take", "form": "section", "title": "ארכיטקטורה", "target": "AGENTS.md", "heading": "Architecture", "text": "Handlers are in `src/api/`, models in `lib/models.ts`, and `base.txt` is the data.", "origin": "theirs"}],
             "drop_ours": [{"key": "reviewer_1_doc", "why": "הסעיף מהטיוטה מכסה את זה"}],
             "reject": [{"what": "Use async/await everywhere", "why": "כללי — לא ספציפי לריפו"}]}
            """);
        try
        {
            // 0–1. connect and diagnose run by themselves; the processes step waits for the interview.
            var runId = (await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/onboarding/runs", new { automation = new { level = "all_approval" } }))).GetProperty("runId").GetGuid();
            var view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "processes") == "WaitingForUser", "the interview");
            // diagnose: no model, a profile with facts the person can correct, saying what is missing
            Assert.Equal(0, view.GetProperty("cost").GetProperty("calls").GetInt32());
            var facts = view.GetProperty("profile").GetProperty("facts").EnumerateArray().ToDictionary(f => f.GetProperty("path").GetString()!);
            Assert.True(facts.Count >= 12, string.Join(", ", facts.Keys));
            Assert.All(new[] { "tests", "ci", "lint_format" }, k => Assert.Equal("warn", facts[k].GetProperty("tone").GetString()));
            Assert.Contains("אין", facts["ai_config"].GetProperty("value_he").GetString());
            // the interview asks only what the code cannot tell, each with a default
            var questions = view.GetProperty("interview").GetProperty("questions").EnumerateArray().ToList();
            Assert.InRange(questions.Count, 1, 4);
            Assert.All(questions, q => Assert.Contains(q.GetProperty("options").EnumerateArray(), o => o.GetProperty("value").GetString() == q.GetProperty("default").GetString()));

            // A correction before the plan: the rule that reads the fact is held back later.
            await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/profile/correct", new { path = "lint_format", note = "יש לנו פורמטר בחוץ" }));

            // 2. One answer given, the rest assumed; the model maps the processes and the code decides each step.
            await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/interview", new { answers = new Dictionary<string, string> { ["done_means"] = "build_tests" } }));
            view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "trial") == "WaitingForUser", "the trial's gate");
            var proc = Step(view, "processes").GetProperty("result");
            Assert.Equal(1, proc.GetProperty("answered").GetInt32());
            Assert.Equal(questions.Count - 1, proc.GetProperty("assumed").GetInt32());
            // an external-info step is an agent, a recurring procedure a skill, a single action nothing
            Assert.Equal(1, proc.GetProperty("agents").GetInt32());
            Assert.Equal(1, proc.GetProperty("skills").GetInt32());
            Assert.Contains(view.GetProperty("processes").EnumerateArray(), p => p.GetProperty("steps").EnumerateArray().Any(s => s.GetProperty("decision").GetString() == "none"));
            // with "everything waits for approval" the trial's cost is declared before it is spent
            var waiting = view.GetProperty("trials").GetProperty("waiting");
            Assert.True(waiting.GetProperty("estimateUsd").GetDouble() > 0);
            Assert.Contains(waiting.GetProperty("tasks").EnumerateArray(), t => t.GetProperty("key").GetString() == "no_tests_honesty");

            // 3. The trial: the code judges the honesty task; the stand-in judges the rest, and one fails.
            await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/trial/approve", new { }));
            view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "plan") == "WaitingForUser", "the plan");
            var baseline = view.GetProperty("trials").GetProperty("baseline").EnumerateArray().ToList();
            var trial = baseline.ToDictionary(t => t.GetProperty("taskKey").GetString()!);
            Assert.True(trial["no_tests_honesty"].GetProperty("passed").GetBoolean());
            Assert.Equal("code", trial["no_tests_honesty"].GetProperty("judgedBy").GetString());
            Assert.True(trial["how_to_build"].GetProperty("passed").GetBoolean());
            Assert.NotEqual("code", trial["how_to_build"].GetProperty("judgedBy").GetString());
            Assert.False(trial["entry_points"].GetProperty("passed").GetBoolean());
            Assert.Equal("missing_fact", trial["entry_points"].GetProperty("failureKind").GetString());
            // every trial task is a ledger row, and every row carries its step
            var rows = view.GetProperty("cost").GetProperty("rows").EnumerateArray().ToList();
            Assert.Equal(baseline.Count, rows.Count(r => r.GetProperty("capability").GetString() == "onboarding_trial"));
            Assert.All(rows, r => Assert.Equal(JsonValueKind.String, r.GetProperty("meta").GetProperty("stepKey").ValueKind));

            // 4. The plan: the repository's signals fired; the corrected fact held its rule back, and the plan says which.
            var plan = view.GetProperty("plan");
            var fired = plan.GetProperty("rulesFired").EnumerateArray().Select(r => r.GetString()).ToList();
            Assert.All(new[] { "R02", "R05", "R17", "R22b" }, r => Assert.Contains(r, fired));
            Assert.DoesNotContain("R21", fired);
            Assert.Contains(plan.GetProperty("rulesSuppressed").EnumerateArray(), s => s.GetProperty("rule").GetString() == "R21" && s.GetProperty("fact").GetString() == "lint_format");
            JsonElement? Card(JsonElement v, string key) => v.GetProperty("components").EnumerateArray().Cast<JsonElement?>().FirstOrDefault(c => c!.Value.GetProperty("key").GetString() == key);
            Assert.Equal("agent", Card(view, "agent_release_publish")?.GetProperty("kind").GetString());
            Assert.Equal("skill", Card(view, "skill_release_build")?.GetProperty("kind").GetString());
            // the open search's finds graded by the code: the vendor's LSP is official; the stranger is unverified despite the model's claim
            Assert.Equal("official", Card(view, "lsp_typescript_lsp")?.GetProperty("params").GetProperty("trust").GetString());
            Assert.Equal("unverified", Card(view, "mcp_random_mcp")?.GetProperty("params").GetProperty("trust").GetString());
            Assert.Contains("אזהרה", Card(view, "mcp_random_mcp")?.GetProperty("why_he").GetString());
            var cards = view.GetProperty("components").EnumerateArray().ToList();
            Assert.Contains(cards, c => c.GetProperty("source").GetString() == "reviewer" && c.GetProperty("group").GetString() == "approval" && c.GetProperty("status").GetString() == "proposed");
            // at "everything waits" only reports are automatic; what is not recommended says why
            Assert.All(cards.Where(c => c.GetProperty("group").GetString() == "auto"), c => Assert.Equal("report", c.GetProperty("kind").GetString()));
            Assert.Contains(cards, c => c.GetProperty("group").GetString() == "not_recommended" && c.GetProperty("status").GetString() == "declined"
                && !string.IsNullOrEmpty(c.GetProperty("declineReason").GetString()));
            Assert.All(cards, c =>
            {
                Assert.True(c.GetProperty("why_he").GetString()!.Length > 10, c.ToString());
                if (c.GetProperty("kind").GetString() is not ("report" or "runner")) Assert.True(c.GetProperty("verifyHow_he").GetString()!.Length > 3, c.ToString());
            });
            Assert.False(view.GetProperty("readiness").GetProperty("ready").GetBoolean());
            Assert.Contains(view.GetProperty("readiness").GetProperty("items").EnumerateArray(), i => !i.GetProperty("ok").GetBoolean());

            // A person's request becomes a skill card with at most three questions.
            var req = await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/request", new { text = "תכין skill לעדכון base.txt" }));
            Assert.Equal("skill", req.GetProperty("kind").GetString());
            Assert.InRange(req.GetProperty("questions").GetArrayLength(), 1, 3);
            var reqKey = req.GetProperty("key").GetString()!;

            // Decisions: everything as a set, then one declined with a reason, the request approved with its answer.
            await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/decide-set", new { decision = "approve" }));
            await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/mcp_random_mcp/decide", new { decision = "decline", reason = "לא מאומת ויקר בהקשר" }));
            await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/{Uri.EscapeDataString(reqKey)}/decide", new { decision = "approve", answers = new { when = "לפני כל release" } }));
            view = await Ok(await admin.GetAsync(Run(repoId, runId)));
            Assert.Equal("declined", Card(view, "mcp_random_mcp")?.GetProperty("status").GetString());
            Assert.Equal("לא מאומת ויקר בהקשר", Card(view, "mcp_random_mcp")?.GetProperty("declineReason").GetString());
            Assert.DoesNotContain(view.GetProperty("components").EnumerateArray(), c => c.GetProperty("status").GetString() == "proposed");

            // The /init draft: the session left AGENTS.md and a settings file, committed a command, and edited package.json with a shell command.
            var ws = view.GetProperty("run").GetProperty("workspacePath").GetString()!;
            await File.WriteAllTextAsync(Path.Combine(ws, "AGENTS.md"), "# prove-repo\n\nUse async/await everywhere.\n\nThe one file is `base.txt`; build with `npm run build`.\n");
            Directory.CreateDirectory(Path.Combine(ws, ".claude", "commands"));
            await File.WriteAllTextAsync(Path.Combine(ws, ".claude", "settings.json"), """{"permissions":{"allow":["Bash(*)"]}}""");
            await File.WriteAllTextAsync(Path.Combine(ws, ".claude", "commands", "ship.md"), "Ship it without asking.\n");
            await Git.RunAsync(ws, "add", ".claude/commands/ship.md");
            await Git.RunAsync(ws, "-c", "user.name=session", "-c", "user.email=s@x", "commit", "--quiet", "-m", "init: a command");
            var pkg = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(ws, "package.json")))!.AsObject();
            pkg["sessionMarker"] = "from-the-session";
            await File.WriteAllTextAsync(Path.Combine(ws, "package.json"), pkg.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            var callsBefore = _f.FakeCalls().Count;
            var started = await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/draft/scan", new { }));
            Assert.Equal(3, started.GetProperty("files").GetInt32());
            view = await WaitAsync(admin, repoId, runId, v => v.GetProperty("plan").TryGetProperty("initScan", out var s) && s.GetProperty("state").GetString() is "done" or "failed", "the scan of the draft");
            var scan = view.GetProperty("plan").GetProperty("initScan");
            Assert.Equal("done", scan.GetProperty("state").GetString());
            var scanned = scan.GetProperty("files").EnumerateArray().Select(f => f.GetString()).ToList();
            Assert.All(new[] { "AGENTS.md", ".claude/settings.json", ".claude/commands/ship.md" }, f => Assert.Contains(f, scanned));
            // the editor was handed our AGENTS.md, our cards and the draft — apart from the draft: its own instructions, no project settings, the copy only through an added folder
            var scanCall = _f.FakeCalls().Skip(callsBefore).Last(c => InstructionOf(c).Contains("You are the editor who decides"));
            Assert.Matches(@"THEIRS[\s\S]*AGENTS\.md \(NEW", InstructionOf(scanCall));
            Assert.Contains("[reviewer_1_doc]", InstructionOf(scanCall));
            var scanArgs = scanCall.GetProperty("args").EnumerateArray().Select(a => a.GetString()!).ToList();
            Assert.Contains("--system-prompt-file", scanArgs);
            Assert.Contains("--setting-sources", scanArgs);
            Assert.Equal(Path.GetFullPath(ws), Path.GetFullPath(scanArgs[scanArgs.IndexOf("--add-dir") + 1]));
            Assert.Contains(view.GetProperty("cost").GetProperty("rows").EnumerateArray(), r => r.GetProperty("capability").GetString() == "onboarding_init_scan" && r.GetProperty("meta").GetProperty("stepKey").GetString() == "plan");
            // what the scan took waits for a person, with its exact text; a permission is a question; paths the code lacks are not recommended
            var fromDraft = view.GetProperty("components").EnumerateArray().Where(c => c.GetProperty("source").GetString() == "init").ToList();
            JsonElement Taken(string title) => fromDraft.Single(c => c.GetProperty("title_he").GetString() == title);
            Assert.Equal(4, fromDraft.Count);
            Assert.All(new[] { "איפה הדברים", "build לפני סיום", "פרסום אחרי מיזוג" }, t =>
            {
                Assert.Equal("approval", Taken(t).GetProperty("group").GetString());
                Assert.Equal("proposed", Taken(t).GetProperty("status").GetString());
            });
            Assert.Equal("The one file is `base.txt`; build with `npm run build`.", Taken("איפה הדברים").GetProperty("params").GetProperty("text").GetString());
            Assert.Matches("צריך החלטה שלך: מותר לסוכן לפרסם", Taken("פרסום אחרי מיזוג").GetProperty("why_he").GetString());
            Assert.Equal("not_recommended", Taken("ארכיטקטורה").GetProperty("group").GetString());
            Assert.Contains("src/api/", Taken("ארכיטקטורה").GetProperty("why_he").GetString());
            // a settings file is not taken whole, the generic line is left out — both said, with why
            Assert.Contains(scan.GetProperty("refused").EnumerateArray(), r => r.GetProperty("why").GetString()!.Contains("settings.json"));
            Assert.Contains(scan.GetProperty("reject").EnumerateArray(), r => r.GetProperty("what").GetString()!.Contains("async"));
            // a card of ours the scan finds redundant gets a note and stays the person's; "replaces" names only real cards
            Assert.Contains("סריקת /init: ", Card(view, "reviewer_1_doc")?.GetProperty("why_he").GetString());
            Assert.Equal(["reviewer_1_doc"], Taken("build לפני סיום").GetProperty("params").GetProperty("replaces").EnumerateArray().Select(x => x.GetString()));

            // "approve all" approves what was taken and leaves the question to be answered on its own
            await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/decide-set", new { decision = "approve" }));
            view = await Ok(await admin.GetAsync(Run(repoId, runId)));
            string? StatusOf(JsonElement v, string title) => v.GetProperty("components").EnumerateArray().First(c => c.GetProperty("title_he").GetString() == title).GetProperty("status").GetString();
            Assert.Equal("approved", StatusOf(view, "איפה הדברים"));
            Assert.Equal("approved", StatusOf(view, "build לפני סיום"));
            Assert.Equal("proposed", StatusOf(view, "פרסום אחרי מיזוג"));
            await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/components/{Uri.EscapeDataString(Taken("פרסום אחרי מיזוג").GetProperty("key").GetString()!)}/decide",
                new { decision = "decline", reason = "לא — אין פרסום אוטומטי" }));
            // a second scan: told what the first took and what was decided, and keeping those decisions
            var rescan = await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/draft/scan", new { }));
            Assert.Equal(3, rescan.GetProperty("files").GetInt32());
            view = await WaitAsync(admin, repoId, runId, v => v.GetProperty("plan").GetProperty("initScan").GetProperty("state").GetString() == "done"
                && EventTypes(v).Count(t => t == "onboarding.draft.scanned") == 2, "the second scan");
            Assert.Contains("taken from the draft by an earlier scan", InstructionOf(_f.FakeCalls().Skip(callsBefore).Last(c => InstructionOf(c).Contains("You are the editor who decides"))));
            var lastScan = view.GetProperty("events").EnumerateArray().Last(e => e.GetProperty("type").GetString() == "onboarding.draft.scanned");
            Assert.Equal(4, lastScan.GetProperty("payload").GetProperty("created").GetArrayLength());
            Assert.Equal("approved", StatusOf(view, "איפה הדברים"));
            Assert.Equal("declined", StatusOf(view, "פרסום אחרי מיזוג"));

            // 5. The build: each component validated its own way, the trial again.
            await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/build", new { }));
            view = await WaitAsync(admin, repoId, runId, v => StepStatus(v, "deliver") == "WaitingForUser", "the build", seconds: 300);
            var dir = view.GetProperty("run").GetProperty("workspacePath").GetString()!;
            JsonElement Built(string key) => Card(view, key) ?? throw new Xunit.Sdk.XunitException($"no card {key}");
            // the build gate hook was written and really run
            Assert.Equal("verified", Built("build_gate_hook").GetProperty("status").GetString());
            Assert.Contains(".claude/hooks/build-gate.mjs", Built("build_gate_hook").GetProperty("files").EnumerateArray().Select(f => f.GetString()));
            Assert.True(Built("build_gate_hook").GetProperty("validation").GetProperty("passed").GetBoolean(), Built("build_gate_hook").GetProperty("validation").ToString());
            // the local gate ran the real build and passed
            Assert.Equal("verified", Built("local_gate_script").GetProperty("status").GetString());
            Assert.Contains("ok", Built("local_gate_script").GetProperty("validation").GetProperty("detail").GetString());
            var agents = await File.ReadAllTextAsync(Path.Combine(dir, "AGENTS.md"));
            Assert.Contains("npm run build", agents);
            Assert.Equal("@AGENTS.md", (await File.ReadAllTextAsync(Path.Combine(dir, "CLAUDE.md"))).Trim());
            // the skills (the process's and the person's) have a frontmatter Claude Code loads; the agent is read-only with a checklist
            Assert.Equal("verified", Built("skill_release_build").GetProperty("status").GetString());
            Assert.Equal("verified", Built(reqKey).GetProperty("status").GetString());
            Assert.True(File.Exists(Path.Combine(dir, Built(reqKey).GetProperty("files")[0].GetString()!)));
            Assert.Equal("verified", Built("agent_release_publish").GetProperty("status").GetString());
            Assert.Contains("קריאה בלבד", Built("agent_release_publish").GetProperty("validation").GetProperty("detail").GetString());
            // the LSP plugin is registered in settings and honestly "not verified here"
            Assert.Equal("installed", Built("lsp_typescript_lsp").GetProperty("status").GetString());
            Assert.Equal(JsonValueKind.Null, Built("lsp_typescript_lsp").GetProperty("validation").GetProperty("passed").ValueKind);
            var settings = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(dir, ".claude", "settings.json")))!;
            Assert.True(settings["enabledPlugins"]?["typescript-lsp@claude-plugins-official"]?.GetValue<bool>());
            // the declined component was not built; a first test for a language without a template is deferred, not faked
            Assert.Equal("declined", Built("mcp_random_mcp").GetProperty("status").GetString());
            Assert.Equal(0, Built("mcp_random_mcp").GetProperty("files").GetArrayLength());
            Assert.False(File.Exists(Path.Combine(dir, ".mcp.json")));
            Assert.Equal("deferred", Built("first_tests_scaffold").GetProperty("status").GetString());
            // the draft was set aside before the build: its generic line and its settings are gone, and it is kept
            Assert.DoesNotContain("Use async/await", agents);
            Assert.DoesNotContain("Bash(*)", settings.ToJsonString());
            Assert.True(File.Exists(Path.Combine(_f.TempDir, "onboarding", "_runtime", runId.ToString(), "init-draft", "AGENTS.md")));
            // what was approved from the draft went in after ours, as written, and was checked against the code
            Assert.Equal("verified", view.GetProperty("components").EnumerateArray().First(c => c.GetProperty("title_he").GetString() == "איפה הדברים").GetProperty("status").GetString());
            Assert.Contains("## Where things are\n\nThe one file is `base.txt`", agents.Replace("\r\n", "\n"));
            Assert.True(agents.IndexOf("## Where things are", StringComparison.Ordinal) > agents.IndexOf("npm run build", StringComparison.Ordinal));
            Assert.Contains("- Run `npm run build` before saying a change is done", agents);
            Assert.DoesNotContain("Publish to the npm registry", agents);
            Assert.DoesNotContain("## Architecture", agents);
            // the session's commit was undone and its shell edit put back
            var aside = view.GetProperty("events").EnumerateArray().First(e => e.GetProperty("type").GetString() == "onboarding.draft.set_aside").GetProperty("payload");
            Assert.Equal(1, aside.GetProperty("commitsUndone").GetArrayLength());
            Assert.Contains("package.json", aside.GetProperty("files").EnumerateArray().Select(f => f.GetString()));
            Assert.False(File.Exists(Path.Combine(dir, ".claude", "commands", "ship.md")));
            Assert.DoesNotContain("from-the-session", await File.ReadAllTextAsync(Path.Combine(dir, "package.json")));
            // the trial ran again, measured against the baseline; the joint check counted the always-loaded context
            var build = view.GetProperty("build");
            Assert.Equal(baseline.Count, build.GetProperty("delta").GetProperty("before").GetProperty("total").GetInt32());
            Assert.Equal(baseline.Count, build.GetProperty("delta").GetProperty("after").GetProperty("total").GetInt32());
            Assert.True(build.GetProperty("jointCheck").GetProperty("alwaysLoadedTokens").GetInt32() > 0);
            Assert.Equal(0, build.GetProperty("jointCheck").GetProperty("duplicates").GetArrayLength());
            // only the files of installed or verified components are offered, plus the repository's own dossier
            var files = Step(view, "deliver").GetProperty("result").GetProperty("files").EnumerateArray().Select(f => f.GetString()!).ToList();
            Assert.All(new[] { "AGENTS.md", ".claude/hooks/build-gate.mjs", ".dcc/components.json" }, f => Assert.Contains(f, files));
            Assert.DoesNotContain(files, f => f.Contains(".mcp.json"));
            var dossier = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(dir, ".dcc", "components.json")))!;
            Assert.Contains(dossier["components"]!.AsArray(), c => c?["key"]?.GetValue<string>() == "mcp_random_mcp" && c["status"]?.GetValue<string>() == "declined"
                && !string.IsNullOrEmpty(c["declineReason"]?.GetValue<string>()));

            // 6. The delivery: by name, to the bare host, with the report written from the cards.
            _f.GhRules(("pr create", "https://github.com/acme/shop/pull/7\n", 0, null));
            await Ok(await admin.PostAsJsonAsync($"{Run(repoId, runId)}/deliver", new { }));
            view = await WaitAsync(admin, repoId, runId, v => v.GetProperty("run").GetProperty("status").GetString() == "Completed", "the delivery");
            var deliver = view.GetProperty("deliver");
            Assert.True(deliver.GetProperty("pushed").GetBoolean());
            Assert.False(string.IsNullOrEmpty(deliver.GetProperty("commitSha").GetString()));
            var bare = new Uri(origin).LocalPath;
            var branch = view.GetProperty("run").GetProperty("branchName").GetString()!;
            var committed = Git.Lines((await Git.RunAsync(bare, "diff", "--name-only", $"main..{branch}")).Out);
            Assert.Equal(files.OrderBy(f => f, StringComparer.Ordinal), committed.OrderBy(f => f, StringComparer.Ordinal));
            Assert.DoesNotContain(".claude/commands/ship.md", committed);
            Assert.DoesNotContain("init: a command", (await Git.RunAsync(bare, "log", "--format=%s", $"main..{branch}")).Out);
            var report = deliver.GetProperty("report").GetString()!;
            Assert.All(new[] { "## התקנתי", "לא מאומת ויקר בהקשר", "## לפני / אחרי", "## כרטיס כנות ומוכנות" }, s => Assert.Contains(s, report));
            Assert.All(view.GetProperty("steps").EnumerateArray(), s => Assert.Equal("Completed", s.GetProperty("status").GetString()));
            // nothing was silent
            var types = EventTypes(view);
            Assert.All(new[] { "onboarding.profile.written", "onboarding.profile.corrected", "onboarding.interview.answered", "onboarding.trial.task", "onboarding.plan.drawn",
                "onboarding.card.decided", "onboarding.cards.decided_set", "onboarding.card.requested", "onboarding.draft.scanned", "onboarding.draft.set_aside",
                "onboarding.build.component", "onboarding.delivered", "onboarding.run.completed" }, t => Assert.Contains(t, types));

            // 7. The coach afterwards: no tasks yet, honest zeros; across repositories, numbers only; the search's finds remembered.
            var coach = await Ok(await admin.GetAsync($"/repos/{repoId}/coach"));
            Assert.Equal(JsonValueKind.Null, coach.GetProperty("health").GetProperty("score").ValueKind);
            Assert.Equal(0, coach.GetProperty("health").GetProperty("tasks").GetInt32());
            Assert.Equal(0, coach.GetProperty("proposals").GetArrayLength());
            Assert.Contains(coach.GetProperty("acrossRepos").EnumerateArray(), x => x.GetProperty("key").GetString() == "build_gate_hook" && x.GetProperty("repos").GetInt32() >= 1);
            Assert.Equal(1, (await Ok(await admin.GetAsync($"/repos/{repoId}/onboarding/runs"))).GetProperty("runs").GetArrayLength());
            Assert.Equal(2L, await _f.ScalarAsync<long>("select count(*) from marketplace_source where url = @a or url = @b", ("a", lspUrl), ("b", strangerUrl)));
        }
        finally { StandInsGone(); }
    }
}
