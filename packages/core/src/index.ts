export { resolveWorkItem, keyFromBranch, type ResolvedWorkItem } from "./resolve.ts";
export { recordSession, recordGitActivity, recordNote } from "./capture.ts";
export { proposeGap, verifyGap } from "./gaps.ts";
export { proposeTasks, progressTask, tasksFor, type TaskInput } from "./tasks.ts";
export { raiseBlocker, answerBlocker, blockersFor } from "./blockers.ts";
export { regenerateBrief } from "./brief/generate.ts";
export { briefFor } from "./brief/read.ts";
export { route, recordRouting, loadPolicy, type Capability, type RoutingDecision, type RoutingSignals } from "./routing.ts";
export { linkWorkItems, flowFor, type FlowNode, type FlowEdge } from "./flow.ts";
export { recordTouches, releaseTouches, contentionFor, recordReview } from "./contention.ts";
export { dashboard, auditTrail, listAllWorkItems, listInitiatives, listBudgets, listAlerts, type AuditFilter } from "./dashboard.ts";
export { listClients, clientDetail, linkRepoToClient, addAdoConnection, checkAdoConnection, deleteConnection, listAdoProjects, listRepos, listConnections } from "./clients.ts";
export { setupClient, type SetupResult } from "./admin.ts";
export { syncRequirementToAdo, trySyncNewRequirement, syncAllToAdo, deleteAdoForRequirement, adoWorkItemUrl } from "./ado-sync.ts";
export { importAdoCsv, parseCsv, type ImportResult } from "./import-ado.ts";
export {
  updateClient, deleteClient, archiveClient,
  updateRequirement, deleteRequirement,
  linkRepoToRequirement, unlinkRepoFromRequirement, reposForRequirement,
  updateRepo, deleteRepo, unlinkClientRepo,
  updateGap, deleteGap, updateBlocker, deleteBlocker, updateTask, deleteTask, deleteDependency,
  updateConnection,
} from "./crud.ts";
