import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepositoryContext, getRepositoryDetail, listRepositoryDiscoveries } from "@/domain/repository-discovery/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { ForbiddenError } from "@/domain/shared/errors";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { RunDiscoveryButton } from "@/components/RunDiscoveryButton";
import { Panel, PanelEmpty } from "@/components/ui/Panel";
import { Row, RowList } from "@/components/ui/Row";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { InfoTooltip } from "@/components/ui/InfoTooltip";

export const dynamic = "force-dynamic";

type DiscoveryStatus = "RUNNING" | "SUCCEEDED" | "FAILED";

const DISCOVERY_STATUS_TONE: Record<DiscoveryStatus, "active" | "healthy" | "critical"> = {
  RUNNING: "active",
  SUCCEEDED: "healthy",
  FAILED: "critical",
};

const DISCOVERY_STATUS_REASON: Record<DiscoveryStatus, string> = {
  RUNNING: "Analyzing the repository now",
  SUCCEEDED: "Completed",
  FAILED: "Failed after exhausting retries",
};

function FindingField({ label, summary, evidence }: { label: string; summary: string; evidence: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="text-sm">{summary}</p>
      {evidence.length > 0 && (
        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Evidence: {evidence.join(", ")}</p>
      )}
    </div>
  );
}

export default async function RepositoryDetailPage({ params }: PageProps<"/repositories/[id]">) {
  const { id } = await params;
  const ctx = await requireAuthContext();

  const detail = await getRepositoryDetail(ctx, id).catch((err) => {
    if (err instanceof ForbiddenError) return null;
    throw err;
  });
  if (!detail) notFound();
  const { repository, client } = detail;

  const [context, discoveries] = await Promise.all([
    getRepositoryContext(ctx, id),
    listRepositoryDiscoveries(ctx, id),
  ]);

  const userRole = ctx.memberships.find((m) => m.clientId === repository.clientId)?.role;
  const canManage = ctx.isOrgAdmin || (!!userRole && (WRITE_ROLES as string[]).includes(userRole));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Repository</p>
        <h1 className="text-xl font-semibold">
          {repository.owner}/{repository.name}
        </h1>
        <Link href={`/clients/${client.id}`} className="mt-1 inline-block text-xs text-accent hover:underline">
          ← Back to {client.name}
        </Link>
      </div>

      <Panel
        title="Repository Context"
        data-testid="repository-context-panel"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {context ? `Discovery v${context.version} — as of ${context.completedAt.toLocaleString()}` : "No Discovery run yet"}
            </p>
            <InfoTooltip label="About repository context">
              This is a summary from the last Discovery run, not a live view of the repository — it can go stale
              as the repository changes. Verify against the live source when a decision depends on it.
            </InfoTooltip>
          </div>
          {canManage && <RunDiscoveryButton repositoryId={id} hasExisting={context !== null} />}
        </div>

        {context ? (
          <div className="flex flex-col gap-3">
            <FindingField label="Purpose" summary={context.findings.purpose.summary} evidence={context.findings.purpose.evidence} />
            <FindingField label="Stack" summary={context.findings.stack.summary} evidence={context.findings.stack.evidence} />
            <FindingField label="Structure" summary={context.findings.structure.summary} evidence={context.findings.structure.evidence} />
            <FindingField label="Modules" summary={context.findings.modules.summary} evidence={context.findings.modules.evidence} />
            <FindingField label="APIs" summary={context.findings.apis.summary} evidence={context.findings.apis.evidence} />
            <FindingField label="Data stores" summary={context.findings.dataStores.summary} evidence={context.findings.dataStores.evidence} />
            <FindingField label="Testing" summary={context.findings.testing.summary} evidence={context.findings.testing.evidence} />
            <FindingField label="Conventions" summary={context.findings.conventions.summary} evidence={context.findings.conventions.evidence} />
            {context.findings.unknowns.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Unknowns</p>
                <ul className="list-inside list-disc text-sm">
                  {context.findings.unknowns.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <PanelEmpty>No Discovery run has completed for this repository yet.</PanelEmpty>
        )}
      </Panel>

      <Panel title="Discovery Runs">
        {discoveries.length === 0 ? (
          <PanelEmpty>No Discovery runs yet.</PanelEmpty>
        ) : (
          <RowList>
            {discoveries.map((d) => (
              <Row key={d.id} columns="auto 1fr auto">
                <span className="font-medium">v{d.version}</span>
                <div className="flex flex-col gap-0.5">
                  <StatusBadge tone={DISCOVERY_STATUS_TONE[d.status]} label={d.status} reason={d.lastError ?? DISCOVERY_STATUS_REASON[d.status]} />
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    Triggered by {d.triggeredByUser.name ?? d.triggeredByUser.email}
                  </span>
                </div>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {d.costUsd ? `$${d.costUsd.toString()}` : "—"} · {d.startedAt.toLocaleString()}
                </span>
              </Row>
            ))}
          </RowList>
        )}
      </Panel>
    </div>
  );
}
