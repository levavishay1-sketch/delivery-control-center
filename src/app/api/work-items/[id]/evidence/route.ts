import { NextResponse } from "next/server";
import { linkEvidence } from "@/domain/evidence/commands";
import { checkCompletionPolicy } from "@/domain/evidence/completion";
import { getEvidenceForWorkItem, getRepositoryForProject, listPullRequestsForRepository } from "@/domain/evidence/queries";
import { getWorkItem } from "@/domain/work-item/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError, NotFoundError } from "@/domain/shared/errors";

/** A work item's linked evidence, its completion-policy state, and the candidate pull requests available to link. */
export async function GET(_req: Request, routeCtx: RouteContext<"/api/work-items/[id]/evidence">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const workItem = await getWorkItem(ctx, id);
    if (!workItem) throw new NotFoundError("Work item not found");

    const [evidence, policy, repository] = await Promise.all([
      getEvidenceForWorkItem(id),
      checkCompletionPolicy(id),
      getRepositoryForProject(workItem.projectId),
    ]);
    const candidatePullRequests = repository ? await listPullRequestsForRepository(repository.id) : [];
    const linkedIds = new Set(evidence.map((e) => e.pullRequestId));

    return NextResponse.json({
      evidence: evidence.map((e) => ({
        id: e.id,
        pullRequest: {
          id: e.pullRequest.id,
          number: e.pullRequest.number,
          title: e.pullRequest.title,
          state: e.pullRequest.state,
          merged: e.pullRequest.merged,
          url: e.pullRequest.url,
          testRuns: e.pullRequest.testRuns.map((t) => ({ id: t.id, name: t.name, status: t.status })),
        },
      })),
      policy,
      candidatePullRequests: candidatePullRequests
        .filter((pr) => !linkedIds.has(pr.id))
        .map((pr) => ({ id: pr.id, number: pr.number, title: pr.title, state: pr.state, merged: pr.merged, url: pr.url })),
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/** Links a pull request to this work item as evidence. Body: { pullRequestId }. WRITE_ROLES-gated inside linkEvidence. */
export async function POST(request: Request, routeCtx: RouteContext<"/api/work-items/[id]/evidence">) {
  const { id } = await routeCtx.params;
  const body = await request.json();
  const { pullRequestId } = body as { pullRequestId?: string };

  if (!pullRequestId) {
    return NextResponse.json({ error: "pullRequestId is required" }, { status: 400 });
  }

  try {
    const ctx = await requireAuthContext();
    const evidence = await linkEvidence(ctx, id, pullRequestId);
    return NextResponse.json({ id: evidence.id });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
