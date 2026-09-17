/**
 * Repository AI Enablement — shared types.
 *
 * Full replace (design discussion, 2026-09-16) of the old 3-step
 * `repo-ai` onboarding flow, per a 36-section spec the user supplied.
 * Phase 1 built the infrastructure (a resumable, persisted 16-stage
 * state machine, only 2 deterministic stages implemented). Phase 2 adds
 * the 5 "Analysis" stages (classification, security/permissions,
 * knowledge coverage, targeted discovery, human enrichment) and the
 * `resumeInput` mechanism `WaitingForUser` stages need to be resumed.
 */

/** Pending | Running | WaitingForUser | Completed | CompletedWithWarnings |
 *  Failed | Skipped | Cancelled — shared between a run and its stages. */
export type OnboardingStatus =
  | "Pending"
  | "Running"
  | "WaitingForUser"
  | "Completed"
  | "CompletedWithWarnings"
  | "Failed"
  | "Skipped"
  | "Cancelled";

/** The ordered list of stage keys the state machine drives through.
 *  `stage_key` is `text` in the DB specifically so this never needs a
 *  migration when a later phase appends more keys. */
export const STAGE_ORDER: readonly string[] = [
  "workspace_setup", "repository_scan", "classification", "security_permissions",
  "knowledge_coverage", "targeted_discovery", "human_enrichment",
  "knowledge_generation", "claude_md_generation", "scoped_rules",
  // Spec stage 11 (Skills Evaluation) is Phase 6 — deferred; "guardrails"
  // (spec stage 12) is Phase 4 and lands here out of numeric order, same
  // as every prior phase treating spec stage numbers as reference labels
  // rather than a strict execution sequence.
  "guardrails",
  // Phase 5 (Validation & Delivery, spec stages 13-16).
  "ai_doctor", "user_review", "github_pull_request", "ai_ready",
  // Phase 6 (Optimization). "skills_evaluation" is spec stage 11 but
  // lands last here — the user's own Implementation Order places it in
  // Phase 6, after Phase 5's GitHub PR/AI Ready, continuing the same
  // append-by-rollout-order precedent every earlier phase already set.
  "skills_evaluation",
];

export type StageContext = {
  runId: string;
  repoId: string;
  clientId: string;
  workspaceDir: string;
  baselineSha: string;
  triggeredBy: string;
  /** Completed/CompletedWithWarnings/Skipped stages' `result`, keyed by
   *  stage key — lets a later stage read an earlier one's output without
   *  re-deriving it. Deliberately excludes a currently-`WaitingForUser`
   *  stage's own (provisional) result. */
  priorResults: Record<string, unknown>;
  /** Set only when this call is a resume via `submitStageInput` — the
   *  human's raw input for whatever this stage asked for (e.g. stage 04's
   *  `{approvedRules}`, stage 07's `{answers}`). Undefined on the stage's
   *  normal first entry through `advanceRun`. A handler must check
   *  `!== undefined` (not truthiness) — an approved empty array is a
   *  valid, deliberate input, not "no input given". */
  resumeInput?: unknown;
};

export type StageOutcome = {
  status: Extract<OnboardingStatus, "Completed" | "CompletedWithWarnings" | "Failed" | "Skipped" | "WaitingForUser">;
  result?: unknown;
  warnings?: string[];
  errors?: string[];
  claudeExecutionId?: string;
  sourceCommitSha?: string;
};

export type StageHandler = (ctx: StageContext) => Promise<StageOutcome>;

/** One build/package/dependency manifest found in the repo. */
export type BuildSystemSignal = { kind: string; path: string };
/** A detected test area. `framework` is a light, best-effort guess (e.g.
 *  "jest"/"xunit") — not authoritative, refined by later stages if ever needed. */
export type TestSignal = { path: string; framework?: string };
export type CiSignal = { provider: string; path: string };
export type FrameworkSignal = { name: string; evidence: string };
/** `lines`/`code`/`comment`/`blank`/`complexity` come from `scc` (see
 *  `scc.ts`) and are optional — absent when `scc` wasn't available and
 *  the scan fell back to plain extension counting, and absent on any
 *  profile persisted before this field existed (jsonb, no migration
 *  needed, but older rows genuinely don't have it). */
export type LanguageSignal = {
  name: string; fileCount: number;
  lines?: number; code?: number; comment?: number; blank?: number; complexity?: number;
};
export type DocsSignal = { path: string };
/** Why a path is excluded from anything Claude reads — the same
 *  dir-name/extension deny-rule logic `repo-ai/permissions.ts` uses for
 *  the old flow's step 2, folded into one scan pass here instead of a
 *  second walk. */
export type IgnoredPathSignal = { pattern: string; reason: "junk_dir" | "junk_extension" };

/** Deterministic repository-scanner output — NOT full comprehension,
 *  just enough signal for later stages (classification, discovery) to
 *  decide where to look. Mirrors `repository_profile`'s jsonb columns. */
export type RepositoryProfile = {
  scannedCommitSha: string;
  languages: LanguageSignal[];
  buildSystems: BuildSystemSignal[];
  testSignals: TestSignal[];
  ciSignals: CiSignal[];
  frameworkSignals: FrameworkSignal[];
  docsSignals: DocsSignal[];
  ignoredPaths: IgnoredPathSignal[];
  stats: { fileCount: number; dirCount: number; maxDepthHit: boolean; sccUsed: boolean };
  warnings: string[];
};

export type OnboardingWorkspace = {
  dir: string;
  baselineSha: string;
  branch: string;
  kind: "worktree" | "clone";
};
