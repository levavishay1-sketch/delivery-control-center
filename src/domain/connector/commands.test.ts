import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { configureConnector, getOrCreateConnectorForProject } from "./commands";
import { createProject } from "@/domain/project/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres — same rationale as the
 * other domain test suites in this project.
 */

let clientId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;

const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Connector Test Org", slug: `connector-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Connector Test Client", slug: "connector-test" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `connector-manager-${Date.now()}@test.local`, name: "Connector Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Connector Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };

  const viewer = await db.user.create({ data: { email: `connector-viewer-${Date.now()}@test.local`, name: "Connector Viewer" } });
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });
  viewerCtx = { userId: viewer.id, displayName: "Connector Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

function makeProject(name: string) {
  return createProject(managerCtx, {
    clientId,
    name,
    key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
  });
}

describe("createProject", () => {
  it("creates a Connector for the project atomically, backed by its integrationType", async () => {
    const project = await makeProject("Connector Create Project");
    const connector = await db.connector.findUnique({ where: { projectId: project.id } });
    expect(connector).not.toBeNull();
    expect(connector?.type).toBe("MANUAL");
    expect(connector?.status).toBe("DISCONNECTED");
  });
});

describe("getOrCreateConnectorForProject", () => {
  it("is idempotent: a second call returns the same row, never creates a duplicate", async () => {
    const project = await makeProject("Idempotent Connector Project");
    const first = await getOrCreateConnectorForProject(project.id);
    const second = await getOrCreateConnectorForProject(project.id);
    expect(second.id).toBe(first.id);

    const count = await db.connector.count({ where: { projectId: project.id } });
    expect(count).toBe(1);
  });
});

describe("configureConnector", () => {
  it("rejects a non-WRITE_ROLES caller", async () => {
    const project = await makeProject("Configure Connector Forbidden");
    await expect(
      configureConnector(viewerCtx, project.id, { type: "MANUAL" })
    ).rejects.toThrow(ForbiddenError);
  });

  it("updates the connector's type/config and marks it CONNECTED for a real integration type", async () => {
    const project = await makeProject("Configure Connector Success");
    const updated = await configureConnector(managerCtx, project.id, {
      type: "JIRA",
      config: { baseUrl: "https://example.atlassian.net", email: "a@b.com", apiToken: "secret", projectKey: "ABC" },
    });
    expect(updated.type).toBe("JIRA");
    expect(updated.status).toBe("CONNECTED");
  });

  it("requires config for a non-MANUAL type", async () => {
    const project = await makeProject("Configure Connector Missing Config");
    await expect(configureConnector(managerCtx, project.id, { type: "JIRA" })).rejects.toThrow();
  });
});
