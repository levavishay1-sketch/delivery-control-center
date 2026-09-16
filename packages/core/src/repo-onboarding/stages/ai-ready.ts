import { git } from "../../ai-assist.ts";
import { ONBOARDING_METHODOLOGY_VERSION } from "../onboarding-version.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 15 — AI Ready (spec §23), `STAGE_ORDER`'s last entry for now.
 * "After the approved onboarding artifacts are MERGED" — not just
 * opened as a PR. Detected with plain `git merge-base --is-ancestor`
 * (after a fetch), deliberately independent of whether `gh` is
 * installed — more robust than parsing `gh pr view --json state`, and
 * it's exactly the same fact a merge actually is. Not yet merged is a
 * normal, expected, RETRYABLE `Failed` (spec §29's failure behavior) —
 * a human merges the PR on GitHub, then retries this stage from DCC.
 * No `repo.aiReady` column exists (and none is added this pass) — the
 * run reaching `Completed` here through the whole pipeline up to this
 * point already IS the durable, queryable "this repo is AI Ready" fact.
 */
const LONGPATHS = process.platform === "win32" ? ["-c", "core.longpaths=true"] : [];

registerStage("ai_ready", async (ctx): Promise<StageOutcome> => {
  const pr = ctx.priorResults.github_pull_request as { prNumber?: number | null; prUrl?: string } | undefined;
  if (!pr?.prNumber) return { status: "Failed", errors: ["אין Pull Request מקושר — יש לפתוח Pull Request ולמזג אותו לפני שהריפוזיטורי יכול להיות מוכן"] };
  const workspaceSetup = ctx.priorResults.workspace_setup as { branchName?: string } | undefined;
  if (!workspaceSetup?.branchName) return { status: "Failed", errors: ["workspace_setup did not produce a branch name"] };
  const dir = ctx.workspaceDir;

  const fetch = await git([...LONGPATHS, "fetch", "origin"], dir, { timeoutMs: 30_000 });
  if (fetch.code !== 0) return { status: "Failed", errors: [`git fetch נכשל: ${fetch.out.slice(0, 300)}`] };

  const base = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir)).out.replace(/^origin\//, "") || "main";
  const isAncestor = await git(["merge-base", "--is-ancestor", workspaceSetup.branchName, `origin/${base}`], dir);
  if (isAncestor.code !== 0) {
    return { status: "Failed", errors: [`ה-Pull Request (#${pr.prNumber}) עדיין לא מוזג ל-${base}. יש למזג ולנסות שוב.`] };
  }

  const mergedSha = (await git(["rev-parse", "--short", `origin/${base}`], dir)).out.trim();

  return {
    status: "Completed",
    result: {
      onboardingVersion: ONBOARDING_METHODOLOGY_VERSION,
      analyzedCommitSha: ctx.baselineSha,
      mergedCommitSha: mergedSha,
      readinessDate: new Date().toISOString(),
      prNumber: pr.prNumber, prUrl: pr.prUrl,
    },
  };
});
