import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { decryptIntegrationConfig } from "@/lib/integrations";
import {
  fetchCheckRuns,
  fetchCommits,
  fetchPullRequests,
  fetchRepository,
} from "@/lib/integrations/github";
import { getProjectById } from "@/domain/project/queries";
import { getConnector } from "@/domain/connector/queries";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import type { AuthContext } from "@/domain/shared/context";
import type { TestRunStatus } from "@/generated/prisma/client";

type DbClient = typeof db | Prisma.TransactionClient;

/** Maps a GitHub check-run's status/conclusion pair onto the fixed TestRunStatus enum. */
function mapCheckRunStatus(status: string, conclusion: string | null): TestRunStatus {
  if (status !== "completed") return "PENDING";
  return conclusion === "success" ? "PASSED" : "FAILED";
}

/**
 * Links a project's GitHub repository as its source of engineering evidence (design.md decision
 * 1: one Repository per Connector, reusing its auth/config), then runs a bounded catch-up fetch
 * inline (design.md decision 4) for commits, pull requests, and each pull request's check runs —
 * not queued through the Job runtime, since this is a one-time, bounded, user-initiated action.
 */
export async function linkRepository(ctx: AuthContext, projectId: string) {
  const project = await getProjectById(projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  const connector = await getConnector(projectId);
  if (!connector || connector.type !== "GITHUB") {
    throw new ValidationError("Linking a repository requires a configured GitHub connector.");
  }

  const existing = await db.repository.findUnique({ where: { connectorId: connector.id } });
  if (existing) throw new ValidationError("This project already has a linked repository.");

  const config = decryptIntegrationConfig("GITHUB", connector.config as Record<string, unknown> | null);
  const fetched = await fetchRepository(config ?? null);

  const repository = await db.$transaction(async (tx) => {
    const repo = await tx.repository.create({
      data: { connectorId: connector.id, owner: fetched.owner, name: fetched.name, externalId: fetched.externalId },
    });
    await recordAuditEvent(tx, {
      projectId: project.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} linked repository ${fetched.owner}/${fetched.name}`,
    });
    return repo;
  });

  await runCatchUpFetch(repository.id, config ?? null);

  return repository;
}

/** Fetches and upserts a repository's recent commit/PR/check-run history. Best-effort per design.md risk 1 — bounded, not full history. */
async function runCatchUpFetch(repositoryId: string, config: Record<string, unknown> | null) {
  const [commits, pullRequests] = await Promise.all([fetchCommits(config), fetchPullRequests(config)]);

  for (const commit of commits) {
    await db.commit.upsert({
      where: { repositoryId_sha: { repositoryId, sha: commit.sha } },
      create: {
        repositoryId,
        sha: commit.sha,
        message: commit.message,
        authorName: commit.authorName,
        authoredAt: new Date(commit.authoredAt),
        url: commit.url,
      },
      update: { message: commit.message, authorName: commit.authorName },
    });
  }

  for (const pr of pullRequests) {
    const prRow = await db.pullRequest.upsert({
      where: { repositoryId_number: { repositoryId, number: pr.number } },
      create: {
        repositoryId,
        number: pr.number,
        title: pr.title,
        state: pr.merged ? "MERGED" : pr.state === "closed" ? "CLOSED" : "OPEN",
        merged: pr.merged,
        mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
        headSha: pr.headSha,
        url: pr.url,
      },
      update: {
        title: pr.title,
        state: pr.merged ? "MERGED" : pr.state === "closed" ? "CLOSED" : "OPEN",
        merged: pr.merged,
        mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
      },
    });

    if (!pr.headSha) continue;
    const checkRuns = await fetchCheckRuns(config, pr.headSha);
    const commitRow = await db.commit.findUnique({ where: { repositoryId_sha: { repositoryId, sha: pr.headSha } } });
    for (const run of checkRuns) {
      await db.testRun.upsert({
        where: { repositoryId_externalId: { repositoryId, externalId: run.externalId } },
        create: {
          repositoryId,
          pullRequestId: prRow.id,
          commitId: commitRow?.id,
          externalId: run.externalId,
          name: run.name,
          status: mapCheckRunStatus(run.status, run.conclusion),
          startedAt: run.startedAt ? new Date(run.startedAt) : null,
          completedAt: run.completedAt ? new Date(run.completedAt) : null,
        },
        update: {
          status: mapCheckRunStatus(run.status, run.conclusion),
          completedAt: run.completedAt ? new Date(run.completedAt) : null,
        },
      });
    }
  }
}

/** Removes a project's linked repository and every commit/PR/test-run/build/deployment recorded under it. */
export async function unlinkRepository(ctx: AuthContext, repositoryId: string) {
  const repository = await db.repository.findUnique({ where: { id: repositoryId }, include: { connector: true } });
  if (!repository) throw new NotFoundError("Repository not found");
  const project = await getProjectById(repository.connector.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  return db.$transaction(async (tx) => {
    await tx.repository.delete({ where: { id: repositoryId } });
    await recordAuditEvent(tx, {
      projectId: project.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} unlinked repository ${repository.owner}/${repository.name}`,
    });
  });
}

export { runCatchUpFetch, mapCheckRunStatus };
export type { DbClient };
