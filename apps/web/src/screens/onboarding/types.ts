/**
 * Client-side mirrors of the v2 onboarding stage results
 * (`packages/core/src/repo-onboarding/stages/*.ts`). Deliberately
 * duplicated, not imported: the web app has no dependency on `@dcc/core`
 * (same reasoning as every other frontend/backend duplication in this
 * codebase). Only the fields the screen renders are typed; everything a
 * stage returns is still visible through the raw-result fallback.
 */
import type { LifecyclePhase } from "../../api.ts";

export type Classification = {
  repository_type: string; architecture_shape?: string; legacy_indicator?: boolean;
  detected_technology_stack: string[]; detected_domains?: string[]; complexity: "low" | "medium" | "high";
  documentation_maturity?: string; testing_maturity?: string;
  discovery_areas_required?: string[]; discovery_areas_not_required?: string[];
  uncertainties?: string[]; confidence: "low" | "medium" | "high"; summary_he: string;
};

export type InventoryItem = {
  type: string; path: string; name: string; description?: string | null; lines?: number; paths?: string[];
  tool: "claude_code" | "cross_tool" | "other_agent" | "human";
};
export type AiInventory = {
  items: InventoryItem[];
  summary: {
    hasClaudeMd: boolean; claudeMdLines: number; hasAgentsMd: boolean; hasClaudeDir: boolean;
    rules: number; skills: number; agents: number; hooks: number; mcpServers: number;
    otherAgentRules: number; readme: boolean; docsDirs: number; adrs: number; contributing: boolean; security: boolean; prTemplate: boolean; ci: number;
  };
};

export type ExistingConfigPolicy = "keep" | "merge" | "replace";
export type ExistingConfigSuggestion = { path: string; type: string; name: string; lines?: number; suggested: ExistingConfigPolicy; why_he: string };

export type ScanResult = {
  workspacePath: string; baselineSha: string; branchName: string; workspaceKind: string; profileId: string;
  profile: {
    languages: { name: string; fileCount: number; lines?: number; code?: number; comment?: number; blank?: number; complexity?: number }[];
    buildSystems: string[]; frameworks: string[]; ciProviders: string[];
    testSignalCount: number; docsCount: number; fileCount: number; dirCount: number; topLevel: string[]; sccUsed: boolean; maxDepthHit: boolean;
  };
  inventory: AiInventory;
  classification: Classification | null;
  classificationError?: string;
  suggestions: { denyRules: { pattern: string; reason: string }[]; profileId: string; existingConfig: ExistingConfigSuggestion[] };
  preflight: { claudeVersion: string | null; restricted: boolean; permissionPrompts: boolean; jsonSchema: boolean; maxBudget: boolean; sccUsed: boolean };
  changedSincePrevious?: string[];
  previousBaselineSha?: string;
  claudeExecutionId?: string;
};

export type PermissionVerb = "allow" | "ask" | "deny";
export type EffectivePolicy = {
  profileId: string;
  profile: { label: string; description: string; read: PermissionVerb; write: PermissionVerb; commands: Record<string, PermissionVerb>; network: PermissionVerb; mcp: PermissionVerb };
  deniedReadPaths: string[];
};
export type BoundariesApproved = { rules: string[]; profileId: string; existingConfig: Record<string, ExistingConfigPolicy>; classificationOverride?: string; notes?: string };
export type BoundariesResult = {
  suggestedRules: { pattern: string; reason: string }[];
  suggestedProfileId: string;
  profiles: { id: string; label: string; description: string }[];
  existing: ExistingConfigSuggestion[];
  classification: Classification | null;
  carriedOver?: boolean;
  approved?: BoundariesApproved;
  effectivePolicy?: EffectivePolicy;
  approvedAt?: string;
};

export type DiscoveryQuestion = { id: string; question_he: string; why_it_matters_he: string; risk_if_unknown: "LOW" | "MEDIUM" | "HIGH"; related_area?: string };
export type Discovery = {
  purpose: string;
  coverage: { area: string; status: "COVERED" | "PARTIAL" | "MISSING"; sources?: string[]; note?: string }[];
  components: { name: string; purpose?: string; paths: string[]; evidence?: string[] }[];
  entry_points?: { name?: string; path: string; how_to_run?: string }[];
  boundaries?: { description: string; paths?: string[] }[];
  key_flows?: { name: string; steps?: string[]; paths?: string[] }[];
  integrations?: { system: string; direction?: string; paths?: string[]; constraints?: string[] }[];
  generated_or_protected_areas?: { path: string; reason: string; kind?: string }[];
  build_test?: { name: string; command: string; cwd?: string; evidence?: string; confidence: "low" | "medium" | "high" }[];
  constraints?: { statement: string; evidence?: string; severity?: string }[];
  where_to_look?: { task_type: string; paths: string[]; note?: string }[];
  existing_instructions_assessment?: {
    path: string; verdict: "keep" | "merge" | "outdated" | "conflicting"; reason?: string;
    reshape?: "none" | "supersede_with_skill" | "consolidate" | "redundant"; reshape_note_he?: string; reshape_target?: string;
  }[];
  existing_setup_summary_he?: string;
  unknowns: string[];
  questions: DiscoveryQuestion[];
  evidence_paths?: string[];
};
export type DiscoveryResult = { discovery: Discovery; claudeExecutionId: string; stats: { toolCalls: Record<string, number>; costUsd: number | null; numTurns: number | null } };

