import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getClientDetail } from "./queries";
import { createProject } from "@/domain/project/commands";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres.
 */

let clientId: string;
let managerCtx: AuthContext;
const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Client Queries Test Org", slug: `client-queries-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Client Queries Test Client", slug: "client-queries-test" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `client-queries-manager-${Date.now()}@test.local`, name: "Client Queries Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Client Queries Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe("getClientDetail", () => {
  it("resolves every project's connector directly via Connector.clientId (Slice 13)", async () => {
    const projectA = await createProject(managerCtx, { clientId, name: "Sources A", key: `SRCA${Date.now().toString(36).toUpperCase()}` });
    const projectB = await createProject(managerCtx, { clientId, name: "Sources B", key: `SRCB${Date.now().toString(36).toUpperCase()}` });

    const detail = await getClientDetail(managerCtx, clientId);
    expect(detail).not.toBeNull();

    const connectorProjectIds = detail!.connectors.map((c) => c.projectId).sort();
    expect(connectorProjectIds).toEqual([projectA.id, projectB.id].sort());
    for (const connector of detail!.connectors) {
      expect(connector.clientId).toBe(clientId);
    }
  });

  it("gives every newly created Connector a clientId matching its project's client, the same invariant the backfill migration establishes for pre-existing rows", async () => {
    const project = await createProject(managerCtx, { clientId, name: "Sources Invariant", key: `SRCI${Date.now().toString(36).toUpperCase()}` });
    const connector = await db.connector.findUniqueOrThrow({ where: { projectId: project.id } });
    const projectRow = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(connector.clientId).toBe(projectRow.clientId);
  });
});
