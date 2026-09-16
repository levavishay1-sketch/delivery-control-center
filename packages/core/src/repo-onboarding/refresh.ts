import { and, desc, eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repo, repoAiEvent, repositoryOnboardingRun, repositoryOnboardingStage } from "@dcc/db/schema";
import { ensureCheckout, git } from "../ai-assist.ts";
import { appendRepoAiEvent } from "../repo-ai/events.ts";
import { extractClaudeJson } from "./json.ts";
import { getActiveOnboardingPrompt } from "./prompts.ts";
import { createClaudeCodeRunner } from "./runner.ts";

/**
 * Incremental Repository Refresh (spec §24) — NOT a `STAGE_ORDER` stage.
 * It compares a repo's last-analyzed commit against the CURRENT default
 * branch HEAD, independent of any specific onboarding run — closer in
 * shape to `startOnboardingRun` than to a pipeline stage. Analysis-only
 * this pass (spec's own "Return either NO_UPDATE_REQUIRED or {impacted_
 * artifacts, ...}"); actually regenerating flagged artifacts is real
 * follow-on work, the same way Phase 3 scoped rule-application out to a
 * human step rather than guessing at unspecified detail.
 */
export type RefreshResult =
  | { updateRequired: false; oldCommit: string; newCommit: string; reason: string }
  | { updateRequired: true; oldCommit: string; newCommit: string; impactedArtifacts: string[]; requiredUpdates: string[]; evidence: string[]; reason: string };

async function lastAnalyzedCommit(repoId: string): Promise<{ runId: string; clientId: string; commit: string } | null> {
  const [run] = await db.select().from(repositoryOnboardingRun)
    .where(eq(repositoryOnboardingRun.repoId, repoId)).orderBy(desc(repositoryOnboardingRun.startedAt)).limit(1);
  if (!run || run.status !== "Completed") return null;

  const [aiReady] = await db.select().from(repositoryOnboardingStage)
    .where(and(eq(repositoryOnboardingStage.runId, run.id), eq(repositoryOnboardingStage.stageKey, "ai_ready"))).limit(1);
  const readyResult = aiReady?.result as { analyzedCommitSha?: string } | undefined;
  const commit = readyResult?.analyzedCommitSha ?? run.baselineSha;
  if (!commit) return null;
  return { runId: run.id, clientId: run.clientId, commit };
}

export async function checkRepositoryRefresh(repoId: string, userId: string): Promise<RefreshResult> {
  const [r] = await db.select().from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r || !r.clientId) throw new Error("הטמעת AI זמינה רק ל-repository ששייך ללקוח יחיד");
  const last = await lastAnalyzedCommit(repoId);
  if (!last) throw new Error("הריפוזיטורי טרם עבר onboarding שהושלם — אין commit קודם להשוואה");

  const dir = await ensureCheckout({ id: r.id, name: r.name, localPath: r.localPath, adoRepoRef: r.adoRepoRef });
  if (!dir) throw new Error(`לא הצלחתי להביא עותק של ${r.name}`);
  const newCommit = (await git(["rev-parse", "HEAD"], dir)).out.trim();

  if (newCommit === last.commit) {
    const result: RefreshResult = { updateRequired: false, oldCommit: last.commit, newCommit, reason: "אין commit חדש מאז הניתוח האחרון" };
    await appendRepoAiEvent({ clientId: r.clientId, repoId, type: "onboarding.refresh_checked", payload: result, actorUserId: userId });
    return result;
  }

  const diff = await git(["diff", `${last.commit}..${newCommit}`, "--name-only"], dir);
  const changedPaths = diff.out.split("\n").map((s) => s.trim()).filter(Boolean);

  const [knowledgeGen] = await db.select().from(repositoryOnboardingStage)
    .where(and(eq(repositoryOnboardingStage.runId, last.runId), eq(repositoryOnboardingStage.stageKey, "knowledge_generation"))).limit(1);
  const knowledgeIndex = (knowledgeGen?.result as { filesWritten?: string[] } | undefined)?.filesWritten ?? [];

  const prompt = await getActiveOnboardingPrompt("onboarding.refresh_check");
  if (!prompt) throw new Error("no active prompt for onboarding.refresh_check — run seed-prompts.ts");

  const runner = createClaudeCodeRunner();
  const claudeResult = await runner.run({
    runId: last.runId, stageKey: "refresh", repoId, clientId: r.clientId,
    cwd: dir, promptId: prompt.id,
    promptVars: { OLD_COMMIT: last.commit, NEW_COMMIT: newCommit, CHANGED_PATHS: JSON.stringify(changedPaths), KNOWLEDGE_INDEX: JSON.stringify(knowledgeIndex) },
    permissionProfile: "read_only_plan", maxTurns: 20, timeoutMs: 180_000,
  });
  if (claudeResult.status !== "Completed" || !claudeResult.text) {
    throw new Error(claudeResult.errorMessage ?? "refresh_check call did not complete");
  }

  const parsed = extractClaudeJson<{ update_required: boolean; impacted_artifacts?: string[]; required_updates?: string[]; evidence?: string[]; reason: string }>(claudeResult.text);
  const result: RefreshResult = parsed.update_required
    ? { updateRequired: true, oldCommit: last.commit, newCommit, impactedArtifacts: parsed.impacted_artifacts ?? [], requiredUpdates: parsed.required_updates ?? [], evidence: parsed.evidence ?? [], reason: parsed.reason }
    : { updateRequired: false, oldCommit: last.commit, newCommit, reason: parsed.reason };

  await appendRepoAiEvent({ clientId: r.clientId, repoId, type: "onboarding.refresh_checked", payload: result, actorUserId: userId });
  return result;
}

export type RefreshMetrics = {
  totalChecks: number; noUpdateCount: number; updateRequiredCount: number;
  lastCheckedAt: string | null; avgDaysBetweenChecks: number | null;
};

export async function repositoryRefreshMetrics(repoId: string): Promise<RefreshMetrics> {
  const rows = await db.select().from(repoAiEvent)
    .where(and(eq(repoAiEvent.repoId, repoId), eq(repoAiEvent.type, "onboarding.refresh_checked")))
    .orderBy(desc(repoAiEvent.occurredAt));

  const totalChecks = rows.length;
  const updateRequiredCount = rows.filter((r) => (r.payload as { updateRequired?: boolean })?.updateRequired === true).length;
  const noUpdateCount = totalChecks - updateRequiredCount;
  const lastCheckedAt = rows[0] ? new Date(rows[0].occurredAt).toISOString() : null;

  let avgDaysBetweenChecks: number | null = null;
  if (rows.length >= 2) {
    const first = new Date(rows[rows.length - 1]!.occurredAt).getTime();
    const lastTs = new Date(rows[0]!.occurredAt).getTime();
    avgDaysBetweenChecks = (lastTs - first) / (rows.length - 1) / (1000 * 60 * 60 * 24);
  }

  return { totalChecks, noUpdateCount, updateRequiredCount, lastCheckedAt, avgDaysBetweenChecks };
}
