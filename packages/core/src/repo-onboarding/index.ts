// Importing the stage modules for their `registerStage(...)` side effects
// — this file must be imported at least once before `advanceRun` runs,
// or "no handler registered for stage" is thrown. `apps/api/src/server.ts`
// imports this barrel, satisfying that at process start.
import "./stages/workspace-setup.ts";
import "./stages/repository-scan.ts";
import "./stages/classification.ts";
import "./stages/security-permissions.ts";
import "./stages/knowledge-coverage.ts";
import "./stages/targeted-discovery.ts";
import "./stages/human-enrichment.ts";
import "./stages/knowledge-generation.ts";
import "./stages/claude-md-generation.ts";
import "./stages/scoped-rules.ts";
import "./stages/guardrails.ts";
import "./stages/ai-doctor.ts";
import "./stages/user-review.ts";
import "./stages/github-pull-request.ts";
import "./stages/ai-ready.ts";
import "./stages/skills-evaluation.ts";

export { startOnboardingRun, advanceRun, cancelRun, getOnboardingRunView, getLatestOnboardingRun, submitStageInput, registerStage, getOnboardingExecution } from "./state-machine.ts";
export { commitWorkspaceChanges } from "./commit.ts";
export { ensureOnboardingWorkspace, releaseOnboardingWorkspace } from "./workspace.ts";
export { scanRepository } from "./scanner.ts";
export { createClaudeCodeRunner, type ClaudeCodeRunner, type ClaudeExecutionRequest, type ClaudeExecutionResult, type PermissionProfile } from "./runner.ts";
export { getActiveOnboardingPrompt, registerPromptVersion, updateOnboardingPromptBody, type OnboardingPromptTemplateRow } from "./prompts.ts";
export { extractClaudeJson } from "./json.ts";
export { loadProfileCatalog, type SecurityProfile } from "./security-profiles.ts";
export { GUARDRAIL_CATALOG, type GuardrailDefinition } from "./guardrails.ts";
export { checkRepositoryRefresh, repositoryRefreshMetrics, type RefreshResult, type RefreshMetrics } from "./refresh.ts";
export { onboardingRunCostSummary, type OnboardingRunCostSummary } from "./telemetry.ts";
export { STAGE_ORDER, type OnboardingStatus, type RepositoryProfile, type StageContext, type StageHandler, type StageOutcome } from "./types.ts";
