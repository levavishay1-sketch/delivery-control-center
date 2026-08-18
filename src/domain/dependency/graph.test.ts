import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDependency } from "./commands";
import { getProjectWorkGraph, getWorkItemDependencyGraph } from "./queries";
import { createWorkItem } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres for the Dependency Graph
 * visualization's data source.
 */

let clientId: string;
let projectId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;
let outsiderCtx: AuthContext;
const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Graph Test Org", slug: `graph-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Graph Test Client", slug: "graph-test" } });
  clientId = client.id;

  const project = await db.project.create({
    data: { clientId, name: "Graph Test Project", key: `GRA${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;

  const manager = await db.user.create({ data: { email: `graph-manager-${Date.now()}@test.local`, name: "Graph Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Graph Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };

  const viewer = await db.user.create({ data: { email: `graph-viewer-${Date.now()}@test.local`, name: "Graph Viewer" } });
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });
  viewerCtx = { userId: viewer.id, displayName: "Graph Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };

  const outsider = await db.user.create({ data: { email: `graph-outsider-${Date.now()}@test.local`, name: "Graph Outsider" } });
  outsiderCtx = { userId: outsider.id, displayName: "Graph Outsider", isOrgAdmin: false, memberships: [] };
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe("getWorkItemDependencyGraph", () => {
  it("returns just the single node when there are no dependencies", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Isolated item" });
    const graph = await getWorkItemDependencyGraph(workItem.id);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].id).toBe(workItem.id);
    expect(graph.edges).toHaveLength(0);
    expect(graph.truncated).toBe(false);
  });

  it("collects the full connected neighborhood across a multi-hop chain", async () => {
    // A depends on B depends on C; D depends on B too (fan-in). Starting from C
    // (a leaf with no direct link to A or D) should still reach the whole chain.
    const { workItem: a } = await createWorkItem(managerCtx, { projectId, title: "Graph A" });
    const { workItem: b } = await createWorkItem(managerCtx, { projectId, title: "Graph B" });
    const { workItem: c } = await createWorkItem(managerCtx, { projectId, title: "Graph C" });
    const { workItem: d } = await createWorkItem(managerCtx, { projectId, title: "Graph D" });
    const { workItem: unrelated } = await createWorkItem(managerCtx, { projectId, title: "Unrelated" });

    await addDependency(managerCtx, { workItemId: a.id, dependsOnWorkItemId: b.id, reason: "A needs B" });
    await addDependency(managerCtx, { workItemId: b.id, dependsOnWorkItemId: c.id, reason: "B needs C" });
    await addDependency(managerCtx, { workItemId: d.id, dependsOnWorkItemId: b.id, reason: "D needs B" });

    const graph = await getWorkItemDependencyGraph(c.id);
    const nodeIds = graph.nodes.map((n) => n.id).sort();
    expect(nodeIds).toEqual([a.id, b.id, c.id, d.id].sort());
    expect(nodeIds).not.toContain(unrelated.id);
    expect(graph.edges).toHaveLength(3);
  });
});

describe("getProjectWorkGraph", () => {
  it("returns every WorkItem in the project, not a paginated subset", async () => {
    const { workItem: x } = await createWorkItem(managerCtx, { projectId, title: "Planner X" });
    const { workItem: y } = await createWorkItem(managerCtx, { projectId, title: "Planner Y" });

    const graph = await getProjectWorkGraph(managerCtx, projectId);
    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain(x.id);
    expect(nodeIds).toContain(y.id);
  });

  it("marks an OPEN item with no dependencies as ready to start", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Planner ready, no deps" });

    const graph = await getProjectWorkGraph(managerCtx, projectId);
    const node = graph.nodes.find((n) => n.id === workItem.id);
    expect(node?.readyToStart).toBe(true);
  });

  it("marks an item depending on a non-resolved item as not ready", async () => {
    const { workItem: blocker } = await createWorkItem(managerCtx, { projectId, title: "Planner blocker" });
    const { workItem: blocked } = await createWorkItem(managerCtx, { projectId, title: "Planner blocked" });
    await addDependency(managerCtx, { workItemId: blocked.id, dependsOnWorkItemId: blocker.id, reason: "needs blocker" });

    const graph = await getProjectWorkGraph(managerCtx, projectId);
    const node = graph.nodes.find((n) => n.id === blocked.id);
    expect(node?.readyToStart).toBe(false);
  });

  it("marks an item ready once its dependency is resolved", async () => {
    const { workItem: dep } = await createWorkItem(managerCtx, { projectId, title: "Planner resolved dep" });
    const { workItem: item } = await createWorkItem(managerCtx, { projectId, title: "Planner unblocked" });
    await addDependency(managerCtx, { workItemId: item.id, dependsOnWorkItemId: dep.id, reason: "needs dep" });
    await db.workItem.update({ where: { id: dep.id }, data: { status: "COMPLETED" } });

    const graph = await getProjectWorkGraph(managerCtx, projectId);
    const node = graph.nodes.find((n) => n.id === item.id);
    expect(node?.readyToStart).toBe(true);
  });

  it("never marks a non-OPEN/IN_PROGRESS item as ready, even with satisfied dependencies", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Planner draft item" });
    await db.workItem.update({ where: { id: workItem.id }, data: { status: "DRAFT" } });

    const graph = await getProjectWorkGraph(managerCtx, projectId);
    const node = graph.nodes.find((n) => n.id === workItem.id);
    expect(node?.readyToStart).toBe(false);
  });

  it("a read-only user can view the project work graph", async () => {
    const graph = await getProjectWorkGraph(viewerCtx, projectId);
    expect(graph.nodes.length).toBeGreaterThan(0);
  });

  it("refuses a user with no access to the project's client", async () => {
    await expect(getProjectWorkGraph(outsiderCtx, projectId)).rejects.toThrow(ForbiddenError);
  });
});
