import { z } from "zod";
import { withTenant } from "../client.ts";
import { claudeCall } from "../schema/claude.ts";
import { appendEvent } from "../events/index.ts";

/**
 * The ONE way to record a call to Claude (`openspec/changes/claude-in-dcc`
 * design §1) — like `appendEvent()` is the one way to write an event.
 * Nothing else may INSERT into `claude_call`; `scripts/audit-stale.mjs`
 * checks that.
 *
 * A call that belongs to a work item also leaves a thin `claude.call` event
 * on that timeline, with a link to the row and no cost fields: the timeline
 * stays complete (decision 01) and the money is counted once (§8.2).
 */

export const CALL_ENTITY_KINDS = ["workitem", "task", "pull_request", "onboarding_run", "conversation", "none"] as const;
export const CALL_TRIGGERS = ["button", "chat", "rollover", "insights", "session", "hook"] as const;
export const CALL_OUTCOMES = ["ok", "error", "timeout", "stopped", "refused"] as const;
export type CallEntityKind = (typeof CALL_ENTITY_KINDS)[number];
export type CallTrigger = (typeof CALL_TRIGGERS)[number];
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

const nonneg = z.number().int().nonnegative();

export const claudeCallInput = z.object({
  clientId: z.string().uuid(),
  userId: z.string().uuid(),
  entityKind: z.enum(CALL_ENTITY_KINDS).default("none"),
  entityId: z.string().nullish(),
  workitemId: z.string().uuid().nullish(),
  screen: z.string().nullish(),
  capability: z.string().min(1),
  trigger: z.enum(CALL_TRIGGERS),
  label: z.string().default(""),
  conversationId: z.string().uuid().nullish(),
  messageId: z.string().uuid().nullish(),
  parentCallId: z.string().uuid().nullish(),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().optional(),
  durationMs: nonneg.nullish(),
  modelRequested: z.string().nullish(),
  modelUsed: z.string().nullish(),
  effort: z.string().nullish(),
  policyVersion: z.number().int().nullish(),
  policyRule: z.string().nullish(),
  numTurns: nonneg.nullish(),
  inputTokens: nonneg.default(0),
  cacheReadTokens: nonneg.default(0),
  cacheWriteTokens: nonneg.default(0),
  outputTokens: nonneg.default(0),
  costUsd: z.number().nonnegative().default(0),
  priceListVersion: z.number().int().nullish(),
  outcome: z.enum(CALL_OUTCOMES).default("ok"),
  errorText: z.string().nullish(),
  unanswered: z.boolean().default(false),
  sourceRef: z.string().nullish(),
  meta: z.record(z.unknown()).default({}),
});
export type ClaudeCallInput = z.input<typeof claudeCallInput>;
export type ClaudeCallRow = typeof claudeCall.$inferSelect;

export async function recordClaudeCall(input: ClaudeCallInput): Promise<ClaudeCallRow> {
  const v = claudeCallInput.parse(input);
  return withTenant(v.clientId, async (tx) => {
    const [row] = await tx
      .insert(claudeCall)
      .values({
        clientId: v.clientId,
        userId: v.userId,
        entityKind: v.entityKind,
        entityId: v.entityId ?? null,
        workitemId: v.workitemId ?? null,
        screen: v.screen ?? null,
        capability: v.capability,
        trigger: v.trigger,
        label: v.label,
        conversationId: v.conversationId ?? null,
        messageId: v.messageId ?? null,
        parentCallId: v.parentCallId ?? null,
        startedAt: v.startedAt,
        finishedAt: v.finishedAt ?? new Date(),
        durationMs: v.durationMs ?? null,
        modelRequested: v.modelRequested ?? null,
        modelUsed: v.modelUsed ?? null,
        effort: v.effort ?? null,
        policyVersion: v.policyVersion ?? null,
        policyRule: v.policyRule ?? null,
        numTurns: v.numTurns ?? null,
        inputTokens: v.inputTokens,
        cacheReadTokens: v.cacheReadTokens,
        cacheWriteTokens: v.cacheWriteTokens,
        outputTokens: v.outputTokens,
        costUsd: v.costUsd.toFixed(6),
        priceListVersion: v.priceListVersion ?? null,
        outcome: v.outcome,
        errorText: v.errorText ?? null,
        unanswered: v.unanswered,
        sourceRef: v.sourceRef ?? null,
        meta: v.meta,
      })
      .returning();
    if (v.workitemId && !v.sourceRef) {
      await appendEvent({
        clientId: v.clientId,
        workitemId: v.workitemId,
        source: "claude_session",
        type: "claude.call",
        actor: { kind: "delegated", userId: v.userId, identityType: "delegated", triggeredBy: `dcc:${v.capability}` },
        links: [{ rel: "claude_call", ref: row!.id }],
        payload: { callId: row!.id, capability: v.capability, label: v.label, outcome: v.outcome },
      });
    }
    return row!;
  });
}

/** The ledger's numeric column comes back as a string; every reader wants a number. */
export const usd = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v));
