import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mocks only the GitHub fetch functions (to inject controllable results per test) — everything
// else stays real, including Postgres, same convention as connector/conflicts.test.ts.
vi.mock("@/lib/integrations/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/github")>();
  return {
    ...actual,
    fetchRepository: vi.fn(async () => ({ externalId: "123", owner: "acme", name: "widgets" })),
    fetchCommits: vi.fn(async () => [
      { sha: "abc123", message: "Fix widget", authorName: "Ada", authoredAt: "2026-08-01T00:00:00Z", url: "https://x/abc123" },
    ]),
    fetchPullRequests: vi.fn(async () => [
      {
        number: 9,
        title: "Add widgets",
        state: "closed" as const,
        merged: true,
        mergedAt: "2026-08-02T00:00:00Z",
        headSha: "abc123",
        url: "https://x/pull/9",
      },
    ]),
    fetchCheckRuns: vi.fn(async () => [
      {
        externalId: "5",
        name: "test",
        status: "completed",
        conclusion: "success",
        headSha: "abc123",
        startedAt: "2026-08-02T00:00:00Z",
        completedAt: "2026-08-02T00:05:00Z",
      },
    ]),
  };
});

const { db } = await import("@/lib/db");
const { linkRepository, unlinkRepository } = await import("./commands");
const { configureConnector } = await import("@/domain/connector/commands");
const { createProject } = await import("@/domain/project/commands");
const { ValidationError, ForbiddenError } = await import("@/domain/shared/errors");
type AuthContext = import("@/domain/shared/context").AuthContext;

let clientId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;
const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Evidence Test Org", slug: `evidence-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Evidence Test Client", slug: "evidence-test" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `evidence-manager-${Date.now()}@test.local`, name: "Evidence Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Evidence Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };

  const viewer = await db.user.create({ data: { email: `evidence-viewer-${Date.now()}@test.local`, name: "Evidence Viewer" } });
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });
  viewerCtx = { userId: viewer.id, displayName: "Evidence Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
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

async function makeGithubProject(name: string) {
  const project = await makeProject(name);
  await configureConnector(managerCtx, project.id, { type: "GITHUB", config: { owner: "acme", repo: "widgets", token: "ghp_x" } });
  return project;
}

describe("linkRepository", () => {
  it("creates a Repository and catches up commits/pull requests/test runs", async () => {
    const project = await makeGithubProject("Link Repo Project");
    const repository = await linkRepository(managerCtx, project.id);

    expect(repository.owner).toBe("acme");
    expect(repository.name).toBe("widgets");

    const commits = await db.commit.findMany({ where: { repositoryId: repository.id } });
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe("abc123");

    const pullRequests = await db.pullRequest.findMany({ where: { repositoryId: repository.id } });
    expect(pullRequests).toHaveLength(1);
    expect(pullRequests[0].merged).toBe(true);

    const testRuns = await db.testRun.findMany({ where: { repositoryId: repository.id } });
    expect(testRuns).toHaveLength(1);
    expect(testRuns[0].status).toBe("PASSED");
    expect(testRuns[0].pullRequestId).toBe(pullRequests[0].id);
  });

  it("rejects linking a repository for a non-GitHub connector", async () => {
    const project = await makeProject("Non Github Project");
    await expect(linkRepository(managerCtx, project.id)).rejects.toThrow(ValidationError);
  });

  it("rejects linking a second repository for the same project", async () => {
    const project = await makeGithubProject("Second Link Project");
    await linkRepository(managerCtx, project.id);
    await expect(linkRepository(managerCtx, project.id)).rejects.toThrow(ValidationError);
  });

  it("rejects a VIEWER", async () => {
    const project = await makeGithubProject("Viewer Link Project");
    await expect(linkRepository(viewerCtx, project.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("unlinkRepository", () => {
  it("removes the project's link but keeps the client-owned Repository record", async () => {
    const project = await makeGithubProject("Unlink Repo Project");
    const repository = await linkRepository(managerCtx, project.id);

    await unlinkRepository(managerCtx, project.id, repository.id);

    const link = await db.projectRepository.findFirst({ where: { projectId: project.id, repositoryId: repository.id } });
    expect(link).toBeNull();

    const found = await db.repository.findUnique({ where: { id: repository.id } });
    expect(found).not.toBeNull();
  });

  it("reuses an existing client repository when a second project links the same one, without duplicating it", async () => {
    // Isolated org/client (rather than the module-level clientId shared by every other test in
    // this file, which all mock the same "acme/widgets" fetchRepository result) so the
    // find-or-create-by-client counts below aren't polluted by sibling tests' own links.
    const org = await db.organization.create({ data: { name: "Shared Repo Org", slug: `shared-repo-org-${Date.now()}` } });
    orgIds.push(org.id);
    const client = await db.client.create({ data: { organizationId: org.id, name: "Shared Repo Client", slug: "shared-repo" } });
    const manager = await db.user.create({ data: { email: `shared-repo-manager-${Date.now()}@test.local`, name: "Shared Repo Manager" } });
    await db.clientMembership.create({ data: { userId: manager.id, clientId: client.id, role: "MANAGER" } });
    const ctx: AuthContext = { userId: manager.id, displayName: "Shared Repo Manager", isOrgAdmin: false, memberships: [{ clientId: client.id, role: "MANAGER" }] };

    async function makeSharedGithubProject(name: string) {
      const project = await createProject(ctx, {
        clientId: client.id,
        name,
        key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
      });
      await configureConnector(ctx, project.id, { type: "GITHUB", config: { owner: "acme", repo: "widgets", token: "ghp_x" } });
      return project;
    }

    const projectA = await makeSharedGithubProject("Shared Repo Project A");
    const repoA = await linkRepository(ctx, projectA.id);

    const projectB = await makeSharedGithubProject("Shared Repo Project B");
    const repoB = await linkRepository(ctx, projectB.id);

    expect(repoB.id).toBe(repoA.id);

    const totalRepos = await db.repository.count({ where: { clientId: client.id, owner: "acme", name: "widgets" } });
    expect(totalRepos).toBe(1);

    const linkCount = await db.projectRepository.count({ where: { repositoryId: repoA.id } });
    expect(linkCount).toBe(2);
  });
});
