import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { checkCompletionPolicy } from "./completion";
import { approveCompletionException, linkEvidence } from "./commands";
import { getOrCreateConnectorForProject, configureConnector } from "@/domain/connector/commands";
import { createProject } from "@/domain/project/commands";
import { createWorkItem, updateWorkItemStatus } from "@/domain/work-item/commands";
import { ValidationError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres — same rationale as the other domain test
 * suites in this project.
 */

let clientId: string;
let managerCtx: AuthContext;
const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Completion Policy Org", slug: `completion-policy-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Completion Policy Client", slug: "completion-policy" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `completion-manager-${Date.now()}@test.local`, name: "Completion Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Completion Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

async function makeApprovedWorkItem(name: string) {
  const project = await createProject(managerCtx, {
    clientId,
    name,
    key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
  });
  const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Ship the feature" });
  await updateWorkItemStatus(managerCtx, workItem.id, "IN_PROGRESS");
  await updateWorkItemStatus(managerCtx, workItem.id, "REVIEW");
  await updateWorkItemStatus(managerCtx, workItem.id, "APPROVED");
  return { project, workItem };
}

async function makePullRequest(project: { id: string }, merged: boolean, testStatus: "PASSED" | "FAILED" | null) {
  await configureConnector(managerCtx, project.id, { type: "GITHUB", config: { owner: "acme", repo: "widgets", token: "ghp_x" } });
  const connector = await getOrCreateConnectorForProject(project.id);
  const repository = await db.repository.upsert({
    where: { connectorId: connector.id },
    create: { connectorId: connector.id, owner: "acme", name: "widgets", externalId: "1" },
    update: {},
  });
  const pullRequest = await db.pullRequest.create({
    data: { repositoryId: repository.id, number: Math.floor(Math.random() * 1_000_000), title: "PR", url: "https://x/pull/1", merged },
  });
  if (testStatus) {
    await db.testRun.create({
      data: { repositoryId: repository.id, pullRequestId: pullRequest.id, externalId: `${pullRequest.id}-check`, name: "test", status: testStatus },
    });
  }
  return pullRequest;
}

describe("checkCompletionPolicy", () => {
  it("is unsatisfied with no linked pull request", async () => {
    const { workItem } = await makeApprovedWorkItem("No Evidence Project");
    const result = await checkCompletionPolicy(workItem.id);
    expect(result.satisfied).toBe(false);
  });

  it("is satisfied with a merged pull request whose latest test run passed", async () => {
    const { project, workItem } = await makeApprovedWorkItem("Passing Evidence Project");
    const pr = await makePullRequest(project, true, "PASSED");
    await linkEvidence(managerCtx, workItem.id, pr.id);
    const result = await checkCompletionPolicy(workItem.id);
    expect(result.satisfied).toBe(true);
  });

  it("is unsatisfied with a merged pull request whose latest test run failed", async () => {
    const { project, workItem } = await makeApprovedWorkItem("Failing Evidence Project");
    const pr = await makePullRequest(project, true, "FAILED");
    await linkEvidence(managerCtx, workItem.id, pr.id);
    const result = await checkCompletionPolicy(workItem.id);
    expect(result.satisfied).toBe(false);
  });

  it("is unsatisfied with an unmerged pull request", async () => {
    const { project, workItem } = await makeApprovedWorkItem("Unmerged Evidence Project");
    const pr = await makePullRequest(project, false, "PASSED");
    await linkEvidence(managerCtx, workItem.id, pr.id);
    const result = await checkCompletionPolicy(workItem.id);
    expect(result.satisfied).toBe(false);
  });

  it("is satisfied when an approved CompletionException exists, regardless of evidence", async () => {
    const { workItem } = await makeApprovedWorkItem("Exception Project");
    await approveCompletionException(managerCtx, workItem.id, "Hotfix, tests run manually offline.");
    const result = await checkCompletionPolicy(workItem.id);
    expect(result.satisfied).toBe(true);
  });
});

describe("updateWorkItemStatus APPROVED -> COMPLETED", () => {
  it("succeeds with qualifying evidence", async () => {
    const { project, workItem } = await makeApprovedWorkItem("Complete With Evidence Project");
    const pr = await makePullRequest(project, true, "PASSED");
    await linkEvidence(managerCtx, workItem.id, pr.id);

    const updated = await updateWorkItemStatus(managerCtx, workItem.id, "COMPLETED");
    expect(updated.status).toBe("COMPLETED");
  });

  it("is rejected with a descriptive error when there is no qualifying evidence and no exception", async () => {
    const { workItem } = await makeApprovedWorkItem("Complete Without Evidence Project");
    await expect(updateWorkItemStatus(managerCtx, workItem.id, "COMPLETED")).rejects.toThrow(ValidationError);

    const stillApproved = await db.workItem.findUnique({ where: { id: workItem.id } });
    expect(stillApproved?.status).toBe("APPROVED");
  });

  it("succeeds with no evidence when an approved CompletionException exists", async () => {
    const { workItem } = await makeApprovedWorkItem("Complete With Exception Project");
    await approveCompletionException(managerCtx, workItem.id, "No CI available for this legacy migration.");

    const updated = await updateWorkItemStatus(managerCtx, workItem.id, "COMPLETED");
    expect(updated.status).toBe("COMPLETED");
  });
});
