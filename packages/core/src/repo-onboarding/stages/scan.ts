import { globSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { repo, repositoryProfile } from "@dcc/db/schema";
import { claudeCliCaps, git } from "../../ai-assist.ts";
import { renderInventoryForPrompt, scanAiInventory, type AiInventory } from "../inventory.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner } from "../runner.ts";
import { scanRepository } from "../scanner.ts";
import { CLASSIFICATION_SCHEMA } from "../schemas.ts";
import { loadProfileCatalog, suggestSecurityProfile } from "../security-profiles.ts";
import { registerStage } from "../state-machine.ts";
import { ensureOnboardingWorkspace } from "../workspace.ts";
import type { RepositoryProfile, StageOutcome } from "../types.ts";

/**
 * Stage 1 — Scan & classify. Deterministic workspace + profile + inventory,
 * then one small AI call that classifies the repository from the scan's
 * signals ONLY (no tools, no file reads). Produces the suggestions the
 * boundaries gate shows.
 */
export type Classification = {
  repository_type: string; architecture_shape?: string; legacy_indicator?: boolean;
  detected_technology_stack: string[]; detected_domains?: string[]; complexity: "low" | "medium" | "high";
  documentation_maturity?: string; testing_maturity?: string;
  discovery_areas_required?: string[]; discovery_areas_not_required?: string[];
  uncertainties?: string[]; confidence: "low" | "medium" | "high"; summary_he: string;
};

export type ExistingConfigPolicy = "keep" | "merge" | "replace";
export type ScanResult = {
  workspacePath: string; baselineSha: string; branchName: string; workspaceKind: string;
  profileId: string;
  profile: {
    languages: RepositoryProfile["languages"]; buildSystems: string[]; frameworks: string[]; ciProviders: string[];
    testSignalCount: number; docsCount: number; fileCount: number; dirCount: number; topLevel: string[]; sccUsed: boolean; maxDepthHit: boolean;
  };
  inventory: AiInventory;
  classification: Classification | null;
  classificationError?: string;
  suggestions: {
    denyRules: { pattern: string; reason: string }[];
    profileId: string;
    existingConfig: { path: string; type: string; name: string; lines?: number; suggested: ExistingConfigPolicy; why_he: string }[];
  };
  preflight: { claudeVersion: string | null; restricted: boolean; permissionPrompts: boolean; jsonSchema: boolean; maxBudget: boolean; sccUsed: boolean };
  /** Refresh runs only: paths changed between the previous run's baseline and this one. */
  changedSincePrevious?: string[];
  previousBaselineSha?: string;
  claudeExecutionId?: string;
};

// Permission rules have no negation, so a blanket `.env.*` rule would also
// hide `.env.example` — the one dotenv file that documents the required
// variables (confirmed live: discovery recorded it as UNKNOWN and the
// validator flagged a "contradiction" about it). The conventional
// secret-bearing variants are denied by name, `.env.example/.sample/
// .template/.dist` stay readable, and any OTHER `.env.<x>` file actually
// present in the tree gets a rule of its own.
const SECRET_DENY: { pattern: string; reason: string }[] = [
  { pattern: "Read(./**/.env)", reason: "סודות" },
  { pattern: "Read(./**/.env.local)", reason: "סודות" },
  { pattern: "Read(./**/.env.*.local)", reason: "סודות" },
  { pattern: "Read(./**/.env.production)", reason: "סודות" },
  { pattern: "Read(./**/.env.development)", reason: "סודות" },
  { pattern: "Read(./**/.env.staging)", reason: "סודות" },
  { pattern: "Read(./**/.env.test)", reason: "סודות" },
  { pattern: "Read(./**/*.pem)", reason: "סודות" },
  { pattern: "Read(./**/*.key)", reason: "סודות" },
];
const DOTENV_DOC = /^\.env\.(example|sample|template|dist|defaults?)$/i;
const DOTENV_KNOWN = new Set([".env", ".env.local", ".env.production", ".env.development", ".env.staging", ".env.test"]);
function dotenvDenyRules(root: string): { pattern: string; reason: string }[] {
  let found: string[] = [];
  try { found = globSync("**/.env*", { cwd: root, exclude: (p) => /(^|\/)(node_modules|\.git|dist|build|bin|obj|vendor)(\/|$)/.test(p) }); } catch { /* no glob support — conventions only */ }
  const out: { pattern: string; reason: string }[] = [];
  for (const f of found.map((p) => p.split(path.sep).join("/")).sort()) {
    const base = path.posix.basename(f);
    if (DOTENV_DOC.test(base) || DOTENV_KNOWN.has(base) || /\.local$/.test(base)) continue;
    out.push({ pattern: `Read(./${f})`, reason: "קובץ dotenv שנמצא ב-repository — לא לפי מוסכמת קובץ דוגמה" });
  }
  return out;
}

function existingConfigSuggestions(inv: AiInventory): ScanResult["suggestions"]["existingConfig"] {
  const out: ScanResult["suggestions"]["existingConfig"] = [];
  for (const it of inv.items) {
    if (it.tool === "human") continue;
    if (it.path === "CLAUDE.local.md") continue;
    let suggested: ExistingConfigPolicy = "keep";
    let why = "קיים ומתוחזק על ידי הצוות — DCC לא נוגע בו.";
    if (it.type === "claude_md") { suggested = "merge"; why = "CLAUDE.md קיים: DCC ישלב לתוכו רק מה שחסר (פקודות, אילוצים, הפניות) ויציע לקצר מה שניתן להסיק מהקוד."; }
    else if (it.type === "settings") { suggested = "merge"; why = "settings.json קיים: כללי חסימה ו-hooks של DCC יתווספו; שום כלל קיים לא יוסר."; }
    else if (it.type === "agents_md") { suggested = "keep"; why = "AGENTS.md קיים: CLAUDE.md ייבא אותו (@AGENTS.md) במקום לשכפל."; }
    else if (it.type === "other_agent_rules") { suggested = "keep"; why = "הנחיות לכלי אחר: ישמשו כמקור ידע ב-Discovery, לא ישוכפלו."; }
    out.push({ path: it.path, type: it.type, name: it.name, lines: it.lines, suggested, why_he: why });
  }
  return out;
}

registerStage("scan", async (ctx): Promise<StageOutcome> => {
  const [r] = await db.select().from(repo).where(eq(repo.id, ctx.repoId)).limit(1);
  if (!r) return { status: "Failed", errors: ["repo not found"] };

  const ws = await ensureOnboardingWorkspace(r, ctx.runId);
  const profile = await scanRepository(ws.dir, ws.baselineSha);
  const inventory = scanAiInventory(ws.dir);
  const caps = claudeCliCaps();
  const warnings = [...profile.warnings];

  let changedSincePrevious: string[] | undefined;
  let previousBaselineSha: string | undefined;
  if (ctx.mode === "refresh") {
    previousBaselineSha = (ctx.previousResults?.scan as ScanResult | undefined)?.baselineSha;
    if (previousBaselineSha && previousBaselineSha !== ws.baselineSha) {
      const diff = await git(["diff", `${previousBaselineSha}..${ws.baselineSha}`, "--name-only"], ws.dir, { timeoutMs: 60_000 });
      changedSincePrevious = diff.code === 0 ? diff.out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
      if (diff.code !== 0) warnings.push("לא ניתן לחשב את רשימת הקבצים שהשתנו מאז ה-onboarding הקודם — ה-Discovery ירוץ ללא מיקוד");
    } else changedSincePrevious = [];
  }
  if (!caps.version) warnings.push("לא ניתן לקרוא את גרסת claude — ודאו ש-Claude Code מותקן ומחובר על מכונת ה-DCC");
  else {
    if (!caps.restricted) warnings.push(`Claude Code ${caps.version}: אין תמיכה ב---restricted (נדרש 2.1.248+) — קריאות ה-AI ירוצו עם allowed-tools בלבד ותצורת ה-repository עצמו לא תיחסם`);
    if (!caps.permissionPrompts) warnings.push(`Claude Code ${caps.version}: אין תמיכה ב---permission-prompts none (נדרש 2.1.259+) — כתיבה שנדחתה תזוהה רק לפי תוצאות הקבצים`);
  }

  // A retry re-enters this stage for the same run — replace, don't duplicate.
  await withTenant(ctx.clientId, (tx) => tx.delete(repositoryProfile).where(eq(repositoryProfile.runId, ctx.runId)));
  const [row] = await withTenant(ctx.clientId, (tx) =>
    tx.insert(repositoryProfile).values({
      runId: ctx.runId, repoId: ctx.repoId, clientId: ctx.clientId, scannedCommitSha: profile.scannedCommitSha,
      languages: profile.languages, buildSystems: profile.buildSystems, testSignals: profile.testSignals, ciSignals: profile.ciSignals,
      frameworkSignals: profile.frameworkSignals, docsSignals: profile.docsSignals, ignoredPaths: profile.ignoredPaths, stats: profile.stats, warnings: profile.warnings,
    }).returning({ id: repositoryProfile.id }),
  );

  const profileSummary: ScanResult["profile"] = {
    languages: profile.languages.slice(0, 10),
    buildSystems: Array.from(new Set(profile.buildSystems.map((b) => b.kind))),
    frameworks: profile.frameworkSignals.map((f) => f.name),
    ciProviders: Array.from(new Set(profile.ciSignals.map((c) => c.provider))),
    testSignalCount: profile.testSignals.length, docsCount: profile.docsSignals.length,
    fileCount: profile.stats.fileCount, dirCount: profile.stats.dirCount, topLevel: profile.stats.topLevel ?? [],
    sccUsed: profile.stats.sccUsed, maxDepthHit: profile.stats.maxDepthHit,
  };

  const prompt = await getActiveOnboardingPrompt("onboarding.v2.classify");
  if (!prompt) return { status: "Failed", errors: ["no active prompt for onboarding.v2.classify — run seed-prompts.ts"] };

  const runner = createClaudeCodeRunner();
  const exec = await runner.run({
    runId: ctx.runId, stageKey: "scan", repoId: ctx.repoId, clientId: ctx.clientId, cwd: ws.dir,
    promptId: prompt.id, capability: "onboarding_classify", modelOverride: ctx.modelChoices.scan, tools: [], jsonSchema: CLASSIFICATION_SCHEMA as unknown as Record<string, unknown>,
    promptVars: {
      REPOSITORY_SCAN: JSON.stringify({ ...profileSummary, buildSystemPaths: profile.buildSystems.slice(0, 40), testSignals: profile.testSignals.slice(0, 20), ci: profile.ciSignals.slice(0, 10) }),
      INVENTORY: renderInventoryForPrompt(inventory),
    },
    maxTurns: 3, timeoutMs: 180_000,
  });

  let classification: Classification | null = null;
  let classificationError: string | undefined;
  if (exec.status === "Completed" && exec.json) classification = exec.json as Classification;
  else classificationError = exec.errorMessage ?? "classification call did not complete";
  if (classificationError) warnings.push(`הסיווג האוטומטי נכשל (${classificationError}) — ניתן להשלים ידנית בשלב הגבולות`);

  const result: ScanResult = {
    workspacePath: ws.dir, baselineSha: ws.baselineSha, branchName: ws.branch, workspaceKind: ws.kind,
    profileId: row!.id, profile: profileSummary, inventory, classification, classificationError,
    suggestions: {
      denyRules: [
        ...profile.ignoredPaths.map((p) => ({ pattern: p.pattern, reason: p.reason === "junk_dir" ? "פלט build / ספריות vendored" : "קבצים בינאריים" })),
        ...SECRET_DENY,
        ...dotenvDenyRules(ws.dir),
      ],
      profileId: suggestSecurityProfile(classification ?? undefined),
      existingConfig: existingConfigSuggestions(inventory),
    },
    preflight: { claudeVersion: caps.version, restricted: caps.restricted, permissionPrompts: caps.permissionPrompts, jsonSchema: caps.jsonSchema, maxBudget: caps.maxBudget, sccUsed: profile.stats.sccUsed },
    changedSincePrevious, previousBaselineSha,
    claudeExecutionId: exec.executionId,
  };
  void loadProfileCatalog;
  return { status: warnings.length ? "CompletedWithWarnings" : "Completed", warnings, sourceCommitSha: ws.baselineSha, claudeExecutionId: exec.executionId, result };
});
