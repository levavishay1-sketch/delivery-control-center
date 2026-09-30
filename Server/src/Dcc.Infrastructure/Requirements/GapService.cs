using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Requirements;

/// <summary>
/// A Gap is an AI PROPOSAL, never a fact, until a person verifies it (architecture §4):
/// blocking or not; resolved with a decision, dismissed with a reason, or spun off into
/// its own requirement. Both the decision and the "not a real gap" reason are recorded,
/// so the next person — or the next Claude run — does not raise the same question again.
/// </summary>
public sealed class GapService(DccDbContext db, ITenantScope tenant, IEventLogWriter events, BriefService brief)
{
    public sealed record ProposeRequest(string Description, bool Blocking, double Confidence, string Mode,
        string? Why = null, string? Kind = null, string? WhoAnswers = null, string[]? Options = null, string? ImpactIfWrong = null);

    public async Task<JsonObject> ProposeAsync(Guid clientId, Guid workitemId, ProposeRequest r, Guid actor, CancellationToken ct)
    {
        if (r.Confidence is < 0 or > 1) throw AppException.BadRequest("bad_request", "confidence must be between 0 and 1.");
        if (r.Mode is not ("delegated" or "interactive")) throw AppException.BadRequest("bad_request", "mode must be delegated or interactive.");
        var cols = await TableColumns.SelectAsync(db, "gap", null, ct);
        var row = await tenant.RunAsync(clientId, async d =>
        {
            var inserted = await SqlJson.QuerySingleAsync(d, $"""
                insert into gap (client_id, workitem_id, description, blocking, confidence, state, why, kind, who_answers, options, impact_if_wrong)
                values (@c, @w, @desc, @blocking, round(@conf::numeric, 2), 'proposed', @why, @kind, @who, @options, @impact)
                returning {cols}
                """, new
            {
                c = clientId, w = workitemId, desc = r.Description, blocking = r.Blocking, conf = r.Confidence, why = r.Why,
                kind = r.Kind ?? "missing_info", who = r.WhoAnswers ?? "team", options = SqlJson.Jsonb(r.Options ?? []), impact = r.ImpactIfWrong,
            }, ct) ?? throw new InvalidOperationException("insert returned nothing");
            var gapId = inserted["id"]!.GetValue<string>();
            EventActor who = r.Mode == "delegated" ? new DelegatedActor(actor, "skill:gap-report") : new UserActor(actor);
            var ev = await events.AppendAsync(new NewEvent
            {
                ClientId = clientId, WorkitemId = workitemId, Source = r.Mode == "delegated" ? "claude_session" : "manual", Type = "gap.proposed",
                Actor = who, Links = [new EventLink("gap", gapId)],
                Payload = JsonSerializer.SerializeToElement(new { description = r.Description, blocking = r.Blocking, confidence = r.Confidence }),
            }, ct);
            await SqlJson.ExecuteAsync(d, "update gap set proposed_by_event = @e where id = @g", new { e = ev.Id, g = Guid.Parse(gapId) }, ct);
            inserted["proposedByEvent"] = ev.Id.ToString();
            return inserted;
        }, ct);
        await brief.RegenerateAsync(clientId, workitemId, ct);
        return row;
    }

