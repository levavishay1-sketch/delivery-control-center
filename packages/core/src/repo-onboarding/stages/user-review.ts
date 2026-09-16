import { and, eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repositoryOnboardingStage } from "@dcc/db/schema";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 13 — User Review (spec §21). No changes reach the default branch
 * automatically — this is the one real gate before `github_pull_request`
 * can run. Purely assembles what earlier stages already produced into
 * the spec's own grouped-by-purpose summary; writes nothing itself.
 */
type ArtifactGroup = { group_he: string; items: { label: string; note_he?: string }[] };
type UserReviewResult = {
  readiness?: unknown;
  groups: ArtifactGroup[];
  decision?: "approve" | "request_changes";
  note?: string;
  decidedAt?: string;
};

registerStage("user_review", async (ctx): Promise<StageOutcome> => {
  const doctor = ctx.priorResults.ai_doctor as { status?: string; checks?: Record<string, string>; review?: { overall_status?: string } } | undefined;
  if (!doctor) return { status: "Failed", errors: ["ai_doctor has not completed"] };

  if (ctx.resumeInput !== undefined) {
    const input = ctx.resumeInput as { decision?: unknown; note?: unknown };
    if (input.decision !== "approve" && input.decision !== "request_changes") {
      return { status: "Failed", errors: ['decision must be "approve" or "request_changes"'] };
    }
    const [ownRow] = await db.select().from(repositoryOnboardingStage)
      .where(and(eq(repositoryOnboardingStage.runId, ctx.runId), eq(repositoryOnboardingStage.stageKey, "user_review"))).limit(1);
    const prior = (ownRow?.result as UserReviewResult | null) ?? { groups: [] };
    const result: UserReviewResult = { ...prior, decision: input.decision, note: typeof input.note === "string" ? input.note : undefined, decidedAt: new Date().toISOString() };
    if (input.decision === "request_changes") {
      return { status: "CompletedWithWarnings", warnings: ["המשתמש ביקש שינויים — אין מנגנון חזרה אוטומטי לשלב קודם; יש לטפל ידנית ולהריץ מחדש את התהליך במידת הצורך."], result };
    }
    return { status: "Completed", result };
  }

  const knowledgeGen = ctx.priorResults.knowledge_generation as { filesWritten?: string[] } | undefined;
  const claudeMd = ctx.priorResults.claude_md_generation as { filesWritten?: string[] } | undefined;
  const doctorRules = doctor as { rulesWritten?: string[] };
  const guardrails = ctx.priorResults.guardrails as { approvedGuardrailIds?: string[] } | undefined;

  const groups: ArtifactGroup[] = [
    { group_he: "ידע על הפרויקט", items: (knowledgeGen?.filesWritten ?? []).map((f) => ({ label: f })) },
    { group_he: "הגדרות Claude", items: [...(claudeMd?.filesWritten ?? []).map((f) => ({ label: f })), ...(doctorRules.rulesWritten ?? []).map((f) => ({ label: f }))] },
    { group_he: "אבטחה", items: (guardrails?.approvedGuardrailIds ?? []).map((id) => ({ label: id })) },
  ];

  return { status: "WaitingForUser", result: { readiness: doctor, groups } };
});
