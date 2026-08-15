import { notFound } from "next/navigation";
import { getWorkItemDetail, listWorkItems } from "@/domain/work-item/queries";
import { getActiveBlockers } from "@/domain/blocker/queries";
import { getWorkItemDecisions } from "@/domain/decision/queries";
import { getWorkItemDependencies, getWorkItemDependencyGraph } from "@/domain/dependency/queries";
import { getWorkItemAuditEvents } from "@/domain/audit/queries";
import { listClientMembers } from "@/domain/client/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { ForbiddenError } from "@/domain/shared/errors";
import { serverNow } from "@/domain/shared/time";
import { WorkItemTabs } from "@/components/WorkItemTabs";
import { OverviewTab } from "@/components/OverviewTab";
import { DependenciesTab } from "@/components/DependenciesTab";
import { TimelineTab } from "@/components/TimelineTab";

export const dynamic = "force-dynamic";

function canAct(clientId: string, memberships: { clientId: string; role: string }[], isOrgAdmin: boolean) {
  if (isOrgAdmin) return true;
  const membership = memberships.find((m) => m.clientId === clientId);
  return !!membership && (WRITE_ROLES as string[]).includes(membership.role);
}

export default async function WorkItem360Page({ params }: PageProps<"/work-items/[id]/360">) {
  const { id } = await params;
  const ctx = await requireAuthContext();

  const workItem = await getWorkItemDetail(ctx, id).catch((err) => {
    if (err instanceof ForbiddenError) return null;
    throw err;
  });
  if (!workItem) notFound();

  const [activeBlockers, pendingDecisions, dependencies, dependencyGraph, timeline, members, siblingItems] = await Promise.all([
    getActiveBlockers(workItem.id),
    getWorkItemDecisions(workItem.id),
    getWorkItemDependencies(workItem.id),
    getWorkItemDependencyGraph(workItem.id),
    getWorkItemAuditEvents(ctx, workItem.id, 1, 20),
    listClientMembers(ctx, workItem.project.clientId),
    listWorkItems(ctx, workItem.projectId, { pageSize: 200 }),
  ]);

  const now = serverNow();
  const manage = canAct(workItem.project.clientId, ctx.memberships, ctx.isOrgAdmin);
  const activeBlocker = activeBlockers[0] ?? null;
  const pendingDecision = pendingDecisions[0] ?? null;

  const excludeIds = new Set([workItem.id, ...dependencies.upstream.map((d) => d.dependsOnWorkItemId)]);
  const candidates = siblingItems.items.filter((i) => !excludeIds.has(i.id)).map((i) => ({ id: i.id, title: i.title }));

  const members2 = members.map((m) => ({ id: m.id, name: m.name, email: m.email }));

  const tabs = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <OverviewTab
          workItem={{
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
          }}
          members={members2}
          activeBlocker={
            activeBlocker
              ? {
                  id: activeBlocker.id,
                  ownerId: activeBlocker.ownerId,
                  reason: activeBlocker.reason,
                  requiredAction: activeBlocker.requiredAction,
                  owner: { id: activeBlocker.owner.id, name: activeBlocker.owner.name, email: activeBlocker.owner.email },
                  blockedSince: activeBlocker.blockedSince.toISOString(),
                }
              : null
          }
          pendingDecision={
            pendingDecision
              ? {
                  id: pendingDecision.id,
                  question: pendingDecision.question,
                  reason: pendingDecision.reason,
                  impact: pendingDecision.impact,
                  aiRecommendation: pendingDecision.aiRecommendation,
                  aiConfidence: pendingDecision.aiConfidence ? pendingDecision.aiConfidence.toString() : null,
                  deadline: pendingDecision.deadline ? pendingDecision.deadline.toISOString() : null,
                }
              : null
          }
          canEdit={manage}
          canManage={manage}
          isBlockerOwner={activeBlocker?.ownerId === ctx.userId}
          parent={workItem.parent ? { id: workItem.parent.id, title: workItem.parent.title, pipelineId: workItem.parent.pipeline?.id ?? null } : null}
          childItems={workItem.children.map((c) => ({
            id: c.id,
            title: c.title,
            status: c.status,
            owner: c.owner ? { id: c.owner.id, name: c.owner.name, email: c.owner.email } : null,
            pipelineId: c.pipeline?.id ?? null,
          }))}
          aiCost={workItem.aiCost.toString()}
          stageCosts={workItem.pipeline?.stages.map((s) => ({ type: s.type, costUsd: s.costUsd ? s.costUsd.toString() : null })) ?? []}
          now={now}
        />
      ),
    },
    {
      id: "dependencies",
      label: "Dependencies",
      content: (
        <DependenciesTab
          upstream={dependencies.upstream.map((d) => ({
            id: d.id,
            reason: d.reason,
            dependsOnWorkItem: {
              id: d.dependsOnWorkItem.id,
              title: d.dependsOnWorkItem.title,
              type: d.dependsOnWorkItem.type,
              status: d.dependsOnWorkItem.status,
              pipeline: d.dependsOnWorkItem.pipeline ? { id: d.dependsOnWorkItem.pipeline.id } : null,
            },
          }))}
          downstream={dependencies.downstream.map((d) => ({
            id: d.id,
            reason: d.reason,
            workItem: {
              id: d.workItem.id,
              title: d.workItem.title,
              type: d.workItem.type,
              status: d.workItem.status,
              pipeline: d.workItem.pipeline ? { id: d.workItem.pipeline.id } : null,
            },
          }))}
          canManage={manage}
          workItemId={workItem.id}
          candidates={candidates}
          graph={dependencyGraph}
        />
      ),
    },
    {
      id: "timeline",
      label: "Timeline",
      content: (
        <TimelineTab
          workItemId={workItem.id}
          initialEvents={timeline.events.map((e) => ({
            id: e.id,
            actor: e.actor,
            actorName: e.actorName,
            action: e.action,
            detail: e.detail,
            createdAt: e.createdAt.toISOString(),
          }))}
          initialTotal={timeline.total}
        />
      ),
    },
    { id: "code", label: "Code", content: <p className="text-sm opacity-50">Coming soon — trace work item to code changes.</p> },
    { id: "tests", label: "Tests", content: <p className="text-sm opacity-50">Coming soon — view associated test runs.</p> },
    { id: "evidence", label: "Evidence", content: <p className="text-sm opacity-50">Coming soon — view evidence of completion.</p> },
    { id: "configuration", label: "Configuration", content: <p className="text-sm opacity-50">Coming soon — view configuration and overrides.</p> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs opacity-60">
          {workItem.project.name} ({workItem.project.key})
        </p>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{workItem.title}</h1>
          <span className="rounded-full bg-black/5 dark:bg-white/10 px-2 py-0.5 text-xs opacity-70">{workItem.type}</span>
        </div>
      </div>

      <WorkItemTabs tabs={tabs} />
    </div>
  );
}
