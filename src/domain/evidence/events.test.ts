import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  recordCheckRunEvent,
  recordDeploymentStatusEvent,
  recordPullRequestEvent,
  recordPushEvent,
} from "./commands";
import { getOrCreateConnectorForProject } from "@/domain/connector/commands";
import { createProject } from "@/domain/project/commands";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Integration tests against a real local Postgres — same rationale as the other domain test
 * suites in this project. These call the event handlers directly with representative GitHub
 * webhook payload shapes, rather than going through the HTTP route (route-level signature
 * verification is covered separately).
 */

let clientId: string;
let managerCtx: AuthContext;
const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Evidence Events Org", slug: `evidence-events-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Evidence Events Client", slug: "evidence-events" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `evidence-events-manager-${Date.now()}@test.local`, name: "Evidence Events Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Evidence Events Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

async function makeRepository(name: string) {
  const project = await createProject(managerCtx, {
    clientId,
    name,
    key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
  });
  const connector = await getOrCreateConnectorForProject(project.id);
  return db.repository.create({ data: { connectorId: connector.id, owner: "acme", name: "widgets", externalId: "1" } });
}

describe("recordPushEvent", () => {
  it("records each commit in the push payload", async () => {
    const repository = await makeRepository("Push Event Project");
    await recordPushEvent(repository.id, {
      commits: [
        { id: "sha1", message: "First commit", url: "https://x/sha1", timestamp: "2026-08-01T00:00:00Z", author: { name: "Ada" } },
      ],
    });

    const commits = await db.commit.findMany({ where: { repositoryId: repository.id } });
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe("sha1");
  });
});

describe("recordPullRequestEvent", () => {
  it("upserts the pull request's current state", async () => {
    const repository = await makeRepository("PR Event Project");
    await recordPullRequestEvent(repository.id, {
      pull_request: {
        number: 1,
        title: "Add feature",
        state: "open",
        merged: false,
        merged_at: null,
        head: { sha: "sha2" },
        html_url: "https://x/pull/1",
      },
    });

    let pr = await db.pullRequest.findUnique({ where: { repositoryId_number: { repositoryId: repository.id, number: 1 } } });
    expect(pr?.state).toBe("OPEN");

    await recordPullRequestEvent(repository.id, {
      pull_request: {
        number: 1,
        title: "Add feature",
        state: "closed",
        merged: true,
        merged_at: "2026-08-02T00:00:00Z",
        head: { sha: "sha2" },
        html_url: "https://x/pull/1",
      },
    });

    pr = await db.pullRequest.findUnique({ where: { repositoryId_number: { repositoryId: repository.id, number: 1 } } });
    expect(pr?.state).toBe("MERGED");
    expect(pr?.merged).toBe(true);
  });
});

describe("recordCheckRunEvent", () => {
  it("creates a placeholder commit when the check_run arrives before its push event", async () => {
    const repository = await makeRepository("Check Run Before Push Project");
    await recordCheckRunEvent(repository.id, {
      check_run: {
        id: 100,
        name: "test",
        status: "completed",
        conclusion: "success",
        head_sha: "sha3",
        started_at: "2026-08-01T00:00:00Z",
        completed_at: "2026-08-01T00:05:00Z",
      },
    });

    const commit = await db.commit.findUnique({ where: { repositoryId_sha: { repositoryId: repository.id, sha: "sha3" } } });
    expect(commit).not.toBeNull();

    const testRun = await db.testRun.findUnique({
      where: { repositoryId_externalId: { repositoryId: repository.id, externalId: "100" } },
    });
    expect(testRun?.status).toBe("PASSED");
    expect(testRun?.commitId).toBe(commit?.id);
  });

  it("leaves pullRequestId unset when the check_run arrives before its pull_request event, then links a later re-delivery", async () => {
    const repository = await makeRepository("Check Run Before PR Project");
    await recordCheckRunEvent(repository.id, {
      check_run: {
        id: 200,
        name: "test",
        status: "completed",
        conclusion: "success",
        head_sha: "sha4",
        started_at: null,
        completed_at: null,
        pull_requests: [{ number: 5 }],
      },
    });

    let testRun = await db.testRun.findUnique({
      where: { repositoryId_externalId: { repositoryId: repository.id, externalId: "200" } },
    });
    expect(testRun?.pullRequestId).toBeNull();

    await recordPullRequestEvent(repository.id, {
      pull_request: {
        number: 5,
        title: "Feature",
        state: "open",
        merged: false,
        merged_at: null,
        head: { sha: "sha4" },
        html_url: "https://x/pull/5",
      },
    });

    await recordCheckRunEvent(repository.id, {
      check_run: {
        id: 200,
        name: "test",
        status: "completed",
        conclusion: "success",
        head_sha: "sha4",
        started_at: null,
        completed_at: null,
        pull_requests: [{ number: 5 }],
      },
    });

    testRun = await db.testRun.findUnique({
      where: { repositoryId_externalId: { repositoryId: repository.id, externalId: "200" } },
    });
    const pr = await db.pullRequest.findUnique({ where: { repositoryId_number: { repositoryId: repository.id, number: 5 } } });
    expect(testRun?.pullRequestId).toBe(pr?.id);
  });
});

describe("recordDeploymentStatusEvent", () => {
  it("upserts a Deployment for the given environment", async () => {
    const repository = await makeRepository("Deployment Event Project");
    await recordDeploymentStatusEvent(repository.id, {
      deployment: { id: 55, environment: "production" },
      deployment_status: { state: "success", created_at: "2026-08-03T00:00:00Z" },
    });

    const deployment = await db.deployment.findUnique({
      where: { repositoryId_externalId: { repositoryId: repository.id, externalId: "55" } },
    });
    expect(deployment?.status).toBe("SUCCEEDED");
    expect(deployment?.environment).toBe("production");
  });
});
