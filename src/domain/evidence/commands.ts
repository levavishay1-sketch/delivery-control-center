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
import { getWorkItemById } from "@/domain/work-item/queries";
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
 * Links a project's GitHub repository as its source of engineering evidence, through that
 * project's `Connector`. Finds-or-creates the `Repository` by `(clientId, owner, name)` (Slice 12
 * design.md decision: a repository is owned by the client, so a second project under the same
 * client linking the same GitHub repo reuses the existing row via `ProjectRepository` instead of
 * duplicating it) rather than by `connectorId`. Runs a bounded catch-up fetch inline (design.md
 * decision 4) for commits, pull requests, and each pull request's check runs — not queued through
 * the Job runtime, since this is a one-time, bounded, user-initiated action.
 */
export async function linkRepository(ctx: AuthContext, projectId: string) {
  const project = await getProjectById(projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  const connector = await getConnector(projectId);
  if (!connector || connector.type !== "GITHUB") {
    throw new ValidationError("Linking a repository requires a configured GitHub connector.");
  }

  const existingLink = await db.projectRepository.findFirst({ where: { projectId } });
  if (existingLink) throw new ValidationError("This project already has a linked repository.");

  const config = decryptIntegrationConfig("GITHUB", connector.config as Record<string, unknown> | null);
  const fetched = await fetchRepository(config ?? null);

  const existingRepo = await db.repository.findFirst({
    where: { clientId: project.clientId, owner: fetched.owner, name: fetched.name },
  });

  const repository = await db.$transaction(async (tx) => {
    const repo =
      existingRepo ??
      (await tx.repository.create({
        data: {
          connectorId: connector.id,
          clientId: project.clientId,
          owner: fetched.owner,
          name: fetched.name,
          externalId: fetched.externalId,
        },
      }));
    await tx.projectRepository.create({ data: { projectId: project.id, repositoryId: repo.id } });
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

/**
 * Removes the link between a project and its repository (Slice 12: a `Repository` is owned by
 * the client, not this project, and may still be linked to other projects — unlinking removes
 * only this project's `ProjectRepository` row, never the shared `Repository` and its recorded
 * commits/PRs/test runs).
 */
export async function unlinkRepository(ctx: AuthContext, projectId: string, repositoryId: string) {
  const project = await getProjectById(projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  const link = await db.projectRepository.findFirst({ where: { projectId, repositoryId } });
  if (!link) throw new NotFoundError("Repository not linked to this project");
  const repository = await db.repository.findUniqueOrThrow({ where: { id: repositoryId } });

  return db.$transaction(async (tx) => {
    await tx.projectRepository.delete({ where: { id: link.id } });
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

/**
 * Explicitly links a pull request to a work item as its evidence (never inferred — see
 * engineering-evidence spec's "not inferred" requirement). The pull request must belong to a
 * repository linked to the work item's own project.
 */
export async function linkEvidence(ctx: AuthContext, workItemId: string, pullRequestId: string) {
  const workItem = await getWorkItemById(workItemId);
  if (!workItem) throw new NotFoundError("Work item not found");
  const project = await getProjectById(workItem.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  const pullRequest = await db.pullRequest.findUnique({ where: { id: pullRequestId }, include: { repository: true } });
  if (!pullRequest) throw new NotFoundError("Pull request not found");

  const connector = await getConnector(workItem.projectId);
  if (!connector || pullRequest.repository.connectorId !== connector.id) {
    throw new ValidationError("This pull request does not belong to this work item's linked repository.");
  }

  const existing = await db.evidence.findUnique({ where: { workItemId_pullRequestId: { workItemId, pullRequestId } } });
  if (existing) return existing;

  return db.$transaction(async (tx) => {
    const evidence = await tx.evidence.create({ data: { workItemId, pullRequestId } });
    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} linked pull request #${pullRequest.number} to "${workItem.title}"`,
    });
    return evidence;
  });
}

/** Removes a previously-linked pull request from a work item. */
export async function unlinkEvidence(ctx: AuthContext, evidenceId: string) {
  const evidence = await db.evidence.findUnique({
    where: { id: evidenceId },
    include: { workItem: true, pullRequest: true },
  });
  if (!evidence) throw new NotFoundError("Evidence link not found");
  const project = await getProjectById(evidence.workItem.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  return db.$transaction(async (tx) => {
    await tx.evidence.delete({ where: { id: evidenceId } });
    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: evidence.workItemId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} unlinked pull request #${evidence.pullRequest.number} from "${evidence.workItem.title}"`,
    });
  });
}

/**
 * Records a write-capable role's approval to complete a work item without qualifying evidence
 * (design.md decision 6: the row's presence is the source of truth for checkCompletionPolicy,
 * not a boolean flag elsewhere).
 */
export async function approveCompletionException(ctx: AuthContext, workItemId: string, reason: string) {
  if (!reason.trim()) throw new ValidationError("A reason is required to approve a completion exception.");

  const workItem = await getWorkItemById(workItemId);
  if (!workItem) throw new NotFoundError("Work item not found");
  const project = await getProjectById(workItem.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  return db.$transaction(async (tx) => {
    const exception = await tx.completionException.create({
      data: { workItemId, reason, approvedByUserId: ctx.userId },
    });
    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} approved a completion exception for "${workItem.title}"`,
      detail: { reason },
    });
    return exception;
  });
}

export { runCatchUpFetch, mapCheckRunStatus, mapDeploymentState };
export type { DbClient };
