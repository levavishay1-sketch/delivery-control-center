import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getClientDetail } from "./queries";
import { createProject } from "@/domain/project/commands";
import { createWorkItem, updateWorkItemStatus } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres.
 */

let clientId: string;
let managerCtx: AuthContext;
const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Client Queries Test Org", slug: `client-queries-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Client Queries Test Client", slug: "client-queries-test" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `client-queries-manager-${Date.now()}@test.local`, name: "Client Queries Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Client Queries Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe("getClientDetail", () => {
  it("resolves every project's connector directly via Connector.clientId (Slice 13)", async () => {
    const projectA = await createProject(managerCtx, { clientId, name: "Sources A", key: `SRCA${Date.now().toString(36).toUpperCase()}` });
    const projectB = await createProject(managerCtx, { clientId, name: "Sources B", key: `SRCB${Date.now().toString(36).toUpperCase()}` });

    const detail = await getClientDetail(managerCtx, clientId);
    expect(detail).not.toBeNull();

    const connectorProjectIds = detail!.connectors.map((c) => c.projectId).sort();
    expect(connectorProjectIds).toEqual([projectA.id, projectB.id].sort());
    for (const connector of detail!.connectors) {
      expect(connector.clientId).toBe(clientId);
    }
  });

  it("gives every newly created Connector a clientId matching its project's client, the same invariant the backfill migration establishes for pre-existing rows", async () => {
    const project = await createProject(managerCtx, { clientId, name: "Sources Invariant", key: `SRCI${Date.now().toString(36).toUpperCase()}` });
    const connector = await db.connector.findUniqueOrThrow({ where: { projectId: project.id } });
    const projectRow = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(connector.clientId).toBe(projectRow.clientId);
  });
});

/** Slice 22 — the Client Tasks section: every top-level (parentless), open WorkItem across the client's projects, of any type. */
describe("getClientDetail — topLevelOpenWorkItems", () => {
  it("includes every top-level type and excludes a child even when its top-level parent is shown", async () => {
    const project = await createProject(managerCtx, { clientId, name: "Tasks Section Test", key: `TSK${Date.now().toString(36).toUpperCase()}` });
    const { workItem: parent } = await createWorkItem(managerCtx, { projectId: project.id, title: "Top-level PROJECT item", type: "PROJECT" });
    const { workItem: child } = await createWorkItem(managerCtx, { projectId: project.id, title: "Child task", parentId: parent.id });
    const { workItem: standaloneTask } = await createWorkItem(managerCtx, { projectId: project.id, title: "Standalone top-level task" });
    const { workItem: standaloneBug } = await createWorkItem(managerCtx, { projectId: project.id, title: "Standalone top-level bug", type: "BUG" });

    const detail = await getClientDetail(managerCtx, clientId);
    const ids = detail!.topLevelOpenWorkItems.map((w) => w.id);

    expect(ids).toContain(parent.id);
    expect(ids).toContain(standaloneTask.id);
    expect(ids).toContain(standaloneBug.id);
    expect(ids).not.toContain(child.id);
  });

  it("excludes a top-level work item once it is CLOSED", async () => {
    // COMPLETED is excluded by the same status:{notIn:[...]} array-membership filter as CLOSED,
    // so this one case is sufficient — reaching COMPLETED itself requires satisfying the
    // evidence-driven completion policy (Slice 5), unrelated to this feature.
    const project = await createProject(managerCtx, { clientId, name: "Tasks Section Status Test", key: `TSS${Date.now().toString(36).toUpperCase()}` });
    const { workItem: closed } = await createWorkItem(managerCtx, { projectId: project.id, title: "Closed item" });
    await updateWorkItemStatus(managerCtx, closed.id, "CLOSED");

    const detail = await getClientDetail(managerCtx, clientId);
    expect(detail!.topLevelOpenWorkItems.map((w) => w.id)).not.toContain(closed.id);
  });

  it("does not include another client's work items", async () => {
    const otherOrg = await db.organization.create({ data: { name: "Other Client Org", slug: `other-client-org-${Date.now()}` } });
    orgIds.push(otherOrg.id);
    const otherClient = await db.client.create({ data: { organizationId: otherOrg.id, name: "Other Client", slug: `other-client-${Date.now()}` } });
    const otherProject = await db.project.create({
      data: { clientId: otherClient.id, name: "Other Project", key: `OTH${Date.now().toString(36).toUpperCase()}` },
    });
    const otherItem = await db.workItem.create({
      data: { projectId: otherProject.id, source: "MANUAL", externalId: `manual-other-${Date.now()}`, title: "Other client's item", status: "OPEN" },
    });

    const detail = await getClientDetail(managerCtx, clientId);
    expect(detail!.topLevelOpenWorkItems.map((w) => w.id)).not.toContain(otherItem.id);
  });
});
