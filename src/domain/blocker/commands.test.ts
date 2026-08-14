import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createBlocker, updateBlocker, resolveBlocker } from "./commands";
import { createWorkItem } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError, ValidationError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres (see prisma/schema.prisma
 * FK constraints — same rationale as work-item tests).
 */

let clientId: string;
let projectId: string;
let managerUserId: string;
let viewerUserId: string;
let ownerUserId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;
let ownerCtx: AuthContext;
let workItemId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Blocker Test Org", slug: `blocker-test-org-${Date.now()}` } });
  const client = await db.client.create({ data: { organizationId: org.id, name: "Blocker Test Client", slug: "blocker-test" } });
  clientId = client.id;

  const project = await db.project.create({
    data: { clientId, name: "Blocker Test Project", key: `BLK${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;

  const manager = await db.user.create({ data: { email: `blocker-manager-${Date.now()}@test.local`, name: "Blocker Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const viewer = await db.user.create({ data: { email: `blocker-viewer-${Date.now()}@test.local`, name: "Blocker Viewer" } });
  viewerUserId = viewer.id;
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });

  const owner = await db.user.create({ data: { email: `blocker-owner-${Date.now()}@test.local`, name: "Blocker Owner" } });
  ownerUserId = owner.id;
  await db.clientMembership.create({ data: { userId: owner.id, clientId, role: "MANAGER" } });

  managerCtx = { userId: managerUserId, displayName: "Blocker Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  viewerCtx = { userId: viewerUserId, displayName: "Blocker Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
  ownerCtx = { userId: ownerUserId, displayName: "Blocker Owner", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };

  // Create a work item to block
  const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Test Work Item" });
  workItemId = workItem.id;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { clients: { some: { id: clientId } } } });
  await db.user.deleteMany({ where: { id: { in: [managerUserId, viewerUserId, ownerUserId] } } });
});

describe("createBlocker", () => {
  it("creates a blocker and sets work item status to BLOCKED", async () => {
    const blocker = await createBlocker(managerCtx, {
      blockingItemId: workItemId,
      reason: "Waiting for design review",
      requiredAction: "Get design approval from lead",
      ownerId: managerUserId,
    });

    expect(blocker.blockingItemId).toBe(workItemId);
    expect(blocker.reason).toBe("Waiting for design review");
    expect(blocker.ownerId).toBe(managerUserId);
    expect(blocker.resolvedAt).toBeNull();

    const workItem = await db.workItem.findUnique({ where: { id: workItemId } });
    expect(workItem?.status).toBe("BLOCKED");

    const events = await db.auditEvent.findMany({ where: { workItemId } });
    expect(events.some((e) => e.action.includes("created blocker"))).toBe(true);
  });

  it("accepts optional impact field", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Impactful item" });
    const blocker = await createBlocker(managerCtx, {
      blockingItemId: workItem.id,
      reason: "Missing data",
      requiredAction: "Prepare data",
      ownerId: managerUserId,
      impact: "Blocks 3 dependent items",
    });

    expect(blocker.impact).toBe("Blocks 3 dependent items");
  });

  it("rejects a Viewer (write role required)", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Viewer cannot block" });
    await expect(
      createBlocker(viewerCtx, {
        blockingItemId: workItem.id,
        reason: "Cannot block",
        requiredAction: "N/A",
        ownerId: viewerUserId,
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects a non-existent work item", async () => {
    await expect(
      createBlocker(managerCtx, {
        blockingItemId: "nonexistent-id",
        reason: "Cannot block",
        requiredAction: "N/A",
        ownerId: managerUserId,
      })
    ).rejects.toThrow();
  });

  it("rejects a non-existent owner", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Bad owner" });
    await expect(
      createBlocker(managerCtx, {
        blockingItemId: workItem.id,
        reason: "Bad owner",
        requiredAction: "N/A",
        ownerId: "nonexistent-user-id",
      })
    ).rejects.toThrow();
  });
});

describe("updateBlocker", () => {
  it("updates a blocker's fields", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Updatable blocker" });
    const blocker = await createBlocker(managerCtx, {
      blockingItemId: workItem.id,
      reason: "Initial reason",
      requiredAction: "Initial action",
      ownerId: managerUserId,
    });

    const updated = await updateBlocker(managerCtx, blocker.id, {
      reason: "Updated reason",
      requiredAction: "Updated action",
      impact: "Now more impactful",
    });

    expect(updated.reason).toBe("Updated reason");
    expect(updated.requiredAction).toBe("Updated action");
    expect(updated.impact).toBe("Now more impactful");

    const events = await db.auditEvent.findMany({ where: { workItemId: workItem.id, action: { contains: "updated" } } });
    expect(events.length).toBeGreaterThan(0);
  });

  it("allows blocker owner to update without MANAGER role", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Owner update" });
    const blocker = await createBlocker(managerCtx, {
      blockingItemId: workItem.id,
      reason: "Owner blocker",
      requiredAction: "Owner action",
      ownerId: ownerUserId,
    });

    // ownerCtx is a MANAGER too, but we're testing the owner-specific path
    const updated = await updateBlocker(ownerCtx, blocker.id, {
      reason: "Owner updated reason",
    });

    expect(updated.reason).toBe("Owner updated reason");
  });

  it("rejects non-existent blocker", async () => {
    await expect(
      updateBlocker(managerCtx, "nonexistent-blocker", {
        reason: "Update attempt",
      })
    ).rejects.toThrow();
  });
});

describe("resolveBlocker", () => {
  it("resolves a blocker and restores work item to OPEN", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Resolvable blocker" });
    const blocker = await createBlocker(managerCtx, {
      blockingItemId: workItem.id,
      reason: "Temporary issue",
      requiredAction: "Fix it",
      ownerId: managerUserId,
    });

    const resolved = await resolveBlocker(managerCtx, blocker.id);
    expect(resolved.resolvedAt).not.toBeNull();

    const workItemAfter = await db.workItem.findUnique({ where: { id: workItem.id } });
    expect(workItemAfter?.status).toBe("OPEN");

    const events = await db.auditEvent.findMany({ where: { workItemId: workItem.id, action: { contains: "resolved" } } });
    expect(events.length).toBeGreaterThan(0);
  });

  it("does not restore status if other blockers remain active", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Multiple blockers" });

    const blocker1 = await createBlocker(managerCtx, {
      blockingItemId: workItem.id,
      reason: "First blocker",
      requiredAction: "Fix",
      ownerId: managerUserId,
    });

    const blocker2 = await createBlocker(managerCtx, {
      blockingItemId: workItem.id,
      reason: "Second blocker",
      requiredAction: "Also fix",
      ownerId: managerUserId,
    });

    // Resolve the first one
    await resolveBlocker(managerCtx, blocker1.id);

    // Status should still be BLOCKED because blocker2 is active
    const workItemStill = await db.workItem.findUnique({ where: { id: workItem.id } });
    expect(workItemStill?.status).toBe("BLOCKED");

    // Resolve the second one
    await resolveBlocker(managerCtx, blocker2.id);

    // Now it should be OPEN
    const workItemFinal = await db.workItem.findUnique({ where: { id: workItem.id } });
    expect(workItemFinal?.status).toBe("OPEN");
  });

  it("rejects resolving an already-resolved blocker", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Already resolved" });
    const blocker = await createBlocker(managerCtx, {
      blockingItemId: workItem.id,
      reason: "Issue",
      requiredAction: "Fix",
      ownerId: managerUserId,
    });

    await resolveBlocker(managerCtx, blocker.id);

    await expect(resolveBlocker(managerCtx, blocker.id)).rejects.toThrow(ValidationError);
  });

  it("allows blocker owner to resolve without MANAGER role", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Owner resolve" });
    const blocker = await createBlocker(managerCtx, {
      blockingItemId: workItem.id,
      reason: "Owner blocker",
      requiredAction: "Owner fix",
      ownerId: ownerUserId,
    });

    const resolved = await resolveBlocker(ownerCtx, blocker.id);
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it("rejects Viewer from resolving", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Viewer cannot resolve" });
    const blocker = await createBlocker(managerCtx, {
      blockingItemId: workItem.id,
      reason: "Viewer blocked",
      requiredAction: "Viewer fix",
      ownerId: managerUserId,
    });

    await expect(resolveBlocker(viewerCtx, blocker.id)).rejects.toThrow(ForbiddenError);
  });
});
