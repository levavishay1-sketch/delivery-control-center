import { db } from "@/lib/db";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";
import { NotFoundError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";
import type { RepositoryDiscoveryFindings } from "@/lib/agents/types";

async function requireReadAccessToRepository(ctx: AuthContext, repositoryId: string) {
  const repository = await db.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) throw new NotFoundError("Repository not found");
  requireClientRole(ctx, repository.clientId, ALL_ROLES);
  return repository;
}

/** A repository's own detail, for the Discovery page's header — reuses the same read-access check as the rest of this module. */
export async function getRepositoryDetail(ctx: AuthContext, repositoryId: string) {
  const repository = await requireReadAccessToRepository(ctx, repositoryId);
  const client = await db.client.findUniqueOrThrow({ where: { id: repository.clientId }, select: { id: true, name: true } });
  return { repository, client };
}

export interface RepositoryContext {
  findings: RepositoryDiscoveryFindings;
  version: number;
  completedAt: Date;
}

/**
 * The spec's "RepositoryContext" concept (design.md: a query, not a table) — the repository's
 * latest SUCCEEDED Discovery findings, labeled with the version and when it completed so the UI
 * can show how current it is. Null when no Discovery run has ever succeeded for this repository.
 */
export async function getRepositoryContext(ctx: AuthContext, repositoryId: string): Promise<RepositoryContext | null> {
  await requireReadAccessToRepository(ctx, repositoryId);

  const latest = await db.repositoryDiscovery.findFirst({
    where: { repositoryId, status: "SUCCEEDED" },
    orderBy: { version: "desc" },
  });
  if (!latest || !latest.findings || !latest.completedAt) return null;

  return { findings: latest.findings as unknown as RepositoryDiscoveryFindings, version: latest.version, completedAt: latest.completedAt };
}

/** Every Discovery run for a repository, newest first — status/cost/timing only, not full findings (run-summary-vs-detail pattern, matching agent-run-tracking's own split). */
export async function listRepositoryDiscoveries(ctx: AuthContext, repositoryId: string) {
  await requireReadAccessToRepository(ctx, repositoryId);

  return db.repositoryDiscovery.findMany({
    where: { repositoryId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      status: true,
      aiModel: true,
      costUsd: true,
      lastError: true,
      startedAt: true,
      completedAt: true,
      triggeredByUser: { select: { id: true, name: true, email: true } },
    },
  });
}
