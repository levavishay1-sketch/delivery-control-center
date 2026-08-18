"use client";

import Link from "next/link";
import { useState } from "react";
import { EditWorkItemForm } from "@/components/EditWorkItemForm";
import { AiRecommendationCard } from "@/components/AiRecommendationCard";
import { CreateBlockerForm } from "@/components/CreateBlockerForm";
import { CreateDecisionForm } from "@/components/CreateDecisionForm";
import { ResolveBlockerButton } from "@/components/ResolveBlockerButton";
import { DecisionActions } from "@/components/DecisionActions";
import { StartPipelineButton } from "@/components/StartPipelineButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { formatDate, formatMessage } from "@/lib/i18n/format";

interface Member {
  id: string;
  name: string | null;
  email: string;
}

interface Blocker {
  id: string;
  ownerId: string;
  reason: string;
  requiredAction: string;
  owner: Member;
  blockedSince: string;
}

interface Decision {
  id: string;
  question: string;
  reason: string;
  impact: string;
  aiRecommendation: string | null;
  aiConfidence: string | null;
  deadline: string | null;
}

interface ChildItem {
  id: string;
  title: string;
  status: string;
  owner: Member | null;
  pipelineId: string | null;
}

export interface FieldProvenanceEntry {
  field: string;
  source: string;
  externalId: string | null;
  actorUser: { name: string | null; email: string } | null;
  updatedAt: string;
}

/** "Where did this value come from?" affordance (Slice 4 field-provenance capability). Renders nothing for a field with no recorded provenance — never fabricates an origin. */
export function ProvenanceNote({ field, provenance }: { field: string; provenance: FieldProvenanceEntry[] }) {
  const entry = provenance.find((p) => p.field === field);
  if (!entry) return null;
  const label =
    entry.source === "MANUAL"
      ? `Manually set by ${entry.actorUser?.name ?? entry.actorUser?.email ?? "a user"}`
      : `Synced${entry.externalId ? ` (${entry.externalId})` : ""}`;
  return (
    <span title={`${label} · ${new Date(entry.updatedAt).toLocaleString()}`} className="ml-1 cursor-help text-xs opacity-40" aria-label={label}>
      ⓘ
    </span>
  );
}

