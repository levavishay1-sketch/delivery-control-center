using System.Globalization;
using System.Text.Json.Nodes;
using Dcc.Domain.Onboarding;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// The memory of ready-made components (marketplace.ts, its database half): a source found for one repository is
/// remembered and offered to the next repository with the same stack, and re-checked weekly. <c>marketplace_source</c>
/// is org-wide and has no RLS — it holds names, addresses and trust checks only, never a client's content — so it is
/// read and written outside any tenant scope. The search, the trust grading and the card are in
/// <see cref="MarketplaceSources"/>.
/// </summary>
public sealed class MarketplaceStore(DccDbContext db)
{
    private const string Columns = """
        id, kind, name, url, publisher, description, tags, trust, trust_checks as "trustChecks", tool_count as "toolCount", context_tokens as "contextTokens",
        found_by as "foundBy", used_in_repos as "usedInRepos", first_seen_at as "firstSeenAt", last_checked_at as "lastCheckedAt", changed_at as "changedAt"
        """;

    /// <summary>Sources already known for any of these tags — what the next repository with the same stack gets without a search. Most used first.</summary>
    public async Task<List<RememberedSource>> RememberedForAsync(IReadOnlyCollection<string> tags, CancellationToken ct = default)
    {
        if (tags.Count == 0) return [];
        var rows = await SqlJson.QueryAsync(db, $"select {Columns} from marketplace_source order by used_in_repos desc, last_checked_at desc", null, ct);
        return rows.Select(Of).Where(r => r.Tags.Any(tags.Contains)).ToList();
    }

    /// <summary>
    /// Remembers what a search found — once per kind and address. A source seen again gains the new tags and its fresh
    /// trust; <c>changed_at</c> moves only when its tool count changed (the coach's "new in the world").
    /// </summary>
    public async Task<RememberedSource> RememberSourceAsync(FoundSource s, string trust, TrustChecks checks, string foundBy = "model", CancellationToken ct = default)
    {
        var existing = await SqlJson.QuerySingleAsync(db, $"select {Columns} from marketplace_source where kind = @k and url = @u limit 1", new { k = s.Kind, u = s.Url }, ct);
        if (existing is not null)
        {
            var prev = Of(existing);
            var changed = prev.ToolCount != s.ToolCount && s.ToolCount is not null;
            var tags = prev.Tags.Concat(s.Tags).Distinct().ToList();
            var row = await SqlJson.QuerySingleAsync(db, $"""
                update marketplace_source set tags = @tags, trust = @trust, trust_checks = @checks, tool_count = @tools, last_checked_at = now(){(changed ? ", changed_at = now()" : "")}
                where id = @id returning {Columns}
                """, new { id = Guid.Parse(prev.Id), tags = SqlJson.Jsonb(tags), trust, checks = SqlJson.Jsonb(checks.ToJson()), tools = s.ToolCount ?? prev.ToolCount }, ct);
            return Of(row!);
        }
        var inserted = await SqlJson.QuerySingleAsync(db, $"""
            insert into marketplace_source (kind, name, url, publisher, description, tags, trust, trust_checks, tool_count, context_tokens, found_by)
            values (@kind, @name, @url, @publisher, @description, @tags, @trust, @checks, @tools, @context, @foundBy) returning {Columns}
            """, new
        {
            kind = s.Kind, name = s.Name, url = s.Url, publisher = s.Publisher, description = s.Description, tags = SqlJson.Jsonb(s.Tags), trust,
            checks = SqlJson.Jsonb(checks.ToJson()), tools = s.ToolCount, context = s.ToolCount is { } n ? n * 700 : (int?)null, foundBy,
        }, ct);
        return Of(inserted!);
    }

    /// <summary>One more repository delivered a component from this source.</summary>
    public Task CountSourceUseAsync(Guid id, CancellationToken ct = default) =>
        SqlJson.ExecuteAsync(db, "update marketplace_source set used_in_repos = used_in_repos + 1 where id = @id", new { id }, ct);

    private static RememberedSource Of(JsonObject r) => new()
    {
        Id = OnboardingJson.Str(r, "id")!, Kind = OnboardingJson.Str(r, "kind")!, Name = OnboardingJson.Str(r, "name")!, Url = OnboardingJson.Str(r, "url")!,
        Publisher = OnboardingJson.Str(r, "publisher"), Description = OnboardingJson.Str(r, "description"),
        Tags = r["tags"] is JsonArray a ? a.Select(ComponentVerifier.AsString).OfType<string>().ToList() : [],
        Trust = OnboardingJson.Str(r, "trust") ?? SourceTrust.Unverified, TrustChecks = r["trustChecks"] is JsonObject tc ? (JsonObject)tc.DeepClone() : [],
        ToolCount = r["toolCount"] is JsonValue t ? t.GetValue<int>() : null, ContextTokens = r["contextTokens"] is JsonValue c ? c.GetValue<int>() : null,
        FoundBy = OnboardingJson.Str(r, "foundBy") ?? "model", UsedInRepos = r["usedInRepos"] is JsonValue u ? u.GetValue<int>() : 0,
        FirstSeenAt = Time(r, "firstSeenAt"), LastCheckedAt = Time(r, "lastCheckedAt"), ChangedAt = Time(r, "changedAt"),
    };

    private static DateTimeOffset? Time(JsonObject r, string key) =>
        OnboardingJson.Str(r, key) is { } s ? DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal) : null;
}
