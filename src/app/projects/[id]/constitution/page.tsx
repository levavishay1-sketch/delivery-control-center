import { notFound } from "next/navigation";
import Link from "next/link";
import { getProjectConstitutionDetail } from "@/domain/constitution/queries";
import { getProjectAiCost } from "@/domain/agent/queries";
import { getEffectiveBudget, listConfigHistory } from "@/domain/config/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { ForbiddenError } from "@/domain/shared/errors";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { stageStatusTone, stageStatusLabel } from "@/lib/colors/stageStatus";
import { DraftButton } from "@/components/DraftButton";
import { ApprovalGate } from "@/components/ApprovalGate";
import { ConfigBudgetPanel } from "@/components/ConfigBudgetPanel";
import { ConfigHistoryList } from "@/components/ConfigHistoryList";

export const dynamic = "force-dynamic";

const DRAFTABLE_STATUSES = new Set(["DRAFT", "REJECTED"]);

export default async function ProjectConstitutionPage({ params }: PageProps<"/projects/[id]/constitution">) {
  const { id } = await params;

  const ctx = await requireAuthContext();
  const detail = await getProjectConstitutionDetail(ctx, id).catch((err) => {
    if (err instanceof ForbiddenError) return null;
    throw err;
  });

  if (!detail) notFound();
  const { project, latest, history } = detail;
  const aiCost = await getProjectAiCost(project.id);
  const userRole = ctx.memberships.find((m) => m.clientId === project.clientId)?.role;
  const canManage = ctx.isOrgAdmin || (!!userRole && (WRITE_ROLES as string[]).includes(userRole));
  const [effectiveBudget, budgetHistory] = await Promise.all([
    getEffectiveBudget("PROJECT", project.id),
    listConfigHistory("PROJECT", project.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs opacity-60">Project</p>
        <h1 className="text-xl font-semibold">
          {project.name} <span className="opacity-50">({project.key})</span>
        </h1>
        <p className="mt-1 text-xs opacity-60">Total AI drafting cost: ${aiCost.toString()}</p>
        <div className="mt-2 flex flex-col gap-1">
          {canManage ? (
            <ConfigBudgetPanel scope="PROJECT" id={project.id} effective={effectiveBudget} />
          ) : (
            <p className="text-xs opacity-60">
              Effective budget: {effectiveBudget.value ? `$${effectiveBudget.value}` : "No limit"}
              {effectiveBudget.sourceScope && !effectiveBudget.isOverride ? ` (inherited from ${effectiveBudget.sourceScope.toLowerCase()})` : ""}
            </p>
          )}
          {budgetHistory.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer opacity-60 hover:opacity-100">Budget history</summary>
              <div className="mt-2">
                <ConfigHistoryList
                  history={budgetHistory.map((h) => ({
                    id: h.id,
                    oldValueUsd: h.oldValueUsd?.toString() ?? null,
                    newValueUsd: h.newValueUsd?.toString() ?? null,
                    changedByUser: { name: h.changedByUser.name, email: h.changedByUser.email },
                    createdAt: h.createdAt.toISOString(),
                  }))}
                />
              </div>
            </details>
          )}
        </div>
        <Link href="/" className="mt-1 inline-block text-xs underline opacity-70 hover:opacity-100">
          ← Back to Dashboard
        </Link>
      </div>

      <section aria-labelledby="constitution-heading" className="rounded-lg border border-black/10 dark:border-white/15 p-4">
        <div className="flex items-center justify-between">
          <h2 id="constitution-heading" className="font-medium">
            Constitution{latest ? ` — v${latest.version}` : ""}
          </h2>
          {latest && (
            <StatusBadge
              tone={stageStatusTone(latest.status)}
              label={stageStatusLabel(latest.status)}
              reason="Governs every pipeline started under this project"
            />
          )}
        </div>
        <p className="mt-1 text-xs opacity-60">
          The project&apos;s governing principles and constraints. Every pipeline started under this project
          references the Constitution version that was approved at the time (Pipeline.constitutionVersion) — a
          later redraft never retroactively changes an in-flight pipeline.
        </p>

        {!latest && (
          <div className="mt-3">
            <p className="mb-2 text-sm opacity-70">No Constitution has been drafted for this project yet.</p>
            <DraftButton
              target={{ kind: "constitution", projectId: project.id }}
              label="Draft with AI"
              canApprove={canManage}
            />
          </div>
        )}

        {latest && (
          <>
            {latest.content && (
              <pre className="mt-3 whitespace-pre-wrap rounded bg-black/[.03] dark:bg-white/[.05] p-3 text-xs font-mono">
                {latest.content}
              </pre>
            )}

            {(latest.status === "PENDING_APPROVAL" || latest.status === "APPROVED") && latest.aiModel && (
              <p className="mt-2 text-xs opacity-50">
                {latest.aiModel} · {latest.promptTokens}+{latest.completionTokens} tokens · ${latest.costUsd?.toString()}
              </p>
            )}

            {DRAFTABLE_STATUSES.has(latest.status) && (
              <div className="mt-3">
                <DraftButton
                  target={{ kind: "constitution", projectId: project.id }}
                  label={latest.status === "REJECTED" ? "Redraft (new version)" : "Draft with AI"}
                  canApprove={canManage}
                />
              </div>
            )}

            {latest.status === "PENDING_APPROVAL" && (
              <div className="mt-3">
                <ApprovalGate apiBasePath={`/api/constitutions/${latest.id}`} />
              </div>
            )}
          </>
        )}
      </section>

      {history.length > 1 && (
        <section aria-labelledby="constitution-history-heading" className="flex flex-col gap-2">
          <h2 id="constitution-history-heading" className="text-sm font-semibold uppercase tracking-wide opacity-60">
            Version History
          </h2>
          <div className="flex flex-col gap-2">
            {history.slice(1).map((version) => (
              <details key={version.id} className="rounded-lg border border-black/10 dark:border-white/15 p-3">
                <summary className="flex cursor-pointer items-center justify-between text-sm">
                  <span>
                    v{version.version} — {version.status.replaceAll("_", " ")}
                  </span>
                  <span className="text-xs opacity-50">
                    {version.approvedAt ? `approved ${version.approvedAt.toDateString()}` : version.createdAt.toDateString()}
                  </span>
                </summary>
                {version.content && (
                  <pre className="mt-3 whitespace-pre-wrap rounded bg-black/[.03] dark:bg-white/[.05] p-3 text-xs font-mono">
                    {version.content}
                  </pre>
                )}
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
