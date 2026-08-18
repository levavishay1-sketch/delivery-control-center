import Link from "next/link";
import { notFound } from "next/navigation";
import { getRequirementById } from "@/domain/requirement/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { ForbiddenError } from "@/domain/shared/errors";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { StartSddButton } from "@/components/StartSddButton";
import { DeclineRequirementButton } from "@/components/DeclineRequirementButton";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  OPEN: "active",
  SDD_ACTIVE: "healthy",
  DECLINED: "inactive",
} as const;

const STATUS_REASON = {
  OPEN: "Ready for review — trigger SDD when this Requirement is understood",
  SDD_ACTIVE: "A Project and WorkItem exist for this Requirement",
  DECLINED: "Declined — no further action",
} as const;

export default async function RequirementDetailPage({ params }: PageProps<"/requirements/[id]">) {
  const { id } = await params;
  const ctx = await requireAuthContext();

  const requirement = await getRequirementById(ctx, id).catch((err) => {
    if (err instanceof ForbiddenError) return null;
    throw err;
  });
  if (!requirement) notFound();

  const userRole = ctx.memberships.find((m) => m.clientId === requirement.clientId)?.role;
  const canManage = ctx.isOrgAdmin || (!!userRole && (WRITE_ROLES as string[]).includes(userRole));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Requirement</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{requirement.title}</h1>
          <StatusBadge tone={STATUS_TONE[requirement.status]} label={requirement.status} reason={STATUS_REASON[requirement.status]} />
        </div>
        <Link href={`/clients/${requirement.clientId}`} className="mt-1 inline-block text-xs text-accent hover:underline">
          ← Back to Client
        </Link>
      </div>

      <Panel title="Details">
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Type</p>
            <p>{requirement.type}</p>
          </div>
          {requirement.description && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Description</p>
              <p className="whitespace-pre-wrap">{requirement.description}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Project</p>
            {requirement.project ? (
              <Link href={`/projects/${requirement.project.id}/settings`} className="text-accent hover:underline">
                {requirement.project.name}
              </Link>
            ) : (
              <p className="text-neutral-500 dark:text-neutral-400">Standalone — no Project linked yet</p>
            )}
          </div>
          {requirement.workItem && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Work Item</p>
              <Link href={`/work-items/${requirement.workItem.id}/360`} className="text-accent hover:underline">
                {requirement.workItem.title}
              </Link>
              {!requirement.workItem.pipeline && (
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  No Pipeline started yet — draft and approve a Constitution for its Project, then start the
                  Pipeline from the Work Item&apos;s own page.
                </p>
              )}
            </div>
          )}
        </div>

        {canManage && requirement.status === "OPEN" && (
          <div className="mt-4 flex items-center gap-2 border-t border-border-hairline pt-3">
            <StartSddButton requirementId={id} />
            <DeclineRequirementButton requirementId={id} />
          </div>
        )}
      </Panel>
    </div>
  );
}
