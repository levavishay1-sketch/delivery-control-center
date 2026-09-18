import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, db, withTenant } from "@dcc/db";
import { onboardingPromptTemplate, repo, repositoryOnboardingClaudeExecution, repositoryOnboardingRun, users } from "@dcc/db/schema";
import { createClaudeCodeRunner } from "./runner.ts";
import { ONBOARDING_VERSION } from "./types.ts";
import { ensureOnboardingWorkspace, releaseOnboardingWorkspace } from "./workspace.ts";

/**
 * Standalone proof that `ClaudeCodeRunner` → `repository_onboarding_
 * claude_execution` → structured output → the cancellation wiring all
 * work end-to-end, independent of the state machine.
 *
 *   npm run -w @dcc/db dev:setup   (fresh PGlite with a clonable/local repo)
 *   npx tsx packages/core/src/repo-onboarding/smoke.ts
 */
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  cond ? (pass++, console.log(`  \x1b[32mPASS\x1b[0m ${name}`)) : (fail++, console.log(`  \x1b[31mFAIL\x1b[0m ${name} ${detail ? JSON.stringify(detail) : ""}`));
};

const [r] = await db.select().from(repo).where(eq(repo.name, process.env.SMOKE_REPO_NAME ?? "ALTSHULER_TRADE")).limit(1);
if (!r || !r.clientId) { console.log("no client-scoped repo found — set SMOKE_REPO_NAME or seed one first"); process.exit(1); }
const [dev] = await db.select().from(users).where(eq(users.email, process.env.SMOKE_USER_EMAIL ?? "you@dcc.local")).limit(1);
if (!dev) { console.log("no dev user found — set SMOKE_USER_EMAIL or run the app once first"); process.exit(1); }

const runId = randomUUID();
await withTenant(r.clientId, (tx) => tx.insert(repositoryOnboardingRun).values({ id: runId, repoId: r.id, clientId: r.clientId!, triggeredBy: dev.id, defaultBranch: r.defaultBranch, onboardingVersion: ONBOARDING_VERSION }));

const ws = await ensureOnboardingWorkspace(r, runId);
check("isolated workspace created", !!ws.dir && (ws.kind === "worktree" || ws.kind === "clone"), ws);

const [tpl] = await db.insert(onboardingPromptTemplate).values({
  promptKey: `smoke.${runId}`, version: 1, stage: "smoke", title: "Smoke test",
  body: "Return the JSON object {\"ok\": true, \"word\": \"OK\"}.", active: true, createdBy: dev.id,
}).returning();

const runner = createClaudeCodeRunner();
const result = await runner.run({
  runId, stageKey: "smoke", repoId: r.id, clientId: r.clientId, cwd: ws.dir,
  promptId: tpl!.id, promptVars: {}, capability: "onboarding_classify", tools: [],
  jsonSchema: { type: "object", properties: { ok: { type: "boolean" }, word: { type: "string" } }, required: ["ok", "word"] },
  maxTurns: 3, timeoutMs: 120_000,
});
check("run completed", result.status === "Completed", result);
check("structured output parsed", (result.json as { ok?: boolean } | null)?.ok === true, result.json);
check("execution row persisted", !!result.executionId);

const [execRow] = await db.select().from(repositoryOnboardingClaudeExecution).where(eq(repositoryOnboardingClaudeExecution.id, result.executionId)).limit(1);
check("execution row status matches", execRow?.status === "Completed", execRow);
check("execution row carries the prompt template it actually used", execRow?.promptTemplateId === tpl!.id);
check("cancel() on a finished execution is a safe no-op", runner.cancel(result.executionId) === false);
check("sendMessage() on a finished execution is a safe no-op", runner.sendMessage(result.executionId, "x") === false);

await releaseOnboardingWorkspace(runId, await (async () => {
  const { ensureCheckout } = await import("../ai-assist.ts");
  return (await ensureCheckout(r)) ?? undefined;
})());
await withTenant(r.clientId, (tx) => tx.update(repositoryOnboardingRun).set({ status: "Cancelled", cancelledAt: new Date(), cancelledBy: dev.id }).where(eq(repositoryOnboardingRun.id, runId)));

console.log(`\n${fail === 0 ? `\x1b[32m✓ all ${pass} passed` : `\x1b[31m✗ ${fail} failed`}\x1b[0m\n`);
await closeDb();
process.exit(fail === 0 ? 0 : 1);
