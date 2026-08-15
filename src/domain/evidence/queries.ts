import { db } from "@/lib/db";

/** A project's linked repository, if any, via its connector. */
export async function getRepositoryForProject(projectId: string) {
  return db.repository.findFirst({ where: { connector: { projectId } } });
}

/** A connector's linked repository, if any — used by the webhook route, which addresses a connector directly. */
export function getRepositoryByConnectorId(connectorId: string) {
  return db.repository.findUnique({ where: { connectorId } });
}

/** A repository's recorded commits, most recent first. */
export function listCommitsForRepository(repositoryId: string) {
  return db.commit.findMany({ where: { repositoryId }, orderBy: { authoredAt: "desc" } });
}

/** A repository's recorded pull requests with their test runs, most recently updated first. */
export function listPullRequestsForRepository(repositoryId: string) {
  return db.pullRequest.findMany({
    where: { repositoryId },
    include: { testRuns: true },
    orderBy: { updatedAt: "desc" },
  });
}

/** A work item's linked pull requests (its evidence), each with its repository and test runs. */
export function getEvidenceForWorkItem(workItemId: string) {
  return db.evidence.findMany({
    where: { workItemId },
    include: { pullRequest: { include: { testRuns: true, repository: true } } },
    orderBy: { createdAt: "desc" },
  });
}
