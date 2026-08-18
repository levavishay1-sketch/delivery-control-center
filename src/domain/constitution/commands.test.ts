import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  approveConstitution,
  completeConstitutionDraft,
  draftConstitution,
  getConstitutionForDrafting,
  rejectConstitution,
  revertConstitutionDraftFailure,
} from "./commands";
import { getApprovedConstitution, getConstitutionHistory } from "./queries";
import type { AuthContext } from "@/domain/shared/context";
import { ConflictError, ForbiddenError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres — same rationale as the
 * other domain test suites in this project. Exercises the whole
 * draft(job enqueue)->worker-completion->approve/reject lifecycle, calling
 * the worker-side completion/failure functions directly (what worker.ts's
 * DRAFT_CONSTITUTION handler calls) rather than running the poll loop.
 */

let clientId: string;
let projectId: string;
let managerUserId: string;
let viewerUserId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Constitution Test Org", slug: `constitution-test-org-${Date.now()}` } });
  const client = await db.client.create({ data: { organizationId: org.id, name: "Constitution Test Client", slug: "constitution-test" } });
  clientId = client.id;

  const project = await db.project.create({
    data: { clientId, name: "Constitution Test Project", key: `CST${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;

  const manager = await db.user.create({ data: { email: `constitution-manager-${Date.now()}@test.local`, name: "Test Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const viewer = await db.user.create({ data: { email: `constitution-viewer-${Date.now()}@test.local`, name: "Test Viewer" } });
  viewerUserId = viewer.id;
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });

  managerCtx = { userId: managerUserId, displayName: "Test Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  viewerCtx = { userId: viewerUserId, displayName: "Test Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
});

const enqueuedForConstitutionIds: string[] = [];

afterAll(async () => {
  // draftConstitution enqueues a real Job row that isn't reachable via any FK cascade
  // from Organization/Project, so it has to be cleaned up explicitly.
  if (enqueuedForConstitutionIds.length > 0) {
    await db.job.deleteMany({
      where: { OR: enqueuedForConstitutionIds.map((id) => ({ idempotencyKey: { startsWith: `constitution-${id}-` } })) },
    });
  }
  await db.organization.deleteMany({ where: { clients: { some: { id: clientId } } } });
  await db.user.deleteMany({ where: { id: { in: [managerUserId, viewerUserId] } } });
});

/** Wraps draftConstitution so its enqueued Job row is tracked for afterAll cleanup. */
async function draft(ctx: AuthContext, forProjectId: string) {
  const constitution = await draftConstitution(ctx, forProjectId);
  enqueuedForConstitutionIds.push(constitution.id);
  return constitution;
}

/** Simulates what worker.ts's DRAFT_CONSTITUTION handler does, without running the poll loop. */
async function runConstitutionDraftJob(constitutionId: string) {
  const constitution = await getConstitutionForDrafting(constitutionId);
  expect(constitution.project).not.toBeNull();
  return completeConstitutionDraft(constitutionId, {
    content: "# Constitution — test",
    aiModel: "mock-agent-v1",
    promptTokens: 10,
    completionTokens: 20,
    costUsd: 0.001,
  });
}

describe("draftConstitution", () => {
  it("creates version 1, enqueues a job, and the job completion moves it to PENDING_APPROVAL", async () => {
    const constitution = await draft(managerCtx, projectId);
    expect(constitution.version).toBe(1);
    expect(constitution.status).toBe("AI_DRAFTING");

    const job = await db.job.findFirst({ where: { idempotencyKey: { startsWith: `constitution-${constitution.id}-` } } });
    expect(job).not.toBeNull();
    expect(job!.type).toBe("DRAFT_CONSTITUTION");
    expect(job!.status).toBe("QUEUED");

    const completed = await runConstitutionDraftJob(constitution.id);
    expect(completed.status).toBe("PENDING_APPROVAL");
    expect(completed.content).toBe("# Constitution — test");
  });

  it("rejects a Viewer (write role required)", async () => {
    await expect(draft(viewerCtx, projectId)).rejects.toThrow(ForbiddenError);
  });

  it("refuses to draft while the latest version is PENDING_APPROVAL or AI_DRAFTING", async () => {
    const project = await db.project.create({
      data: { clientId, name: "Conflict Project", key: `CFL${Date.now().toString(36).toUpperCase()}` },
    });

    const v1 = await draft(managerCtx, project.id);
    // Still AI_DRAFTING — a second draft request is refused.
    await expect(draft(managerCtx, project.id)).rejects.toThrow(ConflictError);

    await runConstitutionDraftJob(v1.id);
    // Now PENDING_APPROVAL — still refused.
    await expect(draft(managerCtx, project.id)).rejects.toThrow(ConflictError);
  });

  it("reuses the same row in place when the latest version is DRAFT (never submitted)", async () => {
    const project = await db.project.create({
      data: { clientId, name: "Draft Reuse Project", key: `DRR${Date.now().toString(36).toUpperCase()}` },
    });

    const v1 = await draft(managerCtx, project.id);
    await revertConstitutionDraftFailure(v1.id, "simulated exhaustion");

    const reverted = await db.constitution.findUniqueOrThrow({ where: { id: v1.id } });
    expect(reverted.status).toBe("DRAFT");

    const redrafted = await draft(managerCtx, project.id);
    expect(redrafted.id).toBe(v1.id);
    expect(redrafted.version).toBe(1);
    expect(redrafted.status).toBe("AI_DRAFTING");
  });

  it("creates a new version when the latest is REJECTED, never overwriting it", async () => {
    const project = await db.project.create({
      data: { clientId, name: "Redraft Project", key: `RDR${Date.now().toString(36).toUpperCase()}` },
    });

    const v1 = await draft(managerCtx, project.id);
    const completedV1 = await runConstitutionDraftJob(v1.id);
    const rejected = await rejectConstitution(managerCtx, completedV1.id, "not aligned with policy");
    expect(rejected.status).toBe("REJECTED");

    const v2 = await draft(managerCtx, project.id);
    expect(v2.id).not.toBe(v1.id);
    expect(v2.version).toBe(2);

    const stillRejectedV1 = await db.constitution.findUniqueOrThrow({ where: { id: v1.id } });
    expect(stillRejectedV1.status).toBe("REJECTED");
    expect(stillRejectedV1.content).toBe("# Constitution — test");
  });

  it("creates a new version when the latest is APPROVED, without un-approving the old one", async () => {
    const project = await db.project.create({
      data: { clientId, name: "Reapprove Project", key: `RAP${Date.now().toString(36).toUpperCase()}` },
    });

    const v1 = await draft(managerCtx, project.id);
    const completedV1 = await runConstitutionDraftJob(v1.id);
    const approvedV1 = await approveConstitution(managerCtx, completedV1.id);
    expect(approvedV1.status).toBe("APPROVED");

    const v2 = await draft(managerCtx, project.id);
    expect(v2.version).toBe(2);

    const stillApprovedV1 = await db.constitution.findUniqueOrThrow({ where: { id: v1.id } });
    expect(stillApprovedV1.status).toBe("APPROVED");
  });
});

describe("getApprovedConstitution / getConstitutionHistory", () => {
  it("returns only the newest APPROVED version, and full history newest first", async () => {
    const project = await db.project.create({
      data: { clientId, name: "History Project", key: `HST${Date.now().toString(36).toUpperCase()}` },
    });

    const v1 = await draft(managerCtx, project.id);
    const completedV1 = await runConstitutionDraftJob(v1.id);
    await approveConstitution(managerCtx, completedV1.id);

    const v2 = await draft(managerCtx, project.id);
    const completedV2 = await runConstitutionDraftJob(v2.id);
    await approveConstitution(managerCtx, completedV2.id);

    const approved = await getApprovedConstitution(project.id);
    expect(approved!.version).toBe(2);

    const history = await getConstitutionHistory(project.id);
    expect(history.map((c) => c.version)).toEqual([2, 1]);
    expect(history.every((c) => c.status === "APPROVED")).toBe(true);
  });

  it("returns null when no version has ever been approved", async () => {
    const project = await db.project.create({
      data: { clientId, name: "Never Approved Project", key: `NAP${Date.now().toString(36).toUpperCase()}` },
    });
    await draft(managerCtx, project.id);

    const approved = await getApprovedConstitution(project.id);
    expect(approved).toBeNull();
  });
});

describe("approveConstitution / rejectConstitution", () => {
  it("rejects approving a version that isn't PENDING_APPROVAL", async () => {
    const project = await db.project.create({
      data: { clientId, name: "Bad State Project", key: `BST${Date.now().toString(36).toUpperCase()}` },
    });
    const v1 = await draft(managerCtx, project.id);
    await expect(approveConstitution(managerCtx, v1.id)).rejects.toThrow(ConflictError);
  });

  it("rejects a Viewer approving", async () => {
    const project = await db.project.create({
      data: { clientId, name: "Viewer Approve Project", key: `VAP${Date.now().toString(36).toUpperCase()}` },
    });
    const v1 = await draft(managerCtx, project.id);
    const completed = await runConstitutionDraftJob(v1.id);
    await expect(approveConstitution(viewerCtx, completed.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects rejecting a version that isn't PENDING_APPROVAL", async () => {
    const project = await db.project.create({
      data: { clientId, name: "Bad State Reject Project", key: `BSR${Date.now().toString(36).toUpperCase()}` },
    });
    const v1 = await draft(managerCtx, project.id);
    await expect(rejectConstitution(managerCtx, v1.id)).rejects.toThrow(ConflictError);
  });

  it("rejects a Viewer rejecting", async () => {
    const project = await db.project.create({
      data: { clientId, name: "Viewer Reject Project", key: `VRP${Date.now().toString(36).toUpperCase()}` },
    });
    const v1 = await draft(managerCtx, project.id);
    const completed = await runConstitutionDraftJob(v1.id);
    await expect(rejectConstitution(viewerCtx, completed.id)).rejects.toThrow(ForbiddenError);
  });
});
