import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDependency } from "./commands";
import { getWorkItemDependencyGraph } from "./queries";
import { createWorkItem } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres for the Dependency Graph
 * visualization's data source.
 */

let clientId: string;
let projectId: string;
let managerCtx: AuthContext;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Graph Test Org", slug: `graph-test-org-${Date.now()}` } });
  const client = await db.client.create({ data: { organizationId: org.id, name: "Graph Test Client", slug: "graph-test" } });
  clientId = client.id;

  const project = await db.project.create({
    data: { clientId, name: "Graph Test Project", key: `GRA${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;

  const manager = await db.user.create({ data: { email: `graph-manager-${Date.now()}@test.local`, name: "Graph Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Graph Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { clients: { some: { id: clientId } } } });
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
