import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createClient, updateClient, deactivateClient, reactivateClient } from "./commands";
import { listActiveClients } from "./queries";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres.
 */

let organizationId: string;
let clientId: string;
let orgAdminCtx: AuthContext;
let managerCtx: AuthContext;
const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Client Commands Test Org", slug: `client-commands-org-${Date.now()}` } });
  orgIds.push(org.id);
  organizationId = org.id;

  const client = await db.client.create({ data: { organizationId, name: "Client Commands Test Client", slug: "client-commands-test" } });
  clientId = client.id;

  const admin = await db.user.create({ data: { email: `client-cmd-admin-${Date.now()}@test.local`, name: "Client Cmd Admin", isOrgAdmin: true } });
  orgAdminCtx = { userId: admin.id, displayName: "Client Cmd Admin", isOrgAdmin: true, memberships: [] };

  const manager = await db.user.create({ data: { email: `client-cmd-manager-${Date.now()}@test.local`, name: "Client Cmd Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Client Cmd Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe("createClient", () => {
  it("creates a client for an org admin", async () => {
    const client = await createClient(orgAdminCtx, { organizationId, name: "New Client", slug: `new-client-${Date.now()}` });
    expect(client.name).toBe("New Client");
    expect(client.active).toBe(true);
  });

  it("rejects a non-org-admin", async () => {
    await expect(
      createClient(managerCtx, { organizationId, name: "Rejected Client", slug: `rejected-${Date.now()}` })
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("updateClient", () => {
  it("updates name and slug for an org admin", async () => {
    const updated = await updateClient(orgAdminCtx, clientId, { name: "Renamed Client", slug: "renamed-client" });
    expect(updated.name).toBe("Renamed Client");
    expect(updated.slug).toBe("renamed-client");
  });

  it("rejects a non-org-admin", async () => {
    await expect(updateClient(managerCtx, clientId, { name: "Should Not Apply" })).rejects.toThrow(ForbiddenError);
  });
});

describe("deactivateClient / reactivateClient", () => {
  it("deactivates and reactivates a client for an org admin, without touching any related row", async () => {
    const deactivated = await deactivateClient(orgAdminCtx, clientId);
    expect(deactivated.active).toBe(false);

    const stillThere = await db.client.findUnique({ where: { id: clientId } });
    expect(stillThere).not.toBeNull();

    const reactivated = await reactivateClient(orgAdminCtx, clientId);
    expect(reactivated.active).toBe(true);
  });

  it("rejects a non-org-admin for both", async () => {
    await expect(deactivateClient(managerCtx, clientId)).rejects.toThrow(ForbiddenError);
    await expect(reactivateClient(managerCtx, clientId)).rejects.toThrow(ForbiddenError);
  });
});

describe("listActiveClients", () => {
  it("excludes a deactivated client", async () => {
    await deactivateClient(orgAdminCtx, clientId);
    const active = await listActiveClients(orgAdminCtx);
    expect(active.some((c) => c.id === clientId)).toBe(false);

    await reactivateClient(orgAdminCtx, clientId);
    const activeAgain = await listActiveClients(orgAdminCtx);
    expect(activeAgain.some((c) => c.id === clientId)).toBe(true);
  });
});
