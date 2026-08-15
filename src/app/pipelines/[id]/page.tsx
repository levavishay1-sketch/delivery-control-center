import { notFound } from "next/navigation";
import Link from "next/link";
import { getPipelineDetail } from "@/domain/pipeline/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { ForbiddenError } from "@/domain/shared/errors";
import { getStageConfigOrFallback } from "@/lib/config";
import { StageBadge } from "@/components/StageBadge";
import { DraftButton } from "@/components/DraftButton";
import { ApprovalGate } from "@/components/ApprovalGate";
import { ClarifyPanel } from "@/components/ClarifyPanel";
import { AnalyzeFindingsPanel } from "@/components/AnalyzeFindingsPanel";

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs opacity-60">
          {pipeline.workItem.project.name} ({pipeline.workItem.project.key}) · {pipeline.workItem.source}{" "}
          {pipeline.workItem.externalId}
        </p>
        <h1 className="text-xl font-semibold">{pipeline.workItem.title}</h1>
        {pipeline.workItem.description && (
          <p className="mt-1 text-sm opacity-70 whitespace-pre-wrap">{pipeline.workItem.description}</p>
        )}
        <div className="mt-2 flex items-center gap-3">
          <StageBadge status={pipeline.status} />
          <Link href={`/work-items/${pipeline.workItem.id}/360`} className="text-xs underline opacity-70 hover:opacity-100">
            360° Record →
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {workflow.map((stageConfig) => {
          const stage = stagesByType.get(stageConfig.type);
          const isCurrent = pipeline.currentStage === stageConfig.type;

          return (
            <div
              key={stageConfig.type}
              data-stage-id={stage?.id}
              className={`rounded-lg border p-4 ${
                isCurrent ? "border-black/25 dark:border-white/30" : "border-black/10 dark:border-white/15"
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{stageConfig.label}</h2>
                {stage ? <StageBadge status={stage.status} /> : <StageBadge status="PENDING" />}
              </div>
              <p className="mt-1 text-xs opacity-60">{stageConfig.description}</p>

              {stage?.content && (
                <pre className="mt-3 whitespace-pre-wrap rounded bg-black/[.03] dark:bg-white/[.05] p-3 text-xs font-mono">
                  {stage.content}
                </pre>
              )}

              {stage && (stage.status === "PENDING_APPROVAL" || stage.status === "DONE") && (
                <p className="mt-2 text-xs opacity-50">
                  {stage.aiModel} · {stage.promptTokens}+{stage.completionTokens} tokens · $
                  {stage.costUsd?.toString()}
                </p>
              )}

              {stage && stage.approvals.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-xs opacity-70">
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
                  <DraftButton stageId={stage.id} label={stage.status === "REJECTED" ? "Redraft" : "Draft with AI"} />
                </div>
              )}

              {!isCurrent && stage && stage.status === "DONE" && flaggedStageTypes.has(stageConfig.type) && (
                <div className="mt-3">
                  <p className="mb-1 text-xs text-red-500">Flagged by Analyze — redraft required to unblock the pipeline.</p>
                  <DraftButton stageId={stage.id} label="Redraft" />
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

              {isCurrent && stage && stage.status === "PENDING_APPROVAL" && (
                <div className="mt-3">
                  <ApprovalGate stageId={stage.id} />
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
