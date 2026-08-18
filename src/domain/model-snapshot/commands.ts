import { db } from "@/lib/db";
import { Prisma, type ModelSnapshot } from "@/generated/prisma/client";
import { enqueueJob } from "@/domain/job/commands";
import type { ExtractedModelFact } from "@/lib/integrations/modelKnowledgeSource";

const WEEK_KEY_PREFIX = "model-snapshot-";

/**
 * The next Sunday 07:00 UTC strictly after `from` — if `from` is itself a Sunday before 07:00,
 * that same day's 07:00 counts as "next" (see design.md Decision 1).
 */
export function nextSunday07UTC(from: Date): Date {
  const candidate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 7, 0, 0, 0));
  const daysUntilSunday = (7 - candidate.getUTCDay()) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + daysUntilSunday);
  if (candidate <= from) candidate.setUTCDate(candidate.getUTCDate() + 7);
  return candidate;
}

function weekKeyFor(date: Date): string {
  return `${WEEK_KEY_PREFIX}${date.toISOString().slice(0, 10)}`;
}

/**
 * Unconditionally enqueues the next Sunday 07:00 FETCH_MODEL_SNAPSHOT run — idempotent via the
 * target week's idempotency key, not via an existence check. Called from the job handler itself
 * after every attempt (success, a recorded extraction failure, or exhaustion — design.md
 * Decision 1/4), where the current attempt's own job row is still `RUNNING`, so an
 * existence-check-based "ensure" (see below) would see that row and wrongly skip scheduling.
 */
export async function scheduleNextModelSnapshotFetch(from: Date = new Date()): Promise<void> {
  const next = nextSunday07UTC(from);
  await enqueueJob("FETCH_MODEL_SNAPSHOT", {}, weekKeyFor(next), db, next);
}

/**
 * Ensures the weekly FETCH_MODEL_SNAPSHOT job keeps running: a no-op if one is already
 * QUEUED/RUNNING, otherwise enqueues the next Sunday 07:00 run. Called only at worker startup
 * (design.md Decision 3 — self-healing across restarts/fresh environments), never from inside the
 * job handler itself — see `scheduleNextModelSnapshotFetch` above for why.
 */
export async function ensureModelSnapshotJobScheduled(): Promise<void> {
  const pending = await db.job.findFirst({
    where: { type: "FETCH_MODEL_SNAPSHOT", status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (pending) return;

  await scheduleNextModelSnapshotFetch();
}

type RecordAttemptInput =
  | { status: "SUCCESS"; rawContent: string; extractedModels: ExtractedModelFact[] }
  | { status: "FAILED"; rawContent: string; failureReason: string };

/**
 * Records one weekly fetch attempt's outcome — success (with the extracted models) or failure
 * (with a reason) — never partially, per design.md's "failed extraction never presents
 * fabricated data" decision. Called both when extraction runs but finds nothing recognizable
 * (`handleFetchModelSnapshotJob`) and when the job's retries are exhausted before a fetch ever
 * succeeds (`handleFetchModelSnapshotExhausted`).
 */
export async function recordModelSnapshotAttempt(input: RecordAttemptInput): Promise<ModelSnapshot> {
  return db.modelSnapshot.create({
    data: {
      status: input.status,
      rawContent: input.rawContent,
      extractedModels: (input.status === "SUCCESS" ? input.extractedModels : []) as unknown as Prisma.InputJsonValue,
      failureReason: input.status === "FAILED" ? input.failureReason : null,
    },
  });
}
