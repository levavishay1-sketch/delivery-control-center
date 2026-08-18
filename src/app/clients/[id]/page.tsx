import Link from "next/link";
import { notFound } from "next/navigation";
import { getClientDetail } from "@/domain/client/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { ForbiddenError } from "@/domain/shared/errors";
import { EditClientForm } from "@/components/EditClientForm";
import { ClientActivationControl } from "@/components/ClientActivationControl";
import { Panel, PanelEmpty } from "@/components/ui/Panel";
import { Row, RowList } from "@/components/ui/Row";
import { StatusBadge } from "@/components/ui/StatusBadge";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const ctx = await requireAuthContext();

  const detail = await getClientDetail(ctx, id).catch((err) => {
    if (err instanceof ForbiddenError) return null;
    throw err;
  });
  if (!detail) notFound();

  const { client, projects, repositories, connectors } = detail;

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
