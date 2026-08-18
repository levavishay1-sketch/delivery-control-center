import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getLatestSuccessfulModelSnapshot, recommendModel } from "./queries";
import { createWorkItem } from "@/domain/work-item/commands";
import { resolveDefaultAgentId } from "@/domain/agent/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError, NotFoundError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres — same rationale as recommendation/queries.test.ts.
 * `ModelSnapshot` has no client/project scoping (design.md Decision 7 — a standalone, dated fact
 * table), so "latest successful snapshot" is global across the whole shared test database: each
 * test cleans up its own snapshot rows in afterEach so an earlier test's snapshot never becomes
 * the "latest" one a later test reads.
 */

let clientId: string;
let projectId: string;
let managerUserId: string;
let viewerUserId: string;
let outsiderUserId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;
let outsiderCtx: AuthContext;
let defaultAgentModel: string;

const orgIds: string[] = [];
const snapshotIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Model Snapshot Test Org", slug: `model-snap-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Model Snapshot Test Client", slug: `model-snap-${Date.now()}` } });
  clientId = client.id;

  const project = await db.project.create({
    data: { clientId, name: "Model Snapshot Test Project", key: `MSN${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;
  await db.constitution.create({
    data: { projectId: project.id, version: 1, status: "APPROVED", content: "# Constitution", approvedAt: new Date() },
  });

  const manager = await db.user.create({ data: { email: `model-snap-manager-${Date.now()}@test.local`, name: "Snap Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const viewer = await db.user.create({ data: { email: `model-snap-viewer-${Date.now()}@test.local`, name: "Snap Viewer" } });
  viewerUserId = viewer.id;
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });

  const otherOrg = await db.organization.create({ data: { name: "Snap Outsider Org", slug: `snap-outsider-org-${Date.now()}` } });
  orgIds.push(otherOrg.id);
  const otherClient = await db.client.create({ data: { organizationId: otherOrg.id, name: "Snap Outsider Client", slug: `snap-outsider-${Date.now()}` } });
  const outsider = await db.user.create({ data: { email: `snap-outsider-${Date.now()}@test.local`, name: "Snap Outsider" } });
  outsiderUserId = outsider.id;
  await db.clientMembership.create({ data: { userId: outsider.id, clientId: otherClient.id, role: "MANAGER" } });

  managerCtx = { userId: managerUserId, displayName: "Snap Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  viewerCtx = { userId: viewerUserId, displayName: "Snap Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
  outsiderCtx = { userId: outsiderUserId, displayName: "Snap Outsider", isOrgAdmin: false, memberships: [{ clientId: otherClient.id, role: "MANAGER" }] };

  const agentId = await resolveDefaultAgentId();
  const agent = await db.agent.findUniqueOrThrow({ where: { id: agentId } });
  defaultAgentModel = agent.model;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

afterEach(async () => {
  if (snapshotIds.length > 0) {
    await db.modelSnapshot.deleteMany({ where: { id: { in: snapshotIds } } });
    snapshotIds.length = 0;
  }
  // Sweep any other snapshot rows a concurrent/previous run of this file's own tests left behind,
  // so "latest successful snapshot" is always exactly this test's own fixture.
  await db.modelSnapshot.deleteMany({});
});

async function createAiExecutedWorkItem(title: string) {
  const { workItem } = await createWorkItem(managerCtx, { projectId, title, executorType: "AI_AGENT" });
  return workItem;
}

describe("getLatestSuccessfulModelSnapshot", () => {
  it("returns null when no successful snapshot exists", async () => {
    expect(await getLatestSuccessfulModelSnapshot()).toBeNull();
  });

  it("returns the most recently fetched SUCCESS snapshot, ignoring FAILED ones", async () => {
    const older = await db.modelSnapshot.create({
      data: { status: "SUCCESS", rawContent: "old", extractedModels: [], fetchedAt: new Date(Date.now() - 60_000) },
    });
    const failed = await db.modelSnapshot.create({
      data: { status: "FAILED", rawContent: "bad", extractedModels: [], failureReason: "no facts found" },
    });
    const newer = await db.modelSnapshot.create({ data: { status: "SUCCESS", rawContent: "new", extractedModels: [] } });
    snapshotIds.push(older.id, failed.id, newer.id);

    const latest = await getLatestSuccessfulModelSnapshot();
    expect(latest?.id).toBe(newer.id);
  });
});

describe("recommendModel", () => {
  it("falls back to the built-in default when no successful snapshot exists yet", async () => {
    const workItem = await createAiExecutedWorkItem("No snapshot yet item");
    const result = await recommendModel(managerCtx, workItem.id);

    expect(result.model).toBe(defaultAgentModel);
    expect(result.snapshotFetchedAt).toBeNull();
    expect(result.why.toLowerCase()).toContain("no model knowledge snapshot");
  });

  it("confirms the configured model with facts when the snapshot lists it", async () => {
    const snapshot = await db.modelSnapshot.create({
      data: {
        status: "SUCCESS",
        rawContent: "raw",
        extractedModels: [{ modelId: defaultAgentModel, pricingText: "$3 per million tokens", contextWindowText: "200K token context" }],
      },
    });
    snapshotIds.push(snapshot.id);

    const workItem = await createAiExecutedWorkItem("Snapshot-confirmed item");
    const result = await recommendModel(managerCtx, workItem.id);

    expect(result.model).toBe(defaultAgentModel);
    expect(result.snapshotFetchedAt).toBe(snapshot.fetchedAt.toISOString());
    expect(result.why).toContain("$3 per million tokens");
    expect(result.assumptions.some((a) => a.includes("200K token context"))).toBe(true);
  });

  it("flags staleness when the configured model is absent from the latest snapshot", async () => {
    const snapshot = await db.modelSnapshot.create({
      data: {
        status: "SUCCESS",
        rawContent: "raw",
        extractedModels: [{ modelId: "claude-some-other-model", pricingText: "$1 per million tokens" }],
      },
    });
    snapshotIds.push(snapshot.id);

    const workItem = await createAiExecutedWorkItem("Stale-model item");
    const result = await recommendModel(managerCtx, workItem.id);

    expect(result.model).toBe(defaultAgentModel);
    expect(result.why.toLowerCase()).toContain("not found in the latest model knowledge snapshot");
  });

  it("always includes the AI-execution cost/time estimate shape", async () => {
    const workItem = await createAiExecutedWorkItem("Estimate-shape item");
    const result = await recommendModel(managerCtx, workItem.id);
    expect(result).toHaveProperty("aiEstimate");
  });

  it("a read-only user can still get a recommendation", async () => {
    const workItem = await createAiExecutedWorkItem("Viewer-readable model item");
    const result = await recommendModel(viewerCtx, workItem.id);
    expect(result.model).toBe(defaultAgentModel);
  });

  it("rejects a user without access to the work item's client", async () => {
    const workItem = await createAiExecutedWorkItem("Outsider-blocked model item");
    await expect(recommendModel(outsiderCtx, workItem.id)).rejects.toThrow(ForbiddenError);
  });

  it("throws NotFoundError for a nonexistent work item", async () => {
    await expect(recommendModel(managerCtx, "nonexistent-id")).rejects.toThrow(NotFoundError);
  });
});
