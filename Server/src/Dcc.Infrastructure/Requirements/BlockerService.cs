using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Requirements;

/// <summary>
/// A Blocker: work stopped and needs an answer (architecture §13). A structured
/// question routed to the requirement's owner, answered in a focused screen.
/// </summary>
public sealed class BlockerService(DccDbContext db, ITenantScope tenant, IEventLogWriter events, BriefService brief)
{
    public async Task<JsonObject> RaiseAsync(Guid clientId, Guid workitemId, string questionType, string question, Guid? taskId, Guid actor, CancellationToken ct)
    {
        var cols = await TableColumns.SelectAsync(db, "blocker", null, ct);
        var row = await tenant.RunAsync(clientId, async d =>
        {
            var owner = await SqlJson.ScalarAsync<Guid?>(d, "select owner_id from workitem where id = @w", new { w = workitemId }, ct) ?? throw AppException.NotFound("workitem");
            var inserted = await SqlJson.QuerySingleAsync(d, $"""
                insert into blocker (client_id, workitem_id, task_id, question_type, question, routed_to, state)
                values (@c, @w, @t, @qt, @q, @owner, 'open') returning {cols}
                """, new { c = clientId, w = workitemId, t = taskId, qt = questionType, q = question, owner }, ct)!;
            var links = new List<EventLink> { new("blocker", inserted!["id"]!.GetValue<string>()) };
            if (taskId is { } tid) links.Add(new EventLink("task", tid.ToString()));
            var payload = new JsonObject { ["questionType"] = questionType, ["question"] = question };
            if (taskId is { } t2) payload["taskId"] = t2.ToString();
            await events.AppendAsync(new NewEvent
            {
                ClientId = clientId, WorkitemId = workitemId, Source = "claude_session", Type = "blocker.raised",
                Actor = new DelegatedActor(actor, "skill:raise-blocker"), Links = links, Payload = JsonSerializer.SerializeToElement(payload),
            }, ct);
            return inserted;
        }, ct);
        await brief.RegenerateAsync(clientId, workitemId, ct);
        return row;
    }

    public async Task<JsonObject> AnswerAsync(Guid clientId, Guid blockerId, string answer, Guid actor, CancellationToken ct)
    {
        var workitemId = await tenant.RunAsync(clientId, async d =>
        {
            var b = await SqlJson.QuerySingleAsync(d, "select workitem_id as \"w\", state::text as \"state\" from blocker where id = @id", new { id = blockerId }, ct)
                    ?? throw AppException.NotFound("blocker");
            if (b["state"]!.GetValue<string>() != "open") throw AppException.Conflict("blocker_closed", $"blocker is {b["state"]}");
            var w = Guid.Parse(b["w"]!.GetValue<string>());
            await SqlJson.ExecuteAsync(d, "update blocker set answer = @a, answered_by = @by, answered_at = now(), state = 'answered' where id = @id",
                new { a = answer, by = actor, id = blockerId }, ct);
            await events.AppendAsync(new NewEvent
            {
                ClientId = clientId, WorkitemId = w, Source = "manual", Type = "blocker.answered", Actor = new UserActor(actor),
                Links = [new EventLink("blocker", blockerId.ToString())],
                Payload = JsonSerializer.SerializeToElement(new { blockerId, answer }),
            }, ct);
            return w;
        }, ct);
        await brief.RegenerateAsync(clientId, workitemId, ct);
        return new JsonObject { ["blockerId"] = blockerId.ToString(), ["state"] = "answered" };
    }

    public async Task<JsonObject> UpdateAsync(Guid clientId, Guid blockerId, string? question, string? questionType, CancellationToken ct)
    {
        if (question is null && questionType is null) return new JsonObject { ["updated"] = false };
        var w = await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<Guid?>(d, """
            update blocker set question = coalesce(@q, question), question_type = coalesce(@qt, question_type) where id = @id returning workitem_id
            """, new { q = question, qt = questionType, id = blockerId }, ct), ct);
        if (w is { } wi) await brief.RegenerateAsync(clientId, wi, ct);
        return new JsonObject { ["updated"] = true };
    }

    public async Task<JsonObject> DeleteAsync(Guid clientId, Guid blockerId, CancellationToken ct)
    {
        var w = await tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<Guid?>(d, "delete from blocker where id = @id returning workitem_id", new { id = blockerId }, ct), ct);
        if (w is { } wi) await brief.RegenerateAsync(clientId, wi, ct);
        return new JsonObject { ["deleted"] = true };
    }

    /// <summary>The "waiting on me" queue: open blockers routed to this user, across a client's requirements.</summary>
    public async Task<List<JsonObject>> WaitingOnAsync(Guid clientId, Guid userId, CancellationToken ct)
    {
        var cols = await TableColumns.SelectAsync(db, "blocker", null, ct);
        return await tenant.RunAsync(clientId, d => SqlJson.QueryAsync(d,
            $"select {cols} from blocker where routed_to = @u and state = 'open' order by created_at", new { u = userId }, ct), ct);
    }

    public Task<Guid?> RequirementOfAsync(Guid clientId, Guid blockerId, CancellationToken ct) =>
        tenant.RunAsync(clientId, d => SqlJson.ScalarAsync<Guid?>(d, "select workitem_id from blocker where id = @id", new { id = blockerId }, ct), ct);
}
