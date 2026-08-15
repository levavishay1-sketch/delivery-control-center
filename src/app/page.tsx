import Link from "next/link";
import { listProjectsForHome } from "@/domain/project/queries";
import { listClients } from "@/domain/client/queries";
import { listRecentAuditEvents } from "@/domain/audit/queries";
import { getItemsNeedingAttention } from "@/domain/attention/queries";
import { getClientAiCost } from "@/domain/agent/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { AddProjectForm } from "@/components/AddProjectForm";
import { AddWorkItemForm } from "@/components/AddWorkItemForm";
import { SyncButton } from "@/components/SyncButton";
import { StageBadge } from "@/components/StageBadge";
import { QuickViewLink } from "@/components/QuickViewLink";
import { StartPipelineButton } from "@/components/StartPipelineButton";
import { BudgetForm } from "@/components/BudgetForm";
import { WRITE_ROLES } from "@/domain/shared/authz";

export const dynamic = "force-dynamic";

const ACTOR_ICON: Record<string, string> = { SYSTEM: "⚙️", AI: "🤖", USER: "🧑" };

function relativeTime(date: Date, now: number) {
  const diffMs = now - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export default async function HomePage() {
  const ctx = await requireAuthContext();
  const [projects, clients, attention, recentEvents] = await Promise.all([
    listProjectsForHome(ctx),
    listClients(ctx),
    getItemsNeedingAttention(ctx),
    listRecentAuditEvents(ctx, 10),
  ]);

  const projectsByClient = new Map<string, typeof projects>();
  for (const project of projects) {
    const list = projectsByClient.get(project.clientId) ?? [];
    list.push(project);
    projectsByClient.set(project.clientId, list);
  }

  // Slice 3 — AI cost rollup per client (Task Group 7.2). All-time only: this app has no
  // time-bucketed AgentRun query yet, and inventing month-bucketing here isn't what was asked for.
  const clientAiCosts = new Map(
    await Promise.all(clients.map(async (client) => [client.id, await getClientAiCost(client.id)] as const))
  );

  const { summary } = attention;
  const allClear = summary.decisions === 0 && summary.blockers === 0 && summary.risks === 0 && summary.deadlines === 0;
  const now = attention.now;

  const quickAccessProjects = [...projects]
    .sort((a, b) => {
      const aLast = a.workItems[0]?.createdAt.getTime() ?? new Date(a.createdAt).getTime();
      const bLast = b.workItems[0]?.createdAt.getTime() ?? new Date(b.createdAt).getTime();
      return bLast - aLast;
    })
    .slice(0, 10);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <section aria-labelledby="attention-summary-heading" className="flex flex-col gap-3">
        <h2 id="attention-summary-heading" className="text-sm font-semibold uppercase tracking-wide opacity-60">
          Attention Summary
        </h2>
        {allClear ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">All clear — no attention needed.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard label="Decisions Pending" count={summary.decisions} href="/attention#decisions" />
            <SummaryCard label="Blockers Active" count={summary.blockers} href="/attention#blockers" />
            <SummaryCard label="Risks" count={summary.risks} href="/attention#risks" />
            <SummaryCard label="Deadlines" count={summary.deadlines} href="/attention#deadlines" />
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section aria-labelledby="quick-access-heading" className="flex flex-col gap-3">
          <h2 id="quick-access-heading" className="text-sm font-semibold uppercase tracking-wide opacity-60">
            Project Quick Access
          </h2>
          {quickAccessProjects.length === 0 && <p className="text-sm opacity-50">No projects yet.</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {quickAccessProjects.map((project) => {
              const client = clients.find((c) => c.id === project.clientId);
              const lastActivity = project.workItems[0]?.createdAt;
              return (
                <a
                  key={project.id}
                  href={`#project-${project.id}`}
                  className="rounded-lg border border-black/10 dark:border-white/15 p-3 hover:border-black/25 dark:hover:border-white/30"
                >
                  <p className="font-medium text-sm">
                    {project.name} <span className="opacity-50">({project.key})</span>
                  </p>
                  <p className="text-xs opacity-60">{client?.name}</p>
                  <p className="mt-1 text-xs opacity-50">
                    {project.workItems.length} work item{project.workItems.length === 1 ? "" : "s"}
                    {lastActivity && ` · updated ${relativeTime(lastActivity, now)}`}
                  </p>
                </a>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="recent-activity-heading" className="flex flex-col gap-3">
          <h2 id="recent-activity-heading" className="text-sm font-semibold uppercase tracking-wide opacity-60">
            Recent Activity
          </h2>
          {recentEvents.length === 0 && <p className="text-sm opacity-50">No activity yet.</p>}
          <div className="flex flex-col divide-y divide-black/10 dark:divide-white/10 rounded-lg border border-black/10 dark:border-white/15">
            {recentEvents.map((event) => (
              <div key={event.id} className="flex flex-col gap-0.5 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">
                    {ACTOR_ICON[event.actor]} {event.action}
                  </span>
                  <time className="shrink-0 text-xs opacity-50">{relativeTime(event.createdAt, now)}</time>
                </div>
                <div className="flex flex-wrap gap-2 text-xs opacity-50">
                  {event.actorName && <span>by {event.actorName}</span>}
                  {event.workItem?.pipeline && (
                    <Link href={`/pipelines/${event.workItem.pipeline.id}`} className="underline">
                      {event.workItem.title}
                    </Link>
                  )}
                  {event.project && !event.workItem && <span>{event.project.name}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="all-projects-heading" className="flex flex-col gap-3">
        <h2 id="all-projects-heading" className="text-xl font-semibold">
          Projects
        </h2>
        <AddProjectForm clients={clients} />
      </section>

      {clients.length === 0 && (
        <p className="text-sm opacity-60">
          No clients yet. Run the seed script (<code>npm run db:seed</code>) or create one directly to get started.
        </p>
      )}

      {clients.map((client) => {
        const clientProjects = projectsByClient.get(client.id) ?? [];
        return (
          <section key={client.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
                {client.name}
                <span className="ml-2 normal-case font-normal opacity-60">
                  · AI cost: ${(clientAiCosts.get(client.id) ?? "0").toString()}
                  {client.aiBudgetUsd ? ` / $${client.aiBudgetUsd.toString()} budget` : ""}
                </span>
              </h2>
              {(ctx.isOrgAdmin || (WRITE_ROLES as string[]).includes(
                ctx.memberships.find((m) => m.clientId === client.id)?.role ?? ""
              )) && (
                <BudgetForm scope="client" id={client.id} currentBudgetUsd={client.aiBudgetUsd?.toString() ?? null} />
              )}
            </div>
            {clientProjects.length === 0 && <p className="text-sm opacity-50">No projects for this client yet.</p>}
            <div className="flex flex-col gap-6">
              {clientProjects.map((project) => (
                <div key={project.id} id={`project-${project.id}`} className="rounded-lg border border-black/10 dark:border-white/15 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-medium">
                        {project.name} <span className="opacity-50">({project.key})</span>
                      </h3>
                      <p className="text-xs opacity-60">{project.connector?.type ?? "MANUAL"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link href={`/projects/${project.id}/constitution`} className="text-xs underline opacity-70 hover:opacity-100">
                        Constitution
                      </Link>
                      <Link href={`/projects/${project.id}/settings`} className="text-xs underline opacity-70 hover:opacity-100">
                        Settings
                      </Link>
                      {project.connector && project.connector.type !== "MANUAL" && <SyncButton projectId={project.id} />}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-2">
                    {project.workItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded border border-black/10 dark:border-white/10 px-3 py-2 text-sm hover:bg-black/[.03] dark:hover:bg-white/[.04]"
                      >
                        {item.pipeline ? (
                          <Link href={`/pipelines/${item.pipeline.id}`} className="flex items-center gap-2">
                            {item.title}
                            <span className="rounded-full bg-black/5 dark:bg-white/10 px-2 py-0.5 text-xs opacity-70">
                              {item.status}
                            </span>
                          </Link>
                        ) : (
                          <span className="flex items-center gap-2">
                            {item.title}
                            <span className="rounded-full bg-black/5 dark:bg-white/10 px-2 py-0.5 text-xs opacity-70">
                              {item.status}
                            </span>
                          </span>
                        )}
                        <span className="flex items-center gap-3">
                          <span className="opacity-50">{item.pipeline?.currentStage}</span>
                          {item.pipeline && <StageBadge status={item.pipeline.status} />}
                          {!item.pipeline && <StartPipelineButton workItemId={item.id} compact />}
                          <QuickViewLink workItemId={item.id} className="text-xs underline opacity-60 hover:opacity-100">
                            Quick View
                          </QuickViewLink>
                        </span>
                      </div>
                    ))}
                    {project.workItems.length === 0 && (
                      <p className="text-sm opacity-50">No work items yet.</p>
                    )}
                  </div>

                  <div className="mt-3">
                    <AddWorkItemForm projectId={project.id} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SummaryCard({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-black/10 dark:border-white/15 p-3 hover:border-black/25 dark:hover:border-white/30"
    >
      <p className="text-2xl font-semibold">{count}</p>
      <p className="text-xs opacity-60">{label}</p>
    </Link>
  );
}
