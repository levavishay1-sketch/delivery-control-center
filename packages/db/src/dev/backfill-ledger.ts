import { sql } from "drizzle-orm";
import { db, withTenant, closeDb } from "../client.ts";
import { eventLog } from "../schema/events.ts";
import { repositoryOnboardingRun } from "../schema/repo-onboarding.ts";
import { recordClaudeCall } from "../ledger/index.ts";
import type { EventActor } from "../schema/events.ts";

/**
 * One-off: copy the cost records that existed before the ledger into it —
 * every `claude.session` event (DCC's own runs and hook-reported sessions)
 * and every onboarding run's session totals. Idempotent: each row carries
 * a `source_ref` with a unique index, so a second run copies nothing.
 *
 * Run with the API STOPPED (PGlite is single-process):
 *   npm run -w @dcc/db dev:backfill-ledger
 */

const KIND_TO_CAPABILITY: Record<string, string> = {
  assess: "gap_detection", breakdown: "decomposition", implement: "execution", check: "execution",
  retro: "retro", gap_letter: "client_letter",
};
const isDuplicate = (e: unknown) => /duplicate|unique/i.test(String((e as Error).message ?? e));

let copied = 0, skipped = 0, noPerson = 0;

type SessionPayload = { summary?: string; model?: string; tokensIn?: number; tokensOut?: number; costUsd?: number; durationMs?: number; numTurns?: number };

const events = await db.select().from(eventLog).where(sql`${eventLog.type} = 'claude.session' and ${eventLog.supersedes} is null`);
for (const e of events) {
  const actor = e.actor as EventActor;
  if (actor.kind === "system") { noPerson++; continue; }
  const p = e.payload as SessionPayload;
  const kind = actor.kind === "delegated" ? actor.triggeredBy.replace(/^dcc:/, "") : "";
  const capability = actor.kind === "user" ? "interactive_session" : KIND_TO_CAPABILITY[kind] ?? (kind || "unknown");
  try {
    await recordClaudeCall({
      clientId: e.clientId, userId: actor.userId, workitemId: e.workitemId, entityKind: e.workitemId ? "workitem" : "none", entityId: e.workitemId,
      capability, trigger: actor.kind === "user" ? "hook" : "button", label: (p.summary ?? "").slice(0, 200),
      startedAt: e.occurredAt, finishedAt: e.occurredAt, durationMs: p.durationMs, modelUsed: p.model, numTurns: p.numTurns,
      inputTokens: p.tokensIn ?? 0, outputTokens: p.tokensOut ?? 0, costUsd: p.costUsd ?? 0, sourceRef: `event:${e.id}`,
    });
    copied++;
  } catch (err) {
    if (isDuplicate(err)) skipped++; else throw err;
  }
}
console.log(`claude.session events: ${copied} copied, ${skipped} already there, ${noPerson} without a person (skipped)`);

type Totals = { costUsd?: number; inputTokens?: number; outputTokens?: number; apiDurationMs?: number };
type Session = {
  model?: string; effort?: string; apiCalls?: number; base?: Totals; ledgerCursor?: unknown;
  status?: Totals & { model?: string | null; effort?: string | null };
  assistant?: { costUsd: number; calls: number; inputTokens: number; outputTokens: number };
};
let runsCopied = 0, runsSkipped = 0;
const runs = await db.select().from(repositoryOnboardingRun);
for (const r of runs) {
  const s = (r.session ?? {}) as Session;
  const totals = {
    costUsd: (s.base?.costUsd ?? 0) + (s.status?.costUsd ?? 0),
    inputTokens: (s.base?.inputTokens ?? 0) + (s.status?.inputTokens ?? 0),
    outputTokens: (s.base?.outputTokens ?? 0) + (s.status?.outputTokens ?? 0),
    apiDurationMs: (s.base?.apiDurationMs ?? 0) + (s.status?.apiDurationMs ?? 0),
  };
  const finished = r.completedAt ?? r.cancelledAt ?? new Date();
  const write = async (input: Parameters<typeof recordClaudeCall>[0]) => {
    try { await recordClaudeCall(input); runsCopied++; } catch (err) { if (isDuplicate(err)) runsSkipped++; else throw err; }
  };
  if (totals.costUsd > 0 || totals.inputTokens > 0) {
    await write({
      clientId: r.clientId, userId: r.triggeredBy, entityKind: "onboarding_run", entityId: r.id, capability: "onboarding_init", trigger: "session",
      label: "סשן ההטמעה (לפני היומן)", startedAt: r.startedAt, finishedAt: finished, durationMs: Math.round(totals.apiDurationMs),
      modelUsed: s.status?.model ?? s.model ?? null, effort: s.status?.effort ?? s.effort ?? null, numTurns: s.apiCalls ?? null,
      inputTokens: Math.round(totals.inputTokens), outputTokens: Math.round(totals.outputTokens), costUsd: totals.costUsd, sourceRef: `run:${r.id}`,
    });
  }
  if (s.assistant && s.assistant.calls > 0) {
    await write({
      clientId: r.clientId, userId: r.triggeredBy, entityKind: "onboarding_run", entityId: r.id, capability: "onboarding_assistant", trigger: "chat",
      label: "העוזר של ההטמעה (לפני היומן)", startedAt: r.startedAt, finishedAt: finished, numTurns: s.assistant.calls,
      inputTokens: Math.round(s.assistant.inputTokens), outputTokens: Math.round(s.assistant.outputTokens), costUsd: s.assistant.costUsd, sourceRef: `run-assistant:${r.id}`,
    });
  }
  // From here on the session's cost is recorded in slices; the cursor says what is already in the ledger.
  if (!s.ledgerCursor) {
    await withTenant(r.clientId, (tx) =>
      tx.update(repositoryOnboardingRun)
        .set({ session: { ...s, ledgerCursor: { ...totals, stageKey: r.currentStageKey, at: new Date().toISOString() } } })
        .where(sql`${repositoryOnboardingRun.id} = ${r.id}`),
    );
  }
}
console.log(`onboarding runs: ${runsCopied} rows copied, ${runsSkipped} already there`);
await closeDb();
