import { notFound } from "next/navigation";
import Link from "next/link";
import { getPipelineDetail } from "@/domain/pipeline/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { ForbiddenError } from "@/domain/shared/errors";
import { getStageConfigOrFallback } from "@/lib/config";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { stageStatusTone, stageStatusLabel } from "@/lib/colors/stageStatus";
import { DraftButton } from "@/components/DraftButton";
import { ApprovalGate } from "@/components/ApprovalGate";
import { ClarifyPanel } from "@/components/ClarifyPanel";
import { AnalyzeFindingsPanel } from "@/components/AnalyzeFindingsPanel";
import { TaskDraftsPanel } from "@/components/TaskDraftsPanel";
import { StageVersionHistory } from "@/components/StageVersionHistory";
import { Panel } from "@/components/ui/Panel";

export const dynamic = "force-dynamic";

export default async function PipelineDetailPage({ params }: PageProps<"/pipelines/[id]">) {
  const { id } = await params;

  const ctx = await requireAuthContext();
  const pipeline = await getPipelineDetail(ctx, id).catch((err) => {
    if (err instanceof ForbiddenError) return null;
    throw err;
  });

  if (!pipeline) notFound();

  // Reads the pipeline's own snapshotted stageSequence, never the live config file — an edit
  // to config/workflow.yaml must never change how an existing pipeline renders (design.md
  // Decision 3). getStageConfigOrFallback tolerates a type retired from the live config (e.g.
  // CONSTITUTION) so older pipelines' history still displays instead of crashing.
  const workflow = pipeline.stageSequence.map(getStageConfigOrFallback);
  const stagesByType = new Map(pipeline.stages.map((s) => [s.type, s]));

  // A stage a Critical Analyze finding names can be redrafted even though it's DONE and no
  // longer the pipeline's current stage — see Task Group 7.3. Findings are only ever the
  // ANALYZE stage's latest run (replaced on every redraft), so its own status being REJECTED
  // is exactly "this block is still active."
  const analyzeStage = stagesByType.get("ANALYZE");
  const flaggedStageTypes = new Set<string>(
    analyzeStage?.status === "REJECTED"
      ? analyzeStage.analysisFindings.filter((f) => f.severity === "CRITICAL").map((f) => f.relatedStageType)
      : []
  );

  // Role-based gate messaging (Task Group 10.2): the current user's role on this client, so a
  // PENDING_APPROVAL stage can explain who *can* act when the viewer can't — approverRoles is
  // per stage type (Task Group 8), not uniform, so this is computed per stage below.
  const userRole = ctx.memberships.find((m) => m.clientId === pipeline.workItem.project.clientId)?.role;
  // Slice 3 — raw AgentRun detail (structured error, retry count) is write-gated the same way
  // getAgentRunDetail's own check is (design.md's permissioned-visibility requirement); the
  // status/cost summary line below it is always visible, matching getAgentRunSummary's ALL_ROLES
  // scope, which this page's own ALL_ROLES query gate already satisfies for every viewer here.
  const canManage = ctx.isOrgAdmin || (!!userRole && (WRITE_ROLES as string[]).includes(userRole));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {pipeline.workItem.project.name} ({pipeline.workItem.project.key}) · {pipeline.workItem.source}{" "}
          {pipeline.workItem.externalId}
        </p>
        <h1 className="text-xl font-semibold">{pipeline.workItem.title}</h1>
        {pipeline.workItem.description && (
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-300">{pipeline.workItem.description}</p>
        )}
        <div className="mt-2 flex items-center gap-3">
          <StatusBadge
            tone={stageStatusTone(pipeline.status)}
            label={stageStatusLabel(pipeline.status)}
            reason={`Currently at the ${stageStatusLabel(pipeline.currentStage)} stage`}
          />
          <Link href={`/work-items/${pipeline.workItem.id}/360`} className="text-xs text-accent hover:underline">
            360° Record →
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {workflow.map((stageConfig) => {
          const stage = stagesByType.get(stageConfig.type);
          const isCurrent = pipeline.currentStage === stageConfig.type;

          return (
            <Panel
              key={stageConfig.type}
              data-stage-id={stage?.id}
              className={isCurrent ? "ring-1 ring-accent/40" : ""}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{stageConfig.label}</h2>
                <StatusBadge
                  tone={stageStatusTone(stage?.status ?? "PENDING")}
                  label={stageStatusLabel(stage?.status ?? "PENDING")}
                  reason={stageConfig.description}
                />
              </div>

              {stage?.content && (
                <pre className="mt-3 whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-xs font-mono">{stage.content}</pre>
              )}

              {stage && (
                <StageVersionHistory
                  versions={stage.versions.map((v) => ({
                    id: v.id,
                    versionNumber: v.versionNumber,
                    content: v.content,
                    createdAsResultOf: v.createdAsResultOf,
                    createdAt: v.createdAt,
                    aiModel: v.aiModel,
                  }))}
                />
              )}

              {stage && (stage.status === "PENDING_APPROVAL" || stage.status === "DONE") && (
                <p className="mt-2 text-xs text-neutral-400">
                  {stage.agentRun ? `${stage.agentRun.agent.name} (${stage.agentRun.status})` : stage.aiModel} ·{" "}
                  {stage.promptTokens}+{stage.completionTokens} tokens · ${stage.costUsd?.toString()}
                </p>
              )}

              {stage?.agentRun && canManage && (
                <details className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                  <summary className="cursor-pointer">View run detail</summary>
                  <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-2 gap-y-1">
                    <dt className="text-neutral-400">Status</dt>
                    <dd>{stage.agentRun.status}</dd>
                    <dt className="text-neutral-400">Retries</dt>
                    <dd>{stage.agentRun.retryCount}</dd>
                    {stage.agentRun.lastError && (
                      <>
                        <dt className="text-neutral-400">Last error</dt>
                        <dd className="whitespace-pre-wrap text-status-critical">{stage.agentRun.lastError}</dd>
                      </>
                    )}
                  </dl>
                </details>
              )}

              {stage && stage.approvals.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {stage.approvals.map((a) => (
                    <li key={a.id}>
                      {a.decision === "APPROVED" ? "✅" : "❌"} {a.approverName} — {a.decision.toLowerCase()}
                      {a.comment ? `: ${a.comment}` : ""}
                    </li>
                  ))}
                </ul>
              )}

              {isCurrent && stage && (stage.status === "PENDING" || stage.status === "REJECTED") && (
                <div className="mt-3">
                  <DraftButton
                    target={{ kind: "stage", stageId: stage.id }}
                    label={stage.status === "REJECTED" ? "Redraft" : "Draft with AI"}
                    canApprove={canManage}
                  />
                </div>
              )}

              {!isCurrent && stage && stage.status === "DONE" && flaggedStageTypes.has(stageConfig.type) && (
                <div className="mt-3">
                  <p className="mb-1 text-xs text-status-critical">Flagged by Analyze — redraft required to unblock the pipeline.</p>
                  <DraftButton target={{ kind: "stage", stageId: stage.id }} label="Redraft" canApprove={canManage} />
                </div>
              )}

              {stageConfig.type === "ANALYZE" && stage && (stage.status === "DONE" || stage.status === "REJECTED") && (
                <AnalyzeFindingsPanel
                  findings={stage.analysisFindings.map((f) => ({
                    id: f.id,
                    severity: f.severity,
                    message: f.message,
                    relatedStageType: f.relatedStageType,
                  }))}
                />
              )}

              {stageConfig.type === "TASKS" && stage && stage.status === "DONE" && (
                <TaskDraftsPanel
                  stageId={stage.id}
                  drafts={stage.taskDrafts.map((d) => ({
                    id: d.id,
                    title: d.title,
                    description: d.description,
                    materializedWorkItem: d.materializedWorkItem,
                  }))}
                  canManage={canManage}
                />
              )}

              {/* No isCurrent guard: a flagged stage's redraft (see the DraftButton branch above)
                  reaches PENDING_APPROVAL while the pipeline is still parked at ANALYZE, so it
                  isn't "current" either — the gate must still render or there's no way to
                  approve it. In the ordinary flow only the current stage is ever
                  PENDING_APPROVAL anyway (future stages have no Stage row yet, past ones are
                  already DONE), so this doesn't change anything there. */}
              {stage && stage.status === "PENDING_APPROVAL" && (
                <div className="mt-3">
                  {ctx.isOrgAdmin || (userRole && stageConfig.approverRoles?.includes(userRole)) ? (
                    <ApprovalGate apiBasePath={`/api/stages/${stage.id}`} />
                  ) : (
                    <p className="rounded-md border border-status-warning/30 bg-status-warning-bg p-3 text-xs text-status-warning">
                      Awaiting gate approval — only {(stageConfig.approverRoles ?? []).join(" or ")} can approve this stage.
                    </p>
                  )}
                </div>
              )}

              {isCurrent && stage && stage.status === "AWAITING_CLARIFICATION" && (
                <div className="mt-3">
                  <ClarifyPanel
                    stageId={stage.id}
                    questions={stage.clarifyQuestions.map((q) => ({
                      id: q.id,
                      question: q.question,
                      answer: q.answer,
                      answeredByName: q.answeredByUser ? q.answeredByUser.name ?? q.answeredByUser.email : null,
                    }))}
                  />
                </div>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
