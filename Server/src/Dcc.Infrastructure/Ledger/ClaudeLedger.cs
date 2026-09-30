using System.Text.Json;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Ledger;

/// <summary>One call to Claude, as recorded — who, which model, tokens, cost.</summary>
public sealed record ClaudeCallInput
{
    public required Guid ClientId { get; init; }
    public required Guid UserId { get; init; }
    public string EntityKind { get; init; } = "none";
    public string? EntityId { get; init; }
    public Guid? WorkitemId { get; init; }
    public string? Screen { get; init; }
    public required string Capability { get; init; }
    public required string Trigger { get; init; }
    public string Label { get; init; } = "";
    public Guid? ConversationId { get; init; }
    public Guid? MessageId { get; init; }
    public Guid? ParentCallId { get; init; }
    public required DateTimeOffset StartedAt { get; init; }
    public DateTimeOffset? FinishedAt { get; init; }
    public int? DurationMs { get; init; }
    public string? ModelRequested { get; init; }
    public string? ModelUsed { get; init; }
    public string? Effort { get; init; }
    public int? PolicyVersion { get; init; }
    public string? PolicyRule { get; init; }
    public int? NumTurns { get; init; }
    public int InputTokens { get; init; }
    public int CacheReadTokens { get; init; }
    public int CacheWriteTokens { get; init; }
    public int OutputTokens { get; init; }
    public decimal CostUsd { get; init; }
    public int? PriceListVersion { get; init; }
    public string Outcome { get; init; } = "ok";
    public string? ErrorText { get; init; }
    public bool Unanswered { get; init; }
    /// <summary>Set when the call was already recorded elsewhere (a hook's session event): no second timeline entry.</summary>
    public string? SourceRef { get; init; }
    public object? Meta { get; init; }
}

/// <summary>
/// The ONE way to record a call to Claude (claude-in-dcc §1) — like the event log
/// is the one way to write an event. Nothing else inserts into <c>claude_call</c>
/// (append-only by trigger). A call that belongs to a work item also leaves a thin
/// <c>claude.call</c> event on that timeline, linking to the row and carrying no
/// cost: the timeline stays complete, and money is counted once.
/// </summary>
public sealed class ClaudeLedger(ITenantScope tenant, IEventLogWriter events)
{
    public static readonly string[] EntityKinds = ["workitem", "task", "pull_request", "onboarding_run", "conversation", "none"];
    public static readonly string[] Triggers = ["button", "chat", "rollover", "insights", "session", "hook"];
    public static readonly string[] Outcomes = ["ok", "error", "timeout", "stopped", "refused"];

    public Task<Guid> RecordAsync(ClaudeCallInput v, CancellationToken ct = default)
    {
        if (!EntityKinds.Contains(v.EntityKind)) throw new ArgumentException($"entity kind \"{v.EntityKind}\"");
        if (!Triggers.Contains(v.Trigger)) throw new ArgumentException($"trigger \"{v.Trigger}\"");
        if (!Outcomes.Contains(v.Outcome)) throw new ArgumentException($"outcome \"{v.Outcome}\"");
        if (v.InputTokens < 0 || v.OutputTokens < 0 || v.CacheReadTokens < 0 || v.CacheWriteTokens < 0 || v.CostUsd < 0)
            throw new ArgumentException("tokens and cost cannot be negative");

        return tenant.RunAsync(v.ClientId, async db =>
        {
            var id = await SqlJson.ScalarAsync<Guid>(db, """
                insert into claude_call (client_id, user_id, entity_kind, entity_id, workitem_id, screen, capability, trigger, label,
                  conversation_id, message_id, parent_call_id, started_at, finished_at, duration_ms, model_requested, model_used, effort,
                  policy_version, policy_rule, num_turns, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost_usd,
                  price_list_version, outcome, error_text, unanswered, source_ref, meta)
                values (@client, @user, @kind, @entity, @wi, @screen, @cap, @trigger, @label, @conv, @msg, @parent, @started,
                  coalesce(@finished, now()), @dur, @modelReq, @modelUsed, @effort, @pv, @rule, @turns, @inTok, @crTok, @cwTok, @outTok,
                  round(@cost, 6), @plv, @outcome, @err, @unanswered, @src, @meta)
                returning id
                """, new
            {
                client = v.ClientId, user = v.UserId, kind = v.EntityKind, entity = v.EntityId, wi = v.WorkitemId, screen = v.Screen,
                cap = v.Capability, trigger = v.Trigger, label = v.Label, conv = v.ConversationId, msg = v.MessageId, parent = v.ParentCallId,
                started = v.StartedAt, finished = v.FinishedAt, dur = v.DurationMs, modelReq = v.ModelRequested, modelUsed = v.ModelUsed,
                effort = v.Effort, pv = v.PolicyVersion, rule = v.PolicyRule, turns = v.NumTurns, inTok = v.InputTokens, crTok = v.CacheReadTokens,
                cwTok = v.CacheWriteTokens, outTok = v.OutputTokens, cost = v.CostUsd, plv = v.PriceListVersion, outcome = v.Outcome,
                err = v.ErrorText, unanswered = v.Unanswered, src = v.SourceRef, meta = SqlJson.Jsonb(v.Meta ?? new { }),
            }, ct);

            if (v.WorkitemId is { } wi && v.SourceRef is null)
            {
                await events.AppendAsync(new NewEvent
                {
                    ClientId = v.ClientId, WorkitemId = wi, Source = "claude_session", Type = "claude.call",
                    Actor = new DelegatedActor(v.UserId, $"dcc:{v.Capability}"),
                    Links = [new EventLink("claude_call", id.ToString())],
                    Payload = JsonSerializer.SerializeToElement(new { callId = id, capability = v.Capability, label = v.Label, outcome = v.Outcome }),
                }, ct);
            }
            return id;
        }, ct);
    }
}
