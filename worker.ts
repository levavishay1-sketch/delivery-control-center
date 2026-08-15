import "dotenv/config";
import { randomUUID } from "node:crypto";
import { claimJobs, completeJob, failJob } from "@/domain/job/commands";
import {
  completeConstitutionDraft,
  getConstitutionForDrafting,
  revertConstitutionDraftFailure,
} from "@/domain/constitution/commands";
import { completeStageDraft, getStageForDrafting, revertStageDraftFailure } from "@/domain/pipeline/commands";
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

async function handleDraftStageJob(payload: JobPayload): Promise<void> {
  const stageId = payload.stageId as string;
  const stage = await getStageForDrafting(stageId);

  const previousStage = stage.pipeline.stages
    .filter((s) => s.type !== stage.type)
    .find((s) => s.status === "DONE" || s.status === "APPROVED");

  const answeredClarifyQuestions = stage.clarifyQuestions
    .filter((q): q is typeof q & { answer: string } => q.answer !== null)
    .map((q) => ({ question: q.question, answer: q.answer }));

  // ANALYZE's cross-artifact consistency check needs every prior stage's content, not just the
  // one immediately before it (see design.md Decision 8 / Task Group 7).
  const priorStagesContent =
    stage.type === "ANALYZE"
      ? stage.pipeline.stages
          .filter((s) => s.type !== stage.type && (s.status === "DONE" || s.status === "APPROVED") && s.content)
          .map((s) => ({ type: s.type, content: s.content! }))
      : undefined;

  // A redraft after a human rejection should see why it was rejected, not guess again from
  // scratch — see Task Group 9. The most recent Approval row on this stage is only relevant
  // here if it was a REJECTED decision (an earlier APPROVED decision would mean this is a
  // flagged-stage redraft after the fact, not a rejection redraft).
  const latestApproval = stage.approvals[0];
  const rejectionComment =
    latestApproval?.decision === "REJECTED" && latestApproval.comment ? latestApproval.comment : undefined;

  const result = await getAgentExecutor().executeStage(stage.type, {
    workItemTitle: stage.pipeline.workItem.title,
    workItemDescription: stage.pipeline.workItem.description ?? "",
    workItemSource: stage.pipeline.workItem.source,
    workItemExternalId: stage.pipeline.workItem.externalId,
    previousStageContent: previousStage?.content ?? undefined,
    clarifyAnswers: answeredClarifyQuestions.length > 0 ? answeredClarifyQuestions : undefined,
    priorStagesContent,
    rejectionComment,
  });

  await completeStageDraft(stageId, result);
}

async function handleDraftStageExhausted(payload: JobPayload, error: string): Promise<void> {
  const stageId = payload.stageId as string;
  await revertStageDraftFailure(stageId, error);
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
  DRAFT_STAGE: { run: handleDraftStageJob, onExhausted: handleDraftStageExhausted },
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
