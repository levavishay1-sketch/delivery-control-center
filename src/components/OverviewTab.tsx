"use client";

import Link from "next/link";
import { useState } from "react";
import { EditWorkItemForm } from "@/components/EditWorkItemForm";
import { CreateBlockerForm } from "@/components/CreateBlockerForm";
import { CreateDecisionForm } from "@/components/CreateDecisionForm";
import { ResolveBlockerButton } from "@/components/ResolveBlockerButton";
import { DecisionActions } from "@/components/DecisionActions";
import { StartPipelineButton } from "@/components/StartPipelineButton";
import { StatusBadge } from "@/components/ui/StatusBadge";

const STATUS_EXPLANATION: Record<string, string> = {
  DRAFT: "Not yet started.",
  OPEN: "Ready to be worked on.",
  IN_PROGRESS: "Currently being worked on.",
  DECISION_REQUIRED: "Waiting on a decision before work can continue.",
  BLOCKED: "Blocked — see the Blocker Status below.",
  REVIEW: "Awaiting review approval.",
  APPROVED: "Reviewed and approved.",
  COMPLETED: "Work is finished.",
  CLOSED: "Closed — no further action expected.",
};

const RISK_EXPLANATION: Record<string, string> = {
  LOW: "Low risk — unlikely to cause delivery issues.",
  MEDIUM: "Moderate risk — worth monitoring.",
  HIGH: "High risk — likely to affect delivery if unaddressed.",
  CRITICAL: "Critical risk — needs immediate attention.",
};

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
          <StatusBadge tone="critical" label="Blocked" reason={activeBlocker.reason} />
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            Owner: {activeBlocker.owner.name ?? activeBlocker.owner.email}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Required action: {activeBlocker.requiredAction}</p>
          {(canManage || isBlockerOwner) && (
            <div className="mt-2">
              <ResolveBlockerButton blockerId={activeBlocker.id} onResolved={onChanged} />
            </div>
          )}
        </div>
      )}

      {pendingDecision && (
        <div className="rounded-lg bg-status-warning-bg p-3">
          <StatusBadge tone="warning" label="Decision needed" reason={pendingDecision.question} />
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{pendingDecision.reason}</p>
          {pendingDecision.aiRecommendation && (
            <p className="text-xs text-status-ai">
              AI recommends: {pendingDecision.aiRecommendation}
              {pendingDecision.aiConfidence !== null && ` (${pendingDecision.aiConfidence}% confidence)`}
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
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">Status</dt>
          <dd className="font-medium">
            {workItem.status}
            <ProvenanceNote field="status" provenance={provenance} />
          </dd>
          <dd className="text-xs text-neutral-400">{STATUS_EXPLANATION[workItem.status]}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">Owner</dt>
          <dd>{workItem.owner ? workItem.owner.name ?? workItem.owner.email : "Unassigned"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">Executor</dt>
          <dd>
            {workItem.executorType === "AI_AGENT"
              ? "AI Agent"
              : workItem.executorType === "UNASSIGNED"
                ? "Unassigned"
                : workItem.executor
                  ? workItem.executor.name ?? workItem.executor.email
                  : workItem.executorType}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">Due date</dt>
          <dd className={dueColor}>
            {due ? due.toLocaleDateString() : "None"}
            {dueDays !== null && (dueDays < 0 ? ` (overdue by ${Math.abs(dueDays)}d)` : ` (in ${dueDays}d)`)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">Risk</dt>
          <dd className="font-medium">{workItem.risk}</dd>
          <dd className="text-xs text-neutral-400">{RISK_EXPLANATION[workItem.risk]}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">Priority</dt>
          <dd className="font-medium">{workItem.priority}</dd>
        </div>
      </dl>

      <div>
        <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
          <span>Progress</span>
          <span>{workItem.progress}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-surface-muted">
          <div className="h-1.5 rounded-full bg-accent" style={{ width: `${workItem.progress}%` }} />
        </div>
      </div>

      {(Number(aiCost) > 0 || stageCosts.some((s) => s.costUsd)) && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">AI Cost</h3>
          <p className="text-sm">Total: ${aiCost}</p>
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
              Parent:{" "}
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
              <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Children</h3>
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
                      · {c.status} · {c.owner ? c.owner.name ?? c.owner.email : "Unassigned"}
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
            Edit
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
