import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { approveBudgetOverride, checkBudget, checkClientBudget, completeAgentRun, resolveDefaultAgentId, startAgentRun } from "./commands";
import { getAgentRunDetail, getAgentRunSummary, getClientAiCost, getOrganizationAiCost } from "./queries";
import { createWorkItem } from "@/domain/work-item/commands";
import { startPipeline, draftStage, completeStageDraft, rejectStage } from "@/domain/pipeline/commands";
import { createProject } from "@/domain/project/commands";
import { configureConnector, getOrCreateConnectorForProject } from "@/domain/connector/commands";
import { ConflictError, ForbiddenError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres — same rationale as the
 * other domain test suites in this project.
 */

let organizationId: string;
let clientId: string;
let managerCtx: AuthContext;
let orgAdminCtx: AuthContext;

const orgIds: string[] = [];
const jobIds: string[] = [];

async function createProjectWithApprovedConstitution(name: string, opts: { aiBudgetUsd?: number } = {}) {
  const project = await db.project.create({
    data: {
      clientId,
      name,
      key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`,
      aiBudgetUsd: opts.aiBudgetUsd,
    },
  });
  await db.constitution.create({
    data: { projectId: project.id, version: 1, status: "APPROVED", content: "# Constitution", approvedAt: new Date() },
  });
  return project;
}

/** Drafts and completes a stage with a given cost, bypassing the worker's poll loop (same pattern as other domain test suites). */
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

/** Slice 14 — a client-owned Repository, created the same way linking.test.ts's helper does. */
async function createRepositoryForClient(name: string) {
  const project = await createProject(managerCtx, {
    clientId,
    name,
    key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`,
  });
  await configureConnector(managerCtx, project.id, { type: "GITHUB", config: { owner: "acme", repo: name, token: "ghp_x" } });
  const connector = await getOrCreateConnectorForProject(project.id);
  return db.repository.create({ data: { connectorId: connector.id, clientId, owner: "acme", name, externalId: `${Date.now()}` } });
}

/** Slice 14 — a completed RepositoryDiscovery run with a given cost, bypassing the Job/worker path (same rationale as draftAndCompleteStage above). */
async function createCompletedDiscovery(repositoryId: string, costUsd: number) {
  const agentId = await resolveDefaultAgentId();
  const run = await db.agentRun.create({ data: { agentId, status: "RUNNING" } });
  await completeAgentRun(run.id, { promptTokens: 10, completionTokens: 10, costUsd });
  const discovery = await db.repositoryDiscovery.create({
    data: {
      repositoryId,
      version: 1,
      status: "SUCCEEDED",
      agentRunId: run.id,
      triggeredByUserId: managerCtx.userId,
      costUsd,
      completedAt: new Date(),
    },
  });
  return { discovery, run };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Budget Test Org", slug: `budget-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  organizationId = org.id;
  const client = await db.client.create({ data: { organizationId: org.id, name: "Budget Test Client", slug: "budget-test" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `budget-manager-${Date.now()}@test.local`, name: "Budget Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Budget Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };

  const orgAdmin = await db.user.create({ data: { email: `budget-org-admin-${Date.now()}@test.local`, name: "Budget Org Admin", isOrgAdmin: true } });
  orgAdminCtx = { userId: orgAdmin.id, displayName: "Budget Org Admin", isOrgAdmin: true, memberships: [] };
});

afterAll(async () => {
  if (jobIds.length > 0) {
    await db.job.deleteMany({ where: { id: { in: jobIds } } });
  }
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe("checkBudget", () => {
  it("allows drafting when neither the project nor the client has a budget configured", async () => {
    const project = await createProjectWithApprovedConstitution("Unbudgeted Project");
    const result = await checkBudget(clientId, project.id);
    expect(result.allowed).toBe(true);
    expect(result.scope).toBeNull();
  });

  it("blocks drafting once a project's accrued cost meets its budget, and no Job is created", async () => {
    const project = await createProjectWithApprovedConstitution("Tight Budget Project", { aiBudgetUsd: 0.01 });
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Over budget" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    const completed = await draftAndCompleteStage(stage.id, 0.01);
    await rejectStage(managerCtx, completed.id, "redo"); // back to a legitimately re-draftable status

    const jobCountBefore = await db.job.count();
    await expect(draftStage(managerCtx, stage.id)).rejects.toThrow(ConflictError);
    expect(await db.job.count()).toBe(jobCountBefore);
  });

  it("a project-level budget overrides its client's", async () => {
    await db.client.update({ where: { id: clientId }, data: { aiBudgetUsd: 1000 } });
    try {
      const project = await createProjectWithApprovedConstitution("Project Overrides Client", { aiBudgetUsd: 0.01 });
      const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Tightly capped" });
      const pipeline = await startPipeline(managerCtx, workItem.id);
      const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

      await draftAndCompleteStage(stage.id, 0.01);

      const result = await checkBudget(clientId, project.id);
      expect(result.scope).toBe("project");
      expect(result.allowed).toBe(false);
    } finally {
      await db.client.update({ where: { id: clientId }, data: { aiBudgetUsd: null } });
    }
  });

  it("falls through to the organization when neither project nor client has a budget configured", async () => {
    await db.organization.update({ where: { id: organizationId }, data: { aiBudgetUsd: 1000 } });
    try {
      const project = await createProjectWithApprovedConstitution("Org Fallback Project");
      const result = await checkBudget(clientId, project.id);
      expect(result.scope).toBe("organization");
      expect(result.allowed).toBe(true);
      expect(result.scopeId).toBe(organizationId);
    } finally {
      await db.organization.update({ where: { id: organizationId }, data: { aiBudgetUsd: null } });
    }
  });

  it("a client-level budget overrides the organization's", async () => {
    await db.organization.update({ where: { id: organizationId }, data: { aiBudgetUsd: 1000 } });
    await db.client.update({ where: { id: clientId }, data: { aiBudgetUsd: 500 } });
    try {
      const project = await createProjectWithApprovedConstitution("Client Overrides Org Project");
      const result = await checkBudget(clientId, project.id);
      expect(result.scope).toBe("client");
    } finally {
      await db.organization.update({ where: { id: organizationId }, data: { aiBudgetUsd: null } });
      await db.client.update({ where: { id: clientId }, data: { aiBudgetUsd: null } });
    }
  });

  it("blocks drafting once the organization's accrued cost meets its budget", async () => {
    // Earlier tests in this file already drafted under this same organization, so its
    // accrued cost is already > 0 — a tiny threshold is already exceeded without drafting
    // anything new here (organization-level accrual is org-wide, unlike the project-scoped
    // tests above which each start from a fresh project).
    await db.organization.update({ where: { id: organizationId }, data: { aiBudgetUsd: 0.000001 } });
    try {
      const project = await createProjectWithApprovedConstitution("Org Budget Exceeded Project");
      const result = await checkBudget(clientId, project.id);
      expect(result.scope).toBe("organization");
      expect(result.allowed).toBe(false);
    } finally {
      await db.organization.update({ where: { id: organizationId }, data: { aiBudgetUsd: null } });
    }
  });
});

describe("checkClientBudget (Slice 14)", () => {
  it("allows a Discovery run when neither the client nor the organization has a budget configured", async () => {
    const repository = await createRepositoryForClient("checkclientbudget-unset");
    const result = await checkClientBudget(repository.clientId);
    expect(result.allowed).toBe(true);
    expect(result.scope).toBeNull();
  });

  it("blocks a Discovery run once the client's accrued cost meets its budget", async () => {
    await db.client.update({ where: { id: clientId }, data: { aiBudgetUsd: 0.01 } });
    try {
      const repository = await createRepositoryForClient("checkclientbudget-tight");
      await createCompletedDiscovery(repository.id, 0.01);
      const result = await checkClientBudget(clientId);
      expect(result.scope).toBe("client");
      expect(result.allowed).toBe(false);
    } finally {
      await db.client.update({ where: { id: clientId }, data: { aiBudgetUsd: null } });
    }
  });

  it("falls through to the organization when the client has no budget configured", async () => {
    await db.organization.update({ where: { id: organizationId }, data: { aiBudgetUsd: 1000 } });
    try {
      const result = await checkClientBudget(clientId);
      expect(result.scope).toBe("organization");
      expect(result.allowed).toBe(true);
      expect(result.scopeId).toBe(organizationId);
    } finally {
      await db.organization.update({ where: { id: organizationId }, data: { aiBudgetUsd: null } });
    }
  });
});

describe("getClientAiCost / getOrganizationAiCost include Discovery runs (Slice 14)", () => {
  it("a client's AI cost total includes a completed Discovery run for one of its repositories", async () => {
    const before = await getClientAiCost(clientId);
    const repository = await createRepositoryForClient("clientaicost-discovery");
    await createCompletedDiscovery(repository.id, 0.5);
    const after = await getClientAiCost(clientId);
    expect(after.minus(before).toNumber()).toBeCloseTo(0.5, 4);
  });

  it("an organization's AI cost total includes a completed Discovery run under one of its clients", async () => {
    const before = await getOrganizationAiCost(organizationId);
    const repository = await createRepositoryForClient("orgaicost-discovery");
    await createCompletedDiscovery(repository.id, 0.25);
    const after = await getOrganizationAiCost(organizationId);
    expect(after.minus(before).toNumber()).toBeCloseTo(0.25, 4);
  });
});

describe("Discovery AgentRun visibility resolves through its repository's client (Slice 14)", () => {
  it("getAgentRunSummary resolves and authorizes a Discovery run via the repository's client", async () => {
    const repository = await createRepositoryForClient("agentrunvisibility-discovery");
    const { run } = await createCompletedDiscovery(repository.id, 0.1);
    const summary = await getAgentRunSummary(managerCtx, run.id);
    expect(summary?.id).toBe(run.id);
  });

  it("getAgentRunDetail resolves and authorizes a Discovery run via the repository's client", async () => {
    const repository = await createRepositoryForClient("agentrundetail-discovery");
    const { run } = await createCompletedDiscovery(repository.id, 0.1);
    const detail = await getAgentRunDetail(managerCtx, run.id);
    expect(detail?.id).toBe(run.id);
  });
});

describe("approveBudgetOverride at organization scope", () => {
  it("requires org-admin, not just a client WRITE_ROLES membership", async () => {
    await expect(approveBudgetOverride(managerCtx, { organizationId })).rejects.toThrow(ForbiddenError);
  });

  it("an org admin can approve an organization-scope override", async () => {
    const override = await approveBudgetOverride(orgAdminCtx, { organizationId });
    expect(override.organizationId).toBe(organizationId);
    expect(override.consumed).toBe(false);
  });

  it("requires exactly one of organizationId/clientId/projectId", async () => {
    const project = await createProjectWithApprovedConstitution("Org Scope Both Set Project");
    await expect(approveBudgetOverride(orgAdminCtx, { organizationId, projectId: project.id })).rejects.toThrow();
  });
});

describe("approveBudgetOverride", () => {
  it("allows exactly one subsequent draft to proceed, then is consumed", async () => {
    const project = await createProjectWithApprovedConstitution("Override Project", { aiBudgetUsd: 0.01 });
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Overridden" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    const first = await draftAndCompleteStage(stage.id, 0.01);
    await rejectStage(managerCtx, first.id, "redo");
    await expect(draftStage(managerCtx, stage.id)).rejects.toThrow(ConflictError);

    const override = await approveBudgetOverride(managerCtx, { projectId: project.id });
    expect(override.consumed).toBe(false);

    // The override lets this one draft through.
    const second = await draftAndCompleteStage(stage.id, 0);

    const overrideRow = await db.budgetOverride.findUniqueOrThrow({ where: { id: override.id } });
    expect(overrideRow.consumed).toBe(true);

    // A second draft past budget after that needs its own new override.
    await rejectStage(managerCtx, second.id, "redo again");
    await expect(draftStage(managerCtx, stage.id)).rejects.toThrow(ConflictError);
  });

  it("concurrent requests against a single override never both consume it", async () => {
    const project = await createProjectWithApprovedConstitution("Override Race Project", { aiBudgetUsd: 0.01 });
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Raced" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draftAndCompleteStage(stage.id, 0.01);
    await approveBudgetOverride(managerCtx, { projectId: project.id });

    const results = await Promise.all([
      checkBudget(clientId, project.id),
      checkBudget(clientId, project.id),
    ]);
    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(1);

    const consumedCount = await db.budgetOverride.count({ where: { projectId: project.id, consumed: true } });
    expect(consumedCount).toBe(1);
  });

  it("requires exactly one of clientId/projectId", async () => {
    await expect(approveBudgetOverride(managerCtx, {})).rejects.toThrow();
    const project = await createProjectWithApprovedConstitution("Both Set Project");
    await expect(approveBudgetOverride(managerCtx, { clientId, projectId: project.id })).rejects.toThrow();
  });
});
