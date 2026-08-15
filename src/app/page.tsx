import Link from "next/link";
import { listProjectsForHome } from "@/domain/project/queries";
import { listClients } from "@/domain/client/queries";
import { listRecentAuditEvents } from "@/domain/audit/queries";
import { getItemsNeedingAttention } from "@/domain/attention/queries";
import { getClientAiCost } from "@/domain/agent/queries";
import { getEffectiveBudget, listConfigHistory } from "@/domain/config/queries";
import { listOrganizations } from "@/domain/organization/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { AddProjectForm } from "@/components/AddProjectForm";
import { AddWorkItemForm } from "@/components/AddWorkItemForm";
import { SyncButton } from "@/components/SyncButton";
import { StageBadge } from "@/components/StageBadge";
import { QuickViewLink } from "@/components/QuickViewLink";
import { StartPipelineButton } from "@/components/StartPipelineButton";
import { ConfigBudgetPanel } from "@/components/ConfigBudgetPanel";
import { ConfigHistoryList } from "@/components/ConfigHistoryList";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { Panel } from "@/components/ui/Panel";
import { Row, RowList, RowEmpty } from "@/components/ui/Row";
import { CheckCircle2 } from "lucide-react";
import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatMessage, pluralize } from "@/lib/i18n/format";
import type { Translations } from "@/lib/i18n/en";

export const dynamic = "force-dynamic";

const ACTOR_ICON: Record<string, string> = { SYSTEM: "⚙️", AI: "🤖", USER: "🧑" };

function relativeTime(date: Date, now: number, t: Translations) {
  const diffMs = now - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return t.common.justNow;
  if (diffMin < 60) return formatMessage(t.common.minutesAgo, { n: diffMin });
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return formatMessage(t.common.hoursAgo, { n: diffHr });
  const diffDay = Math.round(diffHr / 24);
  return formatMessage(t.common.daysAgo, { n: diffDay });
}

