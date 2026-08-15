import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { linkEvidence, unlinkEvidence } from "./commands";
import { getOrCreateConnectorForProject, configureConnector } from "@/domain/connector/commands";
import { createProject } from "@/domain/project/commands";
import { createWorkItem } from "@/domain/work-item/commands";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres — same rationale as the other domain test
 * suites in this project.
 */

let clientId: string;
let managerCtx: AuthContext;
const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Evidence Linking Org", slug: `evidence-linking-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Evidence Linking Client", slug: "evidence-linking" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `evidence-linking-manager-${Date.now()}@test.local`, name: "Evidence Linking Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Evidence Linking Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

async function makeProjectWithPullRequest(name: string) {
  const project = await createProject(managerCtx, {
    clientId,
    name,
    key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
  });
  await configureConnector(managerCtx, project.id, { type: "GITHUB", config: { owner: "acme", repo: "widgets", token: "ghp_x" } });
  const connector = await getOrCreateConnectorForProject(project.id);
  const repository = await db.repository.create({ data: { connectorId: connector.id, owner: "acme", name: "widgets", externalId: "1" } });
  const pullRequest = await db.pullRequest.create({
    data: { repositoryId: repository.id, number: 1, title: "Add feature", url: "https://x/pull/1" },
  });
  const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Do the thing" });
  return { project, pullRequest, workItem };
}

describe("linkEvidence", () => {
  it("creates an Evidence record connecting the work item and pull request", async () => {
    const { pullRequest, workItem } = await makeProjectWithPullRequest("Link Evidence Project");
    const evidence = await linkEvidence(managerCtx, workItem.id, pullRequest.id);
    expect(evidence.workItemId).toBe(workItem.id);
    expect(evidence.pullRequestId).toBe(pullRequest.id);
  });

  it("is idempotent — linking the same pair twice does not create a second record", async () => {
    const { pullRequest, workItem } = await makeProjectWithPullRequest("Idempotent Link Project");
    await linkEvidence(managerCtx, workItem.id, pullRequest.id);
    await linkEvidence(managerCtx, workItem.id, pullRequest.id);
    const count = await db.evidence.count({ where: { workItemId: workItem.id, pullRequestId: pullRequest.id } });
    expect(count).toBe(1);
  });

  it("rejects linking a pull request from a different project's repository", async () => {
    const { workItem } = await makeProjectWithPullRequest("Cross Project A");
    const { pullRequest: otherPr } = await makeProjectWithPullRequest("Cross Project B");
    await expect(linkEvidence(managerCtx, workItem.id, otherPr.id)).rejects.toThrow(ValidationError);
  });

  it("rejects an unknown pull request", async () => {
    const { workItem } = await makeProjectWithPullRequest("Unknown PR Project");
    await expect(linkEvidence(managerCtx, workItem.id, "does-not-exist")).rejects.toThrow(NotFoundError);
  });
});

describe("unlinkEvidence", () => {
  it("removes the Evidence record", async () => {
    const { pullRequest, workItem } = await makeProjectWithPullRequest("Unlink Evidence Project");
    const evidence = await linkEvidence(managerCtx, workItem.id, pullRequest.id);

    await unlinkEvidence(managerCtx, evidence.id);

    const found = await db.evidence.findUnique({ where: { id: evidence.id } });
    expect(found).toBeNull();
  });
});
