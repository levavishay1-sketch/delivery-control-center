// Importing the stage modules for their `registerStage(...)` side effects
// — this file must be imported at least once before a run advances, or
// "no handler registered for stage" is thrown. `apps/api/src/server.ts`
// imports this barrel, satisfying that at process start.
import "./stages/scan.ts";
import "./stages/boundaries.ts";
import "./stages/discovery.ts";
import "./stages/confirm.ts";
import "./stages/plan.ts";
import "./stages/generate.ts";
import "./stages/validate.ts";
import "./stages/review.ts";
import "./stages/deliver.ts";

export {
  startOnboardingRun, advanceRun, cancelRun, driveRun, getOnboardingRunView, getLatestOnboardingRun, listOnboardingRuns, submitStageInput,
  registerStage, getOnboardingExecution, listRunExecutions, updateRunAutomation, updateRunModelChoices, resetRunToStage, stopRunExecution, getRunFileDiff, onboardingStageCatalogue,
  recoverInterruptedRuns,
} from "./state-machine.ts";
export { appendRepoAiEvent } from "./events.ts";
export { commitWorkspaceChanges } from "./commit.ts";
export { ensureOnboardingWorkspace, releaseOnboardingWorkspace } from "./workspace.ts";
export { scanRepository } from "./scanner.ts";
export { scanAiInventory, type AiInventory, type InventoryItem } from "./inventory.ts";
export { createClaudeCodeRunner, type ClaudeCodeRunner, type ClaudeExecutionRequest, type ClaudeExecutionResult } from "./runner.ts";
export { getActiveOnboardingPrompt, listActiveOnboardingPrompts, registerPromptVersion, updateOnboardingPromptBody, type OnboardingPromptTemplateRow } from "./prompts.ts";
export { seedOnboardingPrompts } from "./seed-prompts.ts";
export { extractClaudeJson } from "./json.ts";
export { loadProfileCatalog, type SecurityProfile } from "./security-profiles.ts";
export { GUARDRAIL_CATALOG, type GuardrailDefinition } from "./guardrails.ts";
export { checkRepositoryRefresh, repositoryRefreshMetrics, type RefreshResult, type RefreshMetrics } from "./refresh.ts";
export { onboardingRunCostSummary, type OnboardingRunCostSummary, type OnboardingCostByStage } from "./telemetry.ts";
export {
  STAGES, STAGE_ORDER, STAGE_CAPABILITY, ONBOARDING_VERSION, presetPolicy, normalizePolicy, normalizeModelPolicy,
  type OnboardingStatus, type RepositoryProfile, type StageContext, type StageHandler, type StageOutcome, type StageDefinition,
  type AutomationPolicy, type AutomationPreset, type StagePolicy, type PlannedArtifact, type ModelChoice, type ModelPolicy,
} from "./types.ts";
