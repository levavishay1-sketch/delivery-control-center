import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getClientAiCost, getProjectAiCost, getWorkItemAiCost } from "./queries";
import { resolveDefaultAgentId, startAgentRun } from "./commands";
import { createWorkItem } from "@/domain/work-item/commands";
import { startPipeline, draftStage, completeStageDraft, rejectStage } from "@/domain/pipeline/commands";
import { draftConstitution, completeConstitutionDraft } from "@/domain/constitution/commands";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres — same rationale as the
 * other domain test suites in this project.
 */

let clientId: string;
let managerCtx: AuthContext;

const orgIds: string[] = [];
const jobIds: string[] = [];

async function createProject(name: string) {
  return db.project.create({
    data: { clientId, name, key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}` },
  });
}

async function draftAndCompleteStage(stageId: string, costUsd: number) {
  await draftStage(managerCtx, stageId);
  const job = await db.job.findFirstOrThrow({
    where: { idempotencyKey: { startsWith: `draft-stage-${stageId}-` }, status: "QUEUED" },
    orderBy: { createdAt: "desc" },
  });
  jobIds.push(job.id);
  const agentId = await resolveDefaultAgentId();
  const run = await startAgentRun(agentId, job.id);
  return completeStageDraft(
    stageId,
    { content: "# Draft", aiModel: "mock-agent-v1", promptTokens: 10, completionTokens: 10, costUsd },
    run.id
  );
}

async function draftAndCompleteConstitution(projectId: string, costUsd: number) {
  const constitution = await draftConstitution(managerCtx, projectId);
  const job = await db.job.findFirstOrThrow({
    where: { idempotencyKey: { startsWith: `constitution-${constitution.id}-` }, status: "QUEUED" },
    orderBy: { createdAt: "desc" },
  });
  jobIds.push(job.id);
  const agentId = await resolveDefaultAgentId();
  const run = await startAgentRun(agentId, job.id);
  return completeConstitutionDraft(
    constitution.id,
    { content: "# Constitution", aiModel: "mock-agent-v1", promptTokens: 10, completionTokens: 10, costUsd },
    run.id
  );
}

async function createProjectWithApprovedConstitution(name: string) {
  const project = await createProject(name);
  await db.constitution.create({
    data: { projectId: project.id, version: 1, status: "APPROVED", content: "# Constitution", approvedAt: new Date() },
  });
  return project;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Cost Rollup Org", slug: `cost-rollup-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Cost Rollup Client", slug: "cost-rollup" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `cost-rollup-manager-${Date.now()}@test.local`, name: "Cost Rollup Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Cost Rollup Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
});

afterAll(async () => {
  if (jobIds.length > 0) {
    await db.job.deleteMany({ where: { id: { in: jobIds } } });
  }
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe("getWorkItemAiCost", () => {
  it("returns zero for a work item with no drafts yet", async () => {
    const project = await createProjectWithApprovedConstitution("No Drafts Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Undrafted" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    void pipeline;

    expect((await getWorkItemAiCost(workItem.id)).toString()).toBe("0");
  });

  it("sums every draft/redraft's AgentRun.costUsd for the work item's pipeline", async () => {
    const project = await createProjectWithApprovedConstitution("Summed Drafts Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Costed" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    const first = await draftAndCompleteStage(stage.id, 0.5);
    await rejectStage(managerCtx, first.id, "redo");
    await draftAndCompleteStage(stage.id, 0.25);

    expect((await getWorkItemAiCost(workItem.id)).toString()).toBe("0.75");

    const runsSum = await db.agentRun.aggregate({
      where: { stageVersions: { some: { stage: { pipelineId: pipeline.id } } } },
      _sum: { costUsd: true },
    });
    expect((await getWorkItemAiCost(workItem.id)).toString()).toBe((runsSum._sum.costUsd ?? 0).toString());
  });
});

describe("getProjectAiCost", () => {
  it("sums stage drafts across every work item plus every Constitution version drafted for the project", async () => {
    const project = await createProjectWithApprovedConstitution("Project Rollup Project");
    const { workItem: wi1 } = await createWorkItem(managerCtx, { projectId: project.id, title: "WI1" });
    const { workItem: wi2 } = await createWorkItem(managerCtx, { projectId: project.id, title: "WI2" });
    const pipeline1 = await startPipeline(managerCtx, wi1.id);
    const pipeline2 = await startPipeline(managerCtx, wi2.id);
    const stage1 = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline1.id } });
    const stage2 = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline2.id } });

    await draftAndCompleteStage(stage1.id, 0.1);
    await draftAndCompleteStage(stage2.id, 0.2);

    // The project's Constitution is already APPROVED v1 (created with no aiModel/agentRunId by
    // the test helper); draft a v2 to add a real Constitution-attributed cost.
    await db.constitution.update({ where: { projectId_version: { projectId: project.id, version: 1 } }, data: { status: "REJECTED" } });
    await draftAndCompleteConstitution(project.id, 0.3);

    expect((await getProjectAiCost(project.id)).toString()).toBe("0.6");
  });

  it("returns zero for a project with no drafts yet", async () => {
    const project = await createProject("Empty Project Rollup");
    expect((await getProjectAiCost(project.id)).toString()).toBe("0");
  });
});

describe("getClientAiCost", () => {
  it("sums across every project under the client", async () => {
    const projectA = await createProjectWithApprovedConstitution("Client Rollup A");
    const projectB = await createProjectWithApprovedConstitution("Client Rollup B");
    const { workItem: wiA } = await createWorkItem(managerCtx, { projectId: projectA.id, title: "A item" });
    const { workItem: wiB } = await createWorkItem(managerCtx, { projectId: projectB.id, title: "B item" });
    const pipelineA = await startPipeline(managerCtx, wiA.id);
    const pipelineB = await startPipeline(managerCtx, wiB.id);
    const stageA = await db.stage.findFirstOrThrow({ where: { pipelineId: pipelineA.id } });
    const stageB = await db.stage.findFirstOrThrow({ where: { pipelineId: pipelineB.id } });

    const before = await getClientAiCost(clientId);
    await draftAndCompleteStage(stageA.id, 1);
    await draftAndCompleteStage(stageB.id, 2);
    const after = await getClientAiCost(clientId);

    expect(after.minus(before).toString()).toBe("3");
  });
});
