import "dotenv/config";
import { randomUUID } from "node:crypto";
import { claimJobs, completeJob, failJob } from "@/domain/job/commands";
import {
  completeConstitutionDraft,
  getConstitutionForDrafting,
  revertConstitutionDraftFailure,
} from "@/domain/constitution/commands";
import { completeStageDraft, getStageForDrafting, revertStageDraftFailure } from "@/domain/pipeline/commands";
import { failAgentRun, resolveDefaultAgentId, resolveStageAgentId, startAgentRun } from "@/domain/agent/commands";
import { getAgentRunByJobId } from "@/domain/agent/queries";
import { getAgentExecutor } from "@/lib/agents";
import { completeSyncRun, failSyncRun, startSyncRun } from "@/domain/connector/commands";
import { getSyncRunByJobId } from "@/domain/connector/queries";
import { runConnectorSync } from "@/domain/connector/sync";
import {
  completeRepositoryDiscovery,
  getRepositoryDiscoveryForRun,
  revertRepositoryDiscoveryFailure,
} from "@/domain/repository-discovery/commands";
import { decryptIntegrationConfig } from "@/lib/integrations";
import { fetchRepositorySnapshot } from "@/lib/integrations/github";
import { extractModelFacts, fetchModelSnapshotSource } from "@/lib/integrations/modelKnowledgeSource";
import {
  ensureModelSnapshotJobScheduled,
  recordModelSnapshotAttempt,
  scheduleNextModelSnapshotFetch,
} from "@/domain/model-snapshot/commands";
import type { Job } from "@/generated/prisma/client";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);
const BATCH_SIZE = 5;
const workerId = `worker-${process.pid}-${randomUUID()}`;

type JobPayload = Record<string, unknown>;

interface JobTypeHandlers {
  run: (payload: JobPayload, jobId: string) => Promise<void>;
  /** Called only once the job's retries are exhausted (Job.status becomes FAILED), not on every attempt. */
  onExhausted?: (payload: JobPayload, error: string, jobId: string) => Promise<void>;
}

async function handleDraftStageJob(payload: JobPayload, jobId: string): Promise<void> {
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

  const agentId = await resolveStageAgentId(stage.pipeline.agentRouting, stage.type);
  const run = await startAgentRun(agentId, jobId);

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

  await completeStageDraft(stageId, result, run.id);
}

async function handleDraftStageExhausted(payload: JobPayload, error: string, jobId: string): Promise<void> {
  const stageId = payload.stageId as string;
  await revertStageDraftFailure(stageId, error, jobId);
}

async function handleDraftConstitutionJob(payload: JobPayload, jobId: string): Promise<void> {
  const constitutionId = payload.constitutionId as string;
  const constitution = await getConstitutionForDrafting(constitutionId);

  const agentId = await resolveDefaultAgentId();
  const run = await startAgentRun(agentId, jobId);

  const result = await getAgentExecutor().executeConstitution({
    projectName: constitution.project.name,
    projectKey: constitution.project.key,
  });
  await completeConstitutionDraft(constitutionId, result, run.id);
}

async function handleDraftConstitutionExhausted(payload: JobPayload, error: string, jobId: string): Promise<void> {
  const constitutionId = payload.constitutionId as string;
  await revertConstitutionDraftFailure(constitutionId, error, jobId);
}

async function handleSyncProjectJob(payload: JobPayload, jobId: string): Promise<void> {
  const connectorId = payload.connectorId as string;
  const run = await startSyncRun(connectorId, jobId);
  const counts = await runConnectorSync(connectorId);
  await completeSyncRun(run.id, counts);
}

async function handleSyncProjectExhausted(payload: JobPayload, error: string, jobId: string): Promise<void> {
  const run = await getSyncRunByJobId(jobId);
  if (run) await failSyncRun(run.id, error);
}

