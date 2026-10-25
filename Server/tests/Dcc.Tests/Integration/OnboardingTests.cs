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
}
