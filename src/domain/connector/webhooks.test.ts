import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { receiveWebhook } from "./webhooks";
import { getOrCreateConnectorForProject } from "./commands";
import { createProject } from "@/domain/project/commands";
import { NotFoundError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres — same rationale as the
 * other domain test suites in this project.
 */

let clientId: string;
let managerCtx: AuthContext;
const orgIds: string[] = [];
const jobIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Webhook Test Org", slug: `webhook-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Webhook Test Client", slug: "webhook-test" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `webhook-manager-${Date.now()}@test.local`, name: "Webhook Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Webhook Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
});

afterAll(async () => {
  if (jobIds.length > 0) await db.job.deleteMany({ where: { id: { in: jobIds } } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

function makeProject(name: string) {
  return createProject(managerCtx, {
    clientId,
    name,
    key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
  });
}

describe("receiveWebhook", () => {
  it("a genuinely new delivery triggers a sync (enqueues a SYNC_PROJECT job)", async () => {
    const project = await makeProject("Webhook New Delivery");
    const connector = await getOrCreateConnectorForProject(project.id);

    const result = await receiveWebhook(connector.id, `delivery-${Date.now()}`);
    expect(result.status).toBe("processed");
    if (result.status === "processed") jobIds.push(result.jobId);

    const deliveries = await db.webhookDelivery.count({ where: { connectorId: connector.id } });
    expect(deliveries).toBe(1);
  });

  it("the same delivery id received twice produces no additional sync effects", async () => {
    const project = await makeProject("Webhook Redelivery");
    const connector = await getOrCreateConnectorForProject(project.id);
    const deliveryId = `delivery-${Date.now()}`;

    const first = await receiveWebhook(connector.id, deliveryId);
    expect(first.status).toBe("processed");
    if (first.status === "processed") jobIds.push(first.jobId);

    const second = await receiveWebhook(connector.id, deliveryId);
    expect(second.status).toBe("duplicate");

    const jobCount = await db.job.count({ where: { type: "SYNC_PROJECT", payload: { path: ["connectorId"], equals: connector.id } } });
    expect(jobCount).toBe(1);

    const deliveries = await db.webhookDelivery.count({ where: { connectorId: connector.id, deliveryId } });
    expect(deliveries).toBe(1);
  });

  it("rejects a webhook for a connector that doesn't exist", async () => {
    await expect(receiveWebhook("does-not-exist", "delivery-1")).rejects.toThrow(NotFoundError);
  });
});