async function handleRunRepositoryDiscoveryJob(payload: JobPayload, jobId: string): Promise<void> {
  const discoveryId = payload.repositoryDiscoveryId as string;
  const discovery = await getRepositoryDiscoveryForRun(discoveryId);
  const { repository } = discovery;

  const config = decryptIntegrationConfig("GITHUB", repository.connector.config as Record<string, unknown> | null);
  const snapshot = await fetchRepositorySnapshot(config ?? null);

  const agentId = await resolveDefaultAgentId();
  const run = await startAgentRun(agentId, jobId);

  const result = await getAgentExecutor().executeRepositoryDiscovery({
    owner: repository.owner,
    repo: repository.name,
    rootListing: snapshot.rootListing,
    readme: snapshot.readme,
    manifests: snapshot.manifests,
  });

  await completeRepositoryDiscovery(discoveryId, result, run.id);
}

async function handleRunRepositoryDiscoveryExhausted(payload: JobPayload, error: string, jobId: string): Promise<void> {
  const discoveryId = payload.repositoryDiscoveryId as string;
  await revertRepositoryDiscoveryFailure(discoveryId, error, jobId);
}

// Slice 20 — a self-requeuing weekly job. Unlike every other job type, both its success path and
// its onExhausted path reschedule the next run (design.md Decision 4): a transient outage of the
// source page must not silently end the weekly cadence. A non-2xx/network fetch failure inside
// handleFetchModelSnapshotJob is left to throw, so the existing retry/backoff applies before
// onExhausted's own reschedule kicks in.
async function handleFetchModelSnapshotJob(): Promise<void> {
  const rawHtml = await fetchModelSnapshotSource();
  const extractedModels = extractModelFacts(rawHtml);

  await recordModelSnapshotAttempt(
    extractedModels.length > 0
      ? { status: "SUCCESS", rawContent: rawHtml, extractedModels }
      : {
          status: "FAILED",
          rawContent: rawHtml,
          failureReason: "No recognizable model/pricing/context-window facts found on the source page.",
        }
  );

  await scheduleNextModelSnapshotFetch();
}

async function handleFetchModelSnapshotExhausted(_payload: JobPayload, error: string): Promise<void> {
  await recordModelSnapshotAttempt({ status: "FAILED", rawContent: "", failureReason: error });
  await scheduleNextModelSnapshotFetch();
}

const handlers: Partial<Record<Job["type"], JobTypeHandlers>> = {
  DRAFT_STAGE: { run: handleDraftStageJob, onExhausted: handleDraftStageExhausted },
  DRAFT_CONSTITUTION: { run: handleDraftConstitutionJob, onExhausted: handleDraftConstitutionExhausted },
  SYNC_PROJECT: { run: handleSyncProjectJob, onExhausted: handleSyncProjectExhausted },
  RUN_REPOSITORY_DISCOVERY: { run: handleRunRepositoryDiscoveryJob, onExhausted: handleRunRepositoryDiscoveryExhausted },
  FETCH_MODEL_SNAPSHOT: { run: handleFetchModelSnapshotJob, onExhausted: handleFetchModelSnapshotExhausted },
};

async function processJob(job: Job): Promise<void> {
  const handlerSet = handlers[job.type];
  try {
    if (!handlerSet) throw new Error(`No handler registered for job type ${job.type}`);
    await handlerSet.run(job.payload as JobPayload, job.id);
    await completeJob(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker ${workerId}] job ${job.id} (${job.type}) failed: ${message}`);
    const failed = await failJob(job.id, message);

    // Not yet exhausted: sync the AgentRun's retryCount/lastError, but leave it RUNNING — the
    // same attempt-cycle continues on the next poll (design.md Decision 1). Final exhaustion is
    // handled inside onExhausted's own revertStageDraftFailure/revertConstitutionDraftFailure
    // transaction below, alongside reverting the stage/Constitution row.
    if (failed.status !== "FAILED") {
      const run = await getAgentRunByJobId(job.id);
      if (run) {
        await failAgentRun(run.id, { retryCount: failed.attempts, error: message, exhausted: false });
      }
    }

    if (failed.status === "FAILED" && handlerSet?.onExhausted) {
      await handlerSet.onExhausted(job.payload as JobPayload, message, job.id);
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
  // Slice 20 — self-healing bootstrap: guarantees the weekly snapshot cadence resumes after a
  // worker restart or in a fresh environment, without a one-time seed-script entry (design.md
  // Decision 3).
  await ensureModelSnapshotJobScheduled();

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
