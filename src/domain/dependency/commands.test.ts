import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDependency, removeDependency, detectCycles } from "./commands";
import { createWorkItem } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ValidationError, ForbiddenError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres.
 */

let clientId: string;
let projectId: string;
let otherProjectId: string;
let managerUserId: string;
let viewerUserId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;
let itemA: string;
let itemB: string;
let itemC: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Dependency Test Org", slug: `dep-test-org-${Date.now()}` } });
  const client = await db.client.create({ data: { organizationId: org.id, name: "Dependency Test Client", slug: "dep-test" } });
  clientId = client.id;

  const project = await db.project.create({
    data: { clientId, name: "Dependency Test Project", key: `DEP${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;

  const otherProject = await db.project.create({
    data: { clientId, name: "Other Project", key: `OTH${Date.now().toString(36).toUpperCase()}` },
  });
  otherProjectId = otherProject.id;

  const manager = await db.user.create({ data: { email: `dep-manager-${Date.now()}@test.local`, name: "Dependency Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const viewer = await db.user.create({ data: { email: `dep-viewer-${Date.now()}@test.local`, name: "Dependency Viewer" } });
  viewerUserId = viewer.id;
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });

  managerCtx = { userId: managerUserId, displayName: "Dependency Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  viewerCtx = { userId: viewerUserId, displayName: "Dependency Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };

  // Create work items for dependencies
  const { workItem: a } = await createWorkItem(managerCtx, { projectId, title: "Item A" });
  itemA = a.id;
  const { workItem: b } = await createWorkItem(managerCtx, { projectId, title: "Item B" });
  itemB = b.id;
  const { workItem: c } = await createWorkItem(managerCtx, { projectId, title: "Item C" });
  itemC = c.id;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { clients: { some: { id: clientId } } } });
  await db.user.deleteMany({ where: { id: { in: [managerUserId, viewerUserId] } } });
});

describe("addDependency", () => {
  it("creates a dependency between two items", async () => {
    const dep = await addDependency(managerCtx, {
      workItemId: itemA,
      dependsOnWorkItemId: itemB,
      reason: "A needs B to be done first",
    });

    expect(dep.workItemId).toBe(itemA);
    expect(dep.dependsOnWorkItemId).toBe(itemB);
    expect(dep.reason).toBe("A needs B to be done first");

    const events = await db.auditEvent.findMany({ where: { workItemId: itemA, action: { contains: "dependency" } } });
    expect(events.length).toBeGreaterThan(0);
  });

  it("rejects a self-dependency", async () => {
    await expect(
      addDependency(managerCtx, {
        workItemId: itemA,
        dependsOnWorkItemId: itemA,
        reason: "Self dep",
      })
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a duplicate dependency", async () => {
    await addDependency(managerCtx, {
      workItemId: itemB,
      dependsOnWorkItemId: itemC,
      reason: "First time",
    });

    await expect(
      addDependency(managerCtx, {
        workItemId: itemB,
        dependsOnWorkItemId: itemC,
        reason: "Second time",
      })
    ).rejects.toThrow(ValidationError);
  });

  it("rejects cross-project dependencies", async () => {
    const { workItem: other } = await createWorkItem(managerCtx, { projectId: otherProjectId, title: "Other Project Item" });

    await expect(
      addDependency(managerCtx, {
        workItemId: itemA,
        dependsOnWorkItemId: other.id,
        reason: "Cross project",
      })
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a Viewer (write role required)", async () => {
    await expect(
      addDependency(viewerCtx, {
        workItemId: itemA,
        dependsOnWorkItemId: itemB,
        reason: "Viewer cannot add",
      })
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("detectCycles", () => {
  it("detects a direct self-cycle", async () => {
    const hasCycle = await detectCycles(itemA, itemA);
    expect(hasCycle).toBe(true);
  });

  it("detects no cycle for new dependencies", async () => {
    const hasCycle = await detectCycles(itemA, itemC);
    expect(hasCycle).toBe(false);
  });

  it("rejects a cycle when adding dependency would create one", async () => {
    // Setup: A -> B -> C
    const { workItem: a } = await createWorkItem(managerCtx, { projectId, title: "Cycle A" });
    const { workItem: b } = await createWorkItem(managerCtx, { projectId, title: "Cycle B" });
    const { workItem: c } = await createWorkItem(managerCtx, { projectId, title: "Cycle C" });

    await addDependency(managerCtx, {
      workItemId: a.id,
      dependsOnWorkItemId: b.id,
      reason: "A -> B",
    });

    await addDependency(managerCtx, {
      workItemId: b.id,
      dependsOnWorkItemId: c.id,
      reason: "B -> C",
    });

    // Now try to make C -> A (would close a cycle)
    await expect(
      addDependency(managerCtx, {
        workItemId: c.id,
        dependsOnWorkItemId: a.id,
        reason: "C -> A (cycle)",
      })
    ).rejects.toThrow(ValidationError);
  });
});

describe("removeDependency", () => {
  it("removes a dependency", async () => {
    const { workItem: x } = await createWorkItem(managerCtx, { projectId, title: "X" });
    const { workItem: y } = await createWorkItem(managerCtx, { projectId, title: "Y" });

    const dep = await addDependency(managerCtx, {
      workItemId: x.id,
      dependsOnWorkItemId: y.id,
      reason: "X depends on Y",
    });

    const removed = await removeDependency(managerCtx, dep.id);
    expect(removed.id).toBe(dep.id);

    const stillExists = await db.dependency.findUnique({ where: { id: dep.id } });
    expect(stillExists).toBeNull();

    const events = await db.auditEvent.findMany({ where: { workItemId: x.id, action: { contains: "removed" } } });
    expect(events.length).toBeGreaterThan(0);
  });

  it("rejects removing a non-existent dependency", async () => {
    await expect(removeDependency(managerCtx, "nonexistent-id")).rejects.toThrow();
  });

  it("rejects Viewer from removing", async () => {
    const { workItem: p } = await createWorkItem(managerCtx, { projectId, title: "P" });
    const { workItem: q } = await createWorkItem(managerCtx, { projectId, title: "Q" });

    const dep = await addDependency(managerCtx, {
      workItemId: p.id,
      dependsOnWorkItemId: q.id,
      reason: "P -> Q",
    });

    await expect(removeDependency(viewerCtx, dep.id)).rejects.toThrow(ForbiddenError);
  });
});