export type ConfirmAnswer = { id: string; answer_he: string; status: "answered" | "unknown" | "not_asked" };
export type ConfirmResult = {
  questions: DiscoveryQuestion[];
  digest: { purpose: string; components: number; integrations: number; constraints: number; unknowns: string[]; coverage: Discovery["coverage"] };
  answers?: ConfirmAnswer[];
  corrections?: string;
  answeredAt?: string;
  resolvedBy?: "person" | "automation";
};

export type ArtifactKind = "claude_md" | "nested_claude_md" | "rule" | "knowledge_skill" | "workflow_skill" | "agent" | "settings" | "guardrail_hook" | "dcc_hooks" | "legacy_artifact";
export type PlannedArtifact = {
  key: string; kind: ArtifactKind; path: string; action: "create" | "update" | "skip" | "remove"; loading: "always" | "on_demand" | "never"; writer: "ai" | "dcc";
  title_he: string; justification: string; consumers: LifecyclePhase[]; watchedPaths: string[]; sourceOfTruth: string;
  skill?: { name: string; description: string; paths?: string[]; disableModelInvocation?: boolean };
  rulePaths?: string[]; catalogId?: string; notes?: string[]; supersededBy?: string;
};
export type StaleArtifactWarning = {
  path: string;
  verdict: "outdated" | "conflicting" | "reshape";
  reason?: string;
  reshape?: "supersede_with_skill" | "consolidate" | "redundant";
  reshapeTarget?: string;
};
export type PlanResult = {
  artifacts: PlannedArtifact[];
  notCreated: { kind: string; reason_he: string }[];
  rationale_he?: string;
  protectedGlobs: string[];
  claudeExecutionId?: string;
  approved?: PlannedArtifact[];
  approvedAt?: string;
  staleArtifactWarnings: StaleArtifactWarning[];
};

export type GeneratedArtifact = { key: string; kind: string; path: string; action: string; writer: "ai" | "dcc"; lines: number; estimatedTokens: number; hash: string | null };
export type GenerateResult = {
  filesWritten: string[]; commitSha: string | null; artifacts: GeneratedArtifact[];
  missing: { key: string; path: string; reason_he: string }[];
  summary_he?: string; claudeExecutionId?: string; reviewNoteApplied?: string | null;
};

export type Check = { id: string; label_he: string; status: "pass" | "warn" | "fail" | "skipped"; detail?: string };
export type ContextBudget = {
  alwaysLoadedTokens: number; onDemandTokens: number;
  items: { path: string; loading: "always" | "on_demand" | "never"; tokens: number; lines: number; note?: string }[];
  thresholds: { warnAlways: number; failAlways: number; claudeMdMaxLines: number };
};
export type ReviewIssue = { severity: "low" | "medium" | "high"; artifact: string; problem_he: string; evidence?: string; recommended_correction_he?: string; category?: string };
export type ValidateResult = {
  status: "READY" | "READY_WITH_WARNING" | "NOT_READY";
  checks: Check[];
  budget: ContextBudget;
  review: { overall_status: "PASS" | "WARN" | "FAIL"; issues: ReviewIssue[]; strengths_he?: string[] } | null;
  fixNote?: string;
  attempt: number;
  claudeExecutionId?: string;
};

export type ChangedFile = { path: string; status: string; additions: number; deletions: number };
export type ReviewResult = {
  baselineSha: string;
  changedFiles: ChangedFile[];
  validation: { status: ValidateResult["status"]; failed: number; warned: number; passed: number; reviewStatus: string | null; issueCount: number };
  budget: ContextBudget | null;
  planned: { key: string; kind: string; path: string; action: string; produced: boolean; lines?: number; estimatedTokens?: number }[];
  notCreated: { kind: string; reason_he: string }[];
  decision?: "approve" | "request_changes";
  note?: string;
  droppedPaths?: string[];
  decidedAt?: string;
  decidedBy?: string;
};

export type DeliverResult = {
  branch: string; base: string; pushed: boolean; remote: string | null;
  prNumber: number | null; prUrl: string | null; compareUrl: string | null; createdViaGh: boolean;
  merged: boolean; mergedSha?: string; readinessDate?: string; onboardingVersion: string; analyzedCommitSha: string;
  checks: number; lastCheckedAt: string; localOnly: boolean;
};
