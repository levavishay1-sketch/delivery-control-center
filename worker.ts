import "dotenv/config";
import { randomUUID } from "node:crypto";
import { claimJobs, completeJob, failJob } from "@/domain/job/commands";
import type { Job } from "@/generated/prisma/client";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);
const BATCH_SIZE = 5;
const workerId = `worker-${process.pid}-${randomUUID()}`;

type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

/**
 * DRAFT_STAGE is the only job type today; its real handling (calling the AI
 * executor, writing the resulting StageVersion, advancing the pipeline) is
 * wired up in Task Group 5 once draftStage enqueues instead of running
 * synchronously. Nothing enqueues a DRAFT_STAGE job before then, so this
 * placeholder is never exercised until that wiring lands.
 */
async function handleDraftStageJob(_payload: Record<string, unknown>): Promise<void> {
  throw new Error("DRAFT_STAGE job handling is not wired up yet (see Task Group 5)");
}

const handlers: Partial<Record<Job["type"], JobHandler>> = {
  DRAFT_STAGE: handleDraftStageJob,
};

async function processJob(job: Job): Promise<void> {
  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`No handler registered for job type ${job.type}`);
    await handler(job.payload as Record<string, unknown>);
    await completeJob(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker ${workerId}] job ${job.id} (${job.type}) failed: ${message}`);
    await failJob(job.id, message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});

async function pollLoop(): Promise<void> {
  console.log(`[worker ${workerId}] started, polling every ${POLL_INTERVAL_MS}ms`);
  while (running) {
    const jobs = await claimJobs(workerId, BATCH_SIZE);
    if (jobs.length > 0) {
      console.log(`[worker ${workerId}] claimed ${jobs.length} job(s)`);
      await Promise.all(jobs.map(processJob));
    } else {
      await sleep(POLL_INTERVAL_MS);
    }
  }
  console.log(`[worker ${workerId}] shutting down`);
}

pollLoop().catch((err) => {
  console.error(`[worker ${workerId}] fatal error`, err);
  process.exit(1);
});
