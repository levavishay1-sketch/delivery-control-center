using System.ComponentModel;
using System.Net;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Dcc.Mcp;

/// <summary>
/// The five tools — all of them read, none writes. Each is one GET on the REST route the web reads the same data
/// from, made as the token's person, so it answers exactly what that person sees on the web and nothing of a client
/// they may not read. The names, titles, descriptions and parameters are the ones MCP clients already know.
/// A tool answers one text block holding the JSON, indented; a refusal is a sentence with <c>isError</c>, never an exception.
/// </summary>
[McpServerToolType]
public sealed class DccTools(DccApi api)
{
    [McpServerTool(Name = "list_clients", Title = "List DCC clients", ReadOnly = true)]
    [Description("The clients (tenants) this DCC instance manages that the token's person may see — id, name, number of initiatives and requirements, "
        + "this month's AI spend and the monthly budget. Needed to get a clientId for the other tools.")]
    public Task<CallToolResult> ListClients(CancellationToken ct) =>
        GetAsync("clients", body => body?["clients"], new Subject("the clients", "no clients"), ct);

    [McpServerTool(Name = "search_requirements", Title = "Search requirements", ReadOnly = true)]
    [Description("Search a client's requirements by title (case-insensitive substring). Returns id, key, title, type, phase — enough to pick one for get_requirement.")]
    public Task<CallToolResult> SearchRequirements(
        [Description("The client to search within — from list_clients")] Guid clientId,
        [Description("Substring to match against requirement titles")] string query,
        CancellationToken ct) =>
        GetAsync($"clients/{clientId}/workitems/search?q={Uri.EscapeDataString(query ?? "")}", body => body?["items"],
            new Subject($"the requirements of client {clientId}", $"no client with id {clientId}"), ct);

    [McpServerTool(Name = "get_requirement", Title = "Get requirement detail", ReadOnly = true)]
    [Description("Full detail for one requirement: fields, gaps, blockers, tasks, attachments, linked repos, and its full event timeline. "
        + "Same data the DCC web UI's requirement page shows.")]
    public Task<CallToolResult> GetRequirement([Description("The requirement's id — from search_requirements")] Guid id, CancellationToken ct) =>
        GetAsync($"workitems/{id}", body => body, Requirement(id), ct);

    [McpServerTool(Name = "get_timeline", Title = "Get requirement timeline", ReadOnly = true)]
    [Description("Just the append-only event log for one requirement — every note, decision, status change, AI run, in order. "
        + "Use get_requirement instead if you also need current field values/tasks.")]
    public Task<CallToolResult> GetTimeline(Guid id, CancellationToken ct) =>
        GetAsync($"workitems/{id}/timeline", body => body?["events"], Requirement(id), ct);

    [McpServerTool(Name = "get_cost_summary", Title = "Get requirement AI cost summary", ReadOnly = true)]
    [Description("The requirement's cumulative AI cost: total USD, tokens, run count, broken down by what kind of call (assess/breakdown/implement/chat/...).")]
    public Task<CallToolResult> GetCostSummary(Guid id, CancellationToken ct) =>
        GetAsync($"workitems/{id}/cost", body => body, Requirement(id), ct);

    // ── arguments ────────────────────────────────────────────────────

    /// <summary>Each tool's id argument, and what a caller should put in it.</summary>
    private static readonly Dictionary<string, (string Name, string What)> IdArguments = new()
    {
        ["search_requirements"] = ("clientId", "a client's id, from list_clients"),
        ["get_requirement"] = ("id", "a requirement's id, from search_requirements"),
        ["get_timeline"] = ("id", "a requirement's id, from search_requirements"),
        ["get_cost_summary"] = ("id", "a requirement's id, from search_requirements"),
    };

    /// <summary>
    /// The refusal for an id argument that is missing or not a uuid, checked before the SDK binds the call (a filter in
    /// <see cref="DccMcpServer"/>): the SDK's own answer for a value it cannot bind names neither the argument nor the
    /// reason, and a caller that passed a key such as WI-1284 needs to hear that it should look the id up first.
    /// </summary>
    public static CallToolResult? RefuseMalformedId(CallToolRequestParams? call)
    {
        if (call is null || !IdArguments.TryGetValue(call.Name, out var arg)) return null;
        JsonElement value = default;
        var present = call.Arguments?.TryGetValue(arg.Name, out value) == true;
        if (present && value.ValueKind == JsonValueKind.String && Guid.TryParse(value.GetString(), out _)) return null;
        return Refusal($"{arg.Name} must be a uuid — {arg.What} (it is {(present ? value.GetRawText() : "missing")}).");
    }

    // ── answers ──────────────────────────────────────────────────────

    /// <summary>What a tool reads, in the words of its refusals: the thing a 403 names, and the whole sentence of a 404.</summary>
    private sealed record Subject(string What, string NotFound);

    private static Subject Requirement(Guid id) => new($"requirement {id}", $"no requirement with id {id}");

    /// <summary>Indented like <c>JSON.stringify(value, null, 2)</c>, with Hebrew and other text written as itself rather than <c>\uXXXX</c>.</summary>
    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private async Task<CallToolResult> GetAsync(string path, Func<JsonNode?, JsonNode?> pick, Subject subject, CancellationToken ct)
    {
        ApiAnswer answer;
        try
        {
            answer = await api.GetAsync(path, ct);
        }
        catch (Exception e) when (e is HttpRequestException || (e is TaskCanceledException && !ct.IsCancellationRequested))
        {
            return Refusal($"Cannot reach the DCC API at {api.BaseAddress}: {e.Message} Is the server running? "
                + $"Set {DccApiSettings.UrlVariable} if it runs somewhere else.");
        }

        if (answer.Ok) return Text(pick(answer.Body));
        return Refusal(answer.Status switch
        {
            HttpStatusCode.Unauthorized => $"DCC did not accept the API token (it is missing, wrong, expired or revoked, or its person is disabled). "
                + $"Set {DccApiSettings.TokenVariable} to a token from POST /tokens.",
            HttpStatusCode.Forbidden => $"The token's person may not read {subject.What}"
                + (answer.Body?["permission"] is JsonValue p && p.TryGetValue<string>(out var permission) ? $" (it needs {permission})." : "."),
            HttpStatusCode.NotFound => subject.NotFound,
            _ => $"DCC answered {(int)answer.Status} for {subject.What}: {answer.Message ?? answer.Status.ToString()}",
        });
    }

    private static CallToolResult Text(JsonNode? value) =>
        new() { Content = [new TextContentBlock { Text = value?.ToJsonString(Indented) ?? "null" }] };

    private static CallToolResult Refusal(string sentence) =>
        new() { Content = [new TextContentBlock { Text = sentence }], IsError = true };
}
