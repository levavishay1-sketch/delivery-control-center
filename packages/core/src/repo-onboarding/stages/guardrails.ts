import { and, eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repositoryOnboardingStage } from "@dcc/db/schema";
import { commitWorkspaceChanges } from "../commit.ts";
import { GUARDRAIL_CATALOG, getGuardrailDefinition, guardrailHookPath, renderGuardrailScript, toHookSpec } from "../guardrails.ts";
import { resolveEffectivePolicy } from "../security-profiles.ts";
import { buildClaudeSettings } from "../settings-adapter.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Stage 11 — Guardrails (spec §19). The pipeline's second/last
 * `.claude/` writer, and the ONLY stage that writes `.claude/settings.json`
 * — deliberately combines this stage's own guardrail hooks with
 * `security_permissions`'s already-approved policy in one write, rather
 * than having two stages each partially write the same file (see the
 * approved plan's design decision 1). Fully deterministic — no Claude
 * call at all, matching the spec's own "use deterministic enforcement"
 * principle for this stage.
 */
type Candidate = { id: string; label: string; description: string; suggested: boolean };
type GuardrailsResult = {
  candidates: Candidate[];
  approvedGuardrailIds?: string[];
  filesWritten?: string[];
  commitSha?: string | null;
};

/** `targeted_discovery`'s `generated_or_protected_areas` entries are free
 *  text, not a clean path field — found live: Claude commonly writes
 *  "path/to/file.cs (98,438 lines, auto-generated)" or "packages/ —
 *  vendored NuGet packages, not project code" as ONE string. Passing
 *  that whole string through as a match fragment means the generated
 *  hook's `path.includes(frag)` check never matches a real Write-tool
 *  path (which never contains the trailing commentary) — the guardrail
 *  would silently never fire. Strip the explanatory suffix before using
 *  it as a match fragment. */
function cleanPathFragment(raw: string): string {
  const cut = raw.search(/\s+[(—]|\s+-\s+/);
  return (cut >= 0 ? raw.slice(0, cut) : raw).trim();
}

function extractProtectedGlobs(areas: unknown[]): string[] {
  const globs: string[] = [];
  for (const a of areas) {
    if (typeof a === "string") globs.push(cleanPathFragment(a));
    else if (a && typeof a === "object") {
      const o = a as Record<string, unknown>;
      const v = o.path ?? o.area ?? o.pattern ?? o.location;
      if (typeof v === "string") globs.push(cleanPathFragment(v));
    }
  }
  // Strip a leading "./" so `path.includes(frag)` matching in the
  // generated hook script works against both relative and workspace-root
  // Write-tool paths Claude Code might report.
  return Array.from(new Set(globs.map((g) => g.replace(/^\.?\//, "").trim()).filter(Boolean)));
}

registerStage("guardrails", async (ctx): Promise<StageOutcome> => {
  const security = ctx.priorResults.security_permissions as { approvedRules?: string[]; approvedProfileId?: string } | undefined;
  if (!security?.approvedRules || !security.approvedProfileId) {
    return { status: "Failed", errors: ["security_permissions has not been approved"] };
  }
  const discovery = ctx.priorResults.targeted_discovery as { discovery?: { generated_or_protected_areas?: unknown[] } } | undefined;
  const generatedOrProtectedAreas = discovery?.discovery?.generated_or_protected_areas ?? [];

  if (ctx.resumeInput !== undefined) {
    const input = ctx.resumeInput as { approvedGuardrailIds?: unknown };
    if (!Array.isArray(input.approvedGuardrailIds) || !input.approvedGuardrailIds.every((r) => typeof r === "string")) {
      return { status: "Failed", errors: ["approvedGuardrailIds must be a string[]"] };
    }
    const approvedIds = input.approvedGuardrailIds as string[];
    const defs = approvedIds.map((id) => getGuardrailDefinition(id)).filter((d): d is NonNullable<typeof d> => d !== undefined);

    const policy = resolveEffectivePolicy(security.approvedProfileId, security.approvedRules);
    const protectedGlobs = extractProtectedGlobs(generatedOrProtectedAreas);
    const settings = buildClaudeSettings(policy, defs.map(toHookSpec));

    const claudeDir = path.join(ctx.workspaceDir, ".claude");
    const hooksDir = path.join(claudeDir, "hooks");
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(path.join(claudeDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n", "utf8");
    for (const def of defs) {
      writeFileSync(path.join(ctx.workspaceDir, guardrailHookPath(def)), renderGuardrailScript(def, protectedGlobs), "utf8");
    }

    const { commitSha, filesChanged } = await commitWorkspaceChanges(ctx.workspaceDir, ctx.triggeredBy, "DCC: Claude Code settings + guardrails (.claude/)");

    const [ownRow] = await db.select().from(repositoryOnboardingStage)
      .where(and(eq(repositoryOnboardingStage.runId, ctx.runId), eq(repositoryOnboardingStage.stageKey, "guardrails"))).limit(1);
    const prior = (ownRow?.result as GuardrailsResult | null) ?? { candidates: [] };

    const result: GuardrailsResult = { candidates: prior.candidates, approvedGuardrailIds: approvedIds, filesWritten: filesChanged, commitSha };
    const warnings = filesChanged.length === 0 ? ["guardrails resume wrote no files — .claude/settings.json / hook scripts may already have matched the workspace's committed state"] : [];
    return { status: warnings.length ? "CompletedWithWarnings" : "Completed", warnings, result };
  }

  const candidates: Candidate[] = GUARDRAIL_CATALOG.map((def) => ({
    id: def.id, label: def.label, description: def.description,
    suggested: def.isApplicable({ generatedOrProtectedAreas }),
  }));
  return { status: "WaitingForUser", result: { candidates } };
});
