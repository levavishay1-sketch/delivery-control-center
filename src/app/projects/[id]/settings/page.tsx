import { notFound } from "next/navigation";
import Link from "next/link";
import { getProjectByIdForUser } from "@/domain/project/queries";
import { getOrCreateConnectorForProject } from "@/domain/connector/commands";
import { listSyncRuns } from "@/domain/connector/queries";
import { listOpenConflicts } from "@/domain/connector/conflicts";
import { getRepositoryForProject } from "@/domain/evidence/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { ForbiddenError } from "@/domain/shared/errors";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { ConnectorConfigForm } from "@/components/ConnectorConfigForm";
import { ConflictResolutionPanel } from "@/components/ConflictResolutionPanel";
import { SyncButton } from "@/components/SyncButton";
import { RepositoryLinkForm } from "@/components/RepositoryLinkForm";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";

export const dynamic = "force-dynamic";

const RUN_STATUS_TONES: Record<string, StatusTone> = {
  SUCCEEDED: "healthy",
  FAILED: "critical",
  RUNNING: "active",
};

const CONNECTOR_STATUS_TONES: Record<string, StatusTone> = {
  CONNECTED: "healthy",
  ERROR: "critical",
};

export default async function ProjectSettingsPage({ params }: PageProps<"/projects/[id]/settings">) {
  const { id } = await params;

  const ctx = await requireAuthContext();
  const project = await getProjectByIdForUser(ctx, id).catch((err) => {
    if (err instanceof ForbiddenError) return null;
    throw err;
  });
  if (!project) notFound();

  const connector = await getOrCreateConnectorForProject(project.id);
  const [syncRuns, openConflicts, repository] = await Promise.all([
    listSyncRuns(connector.id),
    listOpenConflicts(ctx, project.id),
    getRepositoryForProject(project.id),
  ]);

  const userRole = ctx.memberships.find((m) => m.clientId === project.clientId)?.role;
  const canManage = ctx.isOrgAdmin || (!!userRole && (WRITE_ROLES as string[]).includes(userRole));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Project settings</p>
        <h1 className="text-xl font-semibold">
          {project.name} <span className="text-neutral-400">({project.key})</span>
        </h1>
        <Link href="/" className="mt-1 inline-block text-xs text-accent hover:underline">
          ← Back to Dashboard
        </Link>
      </div>

      <Panel title="Connector">
        <div className="flex items-center justify-between">
          <StatusBadge
            tone={CONNECTOR_STATUS_TONES[connector.status] ?? "inactive"}
            label={connector.status}
            reason={connector.lastSyncAt ? `Last synced ${connector.lastSyncAt.toLocaleString()}` : "Never synced"}
          />
          {connector.type !== "MANUAL" && <SyncButton projectId={project.id} />}
        </div>
        <p className="mt-2 text-xs text-neutral-400">{connector.type}</p>

        {canManage && (
          <div className="mt-3">
            <ConnectorConfigForm projectId={project.id} currentType={connector.type} />
          </div>
        )}
      </Panel>

      {connector.type === "GITHUB" && (
        <Panel title="Repository">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Engineering evidence (commits, pull requests, test runs) is populated from a linked GitHub repository.
          </p>
          {canManage ? (
            <RepositoryLinkForm
              projectId={project.id}
              repository={repository ? { id: repository.id, owner: repository.owner, name: repository.name } : null}
            />
          ) : (
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              {repository ? `Linked: ${repository.owner}/${repository.name}` : "No repository linked."}
            </p>
          )}
        </Panel>
      )}

      {syncRuns.length > 0 && (
        <section aria-labelledby="sync-history-heading" className="flex flex-col gap-3">
          <h2 id="sync-history-heading" className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Sync History
          </h2>
          <div className="rounded-md border border-border-hairline">
            {syncRuns.map((run, i) => (
              <div
                key={run.id}
                className={`flex items-center justify-between px-4 py-3 text-xs ${i > 0 ? "border-t border-border-hairline" : ""}`}
              >
                <StatusBadge tone={RUN_STATUS_TONES[run.status] ?? "inactive"} label={run.status} reason={run.startedAt.toLocaleString()} />
                <span className="text-neutral-500 dark:text-neutral-400">
                  {run.itemsCreated} created · {run.itemsUpdated} updated
                  {run.itemsConflicted > 0 ? ` · ${run.itemsConflicted} conflicted` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {openConflicts.length > 0 && (
        <section aria-labelledby="conflicts-heading" className="flex flex-col gap-3">
          <h2 id="conflicts-heading" className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Open Sync Conflicts
          </h2>
          {canManage ? (
            <ConflictResolutionPanel
              conflicts={openConflicts.map((c) => ({
                id: c.id,
                field: c.field,
                currentValue: c.currentValue,
                incomingValue: c.incomingValue,
                workItem: { id: c.workItem.id, title: c.workItem.title },
              }))}
            />
          ) : (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {openConflicts.length} field{openConflicts.length === 1 ? "" : "s"} need a write-capable role to resolve.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
