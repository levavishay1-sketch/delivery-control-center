import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { commitWorkspaceChanges } from "../commit.ts";
import { extractClaudeJson } from "../json.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner } from "../runner.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 12 — AI Doctor / Validation (spec §20). Two jobs in one stage:
 * (1) materialize `scoped_rules`' still-only-drafted content into real
 * `.claude/rules/*.md` files — deliberately deferred here by Phase 3's
 * own design comment ("a better fit for the spec's own later User
 * Review stage"), using the same plain-`fs`-write technique Phase 4's
 * `guardrails` stage proved sidesteps Claude Code's `.claude/`
 * protected-path restriction; (2) validate the FULL final artifact set
 * — deterministic existence/parse checks plus one Claude review call.
 * "A repository must not become AI Ready merely because files were
 * generated" (spec) — this is the stage that proves it.
 */
type DraftedRule = { domain: string; suggestedPath: string; content: string };
type CheckResult = "PASS" | "FAIL" | "not_attempted";
type ReviewIssue = { severity: string; artifact: string; problem: string; evidence: string; recommended_correction: string };
type Review = { overall_status: "PASS" | "WARN" | "FAIL"; issues: ReviewIssue[] };

function materializeScopedRules(workspaceDir: string, draftedRules: DraftedRule[]): string[] {
  const written: string[] = [];
  for (const rule of draftedRules) {
    const full = path.join(workspaceDir, rule.suggestedPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, rule.content.endsWith("\n") ? rule.content : rule.content + "\n", "utf8");
    written.push(rule.suggestedPath);
  }
  return written;
}

function checkSettingsAndHooks(workspaceDir: string): Record<string, CheckResult> {
  const settingsPath = path.join(workspaceDir, ".claude", "settings.json");
  if (!existsSync(settingsPath)) return { settings_exists: "FAIL", hooks_exist: "not_attempted" };
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { hooks?: Record<string, { hooks: { command: string }[] }[]> };
    const hookPaths: string[] = [];
    for (const entries of Object.values(settings.hooks ?? {})) {
      for (const e of entries) for (const h of e.hooks) {
        const m = h.command.match(/\$CLAUDE_PROJECT_DIR\/(.+?)"/);
        if (m) hookPaths.push(m[1]!);
      }
    }
    const missing = hookPaths.filter((p) => !existsSync(path.join(workspaceDir, p)));
    return { settings_exists: "PASS", hooks_exist: missing.length === 0 ? "PASS" : "FAIL" };
  } catch {
    return { settings_exists: "FAIL", hooks_exist: "not_attempted" };
  }
}

/** Only attempted for a confidently-detected simple case (an npm
 *  `build`/`test` script at the workspace root) — see the Phase 5 plan's
 *  decision 1. Altshuler's large multi-project .NET solution has no
 *  single safe, inferable build entrypoint, so this is `not_attempted`
 *  for it, not a guess dressed up as a real check. */
function tryRunBuildAndTest(workspaceDir: string): { build: CheckResult; test: CheckResult } {
  const pkgPath = path.join(workspaceDir, "package.json");
  if (!existsSync(pkgPath)) return { build: "not_attempted", test: "not_attempted" };
  let scripts: Record<string, string> = {};
  try {
    scripts = (JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return { build: "not_attempted", test: "not_attempted" };
  }
  const runScript = (name: string): CheckResult => {
    if (!scripts[name]) return "not_attempted";
    try {
      execFileSync("npm", ["run", name], { cwd: workspaceDir, timeout: 120_000, stdio: "pipe", shell: process.platform === "win32" });
      return "PASS";
    } catch {
      return "FAIL";
    }
  };
  return { build: runScript("build"), test: runScript("test") };
}

registerStage("ai_doctor", async (ctx): Promise<StageOutcome> => {
  const security = ctx.priorResults.security_permissions as { approvedRules?: string[] } | undefined;
  if (!security?.approvedRules) return { status: "Failed", errors: ["security_permissions has not been approved"] };
  const scopedRules = ctx.priorResults.scoped_rules as { draftedRules?: DraftedRule[] } | undefined;
  const knowledgeGen = ctx.priorResults.knowledge_generation as { filesWritten?: string[] } | undefined;
  const claudeMd = ctx.priorResults.claude_md_generation as { filesWritten?: string[] } | undefined;

  const rulesWritten = materializeScopedRules(ctx.workspaceDir, scopedRules?.draftedRules ?? []);
  const { commitSha } = rulesWritten.length
    ? await commitWorkspaceChanges(ctx.workspaceDir, ctx.triggeredBy, "DCC: scoped rules (.claude/rules)")
    : { commitSha: null };

  const checks: Record<string, CheckResult> = {
    claude_md_exists: existsSync(path.join(ctx.workspaceDir, "CLAUDE.md")) ? "PASS" : "FAIL",
    knowledge_docs_exist: (knowledgeGen?.filesWritten ?? []).every((f) => existsSync(path.join(ctx.workspaceDir, f))) ? "PASS" : "FAIL",
    rules_materialized: rulesWritten.every((f) => existsSync(path.join(ctx.workspaceDir, f))) ? "PASS" : "FAIL",
    ...checkSettingsAndHooks(ctx.workspaceDir),
    ...tryRunBuildAndTest(ctx.workspaceDir),
  };
  if (!claudeMd?.filesWritten?.length) checks.claude_md_exists = "FAIL";

  const prompt = await getActiveOnboardingPrompt("onboarding.ai_doctor_review");
  if (!prompt) return { status: "Failed", errors: ["no active prompt for onboarding.ai_doctor_review — run seed-prompts.ts"] };

  const runner = createClaudeCodeRunner();
  const result = await runner.run({
    runId: ctx.runId, stageKey: "ai_doctor", repoId: ctx.repoId, clientId: ctx.clientId,
    cwd: ctx.workspaceDir, promptId: prompt.id, promptVars: { RULE_FILES: JSON.stringify(rulesWritten) },
    permissionProfile: "read_only_plan", denyRules: security.approvedRules, maxTurns: 30, timeoutMs: 240_000,
  });
  if (result.status !== "Completed" || !result.text) {
    return { status: "Failed", errors: [result.errorMessage ?? "ai_doctor review call did not complete"], claudeExecutionId: result.executionId };
  }

  let review: Review;
  try {
    review = extractClaudeJson<Review>(result.text);
  } catch (e) {
    return { status: "Failed", errors: [String((e as Error).message)], claudeExecutionId: result.executionId };
  }

  const deterministicFailed = Object.values(checks).some((v) => v === "FAIL");
  const status: "READY" | "READY_WITH_WARNING" | "NOT_READY" =
    deterministicFailed || review.overall_status === "FAIL" ? "NOT_READY" : review.overall_status === "WARN" ? "READY_WITH_WARNING" : "READY";

  const outcomeResult = { status, checks, review, rulesWritten, commitSha, claudeExecutionId: result.executionId };
  if (status === "NOT_READY") return { status: "Failed", errors: ["ai_doctor: הריפוזיטורי אינו מוכן — ראו checks/review"], claudeExecutionId: result.executionId, result: outcomeResult };
  return { status: status === "READY_WITH_WARNING" ? "CompletedWithWarnings" : "Completed", claudeExecutionId: result.executionId, result: outcomeResult };
});
