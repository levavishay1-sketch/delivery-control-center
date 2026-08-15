import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkItem, updateWorkItem, updateWorkItemStatus, addParentWorkItem } from "./commands";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError, ValidationError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres (see prisma/schema.prisma
 * FK constraints — mocking db.$transaction faithfully for these commands
 * would be more brittle than exercising the real thing, and this project's
 * verification standard prefers a real DB check over "looks right").
 * Each test creates its own org/client/project/user fixtures and is
 * independent; nothing here depends on prisma/seed.ts having run.
 */

let clientId: string;
let projectId: string;
let managerUserId: string;
let viewerUserId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "WI Test Org", slug: `wi-test-org-${Date.now()}` } });
  const client = await db.client.create({ data: { organizationId: org.id, name: "WI Test Client", slug: "wi-test" } });
  clientId = client.id;

  const project = await db.project.create({
    data: { clientId, name: "WI Test Project", key: `WIT${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;

  const manager = await db.user.create({ data: { email: `wi-manager-${Date.now()}@test.local`, name: "Test Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const viewer = await db.user.create({ data: { email: `wi-viewer-${Date.now()}@test.local`, name: "Test Viewer" } });
  viewerUserId = viewer.id;
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });

  managerCtx = { userId: managerUserId, displayName: "Test Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  viewerCtx = { userId: viewerUserId, displayName: "Test Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
});

afterAll(async () => {
  // Cascades: Project -> WorkItem -> {Blocker, Decision, Dependency}; Client -> ClientMembership; Organization -> Client.
  await db.organization.deleteMany({ where: { clients: { some: { id: clientId } } } });
  await db.user.deleteMany({ where: { id: { in: [managerUserId, viewerUserId] } } });
});

describe("createWorkItem", () => {
  it("creates a work item with defaults and records an audit event, with no pipeline until one is explicitly started", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Test item" });

    expect(workItem.title).toBe("Test item");
    expect(workItem.status).toBe("OPEN");
    expect(workItem.type).toBe("TASK");
    expect(workItem.risk).toBe("MEDIUM");
    expect(workItem.priority).toBe("MEDIUM");
    expect(workItem.ownerId).toBe(managerUserId);

    const pipeline = await db.pipeline.findUnique({ where: { workItemId: workItem.id } });
    expect(pipeline).toBeNull();

    const events = await db.auditEvent.findMany({ where: { workItemId: workItem.id } });
    expect(events.some((e) => e.action.includes("created work item"))).toBe(true);
  });

  it("accepts explicit type, risk, priority, and owner", async () => {
    const { workItem } = await createWorkItem(managerCtx, {
      projectId,
      title: "Bug item",
      type: "BUG",
      risk: "HIGH",
      priority: "CRITICAL",
      ownerId: viewerUserId,
    });
    expect(workItem.type).toBe("BUG");
    expect(workItem.risk).toBe("HIGH");
    expect(workItem.priority).toBe("CRITICAL");
    expect(workItem.ownerId).toBe(viewerUserId);
  });

  it("rejects a Viewer (write role required)", async () => {
    await expect(createWorkItem(viewerCtx, { projectId, title: "Nope" })).rejects.toThrow(ForbiddenError);
  });

  it("rejects a missing title (Zod validation)", async () => {
    await expect(createWorkItem(managerCtx, { projectId, title: "" })).rejects.toThrow();
  });

  it("rejects a parentId from a different project", async () => {
    const otherProject = await db.project.create({
      data: { clientId, name: "Other Project", key: `OTH${Date.now().toString(36).toUpperCase()}` },
    });
    const { workItem: otherItem } = await createWorkItem(managerCtx, { projectId: otherProject.id, title: "Elsewhere" });

    await expect(
      createWorkItem(managerCtx, { projectId, title: "Child", parentId: otherItem.id })
    ).rejects.toThrow(ValidationError);
  });
});

describe("updateWorkItem", () => {
  it("updates fields and records an audit event", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "To update" });
    const updated = await updateWorkItem(managerCtx, workItem.id, { title: "Updated title", progress: 42 });

    expect(updated.title).toBe("Updated title");
    expect(updated.progress).toBe(42);

    const events = await db.auditEvent.findMany({ where: { workItemId: workItem.id, action: { contains: "updated" } } });
    expect(events.length).toBeGreaterThan(0);
  });

  it("rejects a Viewer", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Viewer cannot touch" });
    await expect(updateWorkItem(viewerCtx, workItem.id, { title: "Nope" })).rejects.toThrow(ForbiddenError);
  });

  it("rejects progress outside 0-100 (Zod validation)", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Bad progress" });
    await expect(updateWorkItem(managerCtx, workItem.id, { progress: 150 })).rejects.toThrow();
  });
});

describe("updateWorkItemStatus", () => {
  it("allows a valid transition (OPEN -> IN_PROGRESS)", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Status flow" });
    const updated = await updateWorkItemStatus(managerCtx, workItem.id, "IN_PROGRESS");
    expect(updated.status).toBe("IN_PROGRESS");
  });

  it("rejects an invalid transition (OPEN -> COMPLETED)", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Bad transition" });
    await expect(updateWorkItemStatus(managerCtx, workItem.id, "COMPLETED")).rejects.toThrow(ValidationError);
  });

  it("rejects manually entering BLOCKED (must go through createBlocker)", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "No manual blocking" });
    await expect(updateWorkItemStatus(managerCtx, workItem.id, "BLOCKED")).rejects.toThrow();
  });

  it("rejects COMPLETED as a source (terminal state)", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Terminal" });
    await updateWorkItemStatus(managerCtx, workItem.id, "IN_PROGRESS");
    await updateWorkItemStatus(managerCtx, workItem.id, "REVIEW");
    await updateWorkItemStatus(managerCtx, workItem.id, "APPROVED");
    await updateWorkItemStatus(managerCtx, workItem.id, "COMPLETED");
    await expect(updateWorkItemStatus(managerCtx, workItem.id, "IN_PROGRESS")).rejects.toThrow(ValidationError);
  });

  it("records the reason in the audit event detail", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "With reason" });
    await updateWorkItemStatus(managerCtx, workItem.id, "IN_PROGRESS", "Starting work");

    const event = await db.auditEvent.findFirst({
      where: { workItemId: workItem.id, action: { contains: "moved" } },
    });
    expect((event?.detail as { reason?: string } | null)?.reason).toBe("Starting work");
  });
});

describe("addParentWorkItem", () => {
  it("sets a valid parent", async () => {
    const { workItem: parent } = await createWorkItem(managerCtx, { projectId, title: "Parent" });
    const { workItem: child } = await createWorkItem(managerCtx, { projectId, title: "Child" });

    const updated = await addParentWorkItem(managerCtx, child.id, parent.id);
    expect(updated.parentId).toBe(parent.id);
  });

  it("rejects a self-parent", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Self parent" });
    await expect(addParentWorkItem(managerCtx, workItem.id, workItem.id)).rejects.toThrow(ValidationError);
  });

  it("rejects a cycle (grandparent cannot become a child of its own descendant)", async () => {
    const { workItem: a } = await createWorkItem(managerCtx, { projectId, title: "A" });
    const { workItem: b } = await createWorkItem(managerCtx, { projectId, title: "B" });
    const { workItem: c } = await createWorkItem(managerCtx, { projectId, title: "C" });

    await addParentWorkItem(managerCtx, b.id, a.id); // B's parent is A
    await addParentWorkItem(managerCtx, c.id, b.id); // C's parent is B (A -> B -> C)

    await expect(addParentWorkItem(managerCtx, a.id, c.id)).rejects.toThrow(ValidationError); // A's parent = C would cycle
  });
});
