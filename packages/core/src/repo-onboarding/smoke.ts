import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, db, withTenant } from "@dcc/db";
import { onboardingPromptTemplate, repo, repositoryOnboardingClaudeExecution, repositoryOnboardingRun, users } from "@dcc/db/schema";
import { createClaudeCodeRunner } from "./runner.ts";
import { ensureOnboardingWorkspace, releaseOnboardingWorkspace } from "./workspace.ts";

/**
 * Standalone proof that `ClaudeCodeRunner` → `repository_onboarding_
 * claude_execution` → the existing cancellation wiring (`stopFlowRun`/
 * `sendRunMessage`) all work end-to-end — independent of the state
 * machine, since neither of Phase 1's own two stages calls Claude.
 *
 *   npm run -w @dcc/db dev:setup   (fresh PGlite with a real, clonable repo)
 *   npx tsx packages/core/src/repo-onboarding/smoke.ts
 *
 * Uses whatever repo/user this local DB already has (this session's own
 * ALTSHULER_TRADE pilot data) rather than fabricating a throwaway
 * client+repo — a real, already-cloneable git remote is the point.
 */
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  cond ? (pass++, console.log(`  \x1b[32mPASS\x1b[0m ${name}`)) : (fail++, console.log(`  \x1b[31mFAIL\x1b[0m ${name} ${detail ? JSON.stringify(detail) : ""}`));
};

const [r] = await db.select().from(repo).where(eq(repo.name, process.env.SMOKE_REPO_NAME ?? "ALTSHULER_TRADE")).limit(1);
if (!r || !r.clientId) { console.log("no clonable client-scoped repo found — set SMOKE_REPO_NAME or seed one first"); process.exit(1); }
const [dev] = await db.select().from(users).where(eq(users.email, process.env.SMOKE_USER_EMAIL ?? "you@dcc.local")).limit(1);
if (!dev) { console.log("no dev user found — set SMOKE_USER_EMAIL or run the app once first"); process.exit(1); }

const runId = randomUUID();
// `claude_execution.run_id` has a real FK to `repository_onboarding_run`
// (correctly so — every execution must trace back to a real run) — this
// standalone smoke test bypasses the state machine entirely, so it must
// insert its own minimal run row rather than relying on one existing.
await withTenant(r.clientId, (tx) => tx.insert(repositoryOnboardingRun).values({ id: runId, repoId: r.id, clientId: r.clientId!, triggeredBy: dev.id, defaultBranch: r.defaultBranch }));

const ws = await ensureOnboardingWorkspace(r, runId);
check("isolated workspace created", !!ws.dir && (ws.kind === "worktree" || ws.kind === "clone"), ws);

const [tpl] = await db.insert(onboardingPromptTemplate).values({
  promptKey: `smoke.${runId}`, version: 1, stage: "smoke", title: "Smoke test",
  body: "Reply with exactly the single word: OK", active: true, createdBy: dev.id,
}).returning();

const runner = createClaudeCodeRunner();
const result = await runner.run({
  runId, stageKey: "smoke", repoId: r.id, clientId: r.clientId, cwd: ws.dir,
  promptId: tpl!.id, promptVars: {}, permissionProfile: "read_only_plan", maxTurns: 3, timeoutMs: 60_000,
});
check("run completed", result.status === "Completed", result);
check("execution row persisted", !!result.executionId);

const [execRow] = await db.select().from(repositoryOnboardingClaudeExecution).where(eq(repositoryOnboardingClaudeExecution.id, result.executionId)).limit(1);
check("execution row status matches", execRow?.status === "Completed", execRow);
check("execution row carries the prompt template it actually used", execRow?.promptTemplateId === tpl!.id);

// The run already finished, so its process is gone from the cancellation
// registry — cancel() on a finished execution must return false, not throw.
check("cancel() on a finished execution is a safe no-op", runner.cancel(result.executionId) === false);
check("sendMessage() on a finished execution is a safe no-op", runner.sendMessage(result.executionId, "x") === false);

await releaseOnboardingWorkspace(runId, await (async () => {
  const { ensureCheckout } = await import("../ai-assist.ts");
  return (await ensureCheckout(r)) ?? undefined;
})());
// Mark the smoke run's own throwaway row done — it never went through the
// state machine, and an un-terminated "Pending" row would otherwise block
// a real onboarding run's one-live-run-per-repo guard.
await withTenant(r.clientId, (tx) => tx.update(repositoryOnboardingRun).set({ status: "Cancelled", cancelledAt: new Date(), cancelledBy: dev.id }).where(eq(repositoryOnboardingRun.id, runId)));

console.log(`\n${fail === 0 ? `\x1b[32m✓ all ${pass} passed` : `\x1b[31m✗ ${fail} failed`}\x1b[0m\n`);
await closeDb();
process.exit(fail === 0 ? 0 : 1);
