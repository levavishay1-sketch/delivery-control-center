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

interface GithubPushPayload {
  commits: Array<{ id: string; message: string; url: string; timestamp: string; author?: { name?: string } }>;
}

interface GithubPullRequestPayload {
  pull_request: {
    number: number;
    title: string;
    state: string;
    merged: boolean;
    merged_at: string | null;
    head: { sha: string };
    html_url: string;
  };
}

interface GithubCheckRunPayload {
  check_run: {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    head_sha: string;
    started_at: string | null;
    completed_at: string | null;
    pull_requests?: Array<{ number: number }>;
  };
}

interface GithubDeploymentStatusPayload {
  deployment: { id: number; environment: string };
  deployment_status: { state: string; created_at: string };
}

function mapDeploymentState(state: string): "PENDING" | "SUCCEEDED" | "FAILED" {
  if (state === "success") return "SUCCEEDED";
  if (state === "failure" || state === "error") return "FAILED";
  return "PENDING";
}

/** Records each commit in a push webhook event's `commits` array. */
export async function recordPushEvent(repositoryId: string, payload: GithubPushPayload) {
  for (const commit of payload.commits) {
    await db.commit.upsert({
      where: { repositoryId_sha: { repositoryId, sha: commit.id } },
      create: {
        repositoryId,
        sha: commit.id,
        message: commit.message,
        authorName: commit.author?.name ?? null,
        authoredAt: new Date(commit.timestamp),
        url: commit.url,
      },
      update: { message: commit.message, authorName: commit.author?.name ?? null },
    });
  }
}

/** Records a pull_request webhook event's current state. */
export async function recordPullRequestEvent(repositoryId: string, payload: GithubPullRequestPayload) {
  const pr = payload.pull_request;
  await db.pullRequest.upsert({
    where: { repositoryId_number: { repositoryId, number: pr.number } },
    create: {
      repositoryId,
      number: pr.number,
      title: pr.title,
      state: pr.merged ? "MERGED" : pr.state === "closed" ? "CLOSED" : "OPEN",
      merged: pr.merged,
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      headSha: pr.head.sha,
      url: pr.html_url,
    },
    update: {
      title: pr.title,
      state: pr.merged ? "MERGED" : pr.state === "closed" ? "CLOSED" : "OPEN",
      merged: pr.merged,
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      headSha: pr.head.sha,
    },
  });
}

/**
 * Records a check_run webhook event as a TestRun. GitHub's check_run events can arrive before the
 * pull_request event for the PR they belong to (design.md risk 2) — a not-yet-existing commit or
 * pull request is tolerated: the commit gets a minimal placeholder row a later push event fills
 * in, and pullRequestId is simply left unset if the PR row doesn't exist yet.
 */
export async function recordCheckRunEvent(repositoryId: string, payload: GithubCheckRunPayload) {
  const run = payload.check_run;

  let commit = await db.commit.findUnique({ where: { repositoryId_sha: { repositoryId, sha: run.head_sha } } });
  if (!commit) {
    commit = await db.commit.create({
      data: { repositoryId, sha: run.head_sha, message: "", authoredAt: new Date() },
    });
  }

  let pullRequestId: string | undefined;
  const prNumber = run.pull_requests?.[0]?.number;
  if (prNumber !== undefined) {
    const pr = await db.pullRequest.findUnique({ where: { repositoryId_number: { repositoryId, number: prNumber } } });
    pullRequestId = pr?.id;
  }

  await db.testRun.upsert({
    where: { repositoryId_externalId: { repositoryId, externalId: String(run.id) } },
    create: {
      repositoryId,
      commitId: commit.id,
      pullRequestId,
      externalId: String(run.id),
      name: run.name,
      status: mapCheckRunStatus(run.status, run.conclusion),
      startedAt: run.started_at ? new Date(run.started_at) : null,
      completedAt: run.completed_at ? new Date(run.completed_at) : null,
    },
    update: {
      pullRequestId,
      status: mapCheckRunStatus(run.status, run.conclusion),
      completedAt: run.completed_at ? new Date(run.completed_at) : null,
    },
  });
}

/** Records a deployment_status webhook event as a Deployment. */
export async function recordDeploymentStatusEvent(repositoryId: string, payload: GithubDeploymentStatusPayload) {
  await db.deployment.upsert({
    where: { repositoryId_externalId: { repositoryId, externalId: String(payload.deployment.id) } },
    create: {
      repositoryId,
      externalId: String(payload.deployment.id),
      environment: payload.deployment.environment,
      status: mapDeploymentState(payload.deployment_status.state),
      deployedAt: new Date(payload.deployment_status.created_at),
    },
    update: {
      status: mapDeploymentState(payload.deployment_status.state),
      deployedAt: new Date(payload.deployment_status.created_at),
    },
  });
}

export { runCatchUpFetch, mapCheckRunStatus, mapDeploymentState };
export type { DbClient };
