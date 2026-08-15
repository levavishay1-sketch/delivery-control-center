import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma, type Job, type JobType } from "@/generated/prisma/client";

type DbClient = typeof db | Prisma.TransactionClient;

const enqueueJobSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(1),
});

/** Base delay for retry backoff; attempt N (1-indexed) waits BASE_BACKOFF_MS * 2^(N-1). */
const BASE_BACKOFF_MS = 30_000;

export function computeBackoffDelayMs(attempts: number): number {
  return BASE_BACKOFF_MS * 2 ** (attempts - 1);
}

/**
 * Enqueues a job for the worker to pick up. Idempotent on `idempotencyKey`: a
 * second enqueue with the same key returns the already-queued/running/finished
 * job instead of creating a duplicate or erroring, so a caller can safely
 * re-request the same logical work (e.g. retrying its own enqueue call).
 *
 * Accepts an optional transaction client so a caller can enqueue atomically
 * with the state transition that precedes it (e.g. draftStage's PENDING ->
 * AI_DRAFTING write) — without that, a crash between "commit the status
 * change" and "enqueue the job" would leave a stage/Constitution stuck in a
 * drafting state with no job ever created to move it out, defeating the
 * crash-durability this job runtime exists for.
 */
export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  client: DbClient = db
): Promise<Job> {
  const input = enqueueJobSchema.parse({ type, payload, idempotencyKey });

  const existing = await client.job.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;

  try {
    return await client.job.create({
      data: {
        type: input.type as JobType,
        payload: input.payload as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey,
      },
    });
  } catch (err) {
    // Race: another caller created the same idempotencyKey between our findUnique and create.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raceWinner = await client.job.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (raceWinner) return raceWinner;
    }
    throw err;
  }
}

/**
 * Atomically claims up to `batchSize` due jobs for `workerId`. Uses
 * `FOR UPDATE SKIP LOCKED` so concurrent workers calling this never claim
 * overlapping job sets, without blocking on each other's in-flight claims.
 */
export async function claimJobs(workerId: string, batchSize: number): Promise<Job[]> {
  return db.$queryRaw<Job[]>(Prisma.sql`
    UPDATE "Job"
    SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, "updatedAt" = now()
    WHERE id IN (
      SELECT id FROM "Job"
      WHERE status = 'QUEUED' AND "scheduledAt" <= now()
      ORDER BY "scheduledAt"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
}

/** Marks a claimed job as successfully finished. */
export async function completeJob(jobId: string): Promise<Job> {
  return db.job.update({ where: { id: jobId }, data: { status: "SUCCEEDED" } });
}

/**
 * Records a failed attempt. Reschedules with exponential backoff while
 * attempts remain; otherwise marks the job permanently FAILED.
 */
export async function failJob(jobId: string, error: string): Promise<Job> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const attempts = job.attempts + 1;

  if (attempts < job.maxAttempts) {
    return db.job.update({
      where: { id: jobId },
      data: {
        status: "QUEUED",
        attempts,
        lastError: error,
        scheduledAt: new Date(Date.now() + computeBackoffDelayMs(attempts)),
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  return db.job.update({
    where: { id: jobId },
    data: { status: "FAILED", attempts, lastError: error },
  });
}
