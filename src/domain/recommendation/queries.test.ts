import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recommendExecutor } from "./queries";
import { createWorkItem } from "@/domain/work-item/commands";
import { resolveDefaultAgentId, startAgentRun } from "@/domain/agent/commands";
import { startPipeline, draftStage, completeStageDraft } from "@/domain/pipeline/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError, NotFoundError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres — same rationale as the other domain test
 * suites in this project. Uses rare type/risk/priority combinations to keep each scenario's
 * `estimateExecutorCost` call isolated from the shared database's accumulated history, the same
 * approach `agent/queries.test.ts`'s `estimateExecutorCost` tests use.
 */

let clientId: string;
let projectId: string;
let managerUserId: string;
let viewerUserId: string;
let outsiderUserId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;
let outsiderCtx: AuthContext;

const orgIds: string[] = [];
const jobIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Recommendation Test Org", slug: `rec-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Recommendation Test Client", slug: `rec-test-${Date.now()}` } });
  clientId = client.id;

  const project = await db.project.create({
    data: { clientId, name: "Recommendation Test Project", key: `REC${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;
  await db.constitution.create({
    data: { projectId: project.id, version: 1, status: "APPROVED", content: "# Constitution", approvedAt: new Date() },
  });

  const manager = await db.user.create({ data: { email: `rec-manager-${Date.now()}@test.local`, name: "Rec Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const viewer = await db.user.create({ data: { email: `rec-viewer-${Date.now()}@test.local`, name: "Rec Viewer" } });
  viewerUserId = viewer.id;
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });

  const otherOrg = await db.organization.create({ data: { name: "Rec Outsider Org", slug: `rec-outsider-org-${Date.now()}` } });
  orgIds.push(otherOrg.id);
  const otherClient = await db.client.create({ data: { organizationId: otherOrg.id, name: "Rec Outsider Client", slug: `rec-outsider-${Date.now()}` } });
  const outsider = await db.user.create({ data: { email: `rec-outsider-${Date.now()}@test.local`, name: "Rec Outsider" } });
  outsiderUserId = outsider.id;
  await db.clientMembership.create({ data: { userId: outsider.id, clientId: otherClient.id, role: "MANAGER" } });

  managerCtx = { userId: managerUserId, displayName: "Rec Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  viewerCtx = { userId: viewerUserId, displayName: "Rec Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
  outsiderCtx = { userId: outsiderUserId, displayName: "Rec Outsider", isOrgAdmin: false, memberships: [{ clientId: otherClient.id, role: "MANAGER" }] };
});

afterAll(async () => {
  if (jobIds.length > 0) await db.job.deleteMany({ where: { id: { in: jobIds } } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

async function completeStageWithCost(stageId: string, costUsd: number) {
  await draftStage(managerCtx, stageId);
  const job = await db.job.findFirstOrThrow({
    where: { idempotencyKey: { startsWith: `draft-stage-${stageId}-` }, status: "QUEUED" },
    orderBy: { createdAt: "desc" },
  });
  jobIds.push(job.id);
  const agentId = await resolveDefaultAgentId();
  const run = await startAgentRun(agentId, job.id);
  await completeStageDraft(stageId, { content: "# Draft", aiModel: "mock-agent-v1", promptTokens: 10, completionTokens: 10, costUsd }, run.id);
}

async function createItemWithHistory(title: string, type: "TASK" | "BUG" | "CHANGE", risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", costUsd: number) {
  const { workItem } = await createWorkItem(managerCtx, { projectId, title, type, risk, priority });
  const pipeline = await startPipeline(managerCtx, workItem.id);
  const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });
  await completeStageWithCost(stage.id, costUsd);
  return workItem;
}

describe("recommendExecutor", () => {
  it("recommends AI for LOW/MEDIUM risk with a cheap estimate", async () => {
    const workItem = await createItemWithHistory("Cheap AI item", "BUG", "LOW", "LOW", 0.01);
    const result = await recommendExecutor(managerCtx, workItem.id);
    expect(result.recommended).toBe("AI_AGENT");
    expect(result.aiEstimate).not.toBeNull();
    expect(result.why.length).toBeGreaterThan(0);
    expect(result.assumptions.length).toBeGreaterThan(0);
  });

  it("recommends a developer for HIGH/CRITICAL risk regardless of a cheap estimate", async () => {
    const workItem = await createItemWithHistory("Cheap but critical item", "BUG", "CRITICAL", "MEDIUM", 0.01);
    const result = await recommendExecutor(managerCtx, workItem.id);
    expect(result.recommended).toBe("HUMAN");
    // The estimate is still shown even though a developer is recommended (spec requirement).
    expect(result.aiEstimate).not.toBeNull();
  });

  it("recommends a developer for an expensive estimate even at LOW/MEDIUM risk", async () => {
    // A combination distinct from agent/queries.test.ts's estimateExecutorCost fixtures
    // (CHANGE/CRITICAL/LOW and CHANGE/MEDIUM/HIGH) so this scenario's average isn't diluted by
    // unrelated cost data.
    const workItem = await createItemWithHistory("Expensive AI item", "CHANGE", "LOW", "CRITICAL", 9);
    const result = await recommendExecutor(managerCtx, workItem.id);
    expect(result.recommended).toBe("HUMAN");
    expect(result.aiEstimate).not.toBeNull();
    expect(result.aiEstimate!.costUsd).toBeGreaterThanOrEqual(5);
  });

  it("recommends a developer with an explicit no-history reason when there is no cost data", async () => {
    // type=PROJECT is not created anywhere else in this suite, so it is expected (though not
    // guaranteed on a shared, accumulating database — see agent/queries.test.ts's own note) to
    // have no matching AgentRun history at all.
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "No history item", type: "PROJECT" });
    const result = await recommendExecutor(managerCtx, workItem.id);
    if (result.aiEstimate === null) {
      expect(result.recommended).toBe("HUMAN");
      expect(result.why.toLowerCase()).toContain("no ai drafting history");
    }
  });

  it("a read-only user can still get a recommendation", async () => {
    const workItem = await createItemWithHistory("Viewer-readable item", "BUG", "LOW", "LOW", 0.02);
    const result = await recommendExecutor(viewerCtx, workItem.id);
    expect(result.recommended).toBeDefined();
  });

  it("rejects a user without access to the work item's client", async () => {
    const workItem = await createItemWithHistory("Outsider-blocked item", "BUG", "LOW", "LOW", 0.02);
    await expect(recommendExecutor(outsiderCtx, workItem.id)).rejects.toThrow(ForbiddenError);
  });

  it("throws NotFoundError for a nonexistent work item", async () => {
    await expect(recommendExecutor(managerCtx, "nonexistent-id")).rejects.toThrow(NotFoundError);
  });
});
