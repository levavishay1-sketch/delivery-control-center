import "dotenv/config";
import { randomUUID } from "node:crypto";
import { claimJobs, completeJob, failJob } from "@/domain/job/commands";
import {
  completeConstitutionDraft,
  getConstitutionForDrafting,
  revertConstitutionDraftFailure,
} from "@/domain/constitution/commands";
import { getAgentExecutor } from "@/lib/agents";
import type { Job } from "@/generated/prisma/client";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);
const BATCH_SIZE = 5;
const workerId = `worker-${process.pid}-${randomUUID()}`;

type JobPayload = Record<string, unknown>;

interface JobTypeHandlers {
  run: (payload: JobPayload) => Promise<void>;
  /** Called only once the job's retries are exhausted (Job.status becomes FAILED), not on every attempt. */
  onExhausted?: (payload: JobPayload, error: string) => Promise<void>;
}

/**
 * DRAFT_STAGE's real handling (calling the AI executor, writing the
 * resulting StageVersion, advancing the pipeline) is wired up in Task
 * Group 5 once draftStage enqueues instead of running synchronously.
 * Nothing enqueues a DRAFT_STAGE job before then, so this placeholder is
 * never exercised until that wiring lands.
 */
async function handleDraftStageJob(_payload: JobPayload): Promise<void> {
  throw new Error("DRAFT_STAGE job handling is not wired up yet (see Task Group 5)");
}

async function handleDraftConstitutionJob(payload: JobPayload): Promise<void> {
  const constitutionId = payload.constitutionId as string;
  const constitution = await getConstitutionForDrafting(constitutionId);
  const result = await getAgentExecutor().executeConstitution({
    projectName: constitution.project.name,
    projectKey: constitution.project.key,
  });
  await completeConstitutionDraft(constitutionId, result);
}

async function handleDraftConstitutionExhausted(payload: JobPayload, error: string): Promise<void> {
  const constitutionId = payload.constitutionId as string;
  await revertConstitutionDraftFailure(constitutionId, error);
}

const handlers: Partial<Record<Job["type"], JobTypeHandlers>> = {
  DRAFT_STAGE: { run: handleDraftStageJob },
  DRAFT_CONSTITUTION: { run: handleDraftConstitutionJob, onExhausted: handleDraftConstitutionExhausted },
};

async function processJob(job: Job): Promise<void> {
  const handlerSet = handlers[job.type];
  try {
    if (!handlerSet) throw new Error(`No handler registered for job type ${job.type}`);
    await handlerSet.run(job.payload as JobPayload);
    await completeJob(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker ${workerId}] job ${job.id} (${job.type}) failed: ${message}`);
    const failed = await failJob(job.id, message);
    if (failed.status === "FAILED" && handlerSet?.onExhausted) {
      await handlerSet.onExhausted(job.payload as JobPayload, message);
    }
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
