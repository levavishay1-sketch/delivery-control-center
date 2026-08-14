import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getItemsNeedingAttention } from "./queries";
import { createWorkItem, updateWorkItemStatus } from "@/domain/work-item/commands";
import { createBlocker } from "@/domain/blocker/commands";
import { createDecision } from "@/domain/decision/commands";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres.
 */

let clientId: string;
let otherClientId: string;
let projectId: string;
let managerUserId: string;
let outsiderUserId: string;
let managerCtx: AuthContext;
let outsiderCtx: AuthContext;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Attention Test Org", slug: `attn-test-org-${Date.now()}` } });

  const client = await db.client.create({ data: { organizationId: org.id, name: "Attention Test Client", slug: "attn-test" } });
  clientId = client.id;

  const otherClient = await db.client.create({ data: { organizationId: org.id, name: "Other Client", slug: `attn-other-${Date.now()}` } });
  otherClientId = otherClient.id;

  const project = await db.project.create({
    data: { clientId, name: "Attention Test Project", key: `ATT${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;

  const otherProject = await db.project.create({
    data: { clientId: otherClientId, name: "Other Client Project", key: `OTC${Date.now().toString(36).toUpperCase()}` },
  });

  const manager = await db.user.create({ data: { email: `attn-manager-${Date.now()}@test.local`, name: "Attention Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const outsider = await db.user.create({ data: { email: `attn-outsider-${Date.now()}@test.local`, name: "Outsider" } });
  outsiderUserId = outsider.id;
  await db.clientMembership.create({ data: { userId: outsider.id, clientId: otherClientId, role: "MANAGER" } });

  managerCtx = { userId: managerUserId, displayName: "Attention Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  outsiderCtx = {
    userId: outsiderUserId,
    displayName: "Outsider",
    isOrgAdmin: false,
    memberships: [{ clientId: otherClientId, role: "MANAGER" }],
  };

  // Create attention-worthy items in the manager's project
  await createWorkItem(managerCtx, { projectId, title: "High risk item", risk: "HIGH" });
  await createWorkItem(managerCtx, {
    projectId,
    title: "Due soon item",
    dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
  });
  const { workItem: reviewItem } = await createWorkItem(managerCtx, { projectId, title: "In review item" });
  await updateWorkItemStatus(managerCtx, reviewItem.id, "IN_PROGRESS");
  await updateWorkItemStatus(managerCtx, reviewItem.id, "REVIEW");

  const { workItem: blockedItem } = await createWorkItem(managerCtx, { projectId, title: "Blocked item" });
  await createBlocker(managerCtx, {
    blockingItemId: blockedItem.id,
    reason: "Needs review",
    requiredAction: "Get sign-off",
    ownerId: managerUserId,
  });

  const { workItem: decisionItem } = await createWorkItem(managerCtx, { projectId, title: "Decision item" });
  await createDecision(managerCtx, {
    workItemId: decisionItem.id,
    question: "Ship it?",
    reason: "Need go/no-go",
    impact: "Release timing",
  });

  // Noise: item in the other client's project, should never appear for managerCtx
  await createWorkItem(outsiderCtx, { projectId: otherProject.id, title: "Other client risk", risk: "CRITICAL" });
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { clients: { some: { id: clientId } } } });
  await db.user.deleteMany({ where: { id: { in: [managerUserId, outsiderUserId] } } });
});

describe("getItemsNeedingAttention", () => {
  it("aggregates decisions, blockers, risks, deadlines, and approval gates", async () => {
    const result = await getItemsNeedingAttention(managerCtx);

    expect(result.summary.decisions).toBeGreaterThanOrEqual(1);
    expect(result.summary.blockers).toBeGreaterThanOrEqual(1);
    expect(result.summary.risks).toBeGreaterThanOrEqual(1);
    expect(result.summary.deadlines).toBeGreaterThanOrEqual(1);
    expect(result.summary.approvalGates).toBeGreaterThanOrEqual(1);

    expect(result.decisions.some((d) => d.question === "Ship it?")).toBe(true);
    expect(result.blockers.some((b) => b.reason === "Needs review")).toBe(true);
    expect(result.risks.some((r) => r.title === "High risk item")).toBe(true);
    expect(result.deadlines.some((d) => d.title === "Due soon item")).toBe(true);
    expect(result.approvalGates.some((a) => a.title === "In review item")).toBe(true);
  });

  it("scopes results to the user's accessible clients only", async () => {
    const result = await getItemsNeedingAttention(managerCtx);
    expect(result.risks.some((r) => r.title === "Other client risk")).toBe(false);

    const outsiderResult = await getItemsNeedingAttention(outsiderCtx);
    expect(outsiderResult.risks.some((r) => r.title === "High risk item")).toBe(false);
    expect(outsiderResult.risks.some((r) => r.title === "Other client risk")).toBe(true);
  });

  it("returns an empty aggregation for a user with no accessible items", async () => {
    const org = await db.organization.create({ data: { name: "Empty Org", slug: `empty-org-${Date.now()}` } });
    const client = await db.client.create({ data: { organizationId: org.id, name: "Empty Client", slug: `empty-${Date.now()}` } });
    const user = await db.user.create({ data: { email: `empty-user-${Date.now()}@test.local`, name: "Empty User" } });
    await db.clientMembership.create({ data: { userId: user.id, clientId: client.id, role: "MANAGER" } });

    const emptyCtx: AuthContext = {
      userId: user.id,
      displayName: "Empty User",
      isOrgAdmin: false,
      memberships: [{ clientId: client.id, role: "MANAGER" }],
    };

    const result = await getItemsNeedingAttention(emptyCtx);
    expect(result.summary).toEqual({ decisions: 0, blockers: 0, risks: 0, deadlines: 0, approvalGates: 0 });

    await db.organization.delete({ where: { id: org.id } });
    await db.user.delete({ where: { id: user.id } });
  });
});
