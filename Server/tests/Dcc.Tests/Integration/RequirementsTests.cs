using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Dcc.Tests.Support;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace Dcc.Tests.Integration;

/// <summary>Phase 4.2: requirements, timeline, brief, flow, gaps, blockers, dependencies, attachments and the spec.</summary>
[Collection(DbCollection.Name)]
public sealed class RequirementsTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    private async Task<HttpClient> Admin() => _f.Client(await _f.AdminTokenAsync());

    private async Task<(Guid ClientId, Guid ReqId, HttpClient Admin)> NewRequirement(string title = "Tiered discounts")
    {
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        var res = await admin.PostAsJsonAsync("/workitems", new { clientId, title, type = "feature", priority = "high", key = "WI-" + Random.Shared.Next(10000, 99999) });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var row = await res.Content.ReadFromJsonAsync<JsonElement>();
        return (clientId, row.GetProperty("id").GetGuid(), admin);
    }

    [Fact]
    public async Task A_new_requirement_answers_with_its_whole_row_in_the_old_shape()
    {
        var admin = await Admin();
        var clientId = await _f.NewClientAsync();
        var row = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "New", type = "story", budgetUsd = 120, dueInDays = 3 }));
        Assert.Equal("story", row.GetProperty("type").GetString());
        Assert.Equal("intake", row.GetProperty("phase").GetString());
        Assert.Equal("development", row.GetProperty("requirementType").GetString());
        Assert.Equal("120.00", row.GetProperty("budgetUsd").GetString()); // numeric(…,2) → a string, as node-postgres gave it
        Assert.Equal(clientId.ToString(), row.GetProperty("clientId").GetString());
        Assert.True(row.TryGetProperty("dueDate", out var due) && due.ValueKind == JsonValueKind.String);
    }

    [Fact]
    public async Task The_requirement_page_carries_its_row_files_repos_gaps_blockers_tasks_and_timeline()
    {
        var (_, id, admin) = await NewRequirement();
        var page = await Ok(await admin.GetAsync($"/workitems/{id}"));
        foreach (var key in new[] { "workitem", "attachments", "repos", "gaps", "blockers", "tasks", "taskDependencies", "events" })
            Assert.True(page.TryGetProperty(key, out _), key);
        Assert.Equal(id, page.GetProperty("workitem").GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task An_edit_records_which_fields_changed_and_reopening_records_why()
    {
        var (_, id, admin) = await NewRequirement();
        await Ok(await admin.PatchAsJsonAsync($"/workitems/{id}", new { phase = "done" }));
        var reopened = await Ok(await admin.PatchAsJsonAsync($"/workitems/{id}", new { phase = "building", reopenReason = "the customer found a bug" }));
        Assert.Equal("building", reopened.GetProperty("phase").GetString());

        var events = (await Ok(await admin.GetAsync($"/workitems/{id}/timeline"))).GetProperty("events").EnumerateArray().ToList();
        Assert.Contains(events, e => e.GetProperty("type").GetString() == "requirement.updated" && e.GetProperty("payload").GetProperty("fields")[0].GetString() == "phase");
        var decision = events.Single(e => e.GetProperty("type").GetString() == "decision.made");
        Assert.Equal("requirement_reopened", decision.GetProperty("payload").GetProperty("trigger").GetString());

        // nothing changed → no new event
        var before = events.Count;
        await Ok(await admin.PatchAsJsonAsync($"/workitems/{id}", new { phase = "building" }));
        Assert.Equal(before, (await Ok(await admin.GetAsync($"/workitems/{id}/timeline"))).GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task A_requirement_with_sub_requirements_is_not_deleted()
    {
        var (clientId, id, admin) = await NewRequirement();
        await Ok(await admin.PostAsJsonAsync("/workitems", new { parentId = id, title = "Child" }));
        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync($"/workitems/{id}")).StatusCode);
        var lone = await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "Alone" }));
        Assert.True((await Ok(await admin.DeleteAsync($"/workitems/{lone.GetProperty("id").GetString()}"))).GetProperty("deleted").GetBoolean());
    }

    [Fact]
    public async Task A_gap_is_proposed_resolved_with_a_decision_and_spun_off_into_a_sibling()
    {
        var (clientId, id, admin) = await NewRequirement();
        var gap = await Ok(await admin.PostAsJsonAsync($"/workitems/{id}/gaps", new { description = "Pro-rata or end of month?", blocking = true, confidence = 0.88, mode = "interactive" }));
        Assert.Equal("proposed", gap.GetProperty("state").GetString());
        Assert.Equal("0.88", gap.GetProperty("confidence").GetString());

        var brief = await admin.GetStringAsync($"/workitems/{id}/brief");
        Assert.Contains("**BLOCKING** — Pro-rata or end of month?", brief);
        Assert.Contains("confidence 0.88, not yet verified", brief);

        var gapId = gap.GetProperty("id").GetString();
        var resolved = await Ok(await admin.PostAsJsonAsync($"/gaps/{gapId}/verify", new { clientId, outcome = "resolved", answer = "End of month." }));
        Assert.Equal("resolved", resolved.GetProperty("outcome").GetString());
        var events = (await Ok(await admin.GetAsync($"/workitems/{id}/timeline"))).GetProperty("events").EnumerateArray().Select(e => e.GetProperty("type").GetString()).ToList();
        Assert.Contains("gap.verified", events);
        Assert.Contains("note.added", events);

        var second = await Ok(await admin.PostAsJsonAsync($"/workitems/{id}/gaps", new { description = "Export to PDF too", blocking = false, confidence = 0.5 }));
        var spun = await Ok(await admin.PostAsJsonAsync($"/gaps/{second.GetProperty("id").GetString()}/verify", new { clientId, outcome = "spun_off", spunOffTitle = "PDF export" }));
        var child = spun.GetProperty("spunOffTo").GetGuid();
        var flow = await Ok(await admin.GetAsync($"/requirements/{id}/flow"));
        Assert.Contains(flow.GetProperty("edges").EnumerateArray(), e => e.GetProperty("kind").GetString() == "spun_off" && e.GetProperty("to").GetGuid() == child);
    }

    [Fact]
    public async Task A_blocker_goes_to_the_owner_is_answered_once_and_shows_in_the_brief()
    {
        var (clientId, id, admin) = await NewRequirement();
        var blocker = await Ok(await admin.PostAsJsonAsync($"/workitems/{id}/blockers", new { questionType = "missing_access", question = "Who has the DB password?" }));
        var mine = await Ok(await admin.GetAsync($"/clients/{clientId}/blockers"));
        Assert.Contains(mine.GetProperty("blockers").EnumerateArray(), b => b.GetProperty("id").GetString() == blocker.GetProperty("id").GetString());

        var answer = await Ok(await admin.PostAsJsonAsync($"/blockers/{blocker.GetProperty("id").GetString()}/answer", new { clientId, answer = "Ops has it." }));
        Assert.Equal("answered", answer.GetProperty("state").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"/blockers/{blocker.GetProperty("id").GetString()}/answer", new { clientId, answer = "again" })).StatusCode);
        Assert.Contains("**A:** Ops has it.", await admin.GetStringAsync($"/workitems/{id}/brief"));
    }

    [Fact]
    public async Task A_dependency_shows_as_an_edge_and_can_be_removed()
    {
        var (clientId, a, admin) = await NewRequirement("A");
        var b = (await Ok(await admin.PostAsJsonAsync("/workitems", new { parentId = a, title = "B" }))).GetProperty("id").GetGuid();
        var c = (await Ok(await admin.PostAsJsonAsync("/workitems", new { parentId = a, title = "C" }))).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync($"/workitems/{c}/depends-on", new { dependsOnWorkitemId = b, reason = "needs the model" })).StatusCode);
        var flow = await Ok(await admin.GetAsync($"/requirements/{a}/flow"));
        Assert.Equal(3, flow.GetProperty("nodes").GetArrayLength());
        Assert.Contains(flow.GetProperty("edges").EnumerateArray(), e => e.GetProperty("kind").GetString() == "predecessor" && e.GetProperty("from").GetGuid() == c);
        await Ok(await admin.DeleteAsync($"/workitems/{c}/depends-on/{b}"));
        flow = await Ok(await admin.GetAsync($"/requirements/{a}/flow"));
        Assert.DoesNotContain(flow.GetProperty("edges").EnumerateArray(), e => e.GetProperty("kind").GetString() == "predecessor");
    }

    [Fact]
    public async Task A_text_file_is_stored_read_and_handed_back()
    {
        var (_, id, admin) = await NewRequirement();
        var content = "Line one\nLine two";
        var res = await admin.PostAsJsonAsync($"/workitems/{id}/attachments", new { name = "notes.txt", contentBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(content)) });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var att = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(content.Length, att.GetProperty("textChars").GetInt32());
        var back = await admin.GetByteArrayAsync($"/workitems/{id}/attachments/{att.GetProperty("id").GetString()}/content");
        Assert.Equal(content, Encoding.UTF8.GetString(back));
    }

    [Fact]
    public async Task An_attached_word_document_is_shown_as_the_spec_with_its_own_table()
    {
        var (_, id, admin) = await NewRequirement();
        await Ok(await admin.PostAsJsonAsync($"/workitems/{id}/attachments", new { name = "spec.docx", contentBase64 = Convert.ToBase64String(SampleDocx()) }));
        var spec = await Ok(await admin.GetAsync($"/workitems/{id}/spec"));
        Assert.False(spec.GetProperty("read").GetBoolean());
        Assert.Equal("spec.docx", spec.GetProperty("source").GetProperty("name").GetString());
        var blocks = spec.GetProperty("doc").GetProperty("blocks").EnumerateArray().ToList();
        Assert.Equal("heading", blocks[0].GetProperty("type").GetString());
        Assert.Equal("Discount rules", blocks[0].GetProperty("text").GetString());
        var table = blocks.Single(b => b.GetProperty("type").GetString() == "table");
        Assert.Equal(["Tier", "Discount"], table.GetProperty("head").EnumerateArray().Select(h => h.GetString()!).ToArray());
        Assert.Equal("t1.r1.c2.l1", table.GetProperty("rows")[0].GetProperty("cells")[1].GetProperty("lines")[0].GetProperty("id").GetString());
    }

    [Fact]
    public async Task A_reader_of_one_client_cannot_edit_there_and_cannot_see_another_clients_requirement()
    {
        var (clientA, reqA, _) = await NewRequirement();
        var (_, reqB, _) = await NewRequirement();
        var (userId, _, password) = await _f.NewUserAsync();
        await _f.AssignAsync("user", userId, "reader", "client", clientA);
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", userId));
        var user = _f.Client((await _f.LoginAsync(email, password)).AccessToken);

        Assert.Equal(HttpStatusCode.OK, (await user.GetAsync($"/workitems/{reqA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.PatchAsJsonAsync($"/workitems/{reqA}", new { title = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync($"/workitems/{reqB}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await user.GetAsync($"/workitems/{Guid.NewGuid()}")).StatusCode);
        var listed = (await Ok(await user.GetAsync("/list/workitems"))).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetGuid()).ToList();
        Assert.Contains(reqA, listed);
        Assert.DoesNotContain(reqB, listed);
    }

    /// <summary>A small .docx: a heading, a bold one-liner (a heading without a style), a paragraph and a table with a header row.</summary>
    private static byte[] SampleDocx()
    {
        using var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            var styles = main.AddNewPart<StyleDefinitionsPart>();
            styles.Styles = new Styles(new Style(new StyleName { Val = "heading 1" }) { Type = StyleValues.Paragraph, StyleId = "Heading1" });
            Paragraph P(string text, bool bold = false, string? style = null)
            {
                var run = new Run(new Text(text));
                if (bold) run.RunProperties = new RunProperties(new Bold());
                var p = new Paragraph(run);
                if (style is not null) p.ParagraphProperties = new ParagraphProperties(new ParagraphStyleId { Val = style });
                return p;
            }
            TableCell Cell(string text) => new(P(text));
            var headRow = new TableRow(Cell("Tier"), Cell("Discount")) { TableRowProperties = new TableRowProperties(new TableHeader()) };
            main.Document = new Document(new Body(
                P("Discount rules", style: "Heading1"),
                P("1.1 Tiers", bold: true),
                P("Business customers get a discount by turnover."),
                new Table(headRow, new TableRow(Cell("Gold"), Cell("10%")))));
        }
        return ms.ToArray();
    }
}
