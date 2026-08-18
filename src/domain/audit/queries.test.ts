import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { listAuditEvents, getAuditActors, listRecentAuditEvents } from "./queries";
import { createWorkItem } from "@/domain/work-item/commands";
import { createBlocker } from "@/domain/blocker/commands";
import { startPipeline } from "@/domain/pipeline/commands";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres. Also proves the 200-row hard
 * truncation is gone: creates > 200 events for one project and confirms every
 * page of results is reachable via pagination, not silently cut off.
 */

let clientId: string;
let otherClientId: string;
let projectId: string;
let managerUserId: string;
let outsiderUserId: string;
let managerCtx: AuthContext;
let outsiderCtx: AuthContext;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Audit Test Org", slug: `audit-test-org-${Date.now()}` } });
  const client = await db.client.create({ data: { organizationId: org.id, name: "Audit Test Client", slug: "audit-test" } });
  clientId = client.id;
  const otherClient = await db.client.create({ data: { organizationId: org.id, name: "Other Client", slug: `audit-other-${Date.now()}` } });
  otherClientId = otherClient.id;

  const project = await db.project.create({
    data: { clientId, name: "Audit Test Project", key: `AUD${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;

  const manager = await db.user.create({ data: { email: `audit-manager-${Date.now()}@test.local`, name: "Audit Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const outsider = await db.user.create({ data: { email: `audit-outsider-${Date.now()}@test.local`, name: "Audit Outsider" } });
  outsiderUserId = outsider.id;
  await db.clientMembership.create({ data: { userId: outsider.id, clientId: otherClientId, role: "MANAGER" } });

  managerCtx = { userId: managerUserId, displayName: "Audit Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  outsiderCtx = {
    userId: outsiderUserId,
    displayName: "Audit Outsider",
    isOrgAdmin: false,
    memberships: [{ clientId: otherClientId, role: "MANAGER" }],
  };

  // 205 "created work item" events — more than the old 200-row hard cap.
  for (let i = 0; i < 205; i++) {
    await createWorkItem(managerCtx, { projectId, title: `Bulk item ${i}` });
  }

  // One blocker event, for action-category filtering.
  const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Blocked item" });
  await createBlocker(managerCtx, {
    blockingItemId: workItem.id,
    reason: "Audit filter check",
    requiredAction: "Fix it",
    ownerId: managerUserId,
  });
}, 60_000);

afterAll(async () => {
  await db.organization.deleteMany({ where: { clients: { some: { id: clientId } } } });
  await db.user.deleteMany({ where: { id: { in: [managerUserId, outsiderUserId] } } });
});

describe("listAuditEvents", () => {
  it("has no hard truncation — every page beyond the old 200-row cap is reachable", async () => {
    const page1 = await listAuditEvents(managerCtx, { projectId, page: 1, pageSize: 100 });
    expect(page1.total).toBeGreaterThan(200);
    expect(page1.events).toHaveLength(100);

    const page3 = await listAuditEvents(managerCtx, { projectId, page: 3, pageSize: 100 });
    expect(page3.events.length).toBeGreaterThan(0);
  });

  it("filters by project", async () => {
    const result = await listAuditEvents(managerCtx, { projectId });
    expect(result.events.every((e) => e.projectId === projectId)).toBe(true);
  });

  it("includes pipeline-scoped events, which only set pipelineId (not projectId directly)", async () => {
    // Regression: the project filter used to be a direct `{ projectId }` match, which silently
    // excluded almost every pipeline/stage audit event (drafts, approvals, "started the
    // pipeline", "Pipeline advanced to X", ...) — found by Task Group 11's E2E scenario
    // asserting against the Audit Trail page's project filter.
    await db.constitution.create({
      data: { projectId, version: 1, status: "APPROVED", content: "# Constitution", approvedAt: new Date() },
    });
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Pipeline-scoped audit fixture" });
    const pipeline = await startPipeline(managerCtx, workItem.id);

    const result = await listAuditEvents(managerCtx, { projectId, pageSize: 500 });
    const startedEvent = result.events.find((e) => e.pipelineId === pipeline.id && e.action.includes("started the pipeline"));
    expect(startedEvent).toBeDefined();
    expect(startedEvent!.projectId).toBeNull();
  });

  it("filters by action category", async () => {
    const result = await listAuditEvents(managerCtx, { projectId, actionCategory: "blocker_created" });
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.every((e) => e.action.includes("created blocker on"))).toBe(true);
  });

  it("filters by actor", async () => {
    const result = await listAuditEvents(managerCtx, { projectId, actorId: managerUserId, pageSize: 1 });
    expect(result.events.every((e) => e.userId === managerUserId)).toBe(true);
  });

  it("filters by date range", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = await listAuditEvents(managerCtx, { projectId, dateFrom: future });
    expect(result.total).toBe(0);
  });

  it("scopes results to the user's accessible clients only", async () => {
    const outsiderResult = await listAuditEvents(outsiderCtx, {});
    expect(outsiderResult.events.every((e) => e.projectId !== projectId)).toBe(true);
  });
});

describe("getAuditActors", () => {
  it("returns distinct actors with events in scope", async () => {
    const actors = await getAuditActors(managerCtx, projectId);
    expect(actors.some((a) => a.id === managerUserId)).toBe(true);
  });

  it("excludes actors from other clients", async () => {
    const actors = await getAuditActors(outsiderCtx, undefined);
    expect(actors.some((a) => a.id === managerUserId)).toBe(false);
  });
});

describe("listRecentAuditEvents", () => {
  it("respects the limit and orders most-recent-first — feeds the Dashboard's activity feed", async () => {
    const events = await listRecentAuditEvents(managerCtx, 3);
    expect(events).toHaveLength(3);
    const timestamps = events.map((e) => e.createdAt.getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("scopes results to the user's accessible clients only", async () => {
    const outsiderEvents = await listRecentAuditEvents(outsiderCtx, 200);
    expect(outsiderEvents.every((e) => e.projectId !== projectId)).toBe(true);
  });
});
