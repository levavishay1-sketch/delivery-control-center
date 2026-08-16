import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { searchAccessible } from "./queries";
import { createWorkItem } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres.
 */

let orgId: string;
let clientId: string;
let otherClientId: string;
let projectId: string;
let managerUserId: string;
let outsiderUserId: string;
let managerCtx: AuthContext;
let outsiderCtx: AuthContext;

const suffix = Date.now().toString(36);

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Search Test Org", slug: `search-test-org-${suffix}` } });
  orgId = org.id;

  const client = await db.client.create({ data: { organizationId: org.id, name: "Search Test Client", slug: `search-test-${suffix}` } });
  clientId = client.id;

  const otherClient = await db.client.create({ data: { organizationId: org.id, name: "Other Client", slug: `search-other-${suffix}` } });
  otherClientId = otherClient.id;

  const project = await db.project.create({
    data: { clientId, name: `Searchable Project ${suffix}`, key: `SRC${suffix}`.toUpperCase().slice(0, 10) },
  });
  projectId = project.id;

  const otherProject = await db.project.create({
    data: { clientId: otherClientId, name: `Other Client Project ${suffix}`, key: `OSR${suffix}`.toUpperCase().slice(0, 10) },
  });

  const manager = await db.user.create({ data: { email: `search-manager-${suffix}@test.local`, name: "Search Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const outsider = await db.user.create({ data: { email: `search-outsider-${suffix}@test.local`, name: "Search Outsider" } });
  outsiderUserId = outsider.id;
  await db.clientMembership.create({ data: { userId: outsider.id, clientId: otherClientId, role: "MANAGER" } });

  managerCtx = { userId: managerUserId, displayName: "Search Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  outsiderCtx = {
    userId: outsiderUserId,
    displayName: "Search Outsider",
    isOrgAdmin: false,
    memberships: [{ clientId: otherClientId, role: "MANAGER" }],
  };

  await createWorkItem(managerCtx, { projectId, title: `Findable widget ${suffix}` });
  await createWorkItem(outsiderCtx, { projectId: otherProject.id, title: `Findable widget ${suffix}` });
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } });
  await db.user.deleteMany({ where: { id: { in: [managerUserId, outsiderUserId] } } });
});

describe("searchAccessible", () => {
  it("returns an empty result for a blank query", async () => {
    const result = await searchAccessible(managerCtx, "   ");
    expect(result).toEqual({ workItems: [], projects: [] });
  });

  it("finds work items and projects the user can access", async () => {
    const result = await searchAccessible(managerCtx, `Findable widget ${suffix}`);
    expect(result.workItems).toHaveLength(1);
    expect(result.workItems[0].project.name).toBe(`Searchable Project ${suffix}`);

    const projectResult = await searchAccessible(managerCtx, `Searchable Project ${suffix}`);
    expect(projectResult.projects.some((p) => p.name === `Searchable Project ${suffix}`)).toBe(true);
  });

  it("excludes work items and projects from clients the user cannot access", async () => {
    const result = await searchAccessible(managerCtx, `Findable widget ${suffix}`);
    expect(result.workItems.every((w) => w.project.name !== `Other Client Project ${suffix}`)).toBe(true);

    const projectResult = await searchAccessible(managerCtx, `Other Client Project ${suffix}`);
    expect(projectResult.projects).toHaveLength(0);
  });

  it("scopes the same query differently per user", async () => {
    const outsiderResult = await searchAccessible(outsiderCtx, `Findable widget ${suffix}`);
    expect(outsiderResult.workItems).toHaveLength(1);
    expect(outsiderResult.workItems[0].project.name).toBe(`Other Client Project ${suffix}`);
  });
});
