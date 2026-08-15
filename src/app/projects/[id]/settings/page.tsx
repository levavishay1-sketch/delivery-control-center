import { notFound } from "next/navigation";
import Link from "next/link";
import { getProjectByIdForUser } from "@/domain/project/queries";
import { getOrCreateConnectorForProject } from "@/domain/connector/commands";
import { listSyncRuns } from "@/domain/connector/queries";
import { listOpenConflicts } from "@/domain/connector/conflicts";
import { requireAuthContext } from "@/domain/shared/session";
import { ForbiddenError } from "@/domain/shared/errors";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { ConnectorConfigForm } from "@/components/ConnectorConfigForm";
import { ConflictResolutionPanel } from "@/components/ConflictResolutionPanel";
import { SyncButton } from "@/components/SyncButton";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  SUCCEEDED: "text-emerald-600 dark:text-emerald-400",
  FAILED: "text-red-600 dark:text-red-400",
  RUNNING: "text-blue-600 dark:text-blue-400",
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
  const [syncRuns, openConflicts] = await Promise.all([listSyncRuns(connector.id), listOpenConflicts(ctx, project.id)]);

  const userRole = ctx.memberships.find((m) => m.clientId === project.clientId)?.role;
  const canManage = ctx.isOrgAdmin || (!!userRole && (WRITE_ROLES as string[]).includes(userRole));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs opacity-60">Project settings</p>
        <h1 className="text-xl font-semibold">
          {project.name} <span className="opacity-50">({project.key})</span>
        </h1>
        <Link href="/" className="mt-1 inline-block text-xs underline opacity-70 hover:opacity-100">
          ← Back to Dashboard
        </Link>
      </div>

      <section aria-labelledby="connector-heading" className="rounded-lg border border-black/10 dark:border-white/15 p-4">
        <div className="flex items-center justify-between">
          <h2 id="connector-heading" className="font-medium">
            Connector
          </h2>
          <span className="flex items-center gap-2 text-xs">
            <span
              className={
                connector.status === "CONNECTED"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : connector.status === "ERROR"
                    ? "text-red-600 dark:text-red-400"
                    : "opacity-60"
              }
            >
              {connector.status}
            </span>
            {connector.type !== "MANUAL" && <SyncButton projectId={project.id} />}
          </span>
        </div>
        <p className="mt-1 text-xs opacity-60">
          {connector.type}
          {connector.lastSyncAt ? ` · last synced ${connector.lastSyncAt.toLocaleString()}` : " · never synced"}
        </p>

        {canManage && (
          <div className="mt-3">
            <ConnectorConfigForm projectId={project.id} currentType={connector.type} />
          </div>
        )}
      </section>

      {syncRuns.length > 0 && (
        <section aria-labelledby="sync-history-heading" className="flex flex-col gap-2">
          <h2 id="sync-history-heading" className="text-sm font-semibold uppercase tracking-wide opacity-60">
            Sync History
          </h2>
          <div className="flex flex-col gap-1">
            {syncRuns.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between rounded border border-black/10 dark:border-white/10 px-3 py-2 text-xs"
              >
                <span className={STATUS_COLOR[run.status] ?? "opacity-70"}>{run.status}</span>
                <span className="opacity-60">
                  {run.itemsCreated} created · {run.itemsUpdated} updated
                  {run.itemsConflicted > 0 ? ` · ${run.itemsConflicted} conflicted` : ""}
                </span>
                <span className="opacity-50">{run.startedAt.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {openConflicts.length > 0 && (
        <section aria-labelledby="conflicts-heading" className="flex flex-col gap-2">
          <h2 id="conflicts-heading" className="text-sm font-semibold uppercase tracking-wide opacity-60">
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
            <p className="text-xs opacity-60">
              {openConflicts.length} field{openConflicts.length === 1 ? "" : "s"} need a write-capable role to resolve.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
