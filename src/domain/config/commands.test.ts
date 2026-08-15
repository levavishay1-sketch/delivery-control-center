import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getEffectiveBudget, listConfigHistory } from "./queries";
import { previewBudgetImpact, resetToInherited, setBudget } from "./commands";
import { createProject } from "@/domain/project/commands";
import { ForbiddenError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres — same rationale as the other domain test
 * suites in this project.
 */

let organizationId: string;
let clientId: string;
let managerCtx: AuthContext;
let orgAdminCtx: AuthContext;
let viewerCtx: AuthContext;
const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Config Test Org", slug: `config-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  organizationId = org.id;
  const client = await db.client.create({ data: { organizationId: org.id, name: "Config Test Client", slug: "config-test" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `config-manager-${Date.now()}@test.local`, name: "Config Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Config Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };

  const viewer = await db.user.create({ data: { email: `config-viewer-${Date.now()}@test.local`, name: "Config Viewer" } });
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });
  viewerCtx = { userId: viewer.id, displayName: "Config Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };

  const orgAdmin = await db.user.create({ data: { email: `config-org-admin-${Date.now()}@test.local`, name: "Config Org Admin", isOrgAdmin: true } });
  orgAdminCtx = { userId: orgAdmin.id, displayName: "Config Org Admin", isOrgAdmin: true, memberships: [] };
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

function makeProject(name: string) {
  return createProject(managerCtx, {
    clientId,
    name,
    key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`,
  });
}

describe("getEffectiveBudget", () => {
  it("resolves to unbounded when nothing in the chain is set", async () => {
    const project = await makeProject("Unbounded Project");
    const result = await getEffectiveBudget("PROJECT", project.id);
    expect(result).toEqual({ value: null, sourceScope: null, isOverride: false });
  });

  it("a project's own override is reported as an override", async () => {
    const project = await makeProject("Own Override Project");
    await setBudget(managerCtx, "PROJECT", project.id, 50);
    const result = await getEffectiveBudget("PROJECT", project.id);
    expect(result.isOverride).toBe(true);
    expect(result.sourceScope).toBe("PROJECT");
    expect(result.value).toBe("50");
  });

  it("a project with no override inherits from the client", async () => {
    const project = await makeProject("Inherit From Client Project");
    await setBudget(managerCtx, "CLIENT", clientId, 100);
    try {
      const result = await getEffectiveBudget("PROJECT", project.id);
      expect(result.isOverride).toBe(false);
      expect(result.sourceScope).toBe("CLIENT");
      expect(result.value).toBe("100");
    } finally {
      await resetToInherited(managerCtx, "CLIENT", clientId);
    }
  });

  it("a project with no override, and a client with no override, inherits from the organization", async () => {
    const project = await makeProject("Inherit From Org Project");
    await setBudget(orgAdminCtx, "ORGANIZATION", organizationId, 200);
    try {
      const result = await getEffectiveBudget("PROJECT", project.id);
      expect(result.isOverride).toBe(false);
      expect(result.sourceScope).toBe("ORGANIZATION");
      expect(result.value).toBe("200");
    } finally {
      await resetToInherited(orgAdminCtx, "ORGANIZATION", organizationId);
    }
  });
});

describe("previewBudgetImpact", () => {
  it("a project scope always reports zero impact", async () => {
    const project = await makeProject("Preview Project Scope");
    const preview = await previewBudgetImpact("PROJECT", project.id);
    expect(preview).toEqual({ affectedClients: 0, affectedProjects: 0 });
  });

  it("a client scope counts projects with no override", async () => {
    await makeProject("Preview Client Impact A");
    await makeProject("Preview Client Impact B");
    const overridden = await makeProject("Preview Client Impact Overridden");
    await setBudget(managerCtx, "PROJECT", overridden.id, 5);

    const preview = await previewBudgetImpact("CLIENT", clientId);
    expect(preview.affectedProjects).toBeGreaterThanOrEqual(2);
  });

  it("an organization scope counts clients and projects with no override", async () => {
    const preview = await previewBudgetImpact("ORGANIZATION", organizationId);
    expect(preview.affectedClients).toBeGreaterThanOrEqual(1);
  });
});

describe("setBudget authorization", () => {
  it("rejects a VIEWER setting a project budget", async () => {
    const project = await makeProject("Viewer Set Project");
    await expect(setBudget(viewerCtx, "PROJECT", project.id, 10)).rejects.toThrow(ForbiddenError);
  });

  it("rejects a plain client WRITE_ROLES member setting the organization budget", async () => {
    await expect(setBudget(managerCtx, "ORGANIZATION", organizationId, 10)).rejects.toThrow(ForbiddenError);
  });

  it("an org admin can set the organization budget", async () => {
    const change = await setBudget(orgAdminCtx, "ORGANIZATION", organizationId, 300);
    expect(change.newValueUsd?.toString()).toBe("300");
    await resetToInherited(orgAdminCtx, "ORGANIZATION", organizationId);
  });
});

describe("ConfigChange history", () => {
  it("records every set and reset, most recent first", async () => {
    const project = await makeProject("History Project");
    await setBudget(managerCtx, "PROJECT", project.id, 10);
    await setBudget(managerCtx, "PROJECT", project.id, 20);
    await resetToInherited(managerCtx, "PROJECT", project.id);

    const history = await listConfigHistory("PROJECT", project.id);
    expect(history).toHaveLength(3);
    expect(history[0].newValueUsd).toBeNull();
    expect(history[1].newValueUsd?.toString()).toBe("20");
    expect(history[2].newValueUsd?.toString()).toBe("10");
    expect(history[2].oldValueUsd).toBeNull();
  });
});