export function OverviewTab({
  workItem,
  members,
  activeBlocker,
  pendingDecision,
  canEdit,
  canManage,
  isBlockerOwner,
  parent,
  childItems,
  aiCost,
  stageCosts,
  now,
  fieldProvenance,
  onChanged,
}: {
  workItem: {
    id: string;
    title: string;
    description: string | null;
    type: string;
    status: string;
    risk: string;
    priority: string;
    owner: Member | null;
    executorType: string;
    executor: Member | null;
    dueDate: string | null;
    progress: number;
    ownerId: string | null;
    executorId: string | null;
    pipelineId: string | null;
  };
  members: Member[];
  activeBlocker: Blocker | null;
  pendingDecision: Decision | null;
  canEdit: boolean;
  canManage: boolean;
  isBlockerOwner: boolean;
  parent: { id: string; title: string; pipelineId: string | null } | null;
  childItems: ChildItem[];
  aiCost: string;
  stageCosts: { type: string; costUsd: string | null }[];
  now: number;
  /** Per-field sync/manual-edit provenance (Slice 4). Defaults to none — Quick View's data isn't yet wired to fetch it. */
  fieldProvenance?: FieldProvenanceEntry[];
  /** If given (e.g. by the Quick View drawer, whose data isn't a Server Component), called after a mutation instead of the default router.refresh(). */
  onChanged?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const provenance = fieldProvenance ?? [];
  const [editing, setEditing] = useState(false);

  const due = workItem.dueDate ? new Date(workItem.dueDate) : null;
  const dueDays = due ? Math.ceil((due.getTime() - now) / (24 * 60 * 60 * 1000)) : null;
  const dueColor =
    dueDays === null
      ? ""
      : dueDays < 0
        ? "text-status-critical"
        : dueDays <= 7
          ? "text-status-warning"
          : "text-status-healthy";

  if (editing) {
    return (
      <EditWorkItemForm
        workItemId={workItem.id}
        initial={{
          title: workItem.title,
          description: workItem.description,
          risk: workItem.risk,
          priority: workItem.priority,
          ownerId: workItem.ownerId,
          executorType: workItem.executorType,
          executorId: workItem.executorId,
          dueDate: workItem.dueDate ? workItem.dueDate.slice(0, 10) : null,
          progress: workItem.progress,
        }}
        members={members}
        onDone={() => setEditing(false)}
        onChanged={onChanged}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {activeBlocker && (
        <div data-testid="blocker-panel" className="rounded-lg bg-status-critical-bg p-3">
          <StatusBadge tone="critical" label={t.overview.blockedLabel} reason={activeBlocker.reason} />
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            {formatMessage(t.overview.ownerSuffix, { name: activeBlocker.owner.name ?? activeBlocker.owner.email })}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {formatMessage(t.overview.requiredActionSuffix, { action: activeBlocker.requiredAction })}
          </p>
          {(canManage || isBlockerOwner) && (
            <div className="mt-2">
              <ResolveBlockerButton blockerId={activeBlocker.id} onResolved={onChanged} />
            </div>
          )}
        </div>
      )}

      {pendingDecision && (
        <div className="rounded-lg bg-status-warning-bg p-3">
          <StatusBadge tone="warning" label={t.overview.decisionNeededLabel} reason={pendingDecision.question} />
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{pendingDecision.reason}</p>
          {pendingDecision.aiRecommendation && (
            <p className="text-xs text-status-ai">
              {formatMessage(t.overview.aiRecommends, { recommendation: pendingDecision.aiRecommendation })}
              {pendingDecision.aiConfidence !== null && formatMessage(t.overview.aiConfidence, { confidence: pendingDecision.aiConfidence })}
            </p>
          )}
          <div className="mt-2">
            <DecisionActions decisionId={pendingDecision.id} onDecided={onChanged} />
          </div>
        </div>
      )}

      {workItem.description && (
        <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
          {workItem.description}
          <ProvenanceNote field="description" provenance={provenance} />
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">{t.overview.statusLabel}</dt>
          <dd className="font-medium">
            {workItem.status}
            <ProvenanceNote field="status" provenance={provenance} />
          </dd>
          <dd className="text-xs text-neutral-400">{t.overview.statusExplanation[workItem.status as keyof typeof t.overview.statusExplanation]}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">{t.overview.ownerLabel}</dt>
          <dd>{workItem.owner ? workItem.owner.name ?? workItem.owner.email : t.overview.unassigned}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">{t.overview.executorLabel}</dt>
          <dd>
            {workItem.executorType === "AI_AGENT"
              ? t.overview.aiAgent
              : workItem.executorType === "UNASSIGNED"
                ? t.overview.unassigned
                : workItem.executor
                  ? workItem.executor.name ?? workItem.executor.email
                  : workItem.executorType}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">{t.overview.dueDateLabel}</dt>
          <dd className={dueColor}>
            {due ? formatDate(due, locale) : t.overview.none}
            {dueDays !== null &&
              " " +
                (dueDays < 0
                  ? formatMessage(t.overview.overdueBy, { n: Math.abs(dueDays) })
                  : formatMessage(t.overview.inDays, { n: dueDays }))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">{t.overview.riskLabel}</dt>
          <dd className="font-medium">{workItem.risk}</dd>
          <dd className="text-xs text-neutral-400">{t.overview.riskExplanation[workItem.risk as keyof typeof t.overview.riskExplanation]}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">{t.overview.priorityLabel}</dt>
          <dd className="font-medium">{workItem.priority}</dd>
        </div>
      </dl>

      {canManage && workItem.executorType === "UNASSIGNED" && (
        <AiRecommendationCard workItemId={workItem.id} onEditDeveloper={() => setEditing(true)} />
      )}

      <div>
        <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
          <span>{t.overview.progressLabel}</span>
          <span className="tabular-nums">{workItem.progress}%</span>
        </div>
        <div className="mt-1.5 h-2 w-full rounded-full bg-surface-muted">
          <div className="h-2 rounded-full" style={{ width: `${workItem.progress}%`, backgroundImage: "var(--gradient-accent)" }} />
        </div>
      </div>

      {(Number(aiCost) > 0 || stageCosts.some((s) => s.costUsd)) && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{t.overview.aiCostHeading}</h3>
          <p className="text-sm">{formatMessage(t.overview.totalCost, { cost: aiCost })}</p>
          {stageCosts.length > 0 && (
            <ul className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {stageCosts.filter((s) => s.costUsd).map((s) => (
                <li key={s.type}>{s.type}: ${s.costUsd}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(parent || childItems.length > 0) && (
        <div className="flex flex-col gap-2">
          {parent && (
            <p className="text-sm">
              {t.overview.parentLabel}{" "}
              {parent.pipelineId ? (
                <Link href={`/pipelines/${parent.pipelineId}`} className="text-accent hover:underline">
                  {parent.title}
                </Link>
              ) : (
                parent.title
              )}
            </p>
          )}
          {childItems.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{t.overview.childrenHeading}</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {childItems.map((c) => (
                  <li key={c.id} className="text-sm">
                    {c.pipelineId ? (
                      <Link href={`/pipelines/${c.pipelineId}`} className="text-accent hover:underline">
                        {c.title}
                      </Link>
                    ) : (
                      c.title
                    )}{" "}
                    <span className="text-xs text-neutral-400">
                      · {c.status} · {c.owner ? c.owner.name ?? c.owner.email : t.overview.unassigned}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border-hairline pt-3">
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border border-border-hairline px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            {t.overview.editButton}
          </button>
        )}
        {canManage && !activeBlocker && (
          <CreateBlockerForm workItemId={workItem.id} members={members} defaultOwnerId={workItem.ownerId ?? members[0]?.id ?? ""} onCreated={onChanged} />
        )}
        {canManage && !pendingDecision && <CreateDecisionForm workItemId={workItem.id} onCreated={onChanged} />}
        {canManage && !workItem.pipelineId && <StartPipelineButton workItemId={workItem.id} onStarted={onChanged} />}
      </div>
    </div>
  );
}
