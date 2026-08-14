import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createDecision, approveDecision, rejectDecision } from "./commands";
import { createWorkItem } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError, ValidationError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres.
 */

let clientId: string;
let projectId: string;
let managerUserId: string;
let viewerUserId: string;
let approverUserId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;
let approverCtx: AuthContext;
let workItemId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Decision Test Org", slug: `decision-test-org-${Date.now()}` } });
  const client = await db.client.create({ data: { organizationId: org.id, name: "Decision Test Client", slug: "decision-test" } });
  clientId = client.id;

  const project = await db.project.create({
    data: { clientId, name: "Decision Test Project", key: `DEC${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;

  const manager = await db.user.create({ data: { email: `decision-manager-${Date.now()}@test.local`, name: "Decision Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const viewer = await db.user.create({ data: { email: `decision-viewer-${Date.now()}@test.local`, name: "Decision Viewer" } });
  viewerUserId = viewer.id;
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });

  const approver = await db.user.create({ data: { email: `decision-approver-${Date.now()}@test.local`, name: "Approver" } });
  approverUserId = approver.id;
  await db.clientMembership.create({ data: { userId: approver.id, clientId, role: "MANAGER" } });

  managerCtx = { userId: managerUserId, displayName: "Decision Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  viewerCtx = { userId: viewerUserId, displayName: "Decision Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
  approverCtx = { userId: approverUserId, displayName: "Approver", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };

  // Create a work item
  const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Test Work Item" });
  workItemId = workItem.id;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { clients: { some: { id: clientId } } } });
  await db.user.deleteMany({ where: { id: { in: [managerUserId, viewerUserId, approverUserId] } } });
});

describe("createDecision", () => {
  it("creates a decision and sets work item status to DECISION_REQUIRED", async () => {
    const decision = await createDecision(managerCtx, {
      workItemId,
      question: "Should we use React or Vue?",
      reason: "Need to choose framework",
      impact: "Affects architecture",
    });

    expect(decision.workItemId).toBe(workItemId);
    expect(decision.question).toBe("Should we use React or Vue?");
    expect(decision.status).toBe("OPEN");
    expect(decision.approverId).toBeNull();

    const workItem = await db.workItem.findUnique({ where: { id: workItemId } });
    expect(workItem?.status).toBe("DECISION_REQUIRED");

    const events = await db.auditEvent.findMany({ where: { workItemId } });
    expect(events.some((e) => e.action.includes("created decision"))).toBe(true);
  });

  it("accepts optional AI recommendation and confidence", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "AI decision item" });
    const decision = await createDecision(managerCtx, {
      workItemId: workItem.id,
      question: "Question",
      reason: "Reason",
      impact: "Impact",
      aiRecommendation: "React is recommended",
      aiConfidence: 85.5,
    });

    expect(decision.aiRecommendation).toBe("React is recommended");
    expect(decision.aiConfidence?.toString()).toBe("85.5");
  });

  it("accepts optional deadline", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Deadline decision" });
    const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    const decision = await createDecision(managerCtx, {
      workItemId: workItem.id,
      question: "Q",
      reason: "R",
      impact: "I",
      deadline,
    });

    expect(decision.deadline?.toISOString().split("T")[0]).toBe(deadline.toISOString().split("T")[0]);
  });

  it("rejects a Viewer (write role required)", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Viewer cannot decide" });
    await expect(
      createDecision(viewerCtx, {
        workItemId: workItem.id,
        question: "Q",
        reason: "R",
        impact: "I",
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects a non-existent work item", async () => {
    await expect(
      createDecision(managerCtx, {
        workItemId: "nonexistent-id",
        question: "Q",
        reason: "R",
        impact: "I",
      })
    ).rejects.toThrow();
  });
});

describe("approveDecision", () => {
  it("approves a decision and restores work item to OPEN", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Approvable decision" });
    const decision = await createDecision(managerCtx, {
      workItemId: workItem.id,
      question: "Approve?",
      reason: "For testing",
      impact: "Test",
    });

    const approved = await approveDecision(approverCtx, decision.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approverId).toBe(approverUserId);
    expect(approved.resolvedAt).not.toBeNull();

    const workItemAfter = await db.workItem.findUnique({ where: { id: workItem.id } });
    expect(workItemAfter?.status).toBe("OPEN");

    const events = await db.auditEvent.findMany({ where: { workItemId: workItem.id, action: { contains: "approved" } } });
    expect(events.length).toBeGreaterThan(0);
  });

  it("allows any authenticated user to approve", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Viewer approves" });
    const decision = await createDecision(managerCtx, {
      workItemId: workItem.id,
      question: "Q",
      reason: "R",
      impact: "I",
    });

    // Even a VIEWER can approve
    const approved = await approveDecision(viewerCtx, decision.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approverId).toBe(viewerUserId);
  });

  it("rejects approving a non-open decision", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Already decided" });
    const decision = await createDecision(managerCtx, {
      workItemId: workItem.id,
      question: "Q",
      reason: "R",
      impact: "I",
    });

    await approveDecision(approverCtx, decision.id);

    await expect(approveDecision(approverCtx, decision.id)).rejects.toThrow(ValidationError);
  });

  it("rejects approving a non-existent decision", async () => {
    await expect(approveDecision(approverCtx, "nonexistent-id")).rejects.toThrow();
  });
});

describe("rejectDecision", () => {
  it("rejects a decision and keeps work item status as DECISION_REQUIRED", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Rejectable decision" });
    const decision = await createDecision(managerCtx, {
      workItemId: workItem.id,
      question: "Reject?",
      reason: "For testing",
      impact: "Test",
    });

    const rejected = await rejectDecision(approverCtx, decision.id, "Not appropriate");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.approverId).toBe(approverUserId);
    expect(rejected.resolvedAt).not.toBeNull();

    const workItemAfter = await db.workItem.findUnique({ where: { id: workItem.id } });
    expect(workItemAfter?.status).toBe("DECISION_REQUIRED");

    const events = await db.auditEvent.findMany({ where: { workItemId: workItem.id, action: { contains: "rejected" } } });
    expect(events.length).toBeGreaterThan(0);
  });

  it("accepts optional reason on rejection", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Rejection reason" });
    const decision = await createDecision(managerCtx, {
      workItemId: workItem.id,
      question: "Q",
      reason: "R",
      impact: "I",
    });

    const rejected = await rejectDecision(approverCtx, decision.id, "Needs more data");
    expect(rejected.status).toBe("REJECTED");

    const event = await db.auditEvent.findFirst({
      where: { workItemId: workItem.id, action: { contains: "rejected" } },
    });
    expect((event?.detail as { reason?: string } | null)?.reason).toBe("Needs more data");
  });

  it("allows any authenticated user to reject", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Viewer rejects" });
    const decision = await createDecision(managerCtx, {
      workItemId: workItem.id,
      question: "Q",
      reason: "R",
      impact: "I",
    });

    const rejected = await rejectDecision(viewerCtx, decision.id);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.approverId).toBe(viewerUserId);
  });

  it("rejects rejecting a non-open decision", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Already decided" });
    const decision = await createDecision(managerCtx, {
      workItemId: workItem.id,
      question: "Q",
      reason: "R",
      impact: "I",
    });

    await rejectDecision(approverCtx, decision.id);

    await expect(rejectDecision(approverCtx, decision.id)).rejects.toThrow(ValidationError);
  });
});
