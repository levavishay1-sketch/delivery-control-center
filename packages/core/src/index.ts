export { resolveWorkItem, keyFromBranch, type ResolvedWorkItem } from "./resolve.ts";
export { recordSession, recordGitActivity, recordNote } from "./capture.ts";
export { proposeGap, verifyGap } from "./gaps.ts";
export { proposeTasks, progressTask, tasksFor, taskDetail, clientOfTask, type TaskInput, type TaskDetail } from "./tasks.ts";
export { raiseBlocker, answerBlocker, blockersFor } from "./blockers.ts";
export { regenerateBrief } from "./brief/generate.ts";
export { briefFor } from "./brief/read.ts";
export { route, recordRouting, loadPolicy, type Capability, type RoutingDecision, type RoutingSignals } from "./routing.ts";
export { linkWorkItems, flowFor, taskFlowFor, clientTaskTree, allAdoTasks, type FlowNode, type FlowEdge, type TaskFlowNode, type TaskFlowEdge, type AdoTaskRow } from "./flow.ts";
export { materializeTasksToAdo, pendingMaterializeCount, editTask, type MaterializeResult, type EditTaskResult } from "./task-ado-sync.ts";
export { recordTouches, releaseTouches, contentionFor, recordReview } from "./contention.ts";
export { dashboard, auditTrail, listAllWorkItems, listInitiatives, listBudgets, listAlerts, type AuditFilter } from "./dashboard.ts";
export { listClients, clientDetail, linkRepoToClient, addAdoConnection, checkAdoConnection, deleteConnection, listAdoProjects, listRepos, listConnections } from "./clients.ts";
export { setupClient, type SetupResult } from "./admin.ts";
export { listPrompts, getPromptByKey, updatePrompt, renderPrompt, type PromptTemplateRow } from "./prompts.ts";
export { syncRequirementToAdo, trySyncNewRequirement, syncAllToAdo, deleteAdoForRequirement, adoWorkItemUrl } from "./ado-sync.ts";
export { importAdoCsv, parseCsv, type ImportResult } from "./import-ado.ts";
export { startBuilding, type StartBuildResult } from "./start-build.ts";
export {
  startFlowRun, getFlowRunView, getTaskRunView, approveTask, rejectTask, pendingApprovalCount, rollbackTask, pushTask,
  precheckTaskDelete, deleteTaskSurgical, DeleteNeedsConfirmation, previewAssessPrompt, composeClientLetter,
  type AssessResult, type AssessGap, type ClientLetter, type BreakdownResult, type FlowRunView, type ImplementResult, type RollbackResult, type PushResult,
  type TaskDeletePrecheck, type TaskDeleteNode, type DeleteTaskOptions,
} from "./ai-assist.ts";
export { pullFromAdo, pullOneFromAdo, attachmentsFor, addAttachment, adoWorkItemExists, type PullResult } from "./ado-pull.ts";
export {
  updateClient, deleteClient, archiveClient,
  updateRequirement, deleteRequirement,
  linkRepoToRequirement, unlinkRepoFromRequirement, reposForRequirement,
  updateRepo, deleteRepo, unlinkClientRepo,
  updateGap, deleteGap, updateBlocker, deleteBlocker, updateTask, deleteDependency,
  updateConnection,
} from "./crud.ts";
