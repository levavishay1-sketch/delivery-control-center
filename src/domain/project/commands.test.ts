import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { previewAssignmentCascade, applyAssignmentCascade } from "./commands";
import { createWorkItem, updateWorkItem } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres (see work-item/commands.test.ts's own
 * comment for why) for the Slice 19 cascade preview/apply flow.
 */

let clientId: string;
let projectId: string;
let managerUserId: string;
let viewerUserId: string;
let secondHumanId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Cascade Test Org", slug: `cascade-test-org-${Date.now()}` } });
  const client = await db.client.create({ data: { organizationId: org.id, name: "Cascade Test Client", slug: `cascade-test-${Date.now()}` } });
  clientId = client.id;

  const project = await db.project.create({
    data: { clientId, name: "Cascade Test Project", key: `CAS${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;

  const manager = await db.user.create({ data: { email: `cascade-manager-${Date.now()}@test.local`, name: "Cascade Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const viewer = await db.user.create({ data: { email: `cascade-viewer-${Date.now()}@test.local`, name: "Cascade Viewer" } });
  viewerUserId = viewer.id;
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });

  const secondHuman = await db.user.create({ data: { email: `cascade-second-${Date.now()}@test.local`, name: "Second Human" } });
  secondHumanId = secondHuman.id;
  await db.clientMembership.create({ data: { userId: secondHuman.id, clientId, role: "MANAGER" } });

  managerCtx = { userId: managerUserId, displayName: "Cascade Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  viewerCtx = { userId: viewerUserId, displayName: "Cascade Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { clients: { some: { id: clientId } } } });
  await db.user.deleteMany({ where: { id: { in: [managerUserId, viewerUserId, secondHumanId] } } });
});

describe("previewAssignmentCascade", () => {
  it("splits WorkItems into affected (INHERITED) and unaffected (EXPLICIT)", async () => {
    const { workItem: inherited } = await createWorkItem(managerCtx, { projectId, title: "Preview inherited" });
    const { workItem: explicit } = await createWorkItem(managerCtx, {
      projectId,
      title: "Preview explicit",
      executorType: "HUMAN",
      executorId: viewerUserId,
    });

    const preview = await previewAssignmentCascade(managerCtx, projectId, { executorType: "HUMAN", executorId: secondHumanId });

    expect(preview.affected.some((i) => i.id === inherited.id)).toBe(true);
    expect(preview.unaffected.some((i) => i.id === explicit.id)).toBe(true);
    expect(preview.affected.some((i) => i.id === explicit.id)).toBe(false);
    expect(preview.unaffected.some((i) => i.id === inherited.id)).toBe(false);
  });

  it("makes no writes", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "No writes on preview" });
    await previewAssignmentCascade(managerCtx, projectId, { executorType: "HUMAN", executorId: secondHumanId });

    const unchanged = await db.workItem.findUnique({ where: { id: workItem.id } });
    expect(unchanged?.executorType).toBe("UNASSIGNED");
    expect(unchanged?.assignmentSource).toBe("INHERITED");

    const project = await db.project.findUnique({ where: { id: projectId } });
    expect(project?.defaultExecutorType).toBe("UNASSIGNED");
  });

  it("rejects a Viewer (write role required, even for a read-only preview — design.md decision, task 3.4)", async () => {
    await expect(previewAssignmentCascade(viewerCtx, projectId, { executorType: "HUMAN", executorId: secondHumanId })).rejects.toThrow(
      ForbiddenError
    );
  });
});

describe("applyAssignmentCascade", () => {
  it("INHERITED_ONLY reassigns only INHERITED/unassigned items, leaves EXPLICIT items untouched", async () => {
    const { workItem: inherited } = await createWorkItem(managerCtx, { projectId, title: "Apply inherited only - inherited" });
    const { workItem: explicit } = await createWorkItem(managerCtx, {
      projectId,
      title: "Apply inherited only - explicit",
      executorType: "AI_AGENT",
    });

    const result = await applyAssignmentCascade(managerCtx, projectId, { executorType: "HUMAN", executorId: secondHumanId }, "INHERITED_ONLY");
    expect(result.reassignedCount).toBeGreaterThanOrEqual(1);

    const reassigned = await db.workItem.findUnique({ where: { id: inherited.id } });
    expect(reassigned?.executorType).toBe("HUMAN");
    expect(reassigned?.executorId).toBe(secondHumanId);
    expect(reassigned?.assignmentSource).toBe("INHERITED");

    const untouched = await db.workItem.findUnique({ where: { id: explicit.id } });
    expect(untouched?.executorType).toBe("AI_AGENT");
    expect(untouched?.assignmentSource).toBe("EXPLICIT");

    const project = await db.project.findUnique({ where: { id: projectId } });
    expect(project?.defaultExecutorType).toBe("HUMAN");
    expect(project?.defaultExecutorId).toBe(secondHumanId);

    await db.project.update({ where: { id: projectId }, data: { defaultExecutorType: "UNASSIGNED", defaultExecutorId: null } });
  });

  it("REASSIGN_ALL reassigns every item, flipping previously-EXPLICIT items to INHERITED", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Reassign all - explicit" });
    await updateWorkItem(managerCtx, workItem.id, { executorType: "AI_AGENT" });

    await applyAssignmentCascade(managerCtx, projectId, { executorType: "HUMAN", executorId: viewerUserId }, "REASSIGN_ALL");

    const reassigned = await db.workItem.findUnique({ where: { id: workItem.id } });
    expect(reassigned?.executorType).toBe("HUMAN");
    expect(reassigned?.executorId).toBe(viewerUserId);
    expect(reassigned?.assignmentSource).toBe("INHERITED");

    await db.project.update({ where: { id: projectId }, data: { defaultExecutorType: "UNASSIGNED", defaultExecutorId: null } });
  });

  it("records an audit event for the Project default-executor change and for each cascaded WorkItem", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Audited cascade" });

    await applyAssignmentCascade(managerCtx, projectId, { executorType: "HUMAN", executorId: secondHumanId }, "INHERITED_ONLY");

    const projectEvent = await db.auditEvent.findFirst({
      where: { projectId, workItemId: null, action: { contains: "default executor" } },
      orderBy: { createdAt: "desc" },
    });
    expect(projectEvent).not.toBeNull();

    const itemEvent = await db.auditEvent.findFirst({
      where: { workItemId: workItem.id, action: { contains: "cascade" } },
    });
    expect(itemEvent).not.toBeNull();

    await db.project.update({ where: { id: projectId }, data: { defaultExecutorType: "UNASSIGNED", defaultExecutorId: null } });
  });

  it("rejects a Viewer", async () => {
    await expect(
      applyAssignmentCascade(viewerCtx, projectId, { executorType: "HUMAN", executorId: secondHumanId }, "INHERITED_ONLY")
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects a missing/invalid option (no default — Zod validation)", async () => {
    await expect(
      // @ts-expect-error deliberately omitting the required option to verify no default is accepted
      applyAssignmentCascade(managerCtx, projectId, { executorType: "HUMAN", executorId: secondHumanId }, undefined)
    ).rejects.toThrow();
  });
});
