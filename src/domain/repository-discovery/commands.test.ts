import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  completeRepositoryDiscovery,
  getRepositoryDiscoveryForRun,
  revertRepositoryDiscoveryFailure,
  runRepositoryDiscovery,
} from "./commands";
import { getRepositoryContext, listRepositoryDiscoveries } from "./queries";
import { resolveDefaultAgentId, startAgentRun } from "@/domain/agent/commands";
import { createProject } from "@/domain/project/commands";
import { configureConnector, getOrCreateConnectorForProject } from "@/domain/connector/commands";
import type { AuthContext } from "@/domain/shared/context";
import { BudgetExceededError, ForbiddenError } from "@/domain/shared/errors";
import type { RepositoryDiscoveryFindings } from "@/lib/agents/types";

/**
 * Integration tests against a real local Postgres — same rationale as constitution/commands.test.ts,
 * which this suite mirrors: exercises the whole trigger(job enqueue)->worker-completion/failure
 * lifecycle, calling the worker-side functions directly rather than running the poll loop.
 */

let clientId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;
const orgIds: string[] = [];
const jobIds: string[] = [];

const SAMPLE_FINDINGS: RepositoryDiscoveryFindings = {
  purpose: { summary: "A widget factory.", evidence: ["README.md"] },
  stack: { summary: "Node.js.", evidence: ["package.json"] },
  structure: { summary: "Root contains: README.md, package.json, src.", evidence: ["."] },
  modules: { summary: "Not determinable from the root-level snapshot.", evidence: [] },
  apis: { summary: "Not determinable from the root-level snapshot.", evidence: [] },
  dataStores: { summary: "Not determinable from the root-level snapshot.", evidence: [] },
  testing: { summary: "Not determinable from the root-level snapshot.", evidence: [] },
  conventions: { summary: "Not determinable from the root-level snapshot.", evidence: [] },
  unknowns: ["modules", "apis", "dataStores", "testing", "conventions"],
};

async function createRepository(name: string) {
  const project = await createProject(managerCtx, {
    clientId,
    name,
    key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`,
  });
  await configureConnector(managerCtx, project.id, { type: "GITHUB", config: { owner: "acme", repo: name, token: "ghp_x" } });
  const connector = await getOrCreateConnectorForProject(project.id);
  return db.repository.create({ data: { connectorId: connector.id, clientId, owner: "acme", name, externalId: `${Date.now()}` } });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Repository Discovery Test Org", slug: `repo-discovery-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Repository Discovery Test Client", slug: "repo-discovery" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `repo-discovery-manager-${Date.now()}@test.local`, name: "Discovery Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Discovery Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };

  const viewer = await db.user.create({ data: { email: `repo-discovery-viewer-${Date.now()}@test.local`, name: "Discovery Viewer" } });
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });
  viewerCtx = { userId: viewer.id, displayName: "Discovery Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
});

