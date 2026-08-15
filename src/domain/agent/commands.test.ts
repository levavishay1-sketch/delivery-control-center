import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  completeAgentRun,
  failAgentRun,
  resolveDefaultAgentId,
  resolveStageAgentId,
  startAgentRun,
  syncAgentRegistry,
} from "./commands";
import { getAgentRunByJobId } from "./queries";
import { createWorkItem } from "@/domain/work-item/commands";
import { startPipeline, draftStage, getStageForDrafting, completeStageDraft, revertStageDraftFailure } from "@/domain/pipeline/commands";
import { enqueueJob } from "@/domain/job/commands";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres — same rationale as the
 * other domain test suites in this project.
 */

let clientId: string;
let managerCtx: AuthContext;

const orgIds: string[] = [];
const jobIds: string[] = [];

async function createProjectWithApprovedConstitution(name: string) {
  const project = await db.project.create({
    data: { clientId, name, key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}` },
  });
  await db.constitution.create({
    data: { projectId: project.id, version: 1, status: "APPROVED", content: "# Constitution", approvedAt: new Date() },
  });
  return project;
}

/** Enqueues a bare Job row directly, bypassing draftStage's transaction — used where a test just needs a jobId to attach an AgentRun to. */
async function makeJob() {
  const job = await enqueueJob("DRAFT_STAGE", { note: "agent-run-test" }, `agent-run-test-${Date.now()}-${Math.random()}`);
  jobIds.push(job.id);
  return job;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Agent Test Org", slug: `agent-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Agent Test Client", slug: "agent-test" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `agent-manager-${Date.now()}@test.local`, name: "Agent Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Agent Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
});

afterAll(async () => {
  if (jobIds.length > 0) {
    await db.job.deleteMany({ where: { id: { in: jobIds } } });
  }
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe("resolveDefaultAgentId / resolveStageAgentId", () => {
  it("resolveDefaultAgentId returns the registry's default Agent id", async () => {
    const agents = await syncAgentRegistry();
    const defaultAgent = agents.find((a) => a.isDefault)!;
    expect(await resolveDefaultAgentId()).toBe(defaultAgent.id);
  });

  it("resolveStageAgentId falls back to the default when the routing map has no entry for the stage type", async () => {
    const defaultId = await resolveDefaultAgentId();
    expect(await resolveStageAgentId({}, "SPEC")).toBe(defaultId);
    expect(await resolveStageAgentId(null, "SPEC")).toBe(defaultId);
  });

  it("resolveStageAgentId uses the routed id when it names a real Agent row", async () => {
    const agents = await syncAgentRegistry();
    const nonDefault = agents.find((a) => !a.isDefault) ?? agents[0];
    expect(await resolveStageAgentId({ SPEC: nonDefault.id }, "SPEC")).toBe(nonDefault.id);
  });
});

describe("startAgentRun / completeAgentRun / failAgentRun", () => {
  it("startAgentRun is idempotent per jobId: a second call reuses the same run row", async () => {
    const agentId = await resolveDefaultAgentId();
    const job = await makeJob();

    const first = await startAgentRun(agentId, job.id);
    const second = await startAgentRun(agentId, job.id);

    expect(second.id).toBe(first.id);
    expect(await db.agentRun.count({ where: { jobId: job.id } })).toBe(1);
  });

  it("completeAgentRun marks the run SUCCEEDED with token/cost totals", async () => {
    const agentId = await resolveDefaultAgentId();
    const job = await makeJob();
    const run = await startAgentRun(agentId, job.id);

    const completed = await completeAgentRun(run.id, { promptTokens: 12, completionTokens: 34, costUsd: 0.05 });
    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.promptTokens).toBe(12);
    expect(completed.completionTokens).toBe(34);
    expect(completed.completedAt).not.toBeNull();
  });

  it("failAgentRun's non-exhausted branch updates retryCount/lastError but keeps the run RUNNING", async () => {
    const agentId = await resolveDefaultAgentId();
    const job = await makeJob();
    const run = await startAgentRun(agentId, job.id);

    const retried = await failAgentRun(run.id, { retryCount: 1, error: "transient error", exhausted: false });
    expect(retried.status).toBe("RUNNING");
    expect(retried.retryCount).toBe(1);
    expect(retried.lastError).toBe("transient error");
    expect(retried.completedAt).toBeNull();
  });

  it("failAgentRun's exhausted branch sets FAILED and completedAt", async () => {
    const agentId = await resolveDefaultAgentId();
    const job = await makeJob();
    const run = await startAgentRun(agentId, job.id);

    const failed = await failAgentRun(run.id, { retryCount: 5, error: "permanent error", exhausted: true });
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toBe("permanent error");
    expect(failed.completedAt).not.toBeNull();
  });
});

describe("AgentRun recording through the drafting lifecycle", () => {
  it("a successful draft creates exactly one SUCCEEDED AgentRun linked from the Stage", async () => {
    const project = await createProjectWithApprovedConstitution("Run Recording Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Run recorded" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draftStage(managerCtx, stage.id);
    const job = await db.job.findFirstOrThrow({ where: { idempotencyKey: { startsWith: `draft-stage-${stage.id}-` } } });
    jobIds.push(job.id);

    const forDrafting = await getStageForDrafting(stage.id);
    const agentId = await resolveStageAgentId(forDrafting.pipeline.agentRouting, forDrafting.type);
    const run = await startAgentRun(agentId, job.id);

    const completed = await completeStageDraft(stage.id, {
      content: "# Draft",
      aiModel: "mock-agent-v1",
      promptTokens: 10,
      completionTokens: 20,
      costUsd: 0.001,
    }, run.id);

    expect(completed.agentRunId).toBe(run.id);
    const runRow = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(runRow.status).toBe("SUCCEEDED");
    expect(await db.agentRun.count({ where: { jobId: job.id } })).toBe(1);

    const version = await db.stageVersion.findFirstOrThrow({ where: { stageId: stage.id } });
    expect(version.agentRunId).toBe(run.id);
  });

  it("a redraft creates a second AgentRun, the first unchanged", async () => {
    const project = await createProjectWithApprovedConstitution("Redraft Run Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Redraft recorded" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draftStage(managerCtx, stage.id);
    const firstJob = await db.job.findFirstOrThrow({ where: { idempotencyKey: { startsWith: `draft-stage-${stage.id}-` } } });
    jobIds.push(firstJob.id);
    const agentId = await resolveDefaultAgentId();
    const firstRun = await startAgentRun(agentId, firstJob.id);
    await completeStageDraft(stage.id, {
      content: "# Draft v1",
      aiModel: "mock-agent-v1",
      promptTokens: 10,
      completionTokens: 20,
      costUsd: 0.001,
    }, firstRun.id);
    await db.approval.create({
      data: { stageId: stage.id, decision: "REJECTED", approverId: managerCtx.userId, approverName: managerCtx.displayName, comment: "redo" },
    });
    await db.stage.update({ where: { id: stage.id }, data: { status: "REJECTED" } });

    await draftStage(managerCtx, stage.id);
    const secondJob = await db.job.findFirstOrThrow({
      where: { idempotencyKey: { startsWith: `draft-stage-${stage.id}-` }, id: { not: firstJob.id } },
    });
    jobIds.push(secondJob.id);
    const secondRun = await startAgentRun(agentId, secondJob.id);
    const completed = await completeStageDraft(stage.id, {
      content: "# Draft v2",
      aiModel: "mock-agent-v1",
      promptTokens: 15,
      completionTokens: 25,
      costUsd: 0.002,
    }, secondRun.id);

    expect(secondRun.id).not.toBe(firstRun.id);
    expect(completed.agentRunId).toBe(secondRun.id);

    const firstRunReloaded = await db.agentRun.findUniqueOrThrow({ where: { id: firstRun.id } });
    expect(firstRunReloaded.status).toBe("SUCCEEDED");
    expect(firstRunReloaded.promptTokens).toBe(10);

    const runsForStage = await db.agentRun.count({ where: { id: { in: [firstRun.id, secondRun.id] } } });
    expect(runsForStage).toBe(2);
  });

  it("a retried-then-succeeded job's single AgentRun shows the correct retryCount", async () => {
    const project = await createProjectWithApprovedConstitution("Retry Run Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Retried then succeeded" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draftStage(managerCtx, stage.id);
    const job = await db.job.findFirstOrThrow({ where: { idempotencyKey: { startsWith: `draft-stage-${stage.id}-` } } });
    jobIds.push(job.id);
    const agentId = await resolveDefaultAgentId();

    // Simulate what worker.ts's processJob does on a retryable failure: startAgentRun is
    // idempotent, so re-invoking the handler on retry reuses the same run row.
    const attempt1 = await startAgentRun(agentId, job.id);
    await failAgentRun(attempt1.id, { retryCount: 1, error: "flaky", exhausted: false });
    const attempt2 = await startAgentRun(agentId, job.id);
    expect(attempt2.id).toBe(attempt1.id);

    const completed = await completeStageDraft(stage.id, {
      content: "# Draft after retry",
      aiModel: "mock-agent-v1",
      promptTokens: 10,
      completionTokens: 20,
      costUsd: 0.001,
    }, attempt2.id);

    expect(completed.agentRunId).toBe(attempt1.id);
    const runRow = await db.agentRun.findUniqueOrThrow({ where: { id: attempt1.id } });
    expect(runRow.status).toBe("SUCCEEDED");
    expect(runRow.retryCount).toBe(1);
    expect(await db.agentRun.count({ where: { jobId: job.id } })).toBe(1);
  });

  it("an exhausted job's AgentRun is FAILED with lastError set and the stage still reaches REJECTED", async () => {
    const project = await createProjectWithApprovedConstitution("Exhaustion Run Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Exhausted draft" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draftStage(managerCtx, stage.id);
    const job = await db.job.findFirstOrThrow({ where: { idempotencyKey: { startsWith: `draft-stage-${stage.id}-` } } });
    jobIds.push(job.id);
    const agentId = await resolveDefaultAgentId();
    const run = await startAgentRun(agentId, job.id);

    await revertStageDraftFailure(stage.id, "executor unavailable", job.id);

    const stageRow = await db.stage.findUniqueOrThrow({ where: { id: stage.id } });
    expect(stageRow.status).toBe("REJECTED");
    expect(stageRow.agentRunId).toBeNull();

    const runRow = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(runRow.status).toBe("FAILED");
    expect(runRow.lastError).toBe("executor unavailable");
    expect(runRow.completedAt).not.toBeNull();
  });
});

describe("getAgentRunByJobId", () => {
  it("returns null for a job with no run started yet, and the run once one has", async () => {
    const job = await makeJob();
    expect(await getAgentRunByJobId(job.id)).toBeNull();

    const agentId = await resolveDefaultAgentId();
    const run = await startAgentRun(agentId, job.id);
    expect((await getAgentRunByJobId(job.id))?.id).toBe(run.id);
  });
});
