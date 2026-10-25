using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dcc.Infrastructure.Repos;
using Dcc.Tests.Support;

namespace Dcc.Tests.Integration;

/// <summary>
/// Phase 4.6: the pull-request centre against a stand-in gh (GitHub) and a stand-in Azure DevOps, and deciding a
/// conflict with real git on a local repository; the contention map and the Reviewer.
/// </summary>
[Collection(DbCollection.Name)]
public sealed class PullRequestsTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    private static async Task<string> Message(HttpResponseMessage res) =>
        Regex.Unescape((await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString() ?? "");

    private async Task<HttpClient> Admin() => _f.Client(await _f.AdminTokenAsync());

    private async Task<HttpClient> UserWith(string roleKey, Guid clientId)
    {
        var (id, _, password) = await _f.NewUserAsync();
        await _f.AssignAsync("user", id, roleKey, "client", clientId);
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", id));
        return _f.Client((await _f.LoginAsync(email, password)).AccessToken);
    }

    private static object GhPr(int number, string head, string @base = "main", string author = "dana", string mergeable = "MERGEABLE", string state = "OPEN", string? closedAt = null) => new
    {
        number, title = $"Request {number}", url = $"https://github.com/acme/x/pull/{number}", state, isDraft = false, author = new { login = author },
        headRefName = head, baseRefName = @base, createdAt = "2026-10-20T10:00:00Z", updatedAt = DateTimeOffset.UtcNow.AddHours(-1).ToString("O"), closedAt,
        changedFiles = 1, additions = 1, deletions = 1, mergeable, reviewDecision = "", statusCheckRollup = Array.Empty<object>(),
    };

    private static object Commit(char c, string message, string date, params char[] parents) => new
    {
        sha = new string(c, 40), parents = parents.Select(p => new { sha = new string(p, 40) }).ToArray(),
        commit = new { message, author = new { name = "dana", date } },
    };

    private static string Esc(string s) => Regex.Escape(s);

    private async Task<(Guid ClientId, Guid RepoId, string Name, string Url)> GitHubRepoAsync(string? localPath = null)
    {
        var clientId = await _f.NewClientAsync();
        var name = "web-" + Guid.NewGuid().ToString("N")[..6];
        var url = $"https://github.com/acme/{name}";
        var repoId = await _f.ScalarAsync<Guid>("insert into repo(name, ado_repo_ref, client_id, local_path) values (@n, @u, @c, @l) returning id",
            ("n", name), ("u", url), ("c", clientId), ("l", (object?)localPath ?? DBNull.Value));
        return (clientId, repoId, name, url);
    }

    [Fact]
    public async Task GitHub_requests_are_listed_read_reviewed_merged_and_seen_only_by_their_clients_people()
    {
        var admin = await Admin();
        var (clientId, repoId, name, url) = await GitHubRepoAsync();
        var slug = $"acme/{name}";
        _f.GhRules(
            ($"^pr list --repo {Esc(url)} --state open", new[] { GhPr(5, "feature"), GhPr(6, "bot-change", author: "dcc-bot"), GhPr(7, "protected") }, 0, null),
            ($"^pr list --repo {Esc(url)} --state closed", new[] { GhPr(3, "old", state: "MERGED", closedAt: "2026-10-10T10:00:00Z") }, 0, null),
            ($@"^pr view 5 --repo {Esc(url)} --json", new { body = "Adds the cart", reviews = new[] { new { state = "COMMENTED", body = "looks fine", author = new { login = "rina" }, submittedAt = "2026-10-21T10:00:00Z" } }, comments = Array.Empty<object>(), files = Array.Empty<object>() }, 0, null),
            ($@"^api repos/{Esc(slug)}/compare/main\.\.\.feature$", new
            {
                ahead_by = 1, behind_by = 1, merge_base_commit = Commit('b', "first", "2026-10-01T10:00:00Z"),
                commits = new[] { Commit('c', "feature work\n\nwhy", "2026-10-20T10:00:00Z", 'b') },
                files = new[] { new { filename = "src/cart.ts", status = "modified", additions = 4, deletions = 1 } },
            }, 0, null),
            ($@"^api repos/{Esc(slug)}/compare/feature\.\.\.main$", new
            {
                ahead_by = 1, behind_by = 1, commits = new[] { Commit('d', "main moved", "2026-10-22T10:00:00Z", 'b') },
                files = new[] { new { filename = "src/cart.ts", status = "modified", additions = 2, deletions = 0 } },
            }, 0, null),
            ($@"^api repos/{Esc(slug)}/contents/src/cart\.ts\?ref=b{{40}} ", "export const v = 1;\n", 0, null),
            ($@"^api repos/{Esc(slug)}/contents/src/cart\.ts\?ref=c{{40}} ", "export const v = 2;\n", 0, null),
            ("^api user$", new { login = "dcc-bot" }, 0, null),
            ($"^pr review 5 --repo {Esc(url)} --comment --body nice", "", 0, null),
            ($"^pr merge 5 --repo {Esc(url)} --merge$", "", 0, null),
            ($"^pr merge 7 --repo {Esc(url)} --merge$", null, 1, "GraphQL: Base branch policy prohibits the merge. At least 1 approving review is required."),
            ($@"^api repos/{Esc(slug)}$", new { default_branch = "main" }, 0, null),
            ("^api graphql", new
            {
                data = new
                {
                    repository = new
                    {
                        refs = new
                        {
                            nodes = new object[]
                            {
                                new { name = "main", target = new { committedDate = "2026-10-22T10:00:00Z", messageHeadline = "main moved", author = new { name = "dana", user = new { login = "dana" } } }, associatedPullRequests = new { nodes = Array.Empty<object>() }, compare = new { aheadBy = 0, behindBy = 0 } },
                                new { name = "claude/old", target = new { committedDate = "2026-09-01T10:00:00Z", messageHeadline = "x", author = new { name = "bot", user = (object?)null } }, associatedPullRequests = new { nodes = Array.Empty<object>() }, compare = new { aheadBy = 4, behindBy = 0 } },
                                new { name = "feature", target = new { committedDate = "2026-10-20T10:00:00Z", messageHeadline = "feature work", author = new { name = "dana", user = new { login = "dana" } } }, associatedPullRequests = new { nodes = new[] { new { number = 5, state = "OPEN", isDraft = false, baseRefName = "main" } } }, compare = new { aheadBy = 1, behindBy = 1 } },
                            },
                        },
                    },
                },
            }, 0, null));

        var list = await Ok(await admin.GetAsync("/pull-requests?refresh=1"));
        var mine = list.GetProperty("rows").EnumerateArray().Where(r => r.GetProperty("repo").GetProperty("id").GetGuid() == repoId).ToList();
        Assert.Equal(3, mine.Count);
        var five = mine.Single(r => r.GetProperty("number").GetInt32() == 5);
        Assert.Equal($"github:{repoId}:5", five.GetProperty("id").GetString());
        Assert.Equal(clientId, five.GetProperty("client").GetProperty("id").GetGuid());
        Assert.Contains(list.GetProperty("history").EnumerateArray(), r => r.GetProperty("repo").GetProperty("id").GetGuid() == repoId && r.GetProperty("state").GetString() == "merged");
        Assert.Contains(list.GetProperty("repos").EnumerateArray(), r => r.GetProperty("id").GetGuid() == repoId && r.GetProperty("provider").GetString() == "github");

        var quick = await Ok(await admin.GetAsync($"/repos/{repoId}/pull-requests/5/quick"));
        Assert.Equal("request_review", quick.GetProperty("nextStep").GetProperty("action").GetString());

        var d = await Ok(await admin.GetAsync($"/repos/{repoId}/pull-requests/5"));
        Assert.Equal("Adds the cart", d.GetProperty("body").GetString());
        Assert.Equal(1, d.GetProperty("freshness").GetProperty("behind").GetInt32());
        Assert.Equal(1, d.GetProperty("freshness").GetProperty("sharedFiles").GetInt32());
        Assert.Equal("update_branch", d.GetProperty("nextStep").GetProperty("action").GetString());
        Assert.Equal("code", d.GetProperty("groups")[0].GetProperty("key").GetString());
        Assert.Equal(new string('b', 40), d.GetProperty("refs").GetProperty("base").GetString());
        Assert.Equal(new string('c', 40), d.GetProperty("refs").GetProperty("head").GetString());
        Assert.Equal(["base", "ours"], d.GetProperty("codeMap").GetProperty("lanes").EnumerateArray().Select(l => l.GetProperty("id").GetString()));
        Assert.Contains(d.GetProperty("timeline").EnumerateArray(), t => t.GetProperty("kind").GetString() == "review" && t.GetProperty("text").GetString() == "rina כתב הערת סקירה");
        Assert.Contains(d.GetProperty("timeline").EnumerateArray(), t => t.GetProperty("kind").GetString() == "base" && t.GetProperty("tag").GetString() == "נוגע באותם קבצים");

        var file = await Ok(await admin.GetAsync($"/repos/{repoId}/pull-requests/5/file?path=src/cart.ts"));
        Assert.Equal("export const v = 1;", file.GetProperty("before").GetString()!.Trim());
        Assert.Equal("export const v = 2;", file.GetProperty("after").GetString()!.Trim());
        Assert.Equal($"{url}/blob/feature/src/cart.ts", file.GetProperty("afterUrl").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/repos/{repoId}/pull-requests/5/file?path=other.ts")).StatusCode);

        // a review goes to the host as the operator's account, and is recorded under the person
        Assert.True((await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/pull-requests/5/review", new { decision = "comment", text = "nice" }))).GetProperty("posted").GetBoolean());
        Assert.Contains(_f.GhCalls(), c => c.Take(3).SequenceEqual(["pr", "review", "5"]) && c.Contains("--comment"));
        Assert.Equal(1, await _f.ScalarAsync<int>("select count(*)::int from audit_log where action = 'pull_request.reviewed' and target_id = @t", ("t", $"{repoId}/5")));
        var noWords = await admin.PostAsJsonAsync($"/repos/{repoId}/pull-requests/5/review", new { decision = "request_changes", text = " " });
        Assert.Equal(HttpStatusCode.Conflict, noWords.StatusCode);
        // the account DCC acts as cannot approve a request it opened — said in words, nothing sent
        var own = await admin.PostAsJsonAsync($"/repos/{repoId}/pull-requests/6/review", new { decision = "approve" });
        Assert.Equal(HttpStatusCode.Conflict, own.StatusCode);
        Assert.Contains("לא נותן לאותו חשבון לאשר", await Message(own));

        Assert.True((await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/pull-requests/5/merge", new { }))).GetProperty("merged").GetBoolean());
        Assert.Equal(1, await _f.ScalarAsync<int>("select count(*)::int from audit_log where action = 'pull_request.merged' and target_id = @t", ("t", $"{repoId}/5")));
        var refused = await admin.PostAsJsonAsync($"/repos/{repoId}/pull-requests/7/merge", new { });
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Contains("צריך אישור סקירה", await Message(refused));

        var branches = await Ok(await admin.GetAsync($"/repos/{repoId}/branches?refresh=1"));
        Assert.Equal("main", branches.GetProperty("defaultBranch").GetString());
        Assert.Equal(["open_pr", "merged", "default"], branches.GetProperty("rows").EnumerateArray().Select(r => r.GetProperty("status").GetString()));

        // a person of another client sees none of it
        var other = await UserWith("reader", await _f.NewClientAsync());
        var theirs = await Ok(await other.GetAsync("/pull-requests"));
        Assert.DoesNotContain(theirs.GetProperty("rows").EnumerateArray(), r => r.GetProperty("repo").GetProperty("id").GetGuid() == repoId);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"/repos/{repoId}/pull-requests/5")).StatusCode);
        // a reader of the owning client sees it
        var reader = await UserWith("reader", clientId);
        Assert.Contains((await Ok(await reader.GetAsync("/pull-requests"))).GetProperty("rows").EnumerateArray(), r => r.GetProperty("repo").GetProperty("id").GetGuid() == repoId);
    }

    [Fact]
    public async Task A_conflict_is_decided_in_DCC_and_pushed_as_one_merge_commit_never_over_a_moved_branch()
    {
        // The "host": a bare repository; the developer's own folder is a clone of it, where the two sides clash.
        var origin = await _f.NewOriginAsync();
        var bare = origin["file:///".Length..];
        var dev = Path.Combine(_f.TempDir, "dev-" + Guid.NewGuid().ToString("N")[..6]);
        await Git.RunAsync(_f.TempDir, "clone", bare, dev);
        async Task CommitAs(string branch, string text)
        {
            await Git.RunAsync(dev, "switch", branch);
            await File.WriteAllTextAsync(Path.Combine(dev, "README.md"), text);
            await Git.RunAsync(dev, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-am", $"{branch} edit");
            await Git.RunAsync(dev, "push", "origin", branch);
        }
        await Git.RunAsync(dev, "branch", "feature");
        await CommitAs("feature", "# shop — feature\n");
        await CommitAs("main", "# shop — main\n");

        var admin = await Admin();
        var (_, repoId, _, url) = await GitHubRepoAsync(dev);
        _f.GhRules(
            ($"^pr list --repo {Esc(url)} --state open", new[] { GhPr(9, "feature", mergeable: "CONFLICTING") }, 0, null),
            ($"^pr list --repo {Esc(url)} --state closed", Array.Empty<object>(), 0, null));
        var row = (await Ok(await admin.GetAsync("/pull-requests?refresh=1"))).GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("repo").GetProperty("id").GetGuid() == repoId);
        Assert.Equal("conflict", row.GetProperty("flags")[0].GetProperty("key").GetString());

        var c = await Ok(await admin.GetAsync($"/repos/{repoId}/pull-requests/9/conflict"));
        var f = c.GetProperty("files").EnumerateArray().Single();
        Assert.Equal("README.md", f.GetProperty("path").GetString());
        Assert.True(f.GetProperty("resolvable").GetBoolean());
        Assert.Equal(1, f.GetProperty("conflicts").GetInt32());
        Assert.EndsWith(">>>>>>> origin/main\n", f.GetProperty("content").GetString());
        Assert.Equal("# shop — main\n", f.GetProperty("theirsFile").GetString());
        var choice = f.GetProperty("segments").EnumerateArray().Single(s => s.GetProperty("kind").GetString() == "conflict");
        Assert.Equal("# shop — feature", choice.GetProperty("ours").GetString());
        Assert.Equal("# shop — main", choice.GetProperty("theirs").GetString());
        Assert.False(c.GetProperty("needsCommandLine").GetBoolean());
        var (headSha, baseSha) = (c.GetProperty("headSha").GetString()!, c.GetProperty("baseSha").GetString()!);

        object Decision(string content, string head) => new { files = new[] { new { path = "README.md", content } }, headSha = head, baseSha };
        // markers left in → refused; the checks: this repository declares none, so nothing is claimed
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"/repos/{repoId}/pull-requests/9/conflict/resolve", Decision("<<<<<<< x\n", headSha))).StatusCode);
        var verify = await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/pull-requests/9/conflict/verify", Decision("# shop — both\n", headSha)));
        Assert.False(verify.GetProperty("ran").GetBoolean());
        Assert.Contains("אין סקריפטים של בדיקה", verify.GetProperty("why").GetString());
        // decided on other commits than the ones there now → refused, nothing pushed
        var stale = await admin.PostAsJsonAsync($"/repos/{repoId}/pull-requests/9/conflict/resolve", Decision("# shop — both\n", new string('0', 40)));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Contains("השתנו מאז שפתחתם את המסך", await Message(stale));

        var saved = await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/pull-requests/9/conflict/resolve", Decision("# shop — both\n", headSha)));
        Assert.Equal("feature", saved.GetProperty("branch").GetString());
        Assert.Equal(1, saved.GetProperty("files").GetInt32());
        var parents = (await Git.RunAsync(bare, "log", "-1", "--format=%P", "feature")).Out.Split(' ');
        Assert.Equal([headSha, baseSha], parents);
        // the file is saved exactly as decided — its final newline included
        Assert.Equal("# shop — both\n", await Git.ShowAsync(bare, "feature", "README.md"));
        Assert.Equal(1, await _f.ScalarAsync<int>("select count(*)::int from audit_log where action = 'pull_request.conflict_resolved' and target_id = @t", ("t", $"{repoId}/9")));
    }

    [Fact]
    public async Task Azure_DevOps_requests_come_through_the_clients_connection_with_votes_and_the_hosts_merge()
    {
        var calls = new List<(string Method, string Path, string Body)>();
        FakeAdo.Respond = req =>
        {
            var path = Uri.UnescapeDataString(req.RequestUri!.AbsolutePath);
            var query = Uri.UnescapeDataString(req.RequestUri.Query);
            lock (calls) calls.Add((req.Method.Method, path + query, req.Content?.ReadAsStringAsync().Result ?? ""));
            const string pr = """{"pullRequestId":12,"title":"Tiered discount","status":"active","isDraft":false,"createdBy":{"displayName":"Rina"},"creationDate":"2026-10-20T10:00:00Z","sourceRefName":"refs/heads/task/WI-1","targetRefName":"refs/heads/main","mergeStatus":"succeeded","reviewers":[{"displayName":"Dana","vote":10}],"description":"the change","lastMergeSourceCommit":{"commitId":"aaaa"}}""";
            if (path.EndsWith("/pullrequests") && query.Contains("status=active")) return FakeAdo.Json($$"""{"value":[{{pr}}]}""");
            if (path.EndsWith("/pullrequests")) return FakeAdo.Json("""{"value":[{"pullRequestId":4,"title":"Old","status":"completed","createdBy":{"displayName":"Rina"},"creationDate":"2026-09-01T10:00:00Z","closedDate":"2026-09-02T10:00:00Z","sourceRefName":"refs/heads/old","targetRefName":"refs/heads/main"}]}""");
            if (path.EndsWith("/statuses")) return FakeAdo.Json("""{"value":[{"state":"succeeded"}]}""");
            if (path.EndsWith("/connectionData")) return FakeAdo.Json("""{"authenticatedUser":{"id":"u-1"}}""");
            if (req.Method == HttpMethod.Put && path.EndsWith("/reviewers/u-1")) return FakeAdo.Json("""{"vote":10}""");
            if (req.Method == HttpMethod.Post && path.EndsWith("/threads")) return FakeAdo.Json("""{"id":1}""");
            if (req.Method == HttpMethod.Patch && path.EndsWith("/pullRequests/12")) return FakeAdo.Json("""{"status":"completed"}""");
            if (path.EndsWith("/pullRequests/12")) return FakeAdo.Json(pr);
            if (path.EndsWith("/iterations")) return FakeAdo.Json("""{"value":[{"id":1},{"id":2}]}""");
            if (path.EndsWith("/iterations/2/changes")) return FakeAdo.Json("""{"changeEntries":[{"item":{"path":"/src/discount.cs"},"changeType":"edit"},{"item":{"path":"/src","isFolder":true},"changeType":"edit"}]}""");
            if (path.EndsWith("/pullRequests/12/commits")) return FakeAdo.Json("""{"value":[{"commitId":"aaaa1111","comment":"discount tiers","author":{"name":"Rina","date":"2026-10-20T10:00:00Z"}}]}""");
            if (path.EndsWith("/threads")) return FakeAdo.Json("""{"value":[{"comments":[{"author":{"displayName":"Dana"},"content":"good","publishedDate":"2026-10-21T10:00:00Z","commentType":"text"}]}]}""");
            // the branch against the base gained one file; the base against the branch gained nothing
            if (path.EndsWith("/diffs/commits") && query.Contains("baseVersion=main&")) return FakeAdo.Json("""{"aheadCount":1,"behindCount":0,"commonCommit":"bbbb2222","changes":[{"item":{"path":"/src/discount.cs"},"changeType":"edit"}]}""");
            if (path.EndsWith("/diffs/commits")) return FakeAdo.Json("""{"aheadCount":0,"behindCount":1,"commonCommit":"bbbb2222","changes":[]}""");
            if (path.EndsWith("/commits/bbbb2222")) return FakeAdo.Json("""{"commitId":"bbbb2222","comment":"start","author":{"name":"Rina","date":"2026-10-01T10:00:00Z"}}""");
            if (path.EndsWith("/commitsbatch")) return FakeAdo.Json("""{"value":[]}""");
            return FakeAdo.Json("""{"name":"Shop"}""");
        };
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        await Ok(await admin.PostAsJsonAsync($"/clients/{clientId}/connections/ado", new { orgUrl = "https://dev.azure.com/acme/Shop", pat = "fake-pat-123456" }));
        var name = "shop-" + Guid.NewGuid().ToString("N")[..6];
        var repoId = await _f.ScalarAsync<Guid>("insert into repo(name, ado_repo_ref, client_id) values (@n, @u, @c) returning id",
            ("n", name), ("u", $"https://dev.azure.com/acme/Shop/_git/{name}"), ("c", clientId));

        var list = await Ok(await admin.GetAsync("/pull-requests?refresh=1"));
        var row = list.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("repo").GetProperty("id").GetGuid() == repoId);
        Assert.Equal("ado", row.GetProperty("provider").GetString());
        Assert.Equal("task/WI-1", row.GetProperty("headBranch").GetString());
        Assert.Equal("approved", row.GetProperty("review").GetString());
        Assert.Equal("passing", row.GetProperty("checks").GetString());
        Assert.Equal($"https://dev.azure.com/acme/Shop/_git/{name}/pullrequest/12", row.GetProperty("url").GetString());
        Assert.Contains(list.GetProperty("history").EnumerateArray(), r => r.GetProperty("repo").GetProperty("id").GetGuid() == repoId && r.GetProperty("state").GetString() == "merged");

        var d = await Ok(await admin.GetAsync($"/repos/{repoId}/pull-requests/12"));
        Assert.Equal("the change", d.GetProperty("body").GetString());
        Assert.Equal(["src/discount.cs"], d.GetProperty("groups").EnumerateArray().SelectMany(g => g.GetProperty("files").EnumerateArray()).Select(f => f.GetProperty("path").GetString()));
        Assert.Equal("merge", d.GetProperty("nextStep").GetProperty("action").GetString());
        Assert.Contains(d.GetProperty("timeline").EnumerateArray(), t => t.GetProperty("text").GetString() == "Dana אישר את השינוי");

        await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/pull-requests/12/review", new { decision = "approve", text = "great" }));
        lock (calls)
        {
            Assert.Contains(calls, c => c.Method == "PUT" && c.Path.Contains("/reviewers/u-1") && c.Body.Contains("\"vote\":10"));
            Assert.Contains(calls, c => c.Method == "POST" && c.Path.Contains("/threads") && c.Body.Contains("great"));
        }
        await Ok(await admin.PostAsJsonAsync($"/repos/{repoId}/pull-requests/12/merge", new { }));
        lock (calls) Assert.Contains(calls, c => c.Method == "PATCH" && c.Body.Contains("\"status\":\"completed\"") && c.Body.Contains("aaaa"));
    }

    [Fact]
    public async Task Touches_show_overlaps_between_requirements_and_finished_work_lets_go_of_its_files()
    {
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        var a = (await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "Cart" }))).GetProperty("id").GetGuid();
        var b = (await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "Checkout" }))).GetProperty("id").GetGuid();
        var name = "touch-" + Guid.NewGuid().ToString("N")[..6];
        await _f.ExecAsync("insert into repo(name, client_id) values (@n, @c)", ("n", name), ("c", clientId));

        var first = await admin.PostAsJsonAsync($"/workitems/{a}/touches", new { repo = name, branch = "task/a", paths = new[] { "src/cart.ts", "src/x.ts" } });
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var second = await Ok(await admin.PostAsJsonAsync($"/workitems/{b}/touches", new { repo = name, paths = new[] { "src/cart.ts" }, kind = "branch" }));
        var overlap = second.GetProperty("overlaps").EnumerateArray().Single();
        Assert.Equal(a, overlap.GetProperty("otherWorkitem").GetGuid());
        Assert.Equal("task/a", overlap.GetProperty("otherBranch").GetString());

        var map = (await Ok(await admin.GetAsync($"/repos/{Uri.EscapeDataString(name)}/contention?clientId={clientId}"))).GetProperty("contention");
        Assert.True(map.EnumerateArray().Single(p => p.GetProperty("path").GetString() == "src/cart.ts").GetProperty("contended").GetBoolean());
        Assert.False(map.EnumerateArray().Single(p => p.GetProperty("path").GetString() == "src/x.ts").GetProperty("contended").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"/repos/{name}/contention")).StatusCode);

        // another client's repository is not this client's to record on
        var stranger = "other-" + Guid.NewGuid().ToString("N")[..6];
        await _f.ExecAsync("insert into repo(name, client_id) values (@n, @c)", ("n", stranger), ("c", await _f.NewClientAsync()));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync($"/workitems/{a}/touches", new { repo = stranger, paths = new[] { "a" } })).StatusCode);

        // the requirement is done: its files are released, so they no longer show as an overlap
        await Ok(await admin.PatchAsJsonAsync($"/workitems/{a}", new { phase = "done" }));
        var after = (await Ok(await admin.GetAsync($"/repos/{name}/contention?clientId={clientId}"))).GetProperty("contention");
        Assert.All(after.EnumerateArray(), p => Assert.False(p.GetProperty("contended").GetBoolean()));
        Assert.True((await Ok(await admin.PostAsJsonAsync($"/workitems/{b}/touches/release", new { }))).GetProperty("released").GetBoolean());
        Assert.Equal(0, (await Ok(await admin.GetAsync($"/repos/{name}/contention?clientId={clientId}"))).GetProperty("contention").GetArrayLength());

        // the Reviewer's verdict: a row and a line on the timeline, as the person who delegated it
        var review = await admin.PostAsJsonAsync($"/workitems/{b}/review", new
        {
            verdict = "changes_requested", prRef = "github:acme/x#4", overlapFocus = new[] { "src/cart.ts" },
            findings = new object[] { new { file = "src/cart.ts", line = 3, severity = "block", note = "breaks totals" }, new { file = "src/x.ts", severity = "info", note = "ok" } },
        });
        Assert.Equal(HttpStatusCode.Created, review.StatusCode);
        var row = await review.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("changes_requested", row.GetProperty("verdict").GetString());
        Assert.Equal(2, row.GetProperty("findings").GetArrayLength());
        var payload = await _f.ScalarAsync<string>("select payload::text from event_log where workitem_id = @w and type = 'review.completed'", ("w", b));
        Assert.Contains("\"blockingCount\": 1", payload);
    }
}
