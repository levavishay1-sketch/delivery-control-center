import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createRequirement, declineRequirement, startSddForRequirement, updateRequirement } from "./commands";
import { getRequirementById, listRequirementsForClient } from "./queries";
import { createProject } from "@/domain/project/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError, ValidationError } from "@/domain/shared/errors";

let clientId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;
const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Requirement Test Org", slug: `requirement-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Requirement Test Client", slug: "requirement-client" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `requirement-manager-${Date.now()}@test.local`, name: "Requirement Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Requirement Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };

  const viewer = await db.user.create({ data: { email: `requirement-viewer-${Date.now()}@test.local`, name: "Requirement Viewer" } });
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });
  viewerCtx = { userId: viewer.id, displayName: "Requirement Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe("createRequirement", () => {
  it("creates a standalone Requirement in OPEN status", async () => {
    const requirement = await createRequirement(managerCtx, { clientId, title: "Improve onboarding" });
    expect(requirement.status).toBe("OPEN");
    expect(requirement.projectId).toBeNull();
    expect(requirement.type).toBe("TASK");

    const auditEvent = await db.auditEvent.findFirst({ where: { action: { contains: `created Requirement "Improve onboarding"` } } });
    expect(auditEvent).not.toBeNull();
  });

  it("creates a Project-linked Requirement", async () => {
    const project = await createProject(managerCtx, { clientId, name: "Linked Project", key: `LNK${Date.now().toString(36).toUpperCase()}` });
    const requirement = await createRequirement(managerCtx, { clientId, title: "Linked requirement", projectId: project.id });
    expect(requirement.projectId).toBe(project.id);
  });

  it("refuses a Project from a different client", async () => {
    const otherOrg = await db.organization.create({ data: { name: "Other Org", slug: `other-org-${Date.now()}` } });
    orgIds.push(otherOrg.id);
    const otherClient = await db.client.create({ data: { organizationId: otherOrg.id, name: "Other Client", slug: "other-client" } });
    const otherProject = await createProject(
      { ...managerCtx, memberships: [{ clientId: otherClient.id, role: "MANAGER" }] },
      { clientId: otherClient.id, name: "Other Project", key: `OTH${Date.now().toString(36).toUpperCase()}` }
    );
    await expect(createRequirement(managerCtx, { clientId, title: "Cross-client", projectId: otherProject.id })).rejects.toThrow(
      ValidationError
    );
  });

  it("refuses a read-only user", async () => {
    await expect(createRequirement(viewerCtx, { clientId, title: "Should fail" })).rejects.toThrow(ForbiddenError);
  });
});

describe("updateRequirement / declineRequirement", () => {
  it("updates an OPEN Requirement's title", async () => {
    const requirement = await createRequirement(managerCtx, { clientId, title: "Original title" });
    const updated = await updateRequirement(managerCtx, requirement.id, { title: "Updated title" });
    expect(updated.title).toBe("Updated title");
  });

  it("declines an OPEN Requirement", async () => {
    const requirement = await createRequirement(managerCtx, { clientId, title: "To decline" });
    const declined = await declineRequirement(managerCtx, requirement.id);
    expect(declined.status).toBe("DECLINED");
  });

  it("refuses to edit a DECLINED Requirement", async () => {
    const requirement = await createRequirement(managerCtx, { clientId, title: "Declined then edited" });
    await declineRequirement(managerCtx, requirement.id);
    await expect(updateRequirement(managerCtx, requirement.id, { title: "New title" })).rejects.toThrow(ValidationError);
  });
});

describe("startSddForRequirement", () => {
  it("creates a new Project and root WorkItem for a standalone Requirement", async () => {
    const requirement = await createRequirement(managerCtx, { clientId, title: "Standalone activation", type: "BUG" });
    const activated = await startSddForRequirement(managerCtx, requirement.id);

    expect(activated.status).toBe("SDD_ACTIVE");
    expect(activated.projectId).not.toBeNull();
    expect(activated.workItemId).not.toBeNull();

    const workItem = await db.workItem.findUniqueOrThrow({ where: { id: activated.workItemId! } });
    expect(workItem.projectId).toBe(activated.projectId);
    expect(workItem.type).toBe("BUG");
    expect(workItem.title).toBe("Standalone activation");

    const project = await db.project.findUniqueOrThrow({ where: { id: activated.projectId! } });
    expect(project.clientId).toBe(clientId);

    const auditEvent = await db.auditEvent.findFirst({ where: { action: { contains: `started SDD for Requirement "Standalone activation"` } } });
    expect(auditEvent).not.toBeNull();
  });

  it("reuses the existing Project for a Project-linked Requirement", async () => {
    const project = await createProject(managerCtx, {
      clientId,
      name: "Pre-existing Project",
      key: `PRE${Date.now().toString(36).toUpperCase()}`,
    });
    const requirement = await createRequirement(managerCtx, { clientId, title: "Linked activation", projectId: project.id });
    const activated = await startSddForRequirement(managerCtx, requirement.id);

    expect(activated.projectId).toBe(project.id);
    const workItem = await db.workItem.findUniqueOrThrow({ where: { id: activated.workItemId! } });
    expect(workItem.projectId).toBe(project.id);
  });

  it("refuses to re-activate an already SDD_ACTIVE Requirement, creating no second Project or WorkItem", async () => {
    const requirement = await createRequirement(managerCtx, { clientId, title: "Double activation" });
    const activated = await startSddForRequirement(managerCtx, requirement.id);

    await expect(startSddForRequirement(managerCtx, requirement.id)).rejects.toThrow(ValidationError);

    const workItemCount = await db.workItem.count({ where: { projectId: activated.projectId! } });
    expect(workItemCount).toBe(1);
  });

  it("refuses a read-only user", async () => {
    const requirement = await createRequirement(managerCtx, { clientId, title: "Forbidden activation" });
    await expect(startSddForRequirement(viewerCtx, requirement.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("listRequirementsForClient / getRequirementById", () => {
  it("lists a client's Requirements newest first", async () => {
    await createRequirement(managerCtx, { clientId, title: "List item A" });
    await createRequirement(managerCtx, { clientId, title: "List item B" });

    const list = await listRequirementsForClient(managerCtx, clientId);
    const titles = list.map((r) => r.title);
    expect(titles.indexOf("List item B")).toBeLessThan(titles.indexOf("List item A"));
  });

  it("a read-only user can view a Requirement's detail", async () => {
    const requirement = await createRequirement(managerCtx, { clientId, title: "Readable by viewer" });
    const fetched = await getRequirementById(viewerCtx, requirement.id);
    expect(fetched.title).toBe("Readable by viewer");
  });
});
