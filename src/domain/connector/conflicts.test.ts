import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FetchedWorkItem } from "@/lib/integrations";

// Mocks only getIntegrationAdapter (to inject controllable fetch results per test) — everything
// else (encrypt/decryptIntegrationConfig) stays real, and every other module in this test uses
// the real Postgres db, same as the rest of this project's domain test suites.
let mockFetchResult: FetchedWorkItem[] = [];
vi.mock("@/lib/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations")>();
  return {
    ...actual,
    getIntegrationAdapter: () => ({
      type: "JIRA",
      fetchWorkItems: async () => mockFetchResult,
    }),
  };
});

const { db } = await import("@/lib/db");
const { runConnectorSync } = await import("./sync");
const { createOrUpdateSyncConflict, listOpenConflicts, resolveConflict } = await import("./conflicts");
const { recordManualProvenance } = await import("./provenance");
const { getOrCreateConnectorForProject, configureConnector } = await import("./commands");
const { createProject } = await import("@/domain/project/commands");
const { ValidationError } = await import("@/domain/shared/errors");
type AuthContext = import("@/domain/shared/context").AuthContext;

let clientId: string;
let managerCtx: AuthContext;
const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Conflict Test Org", slug: `conflict-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Conflict Test Client", slug: "conflict-test" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `conflict-manager-${Date.now()}@test.local`, name: "Conflict Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Conflict Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
});

afterEach(() => {
  mockFetchResult = [];
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

async function makeJiraProjectWithConnector(name: string) {
  const project = await createProject(managerCtx, {
    clientId,
    name,
    key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
  });
  await configureConnector(managerCtx, project.id, {
    type: "JIRA",
    config: { baseUrl: "https://example.atlassian.net", email: "a@b.com", apiToken: "secret", projectKey: "ABC" },
  });
  const connector = await getOrCreateConnectorForProject(project.id);
  return { project, connector };
}

describe("runConnectorSync — provenance and conflict detection", () => {
  it("a field last set by sync (no manual edit) updates normally, no conflict", async () => {
    const { project, connector } = await makeJiraProjectWithConnector("Sync Normal Update");
    mockFetchResult = [{ externalId: "SYNC-1", title: "Original title", status: "To Do" }];
    await runConnectorSync(connector.id);

    mockFetchResult = [{ externalId: "SYNC-1", title: "Updated title", status: "In Progress" }];
    const counts = await runConnectorSync(connector.id);
    expect(counts.itemsConflicted).toBe(0);

    const workItem = await db.workItem.findFirstOrThrow({ where: { projectId: project.id, externalId: "SYNC-1" } });
    expect(workItem.title).toBe("Updated title");
    expect(workItem.status).toBe("IN_PROGRESS");

    const provenance = await db.fieldProvenance.findUnique({ where: { workItemId_field: { workItemId: workItem.id, field: "title" } } });
    expect(provenance?.source).toBe("SYNC");
  });

  it("a sync that would overwrite a manually-edited field creates a conflict and leaves the field unchanged", async () => {
    const { project, connector } = await makeJiraProjectWithConnector("Sync Conflict Creation");
    mockFetchResult = [{ externalId: "CONF-1", title: "Original title", status: "To Do" }];
    await runConnectorSync(connector.id);

    const workItem = await db.workItem.findFirstOrThrow({ where: { projectId: project.id, externalId: "CONF-1" } });
    await recordManualProvenance(workItem.id, "title", managerCtx.userId);
    await db.workItem.update({ where: { id: workItem.id }, data: { title: "Manually edited title" } });

    mockFetchResult = [{ externalId: "CONF-1", title: "Incoming synced title", status: "To Do" }];
    const counts = await runConnectorSync(connector.id);
    expect(counts.itemsConflicted).toBe(1);

    const unchanged = await db.workItem.findUniqueOrThrow({ where: { id: workItem.id } });
    expect(unchanged.title).toBe("Manually edited title");

    const conflict = await db.syncConflict.findUniqueOrThrow({ where: { workItemId_field: { workItemId: workItem.id, field: "title" } } });
    expect(conflict.currentValue).toBe("Manually edited title");
    expect(conflict.incomingValue).toBe("Incoming synced title");
    expect(conflict.resolvedAt).toBeNull();
  });

  it("a matching incoming value creates no conflict even though the field was manually set", async () => {
    const { project, connector } = await makeJiraProjectWithConnector("Sync Conflict Match");
    mockFetchResult = [{ externalId: "MATCH-1", title: "Same title", status: "To Do" }];
    await runConnectorSync(connector.id);

    const workItem = await db.workItem.findFirstOrThrow({ where: { projectId: project.id, externalId: "MATCH-1" } });
    await recordManualProvenance(workItem.id, "title", managerCtx.userId);

    mockFetchResult = [{ externalId: "MATCH-1", title: "Same title", status: "To Do" }];
    const counts = await runConnectorSync(connector.id);
    expect(counts.itemsConflicted).toBe(0);

    const conflict = await db.syncConflict.findUnique({ where: { workItemId_field: { workItemId: workItem.id, field: "title" } } });
    expect(conflict).toBeNull();
  });

  it("a second sync while a conflict is open updates the existing row's incomingValue rather than duplicating it", async () => {
    const { project, connector } = await makeJiraProjectWithConnector("Sync Conflict Update");
    mockFetchResult = [{ externalId: "DUP-1", title: "Original title", status: "To Do" }];
    await runConnectorSync(connector.id);

    const workItem = await db.workItem.findFirstOrThrow({ where: { projectId: project.id, externalId: "DUP-1" } });
    await recordManualProvenance(workItem.id, "title", managerCtx.userId);
    await db.workItem.update({ where: { id: workItem.id }, data: { title: "Manually edited" } });

    mockFetchResult = [{ externalId: "DUP-1", title: "First incoming value", status: "To Do" }];
    await runConnectorSync(connector.id);

    mockFetchResult = [{ externalId: "DUP-1", title: "Second incoming value", status: "To Do" }];
    await runConnectorSync(connector.id);

    const conflicts = await db.syncConflict.findMany({ where: { workItemId: workItem.id, field: "title" } });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].incomingValue).toBe("Second incoming value");
  });
});