afterAll(async () => {
  if (jobIds.length > 0) {
    await db.job.deleteMany({ where: { OR: jobIds.map((id) => ({ id })) } });
  }
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

/** Simulates what worker.ts's RUN_REPOSITORY_DISCOVERY handler does, without running the poll loop. */
async function runDiscoveryJob(discoveryId: string) {
  const loaded = await getRepositoryDiscoveryForRun(discoveryId);
  expect(loaded.repository).not.toBeNull();
  const agentId = await resolveDefaultAgentId();
  const job = await db.job.findFirstOrThrow({ where: { idempotencyKey: `repository-discovery-${discoveryId}` } });
  jobIds.push(job.id);
  const run = await startAgentRun(agentId, job.id);
  return completeRepositoryDiscovery(
    discoveryId,
    { findings: SAMPLE_FINDINGS, aiModel: "mock-agent-v1", promptTokens: 10, completionTokens: 20, costUsd: 0.001 },
    run.id
  );
}

describe("runRepositoryDiscovery", () => {
  it("creates version 1, enqueues a job, and audits the start", async () => {
    const repository = await createRepository("discovery-trigger-v1");
    const discovery = await runRepositoryDiscovery(managerCtx, repository.id);
    expect(discovery.version).toBe(1);
    expect(discovery.status).toBe("RUNNING");

    const job = await db.job.findFirst({ where: { idempotencyKey: `repository-discovery-${discovery.id}` } });
    expect(job).not.toBeNull();
    expect(job!.type).toBe("RUN_REPOSITORY_DISCOVERY");
    jobIds.push(job!.id);

    const auditEvent = await db.auditEvent.findFirst({ where: { action: { contains: `Discovery v1 for acme/discovery-trigger-v1` } } });
    expect(auditEvent).not.toBeNull();
  });

  it("refuses a read-only user", async () => {
    const repository = await createRepository("discovery-trigger-forbidden");
    await expect(runRepositoryDiscovery(viewerCtx, repository.id)).rejects.toThrow(ForbiddenError);
  });

  it("a second trigger creates version 2, not overwriting version 1", async () => {
    const repository = await createRepository("discovery-trigger-v2");
    const first = await runRepositoryDiscovery(managerCtx, repository.id);
    await runDiscoveryJob(first.id);

    const second = await runRepositoryDiscovery(managerCtx, repository.id);
    expect(second.version).toBe(2);

    const versions = await db.repositoryDiscovery.findMany({ where: { repositoryId: repository.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0].status).toBe("SUCCEEDED"); // unchanged by the second trigger
  });

  it("refuses to trigger once the client's AI budget is exceeded", async () => {
    const repository = await createRepository("discovery-trigger-budget");
    const first = await runRepositoryDiscovery(managerCtx, repository.id);
    await runDiscoveryJob(first.id); // accrues 0.001 in client AI cost

    await db.client.update({ where: { id: clientId }, data: { aiBudgetUsd: 0.001 } });
    try {
      await expect(runRepositoryDiscovery(managerCtx, repository.id)).rejects.toThrow(BudgetExceededError);
      const count = await db.repositoryDiscovery.count({ where: { repositoryId: repository.id } });
      expect(count).toBe(1); // only the first, completed run — the refused trigger created no row
    } finally {
      await db.client.update({ where: { id: clientId }, data: { aiBudgetUsd: null } });
    }
  });
});

describe("completeRepositoryDiscovery / revertRepositoryDiscoveryFailure", () => {
  it("completing writes findings, marks SUCCEEDED, and audits completion", async () => {
    const repository = await createRepository("discovery-complete");
    const discovery = await runRepositoryDiscovery(managerCtx, repository.id);
    const completed = await runDiscoveryJob(discovery.id);

    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.findings).toEqual(SAMPLE_FINDINGS);
    expect(completed.completedAt).not.toBeNull();

    const auditEvent = await db.auditEvent.findFirst({ where: { action: { contains: "AI completed Discovery v1" } } });
    expect(auditEvent).not.toBeNull();
  });

  it("reverting on exhausted failure marks FAILED with the error, and audits it", async () => {
    const repository = await createRepository("discovery-fail");
    const discovery = await runRepositoryDiscovery(managerCtx, repository.id);
    const job = await db.job.findFirstOrThrow({ where: { idempotencyKey: `repository-discovery-${discovery.id}` } });
    jobIds.push(job.id);
    const agentId = await resolveDefaultAgentId();
    await startAgentRun(agentId, job.id);

    await revertRepositoryDiscoveryFailure(discovery.id, "GitHub request failed: 500", job.id);

    const failed = await db.repositoryDiscovery.findUniqueOrThrow({ where: { id: discovery.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toBe("GitHub request failed: 500");

    const auditEvent = await db.auditEvent.findFirst({ where: { action: { contains: "Discovery v1 for acme/discovery-fail failed" } } });
    expect(auditEvent).not.toBeNull();
  });
});

describe("getRepositoryContext", () => {
  it("returns null when no Discovery run has ever succeeded", async () => {
    const repository = await createRepository("context-none-yet");
    const context = await getRepositoryContext(managerCtx, repository.id);
    expect(context).toBeNull();
  });

  it("returns the latest succeeded version's findings once one exists", async () => {
    const repository = await createRepository("context-latest");
    const discovery = await runRepositoryDiscovery(managerCtx, repository.id);
    await runDiscoveryJob(discovery.id);

    const context = await getRepositoryContext(managerCtx, repository.id);
    expect(context?.version).toBe(1);
    expect(context?.findings).toEqual(SAMPLE_FINDINGS);
  });

  it("a read-only user can still view context", async () => {
    const repository = await createRepository("context-readonly");
    const discovery = await runRepositoryDiscovery(managerCtx, repository.id);
    await runDiscoveryJob(discovery.id);

    const context = await getRepositoryContext(viewerCtx, repository.id);
    expect(context?.version).toBe(1);
  });
});

describe("listRepositoryDiscoveries", () => {
  it("lists every version newest-first", async () => {
    const repository = await createRepository("list-versions");
    const first = await runRepositoryDiscovery(managerCtx, repository.id);
    await runDiscoveryJob(first.id);
    await runRepositoryDiscovery(managerCtx, repository.id);

    const list = await listRepositoryDiscoveries(managerCtx, repository.id);
    expect(list.map((d) => d.version)).toEqual([2, 1]);
    expect(list[1].status).toBe("SUCCEEDED");
    expect(list[0].status).toBe("RUNNING");
  });
});
