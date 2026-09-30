using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dcc.Tests.Support;

namespace Dcc.Tests.Integration;

/// <summary>Phase 4.4: Azure DevOps — a CSV export imported as requirements, tasks put into TFS on approval, a linked requirement mirrored when building starts.</summary>
[Collection(DbCollection.Name)]
public sealed class AdoTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    private async Task<HttpClient> Admin() => _f.Client(await _f.AdminTokenAsync());

    [Fact]
    public async Task A_csv_export_becomes_requirements_once_with_where_they_came_from()
    {
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        const string csv = "ID,Work Item Type,Title,State,Area Path,Description\r\n" +
                           "101,User Story,\"Checkout, faster\",In Progress,Shop\\Web,\"<p>Make it <b>fast</b></p>\"\r\n" +
                           "102,Bug,Wrong total,Closed,,\r\n" +
                           ",Task,No id,New,,\r\n";
        var r = await Ok(await admin.PostAsJsonAsync($"/clients/{clientId}/import/ado-csv", new { csv }));
        Assert.Equal(3, r.GetProperty("total").GetInt32());
        Assert.Equal(2, r.GetProperty("created").GetInt32());
        Assert.Equal("skipped-bad", r.GetProperty("items")[2].GetProperty("status").GetString());

        var again = await Ok(await admin.PostAsJsonAsync($"/clients/{clientId}/import/ado-csv", new { csv }));
        Assert.Equal(0, again.GetProperty("created").GetInt32());
        Assert.Equal("skipped-exists", again.GetProperty("items")[0].GetProperty("status").GetString());

        var id = await _f.ScalarAsync<Guid>("select id from workitem where client_id = @c and key = 'ADO-101'", ("c", clientId));
        var page = await Ok(await admin.GetAsync($"/workitems/{id}"));
        Assert.Equal("story", page.GetProperty("workitem").GetProperty("type").GetString());
        Assert.Equal("building", page.GetProperty("workitem").GetProperty("phase").GetString());
        var bodies = page.GetProperty("events").EnumerateArray().Select(e => e.GetProperty("payload").GetProperty("body").GetString()).ToList();
        Assert.Contains("תיאור מ-ADO:\nMake it fast", bodies);
        Assert.Contains(bodies, b => b!.StartsWith("מיובא מ-Azure DevOps · work item #101"));
    }

    /// <summary>A client with a connection to a fake Azure DevOps that remembers every call and creates work items from 500 up.</summary>
    private async Task<(Guid ClientId, ConcurrentQueue<(string Method, string Path, string Body)> Calls)> ConnectedClient()
    {
        var calls = new ConcurrentQueue<(string, string, string)>();
        var next = 500;
        FakeAdo.Respond = req =>
        {
            var body = req.Content?.ReadAsStringAsync().Result ?? "";
            calls.Enqueue((req.Method.Method, Uri.UnescapeDataString(req.RequestUri!.AbsolutePath), body));
            if (req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.Contains("/_apis/wit/workitems/"))
            {
                var id = Interlocked.Increment(ref next);
                return FakeAdo.Json($"{{\"id\":{id},\"_links\":{{\"html\":{{\"href\":\"https://dev.azure.com/acme/Shop/_workitems/edit/{id}\"}}}}}}");
            }
            if (req.Method == HttpMethod.Patch) return FakeAdo.Json("{\"id\":1}");
            return FakeAdo.Json("{\"name\":\"Shop\"}");
        };
        var clientId = await _f.NewClientAsync();
        await Ok(await (await Admin()).PostAsJsonAsync($"/clients/{clientId}/connections/ado", new { orgUrl = "https://dev.azure.com/acme/Shop", pat = "fake-pat-123456" }));
        return (clientId, calls);
    }

    [Fact]
    public async Task Approving_puts_the_task_in_TFS_with_its_type_by_role_and_its_checks_in_the_Discussion()
    {
        var (clientId, calls) = await ConnectedClient();
        var admin = await Admin();
        var req = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "Coupons" }));
        var reqId = req.GetProperty("id").GetGuid();
        var created = await Ok(await admin.PostAsJsonAsync($"/workitems/{reqId}/tasks", new { tasks = new object[] { new { intent = "Store coupons" } } }));
        var taskId = created.GetProperty("taskIds")[0].GetGuid();

        var r = await Ok(await admin.PostAsJsonAsync($"/tasks/{taskId}/approve", new { }));
        var m = r.GetProperty("materialized");
        Assert.Equal(1, m.GetProperty("created").GetInt32());
        Assert.Equal(3, m.GetProperty("checksPosted").GetInt32());
        Assert.Equal("Task", m.GetProperty("items")[0].GetProperty("adoType").GetString());
        Assert.True(calls.Any(c => c.Method == "POST" && c.Path.EndsWith("/wit/workitems/$Task") && c.Body.Contains("Store coupons")), string.Join(" | ", calls.Select(c => $"{c.Method} {c.Path} {c.Body}")));
        Assert.Contains(calls, c => c.Method == "PATCH" && System.Text.RegularExpressions.Regex.Unescape(c.Body).Contains("רשימת בדיקה להשלמת המשימה"));

        var page = await Ok(await admin.GetAsync($"/tasks/{taskId}"));
        Assert.Equal(501, page.GetProperty("task").GetProperty("linkedAdoId").GetInt32());
        Assert.Equal("ready", page.GetProperty("status").GetProperty("key").GetString());

        // setting it aside mirrors "Removed" to the work item
        await Ok(await admin.PostAsJsonAsync($"/tasks/{taskId}/active", new { active = false, clientId }));
        Assert.Contains(calls, c => c.Method == "PATCH" && c.Path.EndsWith("/wit/workitems/501") && c.Body.Contains("Removed"));
    }

    [Fact]
    public async Task Starting_to_build_a_linked_requirement_moves_its_work_item_to_Active()
    {
        var (clientId, calls) = await ConnectedClient();
        var admin = await Admin();
        var req = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "Gift cards", linkedAdoId = 777 }));
        var r = await Ok(await admin.PostAsync($"/workitems/{req.GetProperty("id").GetGuid()}/start", null));
        Assert.Equal("WI-777", r.GetProperty("key").GetString());
        Assert.Contains(calls, c => c.Method == "PATCH" && c.Path.EndsWith("/wit/workitems/777") && c.Body.Contains("Active"));
    }
}
