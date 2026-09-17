import { withTenant } from "@dcc/db";
import { repositoryProfile } from "@dcc/db/schema";
import { scanRepository } from "../scanner.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 02 — Deterministic Repository Scan (spec §9). No Claude call —
 * pure filesystem walk against the workspace `workspace_setup` prepared.
 */
registerStage("repository_scan", async (ctx): Promise<StageOutcome> => {
  if (!ctx.workspaceDir) return { status: "Failed", errors: ["workspace_setup did not produce a workspace directory"] };

  const profile = await scanRepository(ctx.workspaceDir, ctx.baselineSha);
  const [row] = await withTenant(ctx.clientId, (tx) =>
    tx.insert(repositoryProfile).values({
      runId: ctx.runId,
      repoId: ctx.repoId,
      clientId: ctx.clientId,
      scannedCommitSha: profile.scannedCommitSha,
      languages: profile.languages,
      buildSystems: profile.buildSystems,
      testSignals: profile.testSignals,
      ciSignals: profile.ciSignals,
      frameworkSignals: profile.frameworkSignals,
      docsSignals: profile.docsSignals,
      ignoredPaths: profile.ignoredPaths,
      stats: profile.stats,
      warnings: profile.warnings,
    }).returning({ id: repositoryProfile.id }),
  );

  return {
    status: profile.warnings.length ? "CompletedWithWarnings" : "Completed",
    warnings: profile.warnings,
    sourceCommitSha: profile.scannedCommitSha,
    result: {
      profileId: row!.id,
      summary: {
        languages: profile.languages.slice(0, 5),
        buildSystems: profile.buildSystems.map((b) => b.kind),
        frameworkSignals: profile.frameworkSignals.map((f) => f.name),
        testSignalCount: profile.testSignals.length,
        ciProviders: Array.from(new Set(profile.ciSignals.map((c) => c.provider))),
        ignoredPathCount: profile.ignoredPaths.length,
        fileCount: profile.stats.fileCount,
      },
    },
  };
});
