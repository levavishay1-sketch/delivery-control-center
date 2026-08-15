import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getAgentRunDetail, getAgentRunSummary } from "./queries";
import { resolveDefaultAgentId, startAgentRun } from "./commands";
import { createWorkItem } from "@/domain/work-item/commands";
import { startPipeline, draftStage, completeStageDraft } from "@/domain/pipeline/commands";
import { ForbiddenError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres — same rationale as the
 * other domain test suites in this project.
 */

let clientId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;
let outsiderCtx: AuthContext;

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

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Visibility Test Org", slug: `visibility-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Visibility Test Client", slug: "visibility-test" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `visibility-manager-${Date.now()}@test.local`, name: "Visibility Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Visibility Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };

  const viewer = await db.user.create({ data: { email: `visibility-viewer-${Date.now()}@test.local`, name: "Visibility Viewer" } });
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });
  viewerCtx = { userId: viewer.id, displayName: "Visibility Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };

  const outsider = await db.user.create({ data: { email: `visibility-outsider-${Date.now()}@test.local`, name: "Outsider" } });
  outsiderCtx = { userId: outsider.id, displayName: "Outsider", isOrgAdmin: false, memberships: [] };
});

afterAll(async () => {
  if (jobIds.length > 0) {
    await db.job.deleteMany({ where: { id: { in: jobIds } } });
  }
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe("getAgentRunDetail / getAgentRunSummary", () => {
  it("returns full detail (incl. lastError/toolCalls) for a write-capable role", async () => {
    const project = await createProjectWithApprovedConstitution("Detail Visibility Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Visible run" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draftStage(managerCtx, stage.id);
    const job = await db.job.findFirstOrThrow({ where: { idempotencyKey: { startsWith: `draft-stage-${stage.id}-` } } });
    jobIds.push(job.id);
    const agentId = await resolveDefaultAgentId();
    const run = await startAgentRun(agentId, job.id);
    await completeStageDraft(
      stage.id,
      { content: "# Draft", aiModel: "mock-agent-v1", promptTokens: 10, completionTokens: 20, costUsd: 0.01 },
      run.id
    );

    const detail = await getAgentRunDetail(managerCtx, run.id);
    expect(detail).not.toBeNull();
    expect(detail!.status).toBe("SUCCEEDED");
    expect(detail!.promptTokens).toBe(10);
    expect("lastError" in detail!).toBe(true);
    expect("toolCalls" in detail!).toBe(true);
  });

  it("refuses getAgentRunDetail for a read-only role (ForbiddenError)", async () => {
    const project = await createProjectWithApprovedConstitution("Detail Refusal Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Refused run" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draftStage(managerCtx, stage.id);
    const job = await db.job.findFirstOrThrow({ where: { idempotencyKey: { startsWith: `draft-stage-${stage.id}-` } } });
    jobIds.push(job.id);
    const agentId = await resolveDefaultAgentId();
    const run = await startAgentRun(agentId, job.id);
    await completeStageDraft(
      stage.id,
      { content: "# Draft", aiModel: "mock-agent-v1", promptTokens: 10, completionTokens: 20, costUsd: 0.01 },
      run.id
    );

    await expect(getAgentRunDetail(viewerCtx, run.id)).rejects.toThrow(ForbiddenError);
    await expect(getAgentRunDetail(outsiderCtx, run.id)).rejects.toThrow(ForbiddenError);
  });

  it("the same read-only role's getAgentRunSummary succeeds and omits lastError/toolCalls", async () => {
    const project = await createProjectWithApprovedConstitution("Summary Visibility Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Summary run" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draftStage(managerCtx, stage.id);
    const job = await db.job.findFirstOrThrow({ where: { idempotencyKey: { startsWith: `draft-stage-${stage.id}-` } } });
    jobIds.push(job.id);
    const agentId = await resolveDefaultAgentId();
    const run = await startAgentRun(agentId, job.id);
    await completeStageDraft(
      stage.id,
      { content: "# Draft", aiModel: "mock-agent-v1", promptTokens: 10, completionTokens: 20, costUsd: 0.01 },
      run.id
    );

    const summary = await getAgentRunSummary(viewerCtx, run.id);
    expect(summary).not.toBeNull();
    expect(summary!.status).toBe("SUCCEEDED");
    expect(summary!.costUsd?.toString()).toBe("0.01");
    expect("lastError" in summary!).toBe(false);
    expect("toolCalls" in summary!).toBe(false);

    await expect(getAgentRunSummary(outsiderCtx, run.id)).rejects.toThrow(ForbiddenError);
  });

  it("both return null for a run id that doesn't exist", async () => {
    expect(await getAgentRunDetail(managerCtx, "does-not-exist")).toBeNull();
    expect(await getAgentRunSummary(managerCtx, "does-not-exist")).toBeNull();
  });

  it("resolves ownership (and gates access) for a still-RUNNING run with no completed Stage/Constitution link yet", async () => {
    const project = await createProjectWithApprovedConstitution("In-Flight Visibility Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "In-flight run" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draftStage(managerCtx, stage.id);
    const job = await db.job.findFirstOrThrow({ where: { idempotencyKey: { startsWith: `draft-stage-${stage.id}-` } } });
    jobIds.push(job.id);
    const agentId = await resolveDefaultAgentId();
    const run = await startAgentRun(agentId, job.id);

    const detail = await getAgentRunDetail(managerCtx, run.id);
    expect(detail!.status).toBe("RUNNING");
    await expect(getAgentRunDetail(viewerCtx, run.id)).rejects.toThrow(ForbiddenError);
  });
});
