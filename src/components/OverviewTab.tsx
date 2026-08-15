"use client";

import Link from "next/link";
import { useState } from "react";
import { EditWorkItemForm } from "@/components/EditWorkItemForm";
import { CreateBlockerForm } from "@/components/CreateBlockerForm";
import { CreateDecisionForm } from "@/components/CreateDecisionForm";
import { ResolveBlockerButton } from "@/components/ResolveBlockerButton";
import { DecisionActions } from "@/components/DecisionActions";
import { StartPipelineButton } from "@/components/StartPipelineButton";

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
  /** If given (e.g. by the Quick View drawer, whose data isn't a Server Component), called after a mutation instead of the default router.refresh(). */
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState(false);

  const due = workItem.dueDate ? new Date(workItem.dueDate) : null;
  const dueDays = due ? Math.ceil((due.getTime() - now) / (24 * 60 * 60 * 1000)) : null;
  const dueColor = dueDays === null ? "" : dueDays < 0 ? "text-red-500" : dueDays <= 7 ? "text-amber-500" : "text-emerald-500";

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
      {workItem.description && <p className="text-sm opacity-80 whitespace-pre-wrap">{workItem.description}</p>}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs opacity-60">Status</dt>
          <dd className="font-medium">{workItem.status}</dd>
          <dd className="text-xs opacity-50">{STATUS_EXPLANATION[workItem.status]}</dd>
        </div>
        <div>
          <dt className="text-xs opacity-60">Owner</dt>
          <dd>{workItem.owner ? workItem.owner.name ?? workItem.owner.email : "Unassigned"}</dd>
        </div>
        <div>
          <dt className="text-xs opacity-60">Executor</dt>
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
          <dt className="text-xs opacity-60">Due date</dt>
          <dd className={dueColor}>
            {due ? due.toLocaleDateString() : "None"}
            {dueDays !== null && (dueDays < 0 ? ` (overdue by ${Math.abs(dueDays)}d)` : ` (in ${dueDays}d)`)}
          </dd>
        </div>
        <div>
          <dt className="text-xs opacity-60">Risk</dt>
          <dd className="font-medium">{workItem.risk}</dd>
          <dd className="text-xs opacity-50">{RISK_EXPLANATION[workItem.risk]}</dd>
        </div>
        <div>
          <dt className="text-xs opacity-60">Priority</dt>
          <dd className="font-medium">{workItem.priority}</dd>
        </div>
      </dl>

      <div>
        <div className="flex items-center justify-between text-xs opacity-60">
          <span>Progress</span>
          <span>{workItem.progress}%</span>
        </div>
        <div className="mt-1 h-2 w-full rounded-full bg-black/10 dark:bg-white/10">
          <div className="h-2 rounded-full bg-foreground" style={{ width: `${workItem.progress}%` }} />
        </div>
      </div>

      {activeBlocker && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">🚫 Blocked — {activeBlocker.reason}</p>
          <p className="mt-1 text-xs opacity-70">Owner: {activeBlocker.owner.name ?? activeBlocker.owner.email}</p>
          <p className="text-xs opacity-70">Required action: {activeBlocker.requiredAction}</p>
          {(canManage || isBlockerOwner) && (
            <div className="mt-2">
              <ResolveBlockerButton blockerId={activeBlocker.id} onResolved={onChanged} />
            </div>
          )}
        </div>
      )}

      {pendingDecision && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">⚠️ Decision Needed — {pendingDecision.question}</p>
          <p className="mt-1 text-xs opacity-70">{pendingDecision.reason}</p>
          {pendingDecision.aiRecommendation && (
            <p className="text-xs opacity-60">
              AI recommends: {pendingDecision.aiRecommendation}
              {pendingDecision.aiConfidence !== null && ` (${pendingDecision.aiConfidence}% confidence)`}
            </p>
          )}
          <div className="mt-2">
            <DecisionActions decisionId={pendingDecision.id} onDecided={onChanged} />
          </div>
        </div>
      )}

      {(Number(aiCost) > 0 || stageCosts.some((s) => s.costUsd)) && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">AI Cost</h3>
          <p className="text-sm">Total: ${aiCost}</p>
          {stageCosts.length > 0 && (
            <ul className="mt-1 text-xs opacity-60">
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
                <Link href={`/pipelines/${parent.pipelineId}`} className="underline">
                  {parent.title}
                </Link>
              ) : (
                parent.title
              )}
            </p>
          )}
          {childItems.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">Children</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {childItems.map((c) => (
                  <li key={c.id} className="text-sm">
                    {c.pipelineId ? (
                      <Link href={`/pipelines/${c.pipelineId}`} className="underline">
                        {c.title}
                      </Link>
                    ) : (
                      c.title
                    )}{" "}
                    <span className="text-xs opacity-50">
                      · {c.status} · {c.owner ? c.owner.name ?? c.owner.email : "Unassigned"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-black/10 dark:border-white/15 pt-3">
        {canEdit && (
          <button onClick={() => setEditing(true)} className="rounded border border-black/15 dark:border-white/20 px-3 py-1.5 text-sm hover:bg-black/[.03] dark:hover:bg-white/[.04]">
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
