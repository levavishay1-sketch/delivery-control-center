import { eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repo } from "@dcc/db/schema";
import { ensureOnboardingWorkspace } from "../workspace.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 01 — Repository Connection / workspace setup (spec §8). No
 * Claude call — pure Git operations. Prepares the isolated worktree and
 * pins the run's baseline commit SHA.
 */
registerStage("workspace_setup", async (ctx): Promise<StageOutcome> => {
  const [r] = await db.select().from(repo).where(eq(repo.id, ctx.repoId)).limit(1);
  if (!r) return { status: "Failed", errors: ["repo not found"] };

  const ws = await ensureOnboardingWorkspace(r, ctx.runId);
  return {
    status: "Completed",
    sourceCommitSha: ws.baselineSha,
    result: { workspacePath: ws.dir, baselineSha: ws.baselineSha, branchName: ws.branch, workspaceKind: ws.kind },
  };
});
