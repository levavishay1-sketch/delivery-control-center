using System.Text.Json.Nodes;
using Dcc.Domain.Prompts;
using Dcc.Infrastructure.Ado;
using Dcc.Infrastructure.Policy;

namespace Dcc.Tests.Unit;

/// <summary>The old server's ado-url and prompt-contract tests, and the policy file's layout — all pure.</summary>
public sealed class AdoUrlTests
{
    [Theory]
    [InlineData("https://dev.azure.com/my-org", "https://dev.azure.com/my-org", "")]
    [InlineData("https://dev.azure.com/my-org/My%20Project", "https://dev.azure.com/my-org", "My Project")]
    [InlineData("https://dev.azure.com/my-org/My Project/_git/x", "https://dev.azure.com/my-org", "My Project")]
    [InlineData("https://dev.azure.com/my-org/_apis/projects", "https://dev.azure.com/my-org", "")]
    [InlineData("  https://dev.azure.com/my-org///  ", "https://dev.azure.com/my-org", "")]
    [InlineData("http://host/DefaultCollection", "http://host/DefaultCollection", "")]
    [InlineData("http://host/DefaultCollection/My Project", "http://host/DefaultCollection", "My Project")]
    [InlineData("http://host/tfs/DefaultCollection/My%20Project", "http://host/tfs/DefaultCollection", "My Project")]
    [InlineData("not a url", "not a url", "")]
    public void Split_finds_the_org_and_the_project(string raw, string org, string project) =>
        Assert.Equal((org, project), AdoUrl.Split(raw));

    [Fact]
    public void The_project_in_the_url_wins_over_the_typed_one() =>
        Assert.Equal(("https://dev.azure.com/my-org", "From Url"), AdoUrl.Normalise("https://dev.azure.com/my-org/From Url", "Typed"));

    [Fact]
    public void The_typed_project_is_used_when_the_url_has_none() =>
        Assert.Equal(("https://dev.azure.com/my-org", "Typed"), AdoUrl.Normalise("https://dev.azure.com/my-org", " Typed "));
}

public sealed class PromptContractTests
{
    [Fact]
    public void Render_fills_values_and_leaves_an_unknown_one_visible() =>
        Assert.Equal("a 1 b {{Y}}", PromptContract.Render("a {{X}} b {{Y}}", new Dictionary<string, object?> { ["X"] = "1" }));

    [Fact]
    public void A_section_shows_only_when_its_switch_is_on_and_its_opposite_only_when_off()
    {
        const string t = "{{#R}}in {{N}}{{/R}}{{^R}}no repo{{/R}}";
        Assert.Equal("in trade", PromptContract.Render(t, new Dictionary<string, object?> { ["R"] = true, ["N"] = "trade" }));
        Assert.Equal("no repo", PromptContract.Render(t, new Dictionary<string, object?> { ["R"] = false, ["N"] = "" }));
        Assert.Equal("x", PromptContract.Render("x{{#T}} ({{T}}){{/T}}", new Dictionary<string, object?> { ["T"] = "  " }));
        Assert.Equal("a", PromptContract.Render("{{#A}}a{{#B}}b{{/B}}{{/A}}", new Dictionary<string, object?> { ["A"] = true, ["B"] = false }));
    }

    [Fact]
    public void A_row_no_code_uses_has_no_contract() => Assert.Empty(PromptContract.Problems("nobody.uses.this", "{{WHATEVER}}"));

    [Fact]
    public void Problems_name_a_missing_value_an_unknown_one_an_unclosed_section_and_a_missing_answer_field()
    {
        var p = PromptContract.Problems("insights.clusters", "{{FOO}} {{#BAR}} [{\"n\": 1, \"finding\": \"\"}]");
        Assert.Contains(p, x => x.Contains("{{FOO}} לא מוכר"));
        Assert.Contains(p, x => x.Contains("{{#BAR}}"));
        Assert.Contains(p, x => x.Contains("\"recommendation\""));
        Assert.Contains(PromptContract.Problems("breakdown.tasks", "no requirement here"), x => x.Contains("{{REQUIREMENT}}"));
    }
}

public sealed class ModelPolicyLayoutTests
{
    /// <summary>The C# writer lays the file out exactly as the old server's did — so a save changes only the changed lines.</summary>
    [Fact]
    public void Formatting_the_policy_reproduces_the_file_byte_for_byte()
    {
        var path = FindRepoFile("config/model-policy.json");
        var original = File.ReadAllText(path).Replace("\r\n", "\n");
        Assert.Equal(original, ModelPolicyStore.Format(JsonNode.Parse(original)) + "\n");
    }

    internal static string FindRepoFile(string relative)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, relative))) dir = dir.Parent;
        return dir is null ? throw new FileNotFoundException(relative) : Path.Combine(dir.FullName, relative);
    }
}

/// <summary>The old ado-map tests, and the CSV reader the import uses.</summary>
public sealed class AdoMapTests
{
    [Fact]
    public void Maps_known_types_and_states_case_insensitively()
    {
        Assert.Equal("story", Dcc.Domain.Ado.AdoMap.MapType("  User Story "));
        Assert.Equal("story", Dcc.Domain.Ado.AdoMap.MapType("PRODUCT BACKLOG ITEM"));
        Assert.Equal("building", Dcc.Domain.Ado.AdoMap.MapState(" In Progress"));
        Assert.Equal("archived", Dcc.Domain.Ado.AdoMap.MapState("Removed"));
    }

    [Fact]
    public void Falls_back_to_task_and_intake()
    {
        Assert.Equal("task", Dcc.Domain.Ado.AdoMap.MapType("Something Custom"));
        Assert.Equal("intake", Dcc.Domain.Ado.AdoMap.MapState("Waiting on vendor"));
    }

    [Fact]
    public void Html_to_text()
    {
        Assert.Equal("one\ntwo\nthree", Dcc.Domain.Ado.AdoMap.HtmlToText("<div>one</div><p>two<br/>three</p>"));
        Assert.Equal("a b & c <d> \"e\" 'f'", Dcc.Domain.Ado.AdoMap.HtmlToText("a&nbsp;b &amp; c &lt;d&gt; &quot;e&quot; &#39;f&#39;"));
        Assert.Equal("a\n\nb", Dcc.Domain.Ado.AdoMap.HtmlToText("<p>a</p><p></p><p></p><p>b</p>"));
    }

    [Fact]
    public void Reads_csv_with_quotes_escapes_and_embedded_newlines()
    {
        var rows = Dcc.Domain.Ado.AdoMap.ParseCsv("ID,Title,Description\r\n1,\"Hello, world\",\"line one\nline \"\"two\"\"\"\r\n\r\n2,Plain,\n");
        Assert.Equal(3, rows.Count);
        Assert.Equal(["1", "Hello, world", "line one\nline \"two\""], rows[1]);
        Assert.Equal(["2", "Plain", ""], rows[2]);
    }
}
