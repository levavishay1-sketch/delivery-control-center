import { listClients } from "@/domain/client/queries";
import { listOrganizations } from "@/domain/organization/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { AddClientForm } from "@/components/AddClientForm";
import { Row, RowList, RowEmpty } from "@/components/ui/Row";
import { StatusBadge } from "@/components/ui/StatusBadge";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const ctx = await requireAuthContext();
  const [clients, organizations] = await Promise.all([
    listClients(ctx),
    ctx.isOrgAdmin ? listOrganizations() : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Clients</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Every client you have access to, with its projects and repositories.
        </p>
      </div>

      {ctx.isOrgAdmin && <AddClientForm organizations={organizations.map((o) => ({ id: o.id, name: o.name }))} />}

      <RowList>
        {clients.length === 0 && <RowEmpty>No clients yet.</RowEmpty>}
        {clients.map((client) => (
          <Row key={client.id} href={`/clients/${client.id}`} columns="1fr auto auto">
            <div>
              <p className="font-medium">{client.name}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {client.slug} · {client.organization.name}
              </p>
            </div>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {client._count.projects} project{client._count.projects === 1 ? "" : "s"}
            </span>
            {client.active ? (
              <StatusBadge tone="healthy" label="Active" reason="Visible on the Dashboard and Attention Center" />
            ) : (
              <StatusBadge tone="inactive" label="Inactive" reason="Deactivated — historical data preserved" />
            )}
          </Row>
        ))}
      </RowList>
    </div>
  );
}