describe("createOrUpdateSyncConflict", () => {
  it("upserts by [workItemId, field] rather than creating duplicate rows", async () => {
    const { project } = await makeJiraProjectWithConnector("Direct Conflict Upsert");
    const workItem = await db.workItem.create({
      data: { projectId: project.id, source: "JIRA", externalId: "DIRECT-1", title: "T", status: "OPEN" },
    });
    const connector = await getOrCreateConnectorForProject(project.id);

    await createOrUpdateSyncConflict(workItem.id, "title", "current", "incoming-1", connector.id);
    await createOrUpdateSyncConflict(workItem.id, "title", "current", "incoming-2", connector.id);

    const rows = await db.syncConflict.findMany({ where: { workItemId: workItem.id, field: "title" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].incomingValue).toBe("incoming-2");
  });
});

describe("resolveConflict", () => {
  async function makeOpenConflict(name: string) {
    const { project } = await makeJiraProjectWithConnector(name);
    const workItem = await db.workItem.create({
      data: { projectId: project.id, source: "JIRA", externalId: `RES-${Date.now()}`, title: "Manual value", status: "OPEN" },
    });
    await recordManualProvenance(workItem.id, "title", managerCtx.userId);
    const connector = await getOrCreateConnectorForProject(project.id);
    const conflict = await createOrUpdateSyncConflict(workItem.id, "title", "Manual value", "Incoming value", connector.id);
    return { project, workItem, conflict };
  }

  it("KEPT_MANUAL closes the conflict without changing the field, and is audited", async () => {
    const { workItem, conflict } = await makeOpenConflict("Resolve Kept Manual");
    const resolved = await resolveConflict(managerCtx, conflict.id, "KEPT_MANUAL");
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.resolution).toBe("KEPT_MANUAL");

    const unchanged = await db.workItem.findUniqueOrThrow({ where: { id: workItem.id } });
    expect(unchanged.title).toBe("Manual value");

    const auditEvent = await db.auditEvent.findFirst({ where: { workItemId: workItem.id, action: { contains: "kept manual value" } } });
    expect(auditEvent).not.toBeNull();
  });

  it("ACCEPTED_INCOMING writes the incoming value, re-records provenance as SYNC, and is audited", async () => {
    const { workItem, conflict } = await makeOpenConflict("Resolve Accepted Incoming");
    const resolved = await resolveConflict(managerCtx, conflict.id, "ACCEPTED_INCOMING");
    expect(resolved.resolution).toBe("ACCEPTED_INCOMING");

    const updated = await db.workItem.findUniqueOrThrow({ where: { id: workItem.id } });
    expect(updated.title).toBe("Incoming value");

    const provenance = await db.fieldProvenance.findUniqueOrThrow({ where: { workItemId_field: { workItemId: workItem.id, field: "title" } } });
    expect(provenance.source).toBe("SYNC");

    const auditEvent = await db.auditEvent.findFirst({ where: { workItemId: workItem.id, action: { contains: "accepted incoming value" } } });
    expect(auditEvent).not.toBeNull();
  });

  it("rejects resolving an already-resolved conflict", async () => {
    const { conflict } = await makeOpenConflict("Resolve Already Resolved");
    await resolveConflict(managerCtx, conflict.id, "KEPT_MANUAL");
    await expect(resolveConflict(managerCtx, conflict.id, "KEPT_MANUAL")).rejects.toThrow(ValidationError);
  });
});

describe("listOpenConflicts", () => {
  it("lists only unresolved conflicts for the project, most recent first", async () => {
    const { project } = await makeJiraProjectWithConnector("List Open Conflicts");
    const connector = await getOrCreateConnectorForProject(project.id);
    const workItem = await db.workItem.create({
      data: { projectId: project.id, source: "JIRA", externalId: "LIST-1", title: "T", status: "OPEN" },
    });
    const conflict = await createOrUpdateSyncConflict(workItem.id, "title", "current", "incoming", connector.id);

    const open = await listOpenConflicts(managerCtx, project.id);
    expect(open.map((c) => c.id)).toContain(conflict.id);

    await resolveConflict(managerCtx, conflict.id, "KEPT_MANUAL");
    const afterResolve = await listOpenConflicts(managerCtx, project.id);
    expect(afterResolve.map((c) => c.id)).not.toContain(conflict.id);
  });
});