export default async function HomePage() {
  const ctx = await requireAuthContext();
  const locale = await getServerLocale();
  const t = getDictionary(locale);
  const [projects, clients, attention, recentEvents, organizations] = await Promise.all([
    listProjectsForHome(ctx),
    listClients(ctx),
    getItemsNeedingAttention(ctx),
    listRecentAuditEvents(ctx, 10),
    ctx.isOrgAdmin ? listOrganizations() : Promise.resolve([]),
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

  // Slice 6 — effective AI budget + change history per client, for the Configuration Center panel.
  const clientBudgetConfig = new Map(
    await Promise.all(
      clients.map(async (client) => {
        const [effective, history] = await Promise.all([
          getEffectiveBudget("CLIENT", client.id),
          listConfigHistory("CLIENT", client.id),
        ]);
        return [
          client.id,
          {
            effective,
            history: history.map((h) => ({
              id: h.id,
              oldValueUsd: h.oldValueUsd?.toString() ?? null,
              newValueUsd: h.newValueUsd?.toString() ?? null,
              changedByUser: { name: h.changedByUser.name, email: h.changedByUser.email },
              createdAt: h.createdAt.toISOString(),
            })),
          },
        ] as const;
      })
    )
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t.dashboard.heading}</h1>
        {ctx.isOrgAdmin && organizations.length > 0 && (
          <div className="flex items-center gap-3 text-xs">
            {organizations.map((org) => (
              <Link
                key={org.id}
                href={`/organizations/${org.id}/config`}
                className="text-accent hover:underline"
              >
                {org.name} configuration
              </Link>
            ))}
          </div>
        )}
      </div>

      <section aria-labelledby="attention-summary-heading" className="flex flex-col gap-3">
        <h2 id="attention-summary-heading" className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {t.dashboard.attentionSummaryHeading}
        </h2>
        {allClear ? (
          <div className="flex items-center gap-2 rounded-full bg-status-healthy-bg px-3 py-1.5 text-status-healthy w-fit">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-medium">{t.dashboard.allClear}</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <SummaryChip label={t.common.decisions} count={summary.decisions} href="/attention#decisions" />
            <SummaryChip label={t.common.blockers} count={summary.blockers} href="/attention#blockers" />
            <SummaryChip label={t.common.risks} count={summary.risks} href="/attention#risks" />
            <SummaryChip label={t.common.deadlines} count={summary.deadlines} href="/attention#deadlines" />
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section aria-labelledby="quick-access-heading" className="flex flex-col gap-3">
          <h2 id="quick-access-heading" className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {t.dashboard.quickAccessHeading}
          </h2>
          {quickAccessProjects.length === 0 && <p className="text-sm text-neutral-500">{t.dashboard.noProjects}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {quickAccessProjects.map((project) => {
              const client = clients.find((c) => c.id === project.clientId);
              const lastActivity = project.workItems[0]?.createdAt;
              return (
                <a
                  key={project.id}
                  href={`#project-${project.id}`}
                  className="rounded-lg border border-border-hairline bg-surface p-3 hover:border-neutral-400 dark:hover:border-neutral-500"
                >
                  <p className="text-sm font-medium">
                    {project.name} <span className="text-neutral-500">({project.key})</span>
                  </p>
                  <p className="text-xs text-neutral-500">{client?.name}</p>
                  <p className="mt-1 text-xs text-neutral-400">
                    {pluralize(locale, project.workItems.length, t.dashboard.workItemCount)}
                    {lastActivity && ` · ${formatMessage(t.dashboard.updatedRelative, { time: relativeTime(lastActivity, now, t) })}`}
                  </p>
                </a>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="recent-activity-heading" className="flex flex-col gap-3">
          <h2 id="recent-activity-heading" className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {t.dashboard.recentActivityHeading}
          </h2>
          {recentEvents.length === 0 ? (
            <RowList>
              <RowEmpty>{t.dashboard.noActivity}</RowEmpty>
            </RowList>
          ) : (
            <RowList>
              {recentEvents.map((event) => (
                <Row key={event.id} className="flex-col items-start gap-0.5">
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm">
                      {ACTOR_ICON[event.actor]} {event.action}
                    </span>
                    <time className="shrink-0 text-xs text-neutral-400">{relativeTime(event.createdAt, now, t)}</time>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-neutral-500">
                    {event.actorName && <span>{formatMessage(t.common.byActor, { name: event.actorName })}</span>}
                    {event.workItem?.pipeline && (
                      <Link href={`/pipelines/${event.workItem.pipeline.id}`} className="text-accent hover:underline">
                        {event.workItem.title}
                      </Link>
                    )}
                    {event.project && !event.workItem && <span>{event.project.name}</span>}
                  </div>
                </Row>
              ))}
            </RowList>
          )}
        </section>
      </div>

      <section aria-labelledby="all-projects-heading" className="flex flex-col gap-3">
        <h2 id="all-projects-heading" className="text-xl font-semibold">
          Projects
        </h2>
        <AddProjectForm clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
      </section>

      {clients.length === 0 && (
        <p className="text-sm text-neutral-500">
          No clients yet. Run the seed script (<code>npm run db:seed</code>) or create one directly to get started.
        </p>
      )}

      {clients.map((client) => {
        const clientProjects = projectsByClient.get(client.id) ?? [];
        const budgetConfig = clientBudgetConfig.get(client.id);
        const canManageClient =
          ctx.isOrgAdmin || (WRITE_ROLES as string[]).includes(ctx.memberships.find((m) => m.clientId === client.id)?.role ?? "");
        return (
          <section key={client.id} id={`client-${client.id}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {client.name}
                <span className="ml-2 normal-case font-normal text-neutral-400">
                  · AI cost: ${(clientAiCosts.get(client.id) ?? "0").toString()}
                </span>
              </h2>
            </div>
            {budgetConfig && (
              <div className="flex flex-col gap-1">
                {canManageClient ? (
                  <ConfigBudgetPanel scope="CLIENT" id={client.id} effective={budgetConfig.effective} />
                ) : (
                  <p className="text-xs text-neutral-500">
                    Effective budget: {budgetConfig.effective.value ? `$${budgetConfig.effective.value}` : "No limit"}
                    {budgetConfig.effective.sourceScope && !budgetConfig.effective.isOverride
                      ? ` (inherited from ${budgetConfig.effective.sourceScope.toLowerCase()})`
                      : ""}
                  </p>
                )}
                {budgetConfig.history.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-neutral-500 hover:text-foreground">Budget history</summary>
                    <div className="mt-2">
                      <ConfigHistoryList history={budgetConfig.history} />
                    </div>
                  </details>
                )}
              </div>
            )}
            {clientProjects.length === 0 && <p className="text-sm text-neutral-500">No projects for this client yet.</p>}
            <div className="flex flex-col gap-6">
              {clientProjects.map((project) => (
                <Panel key={project.id} id={`project-${project.id}`} className="scroll-mt-8">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-medium">
                          {project.name} <span className="text-neutral-500">({project.key})</span>
                        </h3>
                        <p className="text-xs text-neutral-500">{project.connector?.type ?? "MANUAL"}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Link href={`/projects/${project.id}/constitution`} className="text-xs text-accent hover:underline">
                          Constitution
                        </Link>
                        <Link href={`/projects/${project.id}/settings`} className="text-xs text-accent hover:underline">
                          Settings
                        </Link>
                        {project.connector && project.connector.type !== "MANUAL" && <SyncButton projectId={project.id} />}
                      </div>
                    </div>

                    <RowList className="mt-4">
                      {project.workItems.map((item) => (
                        <Row key={item.id} className="justify-between text-sm">
                          {item.pipeline ? (
                            <Link href={`/pipelines/${item.pipeline.id}`} className="flex items-center gap-2">
                              {item.title}
                              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-neutral-500">
                                {item.status}
                              </span>
                            </Link>
                          ) : (
                            <span className="flex items-center gap-2">
                              {item.title}
                              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-neutral-500">
                                {item.status}
                              </span>
                            </span>
                          )}
                          <span className="flex items-center gap-3">
                            <span className="text-neutral-400">{item.pipeline?.currentStage}</span>
                            {item.pipeline && <StageBadge status={item.pipeline.status} />}
                            {!item.pipeline && <StartPipelineButton workItemId={item.id} compact />}
                            <QuickViewLink workItemId={item.id} className="text-xs text-accent hover:underline">
                              Quick View
                            </QuickViewLink>
                          </span>
                        </Row>
                      ))}
                      {project.workItems.length === 0 && <RowEmpty>No work items yet.</RowEmpty>}
                    </RowList>

                    <div className="mt-3">
                      <AddWorkItemForm projectId={project.id} />
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SummaryChip({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-full border border-border-hairline bg-surface px-3 py-1.5 text-sm hover:border-neutral-400 dark:hover:border-neutral-500"
    >
      <span className="font-semibold">{count}</span>
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
    </Link>
  );
}