    public async Task<JsonObject> VerifyAsync(Guid clientId, Guid gapId, string outcome, string? spunOffTitle, string? answer, Guid? ownerId, Guid actor, CancellationToken ct)
    {
        if (outcome is not ("verified" or "resolved" or "dismissed" or "spun_off")) throw AppException.BadRequest("bad_request", "unknown outcome");
        var result = await tenant.RunAsync(clientId, async d =>
        {
            var g = await SqlJson.QuerySingleAsync(d, "select workitem_id as \"w\", description from gap where id = @id", new { id = gapId }, ct) ?? throw AppException.NotFound("gap");
            var workitemId = Guid.Parse(g["w"]!.GetValue<string>());
            var description = g["description"]!.GetValue<string>();
            var trimmed = answer?.Trim();

            if (outcome is "resolved" or "dismissed" && !string.IsNullOrEmpty(trimmed))
            {
                var lead = outcome == "resolved" ? "החלטה על הפער" : "נדחה כלא-פער";
                await events.AppendAsync(new NewEvent
                {
                    ClientId = clientId, WorkitemId = workitemId, Source = "manual", Type = "note.added", Actor = new UserActor(actor),
                    Payload = JsonSerializer.SerializeToElement(new { body = $"{lead} \"{(description.Length > 80 ? description[..80] : description)}\":\n{trimmed}" }),
                }, ct);
            }

            Guid? spunOffTo = null;
            if (outcome == "spun_off")
            {
                if (string.IsNullOrWhiteSpace(spunOffTitle)) throw AppException.BadRequest("bad_request", "spun_off needs spunOffTitle");
                // A sibling of the origin: same parent, same owner unless overridden.
                spunOffTo = await SqlJson.ScalarAsync<Guid>(d, """
                    insert into workitem (client_id, parent_id, owner_id, title, type)
                    select client_id, parent_id, coalesce(@owner, owner_id), @title, 'task' from workitem where id = @w
                    returning id
                    """, new { owner = ownerId, title = spunOffTitle, w = workitemId }, ct);
            }

            await SqlJson.ExecuteAsync(d, """
                update gap set state = @state::gap_state, resolved_by = @by, resolved_at = now(), spun_off_to = @spun,
                  answer = case when @answer::text is null then answer else @answer::text end
                where id = @id
                """, new { state = outcome, by = actor, spun = spunOffTo, answer = string.IsNullOrEmpty(trimmed) ? null : trimmed, id = gapId }, ct);

            var links = new List<EventLink> { new("gap", gapId.ToString()) };
            if (spunOffTo is { } s) links.Add(new EventLink("task", s.ToString()));
            var payload = new JsonObject { ["gapId"] = gapId.ToString(), ["outcome"] = outcome };
            if (spunOffTo is { } s2) payload["spunOffTo"] = s2.ToString();
            await events.AppendAsync(new NewEvent
            {
                ClientId = clientId, WorkitemId = workitemId, Source = "manual", Type = "gap.verified", Actor = new UserActor(actor),
                Links = links, Payload = JsonSerializer.SerializeToElement(payload),
            }, ct);
            return (workitemId, spunOffTo);
        }, ct);
        await brief.RegenerateAsync(clientId, result.workitemId, ct);
        return new JsonObject { ["gapId"] = gapId.ToString(), ["outcome"] = outcome, ["spunOffTo"] = result.spunOffTo?.ToString() };
    }

    public async Task<JsonObject> UpdateAsync(Guid clientId, Guid gapId, string? description, bool? blocking, CancellationToken ct)
    {
        if (description is null && blocking is null) return new JsonObject { ["updated"] = false };
        var w = await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<Guid?>(d, """
            update gap set description = coalesce(@desc, description), blocking = coalesce(@blocking, blocking) where id = @id returning workitem_id
            """, new { desc = description, blocking, id = gapId }, ct), ct);
        if (w is { } wi) await brief.RegenerateAsync(clientId, wi, ct);
        return new JsonObject { ["updated"] = true };
    }

    public async Task<JsonObject> DeleteAsync(Guid clientId, Guid gapId, CancellationToken ct)
    {
        var w = await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<Guid?>(d, "delete from gap where id = @id returning workitem_id", new { id = gapId }, ct), ct);
        if (w is { } wi) await brief.RegenerateAsync(clientId, wi, ct);
        return new JsonObject { ["deleted"] = true };
    }

    /// <summary>The requirement a gap belongs to — to check the caller's permission on it.</summary>
    public Task<Guid?> RequirementOfAsync(Guid clientId, Guid gapId, CancellationToken ct) =>
        tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<Guid?>(d, "select workitem_id from gap where id = @id", new { id = gapId }, ct), ct);

    public static string Fixed2(double v) => v.ToString("0.00", CultureInfo.InvariantCulture);
}
