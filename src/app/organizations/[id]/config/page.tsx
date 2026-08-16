import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrganizationById } from "@/domain/organization/queries";
import { getEffectiveBudget, listConfigHistory } from "@/domain/config/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { requireOrgAdmin } from "@/domain/shared/authz";
import { ForbiddenError } from "@/domain/shared/errors";
import { ConfigBudgetPanel } from "@/components/ConfigBudgetPanel";
import { ConfigHistoryList } from "@/components/ConfigHistoryList";
import { Panel } from "@/components/ui/Panel";

export const dynamic = "force-dynamic";

/** The app's first Organization-scoped page (design.md Task 5.3): the Organization's AI-budget Configuration Center entry, org-admin-gated. */
export default async function OrganizationConfigPage({ params }: PageProps<"/organizations/[id]/config">) {
  const { id } = await params;

  const ctx = await requireAuthContext();
  const organization = await getOrganizationById(id);
  if (!organization) notFound();

  try {
    requireOrgAdmin(ctx);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [effectiveBudget, history] = await Promise.all([
    getEffectiveBudget("ORGANIZATION", organization.id),
    listConfigHistory("ORGANIZATION", organization.id),
  ]);

  const clientsWithBudget = await Promise.all(
    organization.clients.map(async (client) => ({
      ...client,
      effective: await getEffectiveBudget("CLIENT", client.id),
    }))
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Organization</p>
        <h1 className="text-xl font-semibold">{organization.name}</h1>
        <Link href="/" className="mt-1 inline-block text-xs text-accent hover:underline">
          ← Back to Dashboard
        </Link>
      </div>

      <Panel title="AI Budget">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          The organization-wide AI spending limit. Clients and projects with no override of their own inherit this value.
        </p>
        <div className="mt-3">
          <ConfigBudgetPanel scope="ORGANIZATION" id={organization.id} effective={effectiveBudget} />
        </div>
      </Panel>

      <section aria-labelledby="org-history-heading" className="flex flex-col gap-3">
        <h2 id="org-history-heading" className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Budget History
        </h2>
        <ConfigHistoryList
          history={history.map((h) => ({
            id: h.id,
            oldValueUsd: h.oldValueUsd?.toString() ?? null,
            newValueUsd: h.newValueUsd?.toString() ?? null,
            changedByUser: { name: h.changedByUser.name, email: h.changedByUser.email },
            createdAt: h.createdAt.toISOString(),
          }))}
        />
      </section>

      <section aria-labelledby="org-clients-heading" className="flex flex-col gap-3">
        <h2 id="org-clients-heading" className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Clients
        </h2>
        {clientsWithBudget.length === 0 && <p className="text-sm text-neutral-500 dark:text-neutral-400">No clients yet.</p>}
        <div className="rounded-md border border-border-hairline">
          {clientsWithBudget.map((client, i) => (
            <Link
              key={client.id}
              href={`/#client-${client.id}`}
              className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs hover:bg-surface-muted ${i > 0 ? "border-t border-border-hairline" : ""}`}
            >
              <span className="font-medium">{client.name}</span>
              <span className="text-neutral-500 dark:text-neutral-400">
                Effective budget: {client.effective.value ? `$${client.effective.value}` : "No limit"}
                {client.effective.sourceScope && !client.effective.isOverride ? ` (inherited from ${client.effective.sourceScope.toLowerCase()})` : ""}
                {client.effective.isOverride ? " (own override)" : ""}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
