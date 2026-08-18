import Link from "next/link";
import { notFound } from "next/navigation";
import { getClientDetail } from "@/domain/client/queries";
import { listRequirementsForClient } from "@/domain/requirement/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { ForbiddenError } from "@/domain/shared/errors";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { EditClientForm } from "@/components/EditClientForm";
import { ClientActivationControl } from "@/components/ClientActivationControl";
import { RequirementForm } from "@/components/RequirementForm";
import { Panel, PanelEmpty } from "@/components/ui/Panel";
import { Row, RowList } from "@/components/ui/Row";
import { StatusBadge } from "@/components/ui/StatusBadge";

export const dynamic = "force-dynamic";

const REQUIREMENT_STATUS_TONE = {
  OPEN: "active",
  SDD_ACTIVE: "healthy",
  DECLINED: "inactive",
} as const;

/** Slice 22 — only the open statuses ever reach this panel (COMPLETED/CLOSED are filtered out by the query), but every WorkStatus value is mapped for type completeness. */
const WORK_STATUS_TONE = {
  DRAFT: "inactive",
  OPEN: "active",
  IN_PROGRESS: "active",
  DECISION_REQUIRED: "warning",
  BLOCKED: "critical",
  REVIEW: "warning",
  APPROVED: "healthy",
  COMPLETED: "healthy",
  CLOSED: "inactive",
} as const;

const WORK_STATUS_REASON = {
  DRAFT: "Not yet submitted for approval",
  OPEN: "Ready to start",
  IN_PROGRESS: "Currently being worked on",
  DECISION_REQUIRED: "Waiting on a decision",
  BLOCKED: "Blocked",
  REVIEW: "In review",
  APPROVED: "Approved, not yet started",
  COMPLETED: "Completed",
  CLOSED: "Closed",
} as const;

export default async function ClientDetailPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const ctx = await requireAuthContext();

  const detail = await getClientDetail(ctx, id).catch((err) => {
    if (err instanceof ForbiddenError) return null;
    throw err;
  });
  if (!detail) notFound();

  const { client, projects, repositories, connectors, topLevelOpenWorkItems } = detail;
  const requirements = await listRequirementsForClient(ctx, id);

  const userRole = ctx.memberships.find((m) => m.clientId === id)?.role;
  const canManage = ctx.isOrgAdmin || (!!userRole && (WRITE_ROLES as string[]).includes(userRole));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Client</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{client.name}</h1>
          {client.active ? (
            <StatusBadge tone="healthy" label="Active" reason="Visible on the Dashboard and Attention Center" />
          ) : (
            <StatusBadge tone="inactive" label="Inactive" reason="Deactivated — historical data preserved" />
          )}
        </div>
        <Link href="/clients" className="mt-1 inline-block text-xs text-accent hover:underline">
          ← Back to Clients
        </Link>
      </div>

      {ctx.isOrgAdmin && (
        <Panel title="Client details">
          <EditClientForm clientId={client.id} initialName={client.name} initialSlug={client.slug} />
          <div className="mt-3 border-t border-border-hairline pt-3">
            <ClientActivationControl clientId={client.id} active={client.active} />
          </div>
        </Panel>
      )}

      <Panel title="Projects">
        {projects.length === 0 ? (
          <PanelEmpty>No projects yet.</PanelEmpty>
        ) : (
          <RowList>
            {projects.map((project) => (
              <Row key={project.id} href={`/projects/${project.id}/settings`} columns="1fr auto">
                <div>
                  <p className="font-medium">{project.name}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{project.key}</p>
                </div>
                {project.connector && (
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">{project.connector.type}</span>
                )}
              </Row>
            ))}
          </RowList>
        )}
      </Panel>

      <Panel title="Requirements">
        {canManage && <RequirementForm clientId={id} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />}
        {requirements.length === 0 ? (
          <PanelEmpty>No Requirements yet.</PanelEmpty>
        ) : (
          <RowList className={canManage ? "mt-3" : undefined}>
            {requirements.map((requirement) => (
              <Row key={requirement.id} href={`/requirements/${requirement.id}`} columns="1fr auto">
                <div>
                  <p className="font-medium">{requirement.title}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {requirement.type} · {requirement.project ? requirement.project.name : "Standalone"}
                  </p>
                </div>
                <StatusBadge
                  tone={REQUIREMENT_STATUS_TONE[requirement.status]}
                  label={requirement.status}
                  reason={requirement.workItem ? `Linked to "${requirement.workItem.title}"` : "No Work Item yet"}
                />
              </Row>
            ))}
          </RowList>
        )}
      </Panel>

      <Panel title="Tasks">
        {topLevelOpenWorkItems.length === 0 ? (
          <PanelEmpty>No top-level open work items.</PanelEmpty>
        ) : (
          <RowList>
            {topLevelOpenWorkItems.map((item) => {
              const project = projects.find((p) => p.id === item.projectId);
              return (
                <Row key={item.id} href={`/work-items/${item.id}/360`} columns="1fr auto">
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {item.type} · {project ? project.name : "Unknown project"}
                    </p>
                  </div>
                  <StatusBadge
                    tone={WORK_STATUS_TONE[item.status]}
                    label={item.status}
                    reason={WORK_STATUS_REASON[item.status]}
                  />
                </Row>
              );
            })}
          </RowList>
        )}
      </Panel>

      <Panel title="Repositories">
        {repositories.length === 0 ? (
          <PanelEmpty>No repositories linked yet.</PanelEmpty>
        ) : (
          <RowList>
            {repositories.map((repo) => (
              <Row key={repo.id} href={`/repositories/${repo.id}`} columns="1fr 1fr">
                <p className="font-medium">
                  {repo.owner}/{repo.name}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Linked to: {repo.projectLinks.map((link) => link.project.name).join(", ") || "no project"}
                </p>
              </Row>
            ))}
          </RowList>
        )}
      </Panel>

      <Panel title="Connectors">
        {connectors.length === 0 ? (
          <PanelEmpty>No connectors configured yet.</PanelEmpty>
        ) : (
          <RowList>
            {connectors.map((connector) => (
              <Row key={connector.id} columns="1fr auto">
                <span className="text-sm">{connector.type}</span>
                <StatusBadge
                  tone={connector.status === "CONNECTED" ? "healthy" : connector.status === "ERROR" ? "critical" : "inactive"}
                  label={connector.status}
                  reason={connector.lastSyncAt ? `Last synced ${connector.lastSyncAt.toLocaleString()}` : "Never synced"}
                />
              </Row>
            ))}
          </RowList>
        )}
      </Panel>
    </div>
  );
}
