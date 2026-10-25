using System.IO.Pipelines;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Infrastructure.Ledger;
using Dcc.Mcp;
using Dcc.Tests.Support;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace Dcc.Tests.Integration;

/// <summary>
/// Phase 4.9: the MCP server. A real MCP client talks to it over in-memory streams — the same protocol it speaks
/// over stdio — and the server calls this test API with an API token, as it calls the real one.
/// </summary>
[Collection(DbCollection.Name)]
public sealed class McpTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static readonly string[] ToolNames = ["list_clients", "search_requirements", "get_requirement", "get_timeline", "get_cost_summary"];

    /// <summary>The MCP server (its own host, as Program runs it) and a client connected to it; both stop on dispose.</summary>
    private sealed class Session(IHost server, McpClient client, Pipe toServer) : IAsyncDisposable
    {
        public McpClient Client => client;

        public async Task<(bool IsError, string Text)> CallAsync(string tool, object? args = null)
        {
            var arguments = args is null ? null : JsonSerializer.SerializeToElement(args).EnumerateObject()
                .ToDictionary(p => p.Name, p => (object?)p.Value.GetString());
            var result = await client.CallToolAsync(tool, arguments);
            return (result.IsError == true, Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text);
        }

        public async ValueTask DisposeAsync()
        {
            await client.DisposeAsync();
            await toServer.Writer.CompleteAsync(); // the server's stdin closes, as when the MCP client exits
            using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await server.StopAsync(stop.Token);
            server.Dispose();
        }
    }

    private static async Task<Session> ConnectAsync(HttpClient api)
    {
        var toServer = new Pipe();
        var toClient = new Pipe();
        var builder = Host.CreateEmptyApplicationBuilder(new HostApplicationBuilderSettings());
        builder.Services.AddDccMcpServer(new DccApi(api)).WithStreamServerTransport(toServer.Reader.AsStream(), toClient.Writer.AsStream());
        var server = builder.Build();
        await server.StartAsync();
        var client = await McpClient.CreateAsync(new StreamClientTransport(toServer.Writer.AsStream(), toClient.Reader.AsStream()));
        return new Session(server, client, toServer);
    }

    private static async Task<JsonNode> Rest(HttpClient http, string path)
    {
        var res = await http.GetAsync(path);
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"GET {path}: {(int)res.StatusCode} {text}");
        return JsonNode.Parse(text)!;
    }

    private static void SameJson(JsonNode? expected, string actualText) =>
        Assert.True(JsonNode.DeepEquals(expected, JsonNode.Parse(actualText)), $"expected {expected?.ToJsonString()}\nactual {actualText}");

    private async Task<Guid> NewRequirement(HttpClient admin, Guid clientId, string title)
    {
        var res = await admin.PostAsJsonAsync("/workitems", new { clientId, title, type = "feature", key = "WI-" + Random.Shared.Next(10000, 99999) });
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"POST /workitems: {(int)res.StatusCode} {body}");
        return body.GetProperty("id").GetGuid();
    }

    [Fact]
    public async Task The_server_offers_exactly_the_five_read_only_tools_under_their_known_names()
    {
        await using var mcp = await ConnectAsync(_f.Client());
        Assert.Equal("dcc", mcp.Client.ServerInfo?.Name);

        var tools = await mcp.Client.ListToolsAsync();
        Assert.Equal(ToolNames.Order().ToArray(), tools.Select(t => t.Name).Order().ToArray());
        Assert.All(tools, t => Assert.True(t.ProtocolTool.Annotations?.ReadOnlyHint, t.Name));
        // the titles and descriptions MCP clients already know, word for word; list_clients' says what a row really holds
        foreach (var (name, title, description) in new[]
                 {
                     ("list_clients", "List DCC clients", null),
                     ("search_requirements", "Search requirements", "Search a client's requirements by title (case-insensitive substring). Returns id, key, title, type, phase — enough to pick one for get_requirement."),
                     ("get_requirement", "Get requirement detail", "Full detail for one requirement: fields, gaps, blockers, tasks, attachments, linked repos, and its full event timeline. Same data the DCC web UI's requirement page shows."),
                     ("get_timeline", "Get requirement timeline", "Just the append-only event log for one requirement — every note, decision, status change, AI run, in order. Use get_requirement instead if you also need current field values/tasks."),
                     ("get_cost_summary", "Get requirement AI cost summary", "The requirement's cumulative AI cost: total USD, tokens, run count, broken down by what kind of call (assess/breakdown/implement/chat/...)."),
                 })
        {
            var tool = tools.Single(t => t.Name == name);
            Assert.Equal(title, tool.Title);
            if (description is not null) Assert.Equal(description, tool.Description);
        }
        Assert.DoesNotContain("connector", tools.Single(t => t.Name == "list_clients").Description);
        Assert.EndsWith("Needed to get a clientId for the other tools.", tools.Single(t => t.Name == "list_clients").Description);

        var search = tools.Single(t => t.Name == "search_requirements").ProtocolTool.InputSchema;
        Assert.Equal(["clientId", "query"], search.GetProperty("required").EnumerateArray().Select(e => e.GetString()!).Order().ToArray());
        Assert.Equal("uuid", search.GetProperty("properties").GetProperty("clientId").GetProperty("format").GetString());
        Assert.Equal("The client to search within — from list_clients",
            search.GetProperty("properties").GetProperty("clientId").GetProperty("description").GetString());
        var detail = tools.Single(t => t.Name == "get_requirement").ProtocolTool.InputSchema;
        Assert.Equal(["id"], detail.GetProperty("required").EnumerateArray().Select(e => e.GetString()!).ToArray());
        Assert.Equal("Substring to match against requirement titles",
            search.GetProperty("properties").GetProperty("query").GetProperty("description").GetString());
        Assert.Equal("The requirement's id — from search_requirements",
            detail.GetProperty("properties").GetProperty("id").GetProperty("description").GetString());
        foreach (var name in (string[])["get_timeline", "get_cost_summary"])
        {
            var schema = tools.Single(t => t.Name == name).ProtocolTool.InputSchema;
            Assert.Equal(["id"], schema.GetProperty("required").EnumerateArray().Select(e => e.GetString()!).ToArray());
            Assert.Equal("uuid", schema.GetProperty("properties").GetProperty("id").GetProperty("format").GetString());
        }
    }

    [Fact]
    public async Task A_token_reads_as_its_person_only_what_that_person_may_read_in_the_shapes_of_the_REST_routes()
    {
        var admin = _f.Client(await _f.AdminTokenAsync());
        var clientA = await _f.NewClientAsync();
        var clientB = await _f.NewClientAsync();
        var word = "Tiered" + Guid.NewGuid().ToString("N")[..6];
        var reqA = await NewRequirement(admin, clientA, $"{word} discounts — הנחות מדורגות");
        var reqB = await NewRequirement(admin, clientB, $"{word} discounts elsewhere");

        // something on reqA's timeline, a blocker and a cost
        (await admin.PatchAsJsonAsync($"/workitems/{reqA}", new { priority = "high" })).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"/workitems/{reqA}/blockers", new { questionType = "business", question = "Which tiers?" })).EnsureSuccessStatusCode();
        using (var scope = _f.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<ClaudeLedger>().RecordAsync(new ClaudeCallInput
            {
                ClientId = clientA, UserId = await _f.ScalarAsync<Guid>("select id from users order by created_at limit 1"),
                EntityKind = "workitem", EntityId = reqA.ToString(), WorkitemId = reqA, Capability = "assess", Trigger = "button",
                StartedAt = DateTimeOffset.UtcNow, InputTokens = 1000, OutputTokens = 200, CostUsd = 0.25m,
            });

        // a person who reads client A only, and the token an admin made for them
        var (userId, _, _) = await _f.NewUserAsync();
        await _f.AssignAsync("user", userId, "reader", "client", clientA);
        var created = await (await admin.PostAsJsonAsync("/tokens", new { name = "mcp", forAgentId = userId })).Content.ReadFromJsonAsync<JsonElement>();
        var api = _f.Client(created.GetProperty("secret").GetString()!);
        await using var mcp = await ConnectAsync(api);

        var clients = await mcp.CallAsync("list_clients");
        Assert.False(clients.IsError, clients.Text);
        Assert.Equal([clientA.ToString()], JsonNode.Parse(clients.Text)!.AsArray().Select(c => c!["id"]!.GetValue<string>()).ToArray());
        SameJson((await Rest(api, "/clients"))["clients"], clients.Text);

        var found = await mcp.CallAsync("search_requirements", new { clientId = clientA.ToString(), query = word.ToLowerInvariant() });
        Assert.False(found.IsError, found.Text);
        var row = Assert.Single(JsonNode.Parse(found.Text)!.AsArray())!.AsObject();
        Assert.Equal(reqA.ToString(), row["id"]!.GetValue<string>());
        Assert.Equal(["id", "key", "title", "type", "phase", "requirementType"], row.Select(p => p.Key).ToArray());
        SameJson((await Rest(api, $"/clients/{clientA}/workitems/search?q={word.ToLowerInvariant()}"))["items"], found.Text);
        Assert.Contains("הנחות מדורגות", found.Text); // Hebrew as itself, not \uXXXX

        var detail = await mcp.CallAsync("get_requirement", new { id = reqA.ToString() });
        Assert.False(detail.IsError, detail.Text);
        SameJson(await Rest(api, $"/workitems/{reqA}"), detail.Text);
        Assert.Single(JsonNode.Parse(detail.Text)!["blockers"]!.AsArray());

        var timeline = await mcp.CallAsync("get_timeline", new { id = reqA.ToString() });
        Assert.False(timeline.IsError, timeline.Text);
        Assert.True(JsonNode.Parse(timeline.Text)!.AsArray().Count >= 3, timeline.Text); // the edit, the blocker, the call
        SameJson((await Rest(api, $"/workitems/{reqA}/timeline"))["events"], timeline.Text);

        var cost = await mcp.CallAsync("get_cost_summary", new { id = reqA.ToString() });
        Assert.False(cost.IsError, cost.Text);
        SameJson(await Rest(api, $"/workitems/{reqA}/cost"), cost.Text);
        Assert.Equal(0.25, JsonNode.Parse(cost.Text)!["byKind"]!["assess"]!["usd"]!.GetValue<double>(), 6);

        // client B is behind the wall: every tool refuses, in a sentence
        foreach (var (tool, args) in new (string, object)[]
                 {
                     ("get_requirement", new { id = reqB.ToString() }), ("get_timeline", new { id = reqB.ToString() }),
                     ("get_cost_summary", new { id = reqB.ToString() }), ("search_requirements", new { clientId = clientB.ToString(), query = word }),
                 })
        {
            var refused = await mcp.CallAsync(tool, args);
            Assert.True(refused.IsError, $"{tool}: {refused.Text}");
            Assert.Contains("may not read", refused.Text);
            Assert.Contains("requirements.read", refused.Text);
            Assert.DoesNotContain(word, refused.Text);
        }

        var nowhere = Guid.NewGuid();
        var missing = await mcp.CallAsync("get_requirement", new { id = nowhere.ToString() });
        Assert.True(missing.IsError);
        Assert.Equal($"no requirement with id {nowhere}", missing.Text);
    }

    [Fact]
    public async Task Search_matches_a_title_ignoring_case_inside_its_client_only_the_25_most_recently_changed_first()
    {
        var admin = _f.Client(await _f.AdminTokenAsync());
        var client = await _f.NewClientAsync();
        var other = await _f.NewClientAsync();
        var owner = await _f.ScalarAsync<Guid>("select id from users order by created_at limit 1");
        var word = "Quorum" + Guid.NewGuid().ToString("N")[..6];
        async Task<Guid> Insert(Guid c, string title, int minutesAgo) => await _f.ScalarAsync<Guid>(
            "insert into workitem(client_id, owner_id, title, updated_at) values (@c, @o, @t, now() - make_interval(mins => @m)) returning id",
            ("c", c), ("o", owner), ("t", title), ("m", minutesAgo));

        var ids = new List<Guid>();
        for (var i = 0; i < 27; i++) ids.Add(await Insert(client, $"{word} no. {i}", i)); // ids[0] changed last
        await Insert(client, "unrelated", 0);
        var elsewhere = await Insert(other, $"{word} of another client", 0);

        await using var mcp = await ConnectAsync(admin);
        var found = await mcp.CallAsync("search_requirements", new { clientId = client.ToString(), query = word.ToUpperInvariant() });
        Assert.False(found.IsError, found.Text);
        var rows = JsonNode.Parse(found.Text)!.AsArray().Select(r => Guid.Parse(r!["id"]!.GetValue<string>())).ToArray();
        Assert.Equal(ids.Take(25), rows); // newest first, at most 25, the other client's match never in it
        Assert.DoesNotContain(elsewhere, rows);
        var first = JsonNode.Parse(found.Text)![0]!;
        Assert.Equal("development", first["requirementType"]!.GetValue<string>());

        // an empty text lists the newest 25; % and _ are wildcards, as they always were
        Assert.Equal(25, JsonNode.Parse((await mcp.CallAsync("search_requirements", new { clientId = client.ToString(), query = "" })).Text)!.AsArray().Count);
        var wildcard = await mcp.CallAsync("search_requirements", new { clientId = client.ToString(), query = word[..2] + "_" + word[3..] + " no. 2%" });
        Assert.Equal([ids[2], ids[20], ids[21], ids[22], ids[23], ids[24], ids[25], ids[26]],
            JsonNode.Parse(wildcard.Text)!.AsArray().Select(r => Guid.Parse(r!["id"]!.GetValue<string>())).ToArray());
    }

    [Fact]
    public async Task An_agent_token_reads_no_further_than_its_owner_and_a_revoked_token_or_a_bad_id_is_refused_in_a_sentence()
    {
        var admin = _f.Client(await _f.AdminTokenAsync());
        var clientA = await _f.NewClientAsync();
        var clientB = await _f.NewClientAsync();
        var reqB = await NewRequirement(admin, clientB, "behind the wall");

        // a delegated agent whose owner reads client A only — the agent itself is given client B as well
        var (owner, _, _) = await _f.NewUserAsync();
        await _f.AssignAsync("user", owner, "reader", "client", clientA);
        var res = await admin.PostAsJsonAsync("/agents", new { displayName = "mcp-bot", ownerUserId = owner });
        var agent = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        await _f.AssignAsync("user", agent, "reader", "client", clientA);
        await _f.AssignAsync("user", agent, "reader", "client", clientB);
        var created = await (await admin.PostAsJsonAsync("/tokens", new { name = "mcp", forAgentId = agent })).Content.ReadFromJsonAsync<JsonElement>();
        var api = _f.Client(created.GetProperty("secret").GetString()!);
        await using var mcp = await ConnectAsync(api);

        var clients = await mcp.CallAsync("list_clients");
        Assert.Equal([clientA.ToString()], JsonNode.Parse(clients.Text)!.AsArray().Select(c => c!["id"]!.GetValue<string>()).ToArray());
        var refused = await mcp.CallAsync("get_requirement", new { id = reqB.ToString() });
        Assert.True(refused.IsError);
        Assert.Equal($"The token's person may not read requirement {reqB} (it needs requirements.read).", refused.Text);
        var search = await mcp.CallAsync("search_requirements", new { clientId = clientB.ToString(), query = "wall" });
        Assert.True(search.IsError);
        Assert.Equal($"The token's person may not read the requirements of client {clientB} (it needs requirements.read).", search.Text);

        // a client that does not exist; an id that is not a uuid (a key, say) or no id at all: a sentence that says which and why
        var nowhere = Guid.NewGuid();
        var noClient = await mcp.CallAsync("search_requirements", new { clientId = nowhere.ToString(), query = "x" });
        Assert.True(noClient.IsError);
        Assert.Equal($"no client with id {nowhere}", noClient.Text);
        var malformed = await mcp.CallAsync("get_timeline", new { id = "WI-1284" });
        Assert.True(malformed.IsError);
        Assert.Equal("id must be a uuid — a requirement's id, from search_requirements (it is \"WI-1284\").", malformed.Text);
        var noId = await mcp.Client.CallToolAsync("search_requirements", new Dictionary<string, object?> { ["query"] = "x" });
        Assert.True(noId.IsError);
        Assert.Equal("clientId must be a uuid — a client's id, from list_clients (it is missing).",
            Assert.IsType<TextContentBlock>(Assert.Single(noId.Content)).Text);

        // revoked: from then on every tool says the token was not accepted
        var tokenId = created.GetProperty("token").GetProperty("id").GetGuid();
        Assert.Equal(System.Net.HttpStatusCode.NoContent, (await admin.DeleteAsync($"/tokens/{tokenId}")).StatusCode);
        var revoked = await mcp.CallAsync("list_clients");
        Assert.True(revoked.IsError);
        Assert.StartsWith("DCC did not accept the API token", revoked.Text);
    }

    [Fact]
    public async Task A_token_DCC_does_not_accept_or_an_API_that_is_not_there_is_a_sentence_not_a_crash()
    {
        await using (var mcp = await ConnectAsync(_f.Client("dcc_pat_not-a-real-token")))
        {
            var refused = await mcp.CallAsync("list_clients");
            Assert.True(refused.IsError);
            Assert.Contains(DccApiSettings.TokenVariable, refused.Text);
        }

        // nothing listens on port 9 (discard): the connection is refused
        using var offline = DccApiSettings.From("http://127.0.0.1:9", "dcc_pat_x").CreateHttpClient();
        await using (var mcp = await ConnectAsync(offline))
        {
            var unreachable = await mcp.CallAsync("get_timeline", new { id = Guid.NewGuid().ToString() });
            Assert.True(unreachable.IsError);
            Assert.StartsWith("Cannot reach the DCC API at http://127.0.0.1:9/", unreachable.Text);
        }
    }
}
