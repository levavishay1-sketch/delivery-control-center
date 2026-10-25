using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Ledger;
using Dcc.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Dcc.Infrastructure.Requirements;

/// <summary>
/// What happens around Claude Code, recorded with zero manual effort (POST /events): a person's own Claude
/// session and their git activity, posted by the hooks, and a note from the web's "add note" form. Each becomes
/// one event on the requirement it belongs to, then that requirement's brief is rebuilt — so the next session
/// starts from it. When no requirement can be named with confidence the event lands in the client's unassigned
/// inbox; it is never guessed.
/// </summary>
public sealed class CaptureService(
    DccDbContext db,
    ITenantScope tenant,
    IEventLogWriter events,
    ClaudeLedger ledger,
    BriefService brief,
    RequirementService requirements,
    DashboardService dashboard,
    ILogger<CaptureService> log)
{
    /// <summary>Where an event lands: always a client, and a requirement when one was named or resolved.</summary>
    public sealed record Target(Guid ClientId, Guid? WorkitemId);

    /// <summary>
    /// Who an event is by (decision 02 — always a person). <see cref="Person"/> is the one accountable, who the
    /// ledger row is charged to; <see cref="AgentId"/> names the AI agent whose token it was, if any.
    /// </summary>
    public sealed record Who(EventActor Actor, Guid Person, Guid? AgentId);

    public sealed record Session(string SessionId, string? TranscriptPath, string Summary, string? Model, int? TokensIn, int? TokensOut, decimal? CostUsd);

    public sealed record Git(string Repo, string Branch, string Kind, int? Count, int? PrNumber, IReadOnlyList<string>? Shas);

    public sealed record Note(string Body, string Source, Guid? Corrects);

    public static readonly string[] GitKinds = ["commit", "push", "branch_created", "pull_request"];
    public static readonly string[] NoteSources = ["manual", "email", "slack", "phone", "meeting"];

    /// <summary>
    /// The requirement an event belongs to, in the old order: an id names it (its own client wins); a key is looked
    /// up only inside <paramref name="clientId"/>'s tenant — never across clients; otherwise the WI-nnnn key in the
    /// branch. No confident match ⇒ the client with no requirement (the inbox). null when no client can be told at all.
    /// </summary>
    public async Task<Target?> ResolveAsync(Guid? workitemId, string? workitemKey, Guid? clientId, string? branch, CancellationToken ct)
    {
        if (workitemId is { } id)
        {
            var (_, owner, _) = await requirements.LocateAsync(id, ct);
            return new Target(owner, id);
        }
        if (workitemKey is not null)
        {
            if (clientId is not { } c) throw AppException.BadRequest("bad_request", "\"workitemKey\" needs \"clientId\": a key is looked up only inside its own client.");
            var found = await dashboard.ResolveAsync(tenant, c, null, workitemKey, ct) ?? throw AppException.NotFound("workitem");
            return new Target(c, Guid.Parse(found["workitemId"]!.GetValue<string>()));
        }
        if (clientId is not { } cid) return null;
        var byBranch = branch is null ? null : await dashboard.ResolveAsync(tenant, cid, branch, null, ct);
        return new Target(cid, byBranch is null ? null : Guid.Parse(byBranch["workitemId"]!.GetValue<string>()));
    }

    /// <summary>
    /// The actor for whoever signed in. A person (a sign-in or their own API token) is themselves. An AI agent's
    /// token is never recorded as the agent's own row: a delegated agent is its owner with the agent named
    /// (<c>agent:&lt;name&gt;</c>); an independent one is itself with the person who sponsors it.
    /// </summary>
    public async Task<Who> WhoAsync(Guid userId, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.Kind, u.DisplayName }).FirstOrDefaultAsync(ct)
                   ?? throw AppException.Unauthorized("unauthorized", "Not signed in.");
        if (user.Kind != "agent") return new Who(new UserActor(userId), userId, null);

        var profile = await db.AgentProfiles.AsNoTracking().FirstOrDefaultAsync(a => a.UserId == userId, ct);
        if (profile is { Mode: "independent", SponsorUserId: { } sponsor }) return new Who(new AgentActor(userId, sponsor), sponsor, userId);
        if (profile is { Mode: "delegated", OwnerUserId: { } owner })
            return new Who(new DelegatedActor(owner, $"agent:{user.DisplayName}") { AgentId = userId }, owner, userId);
        throw AppException.Forbidden("forbidden", "This agent has no person behind it, so nothing it does can be recorded.");
    }

    /// <summary>
    /// A Claude Code session that ended. It is also a call to Claude like any other, so it gets one ledger row —
    /// tied to the event by <c>event:&lt;id&gt;</c>, which keeps the ledger from adding a second timeline entry.
    /// The session is already recorded when the row is written: a row that fails is logged, never lost with it.
    /// </summary>
    public async Task<StoredEvent> RecordSessionAsync(Target t, Who who, Session s, DateTimeOffset? occurredAt, CancellationToken ct)
    {
        var payload = new JsonObject { ["sessionId"] = s.SessionId };
        if (s.TranscriptPath is not null) payload["transcriptPath"] = s.TranscriptPath;
        payload["summary"] = s.Summary;
        if (s.Model is not null) payload["model"] = s.Model;
        if (s.TokensIn is { } tin) payload["tokensIn"] = tin;
        if (s.TokensOut is { } tout) payload["tokensOut"] = tout;
        if (s.CostUsd is { } cost) payload["costUsd"] = cost;

        var ev = await events.AppendAsync(new NewEvent
        {
            ClientId = t.ClientId, WorkitemId = t.WorkitemId, OccurredAt = occurredAt, Source = "claude_session", Type = "claude.session",
            Actor = who.Actor, Links = [new EventLink("session", s.SessionId)], Payload = JsonSerializer.SerializeToElement(payload),
        }, ct);

        try
        {
            await ledger.RecordAsync(new ClaudeCallInput
            {
                ClientId = t.ClientId, UserId = who.Person, WorkitemId = t.WorkitemId,
                EntityKind = t.WorkitemId is null ? "none" : "workitem", EntityId = t.WorkitemId?.ToString(),
                Capability = "interactive_session", Trigger = "hook", Label = s.Summary.Length > 200 ? s.Summary[..200] : s.Summary,
                StartedAt = occurredAt ?? DateTimeOffset.UtcNow, ModelUsed = s.Model,
                InputTokens = s.TokensIn ?? 0, OutputTokens = s.TokensOut ?? 0, CostUsd = s.CostUsd ?? 0,
                SourceRef = $"event:{ev.Id}", Meta = who.AgentId is { } agent ? new { agentId = agent } : null,
            }, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogWarning(e, "Session {EventId} was captured, but its ledger row could not be written", ev.Id);
        }

        if (t.WorkitemId is { } w) await brief.RegenerateAsync(t.ClientId, w, ct);
        return ev;
    }

    /// <summary>A commit, push, new branch or pull request, linked to its commits and its pull request.</summary>
    public async Task<StoredEvent> RecordGitAsync(Target t, Who who, Git g, DateTimeOffset? occurredAt, CancellationToken ct)
    {
        var links = new List<EventLink>();
        if (g.PrNumber is { } pr and not 0) links.Add(new EventLink("pull_request", pr.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        links.AddRange((g.Shas ?? []).Select(sha => new EventLink("commit", sha)));

        var payload = new JsonObject { ["repo"] = g.Repo, ["branch"] = g.Branch, ["kind"] = g.Kind };
        if (g.Count is { } count) payload["count"] = count;
        if (g.PrNumber is { } n) payload["prNumber"] = n;
        if (g.Shas is { } shas) payload["shas"] = new JsonArray(shas.Select(x => (JsonNode?)x).ToArray());

        var ev = await events.AppendAsync(new NewEvent
        {
            ClientId = t.ClientId, WorkitemId = t.WorkitemId, OccurredAt = occurredAt, Source = "git", Type = "git.activity",
            Actor = who.Actor, Links = links, Payload = JsonSerializer.SerializeToElement(payload),
        }, ct);
        if (t.WorkitemId is { } w) await brief.RegenerateAsync(t.ClientId, w, ct);
        return ev;
    }

    /// <summary>
    /// A person's note. The timeline is append-only (decision 01), so correcting a note is a NEW note that
    /// supersedes it — allowed only for a note on the same requirement that nothing has corrected yet, so a
    /// correction can never hide another event or fork a note into two "current" versions.
    /// </summary>
    public async Task<StoredEvent> RecordNoteAsync(Target t, Who who, Note n, DateTimeOffset? occurredAt, CancellationToken ct)
    {
        var ev = await tenant.RunAsync(t.ClientId, async d =>
        {
            if (n.Corrects is { } target)
            {
                // Two people correcting the same note at once: the second waits here and then sees the first.
                await SqlJson.ExecuteAsync(d, "select pg_advisory_xact_lock(hashtextextended(@t::text, 0))", new { t = target }, ct);
                var note = await SqlJson.QuerySingleAsync(d, """
                    select exists (select 1 from event_log s where s.supersedes = e.id) as "corrected"
                    from event_log e
                    where e.id = @t and e.type = 'note.added' and e.workitem_id is not distinct from @w::uuid
                    """, new { t = target, w = t.WorkitemId }, ct)
                    ?? throw AppException.Conflict("cannot_correct", "אפשר לתקן רק הערה שנמצאת בדרישה הזו.");
                if (note["corrected"]!.GetValue<bool>())
                    throw AppException.Conflict("cannot_correct", "ההערה הזו כבר תוקנה. כדי לשנות אותה שוב צריך לתקן את התיקון האחרון.");
            }

            var payload = new JsonObject { ["body"] = n.Body };
            if (n.Corrects is { } c) payload["corrects"] = c.ToString();
            return await events.AppendAsync(new NewEvent
            {
                ClientId = t.ClientId, WorkitemId = t.WorkitemId, OccurredAt = occurredAt, Source = n.Source, Type = "note.added",
                Actor = who.Actor, Supersedes = n.Corrects, Payload = JsonSerializer.SerializeToElement(payload),
            }, ct);
        }, ct);
        if (t.WorkitemId is { } w) await brief.RegenerateAsync(t.ClientId, w, ct);
        return ev;
    }
}
