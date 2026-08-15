import { NextResponse } from "next/server";
import { getWorkItemDetail, listWorkItems } from "@/domain/work-item/queries";
import { getActiveBlockers } from "@/domain/blocker/queries";
import { getWorkItemDecisions } from "@/domain/decision/queries";
import { getWorkItemDependencies } from "@/domain/dependency/queries";
import { getWorkItemAuditEvents } from "@/domain/audit/queries";
import { listClientMembers } from "@/domain/client/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { DomainError, NotFoundError } from "@/domain/shared/errors";
import { serverNow } from "@/domain/shared/time";

function canAct(clientId: string, memberships: { clientId: string; role: string }[], isOrgAdmin: boolean) {
  if (isOrgAdmin) return true;
  const membership = memberships.find((m) => m.clientId === clientId);
  return !!membership && (WRITE_ROLES as string[]).includes(membership.role);
}

/** Aggregate payload for the Quick View drawer — same shape the 360° Record page builds, over HTTP so it can be fetched client-side. */
export async function GET(request: Request, routeCtx: RouteContext<"/api/work-items/[id]/quick-view">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const workItem = await getWorkItemDetail(ctx, id);
    if (!workItem) throw new NotFoundError("Work item not found");

    const [activeBlockers, pendingDecisions, dependencies, timeline, members, siblingItems] = await Promise.all([
      getActiveBlockers(workItem.id),
      getWorkItemDecisions(workItem.id),
      getWorkItemDependencies(workItem.id),
      getWorkItemAuditEvents(ctx, workItem.id, 1, 20),
      listClientMembers(ctx, workItem.project.clientId),
      listWorkItems(ctx, workItem.projectId, { pageSize: 200 }),
    ]);

    const manage = canAct(workItem.project.clientId, ctx.memberships, ctx.isOrgAdmin);
    const activeBlocker = activeBlockers[0] ?? null;
    const pendingDecision = pendingDecisions[0] ?? null;
    const excludeIds = new Set([workItem.id, ...dependencies.upstream.map((d) => d.dependsOnWorkItemId)]);
    const candidates = siblingItems.items.filter((i) => !excludeIds.has(i.id)).map((i) => ({ id: i.id, title: i.title }));

    return NextResponse.json({
      now: serverNow(),
      canManage: manage,
      isBlockerOwner: activeBlocker?.ownerId === ctx.userId,
      workItem: {
        id: workItem.id,
        title: workItem.title,
        description: workItem.description,
        type: workItem.type,
        status: workItem.status,
        risk: workItem.risk,
        priority: workItem.priority,
        owner: workItem.owner ? { id: workItem.owner.id, name: workItem.owner.name, email: workItem.owner.email } : null,
        executorType: workItem.executorType,
        executor: workItem.executor ? { id: workItem.executor.id, name: workItem.executor.name, email: workItem.executor.email } : null,
        dueDate: workItem.dueDate ? workItem.dueDate.toISOString() : null,
        progress: workItem.progress,
        ownerId: workItem.ownerId,
        executorId: workItem.executorId,
        pipelineId: workItem.pipeline?.id ?? null,
      },
      members: members.map((m) => ({ id: m.id, name: m.name, email: m.email })),
      activeBlocker: activeBlocker
        ? {
            id: activeBlocker.id,
            ownerId: activeBlocker.ownerId,
            reason: activeBlocker.reason,
            requiredAction: activeBlocker.requiredAction,
            owner: { id: activeBlocker.owner.id, name: activeBlocker.owner.name, email: activeBlocker.owner.email },
            blockedSince: activeBlocker.blockedSince.toISOString(),
          }
        : null,
      pendingDecision: pendingDecision
        ? {
            id: pendingDecision.id,
            question: pendingDecision.question,
            reason: pendingDecision.reason,
            impact: pendingDecision.impact,
            aiRecommendation: pendingDecision.aiRecommendation,
            aiConfidence: pendingDecision.aiConfidence ? pendingDecision.aiConfidence.toString() : null,
            deadline: pendingDecision.deadline ? pendingDecision.deadline.toISOString() : null,
          }
        : null,
      parent: workItem.parent ? { id: workItem.parent.id, title: workItem.parent.title, pipelineId: workItem.parent.pipeline?.id ?? null } : null,
      childItems: workItem.children.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        owner: c.owner ? { id: c.owner.id, name: c.owner.name, email: c.owner.email } : null,
        pipelineId: c.pipeline?.id ?? null,
      })),
      aiCost: workItem.aiCost.toString(),
      stageCosts: workItem.pipeline?.stages.map((s) => ({ type: s.type, costUsd: s.costUsd ? s.costUsd.toString() : null })) ?? [],
      dependencies: {
        upstream: dependencies.upstream.map((d) => ({
          id: d.id,
          reason: d.reason,
          dependsOnWorkItem: {
            id: d.dependsOnWorkItem.id,
            title: d.dependsOnWorkItem.title,
            type: d.dependsOnWorkItem.type,
            status: d.dependsOnWorkItem.status,
            pipeline: d.dependsOnWorkItem.pipeline ? { id: d.dependsOnWorkItem.pipeline.id } : null,
          },
        })),
        downstream: dependencies.downstream.map((d) => ({
          id: d.id,
          reason: d.reason,
          workItem: {
            id: d.workItem.id,
            title: d.workItem.title,
            type: d.workItem.type,
            status: d.workItem.status,
            pipeline: d.workItem.pipeline ? { id: d.workItem.pipeline.id } : null,
          },
        })),
      },
      candidates,
      timeline: {
        events: timeline.events.map((e) => ({
          id: e.id,
          actor: e.actor,
          actorName: e.actorName,
          action: e.action,
          detail: e.detail,
          createdAt: e.createdAt.toISOString(),
        })),
        total: timeline.total,
      },
      fullRecordHref: `/work-items/${workItem.id}/360`,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
