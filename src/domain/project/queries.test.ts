import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { listProjectsForHome, listProjectsWithCounts, getProjectByIdForUser } from "./queries";
import { createWorkItem } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres for the project queries that
 * feed the Dashboard (Task Group 13.2 — "Dashboard queries: verify counts are
 * accurate, authorization enforced"). getItemsNeedingAttention, the Dashboard's
 * other data source, already has its own dedicated test file
 * (src/domain/attention/queries.test.ts).
 */

let clientId: string;
let otherClientId: string;
let projectId: string;
let managerUserId: string;
let outsiderUserId: string;
let orgAdminUserId: string;
let managerCtx: AuthContext;
let outsiderCtx: AuthContext;
let orgAdminCtx: AuthContext;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Project Query Test Org", slug: `proj-test-org-${Date.now()}` } });
  const client = await db.client.create({ data: { organizationId: org.id, name: "Project Query Test Client", slug: "proj-test" } });
  clientId = client.id;
  const otherClient = await db.client.create({ data: { organizationId: org.id, name: "Other Client", slug: `proj-other-${Date.now()}` } });
  otherClientId = otherClient.id;

  const project = await db.project.create({
    data: { clientId, name: "Project Query Test Project", key: `PJQ${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;

  await db.project.create({
    data: { clientId: otherClientId, name: "Other Client Project", key: `OCP${Date.now().toString(36).toUpperCase()}` },
  });

  const manager = await db.user.create({ data: { email: `proj-manager-${Date.now()}@test.local`, name: "Project Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const outsider = await db.user.create({ data: { email: `proj-outsider-${Date.now()}@test.local`, name: "Project Outsider" } });
  outsiderUserId = outsider.id;
  await db.clientMembership.create({ data: { userId: outsider.id, clientId: otherClientId, role: "MANAGER" } });

  const orgAdmin = await db.user.create({ data: { email: `proj-admin-${Date.now()}@test.local`, name: "Project Org Admin", isOrgAdmin: true } });
  orgAdminUserId = orgAdmin.id;

  managerCtx = { userId: managerUserId, displayName: "Project Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  outsiderCtx = {
    userId: outsiderUserId,
    displayName: "Project Outsider",
    isOrgAdmin: false,
    memberships: [{ clientId: otherClientId, role: "MANAGER" }],
  };
  orgAdminCtx = { userId: orgAdminUserId, displayName: "Project Org Admin", isOrgAdmin: true, memberships: [] };

  await createWorkItem(managerCtx, { projectId, title: "Query test item 1" });
  await createWorkItem(managerCtx, { projectId, title: "Query test item 2" });
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { clients: { some: { id: clientId } } } });
  await db.user.deleteMany({ where: { id: { in: [managerUserId, outsiderUserId, orgAdminUserId] } } });
});

describe("listProjectsForHome", () => {
  it("returns projects with client and work items included, scoped to accessible clients", async () => {
    const projects = await listProjectsForHome(managerCtx);
    const found = projects.find((p) => p.id === projectId);
    expect(found).toBeTruthy();
    expect(found?.client.id).toBe(clientId);
    expect(found?.workItems).toHaveLength(2);
  });

  it("excludes projects from clients the user doesn't belong to", async () => {
    const projects = await listProjectsForHome(outsiderCtx);
    expect(projects.some((p) => p.id === projectId)).toBe(false);
  });

  it("returns every project for an org admin regardless of membership", async () => {
    const projects = await listProjectsForHome(orgAdminCtx);
    expect(projects.some((p) => p.id === projectId)).toBe(true);
  });
});

describe("listProjectsWithCounts", () => {
  it("returns an accurate work-item count per project", async () => {
    const projects = await listProjectsWithCounts(managerCtx);
    const found = projects.find((p) => p.id === projectId);
    expect(found?._count.workItems).toBe(2);
  });

  it("excludes projects from clients the user doesn't belong to", async () => {
    const projects = await listProjectsWithCounts(outsiderCtx);
    expect(projects.some((p) => p.id === projectId)).toBe(false);
  });
});

describe("getProjectByIdForUser", () => {
  it("returns the project when ctx has access", async () => {
    const project = await getProjectByIdForUser(managerCtx, projectId);
    expect(project?.id).toBe(projectId);
  });

  it("throws ForbiddenError when ctx has no membership on the project's client", async () => {
    await expect(getProjectByIdForUser(outsiderCtx, projectId)).rejects.toThrow(ForbiddenError);
  });

  it("returns null for a non-existent project", async () => {
    const project = await getProjectByIdForUser(managerCtx, "nonexistent-id");
    expect(project).toBeNull();
  });
});
