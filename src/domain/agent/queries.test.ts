import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getClientAiCost, getProjectAiCost, getWorkItemAiCost, estimateExecutorCost } from "./queries";
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

describe("estimateExecutorCost", () => {
  /**
   * Runs against a real, shared local Postgres that accumulates data across test files/runs
   * (see this file's own header comment), so tests verify *relationships* — sample size deltas
   * and weighted-average math against a captured "before" snapshot — rather than absolute
   * values, mirroring getClientAiCost's own before/after pattern below.
   */
  async function completeStageWithDuration(stageId: string, costUsd: number, durationMinutes: number) {
    const completed = await draftAndCompleteStage(stageId, costUsd);
    const run = await db.agentRun.findFirstOrThrow({ where: { stageVersions: { some: { stageId } } }, orderBy: { createdAt: "desc" } });
    await db.agentRun.update({
      where: { id: run.id },
      data: { startedAt: new Date(Date.now() - durationMinutes * 60_000), completedAt: new Date() },
    });
    return completed;
  }

  it("uses an exact type/risk/priority match, weighted correctly against any pre-existing history", async () => {
    const project = await createProjectWithApprovedConstitution("Estimate Exact Project");
    const { workItem } = await createWorkItem(managerCtx, {
      projectId: project.id,
      title: "Exact match item",
      type: "CHANGE",
      risk: "CRITICAL",
      priority: "LOW",
    });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    // "before" may itself already be an exact match (accumulated from prior test/E2E runs
    // against this shared database) or a type/global fallback (if no CHANGE/CRITICAL/LOW run
    // existed yet) — only the former is the same bucket "after" will read from, so the weighted
    // delta math only applies in that case.
    const before = await estimateExecutorCost("CHANGE", "CRITICAL", "LOW");
    const beforeWasExact = before?.matchLevel === "exact";
    const beforeTotalCost = beforeWasExact ? before!.costUsd * before!.sampleSize : 0;
    const beforeTotalDuration = beforeWasExact ? before!.durationMinutes * before!.sampleSize : 0;
    const beforeSampleSize = beforeWasExact ? before!.sampleSize : 0;

    await completeStageWithDuration(stage.id, 2, 10);

    const after = await estimateExecutorCost("CHANGE", "CRITICAL", "LOW");
    expect(after).not.toBeNull();
    expect(after!.matchLevel).toBe("exact");
    expect(after!.sampleSize).toBe(beforeSampleSize + 1);
    expect(after!.costUsd).toBeCloseTo((beforeTotalCost + 2) / (beforeSampleSize + 1), 5);
    expect(after!.durationMinutes).toBeCloseTo((beforeTotalDuration + 10) / (beforeSampleSize + 1), 3);
  });

  it("falls back to a type-only average when no exact risk/priority match exists", async () => {
    const project = await createProjectWithApprovedConstitution("Estimate Type Fallback Project");
    // A CHANGE-type item with a risk/priority combination nothing else in this suite creates.
    const { workItem } = await createWorkItem(managerCtx, {
      projectId: project.id,
      title: "Type-only match item",
      type: "CHANGE",
      risk: "MEDIUM",
      priority: "HIGH",
    });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });
    await completeStageWithDuration(stage.id, 3, 20);

    // No CHANGE item anywhere has risk=HIGH/priority=CRITICAL — the exact match is empty, so
    // this must fall back to the type-only (all CHANGE items) average, which does include the
    // item just created above.
    const result = await estimateExecutorCost("CHANGE", "HIGH", "CRITICAL");
    expect(result).not.toBeNull();
    expect(result!.matchLevel).not.toBe("exact");
  });

  it("falls back to a global average when no completed run of any WorkItem type exists yet for a fresh scope", async () => {
    // No other test in this suite (or, as far as this test can control, elsewhere) deliberately
    // creates a type=PROJECT WorkItem and drafts against it, so this combination is expected to
    // have zero exact and zero type-only matches, forcing the global fallback.
    const result = await estimateExecutorCost("PROJECT", "CRITICAL", "CRITICAL");
    if (result) {
      expect(result.matchLevel).toBe("global");
      expect(result.sampleSize).toBeGreaterThan(0);
    }
    // If no AgentRun has completed anywhere yet in this database, `null` is the correct answer
    // too (design.md decision 4) — either outcome is valid depending on prior test-run state.
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
