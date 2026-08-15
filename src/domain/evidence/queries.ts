import { db } from "@/lib/db";

/** A project's linked repository, if any, via its connector. */
export async function getRepositoryForProject(projectId: string) {
  return db.repository.findFirst({ where: { connector: { projectId } } });
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
