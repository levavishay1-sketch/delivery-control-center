using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.Glossary;

/// <summary>Bound from <c>Glossary</c>.</summary>
public sealed class GlossaryOptions
{
    public const string Section = "Glossary";

    /// <summary>Server/glossary: <c>concepts/*.json</c> (one file per area) and <c>screens.json</c>.</summary>
    public string Path { get; set; } = "../../glossary";
}

/// <summary>
/// The "i" registry: for every idea a person meets on a screen — a card, a
/// figure, a field, a costly button — one Hebrew name and one or two plain
/// sentences. One wording, three readers: the "i" next to the element, the
/// chat (which answers from here with no model call), and the audit.
///
/// Entries are keyed by CONCEPT, not by screen. Everything reads through
/// <see cref="All"/>, <see cref="Get"/> and <see cref="For"/>, never the files,
/// so moving the registry into a table later changes only this class.
/// </summary>
public sealed class GlossaryService
{
    private readonly List<JsonObject> _concepts;
    private readonly Dictionary<string, JsonObject> _byKey;
    private readonly Dictionary<string, string> _screens;

    public GlossaryService(IOptions<GlossaryOptions> options)
    {
        var dir = options.Value.Path;
        _concepts = System.IO.Directory.GetFiles(System.IO.Path.Combine(dir, "concepts"), "*.json")
            .OrderBy(System.IO.Path.GetFileName, StringComparer.Ordinal)
            .SelectMany(f => JsonNode.Parse(File.ReadAllText(f))!.AsArray().Select(n => n!.AsObject()))
            .ToList();
        _byKey = _concepts.ToDictionary(c => c["key"]!.GetValue<string>());
        _screens = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(System.IO.Path.Combine(dir, "screens.json")))!;
    }

    public IReadOnlyList<JsonObject> All => _concepts;

    public JsonObject? Get(string key) => _byKey.GetValueOrDefault(key);

    public IEnumerable<string> Screens => _screens.Keys;

    /// <summary>What one screen's chat knows: the screen's purpose and every concept that lists it.</summary>
    public JsonObject? For(string? screen)
    {
        if (screen is null || !_screens.TryGetValue(screen, out var about)) return null;
        var entries = _concepts.Where(c => c["screens"] is JsonArray s && s.Any(x => x?.GetValue<string>() == screen)).Select(c => (JsonNode?)c.DeepClone());
        return new JsonObject { ["screen"] = screen, ["about"] = about, ["entries"] = new JsonArray(entries.ToArray()) };
    }
}
