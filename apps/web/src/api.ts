const DEV_EMAIL = import.meta.env.VITE_DCC_DEV_EMAIL ?? "you@dcc.local";
const HOOK_TOKEN = import.meta.env.VITE_DCC_HOOK_TOKEN ?? "dev-secret";
/** auth headers only — no content-type (added per-request when there's a body) */
const AUTH = { "x-dcc-hook-token": HOOK_TOKEN, "x-dcc-dev-email": DEV_EMAIL };
const H = { "content-type": "application/json", ...AUTH };

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
const get = <T,>(p: string) => fetch(`/api${p}`, { headers: H }).then((r) => j<T>(r));
const post = <T,>(p: string, body: unknown) =>
  fetch(`/api${p}`, { method: "POST", headers: H, body: JSON.stringify(body) }).then((r) => j<T>(r));
const patch = <T,>(p: string, body: unknown) =>
  fetch(`/api${p}`, { method: "PATCH", headers: H, body: JSON.stringify(body) }).then((r) => j<T>(r));
const del = <T,>(p: string, body?: unknown) =>
  fetch(`/api${p}`, body
    ? { method: "DELETE", headers: H, body: JSON.stringify(body) }
    : { method: "DELETE", headers: AUTH }).then((r) => j<T>(r));
export const getText = (p: string) => fetch(`/api${p}`, { headers: H }).then((r) => r.text());

// ---------- types ----------
/** Requirement / work-item type — 1:1 with Azure DevOps / TFS. */
export type ReqType = "epic" | "feature" | "story" | "bug" | "task" | "spike";
export const REQ_TYPES: ReqType[] = ["epic", "feature", "story", "bug", "task", "spike"];
export const REQ_TYPE_HE: Record<ReqType, string> = {
  epic: "אפיק (Epic)", feature: "פיצ'ר (Feature)", story: "סיפור (Story)",
  bug: "באג (Bug)", task: "משימה (Task)", spike: "בירור (Spike)",
};

export type EventRow = {
  id: string; workitemId: string | null; occurredAt: string; recordedAt: string;
  source: string; type: string; actor: { kind: string; triggeredBy?: string };
  payload: Record<string, unknown>; supersedes: string | null; links: { rel: string; ref: string }[];
};
export type GapState = "proposed" | "verified" | "resolved" | "dismissed" | "spun_off";
export type GapKind = "business" | "technical" | "missing_info" | "new_scope";
export type Gap = {
  id: string; description: string; blocking: boolean; confidence: string; state: GapState; spunOffTo: string | null;
  why: string | null; kind: GapKind; whoAnswers: "client" | "team"; options: string[]; impactIfWrong: string | null;
  answer: string | null;
};
export type Blocker = { id: string; workitemId: string; questionType: string; question: string; answer: string | null; state: "open" | "answered" | "abandoned" };
export type TaskKind = "task" | "check";
export type Task = {
  id: string; seq: number; kind: TaskKind; intent: string; appetite: string;
  state: "pending" | "in_progress" | "blocked" | "failed_checks" | "done" | "dropped";
  /** Check-kind rows only — the FACTUAL result Claude reported. */
  checkResult: "passed" | "failed" | null;
  /** Set only when a human overrode/decided on the result directly — a
   *  null here with a checkResult present means "Claude's report, as-is". */
  checkResolvedBy: string | null;
  origin: "ai" | "human"; approvedAt: string | null; affectedPaths: string[]; compiledComponents: string[];
  parentTaskId: string | null; adoType: string | null; linkedAdoId: number | null; adoUrl: string | null;
  prompt: string | null;
  /** Check-kind rows only — false when toggled out of play (see
   *  `setCheckActive`): dropped from its parent's prompt and the
   *  completion gate, but its row and history stay. */
  active: boolean;
};

/** DCC-internal flow-control axis, orthogonal to `type` (`requirement-types`,
 *  decided 2026-09-12). `research`/`testing` don't yet get a different
 *  WorkflowTab/Flow-card treatment — that's still an open design question. */
export type RequirementType = "development" | "research" | "testing";
export type WorkItem = {
  id: string; key: string | null; title: string; clientId: string; parentId: string | null;
  type: ReqType; requirementType: RequirementType; phase: string;
  priority: "low" | "medium" | "high" | "critical"; risk: "low" | "medium" | "high";
  executor: "human" | "ai" | "mixed"; budgetUsd: string | null; dueDate: string | null;
  progressPct: number; linkedAdoId: number | null; adoAreaPath: string | null; startedWithOpenBlocker: boolean;
};
export type LinkedRepo = { id: string; name: string; adoRepoRef: string | null; linkKind: "declared" | "auto"; addedAt: string };
export type Attachment = { id: string; name: string; adoUrl: string | null; sizeBytes: number | null; source: "dcc" | "ado"; createdAt: string };
export type WorkItemDetail = {
  workitem: WorkItem; attachments: Attachment[]; repos: LinkedRepo[]; gaps: Gap[]; blockers: Blocker[]; tasks: Task[];
  taskDependencies: { taskId: string; dependsOnTaskId: string; reason: string | null }[];
  events: EventRow[];
};

export type Initiative = {
  id: string; name: string; type: ReqType; phase: string; priority: string;
  clientName: string; clientId: string; ownerName?: string;
  budgetUsd: number | null; aiCostUsd?: number; children?: number; items?: number;
  updatedAt?: string | null;
};

export type Dashboard = {
  stats: {
    initiatives: number; initiativesDelta: number;
    openItems: number; itemsDelta: number;
    blockedItems: number;
    aiCostUsd: number; aiBudgetUsd: number; aiBudgetPct: number;
  };
  initiatives: Initiative[];
  recentWorkItems: {
    id: string; key: string | null; title: string; type: ReqType; priority: string;
    parentTitle: string | null; clientName: string; ownerName: string; updatedAt: string;
    aiSpentUsd: number; aiBudgetUsd: number | null; trend: "up" | "down" | "flat";
  }[];
  alerts: { id: string; kind: string; severity: string; title: string; body: string | null; createdAt: string; workitemId: string | null }[];
};

export type AuditPage = {
  page: number; hasNext: boolean;
  rows: {
    id: string; occurredAt: string; type: string; source: string;
    actor: { kind: string; triggeredBy?: string }; payload: Record<string, unknown>;
    workitemId: string | null; wiKey: string | null; wiTitle: string | null;
    clientName: string | null;
  }[];
};

export type FlowData = {
  nodes: { id: string; key: string | null; title: string; phase: string; type: ReqType; parentId: string | null; openBlockingGaps: number; openBlockers: number; linkedAdoId: number | null; adoUrl: string | null }[];
  edges: { from: string; to: string; kind: string; reason: string | null; adoSynced: boolean }[];
};

// ---------- calls ----------
export const getDashboard = () => get<Dashboard>("/dashboard");
export const getAudit = (q: Record<string, string>) =>
  get<AuditPage>(`/audit?${new URLSearchParams(q).toString()}`);

export type WorkListRow = {
  id: string; key: string | null; title: string; type: ReqType; phase: string;
  priority: string; risk: string; updatedAt: string; parentId: string | null; parentTitle: string | null;
  clientName: string; ownerName: string; openBlockers: number;
};
export const getWorkList = () => get<{ items: WorkListRow[] }>("/list/workitems");
export const getInitiatives = () => get<{ initiatives: Initiative[] }>("/list/initiatives");
export const getBudgets = () => get<{ budgets: { clientId: string; clientName: string; monthlyUsd: number; spentUsd: number; pct: number }[] }>("/list/budgets");
export const getAlerts = () => get<{ alerts: { id: string; kind: string; severity: string; title: string; body: string | null; createdAt: string; workitemId: string | null }[] }>("/list/alerts");

export type ClientRow = { id: string; name: string; initiatives: number; workitems: number; spent: number; budget: number };
export const getClients = () => get<{ clients: ClientRow[] }>("/clients");

export type Requirement = {
  id: string; key: string | null; title: string; type: ReqType; phase: string;
  priority: string; risk: string; parentId: string | null; ownerName: string;
  budgetUsd: string | null; dueDate: string | null; progressPct: number;
  updatedAt: string | null; openBlockers: number;
};
export type ClientDetail = {
  client: { id: string; name: string; connectorType: string; adoProjectRef: string | null };
  requirements: Requirement[];
  repos: { id: string; name: string; adoRepoRef: string | null; addedAt: string }[];
  connections: { id: string; kind: string; displayName: string; config: Record<string, string>; lastCheckedAt: string | null; lastCheckOk: string | null; revokedAt: string | null }[];
};
export const getClient = (id: string) => get<ClientDetail>(`/clients/${id}`);
export const getRepos = () => get<{ repos: { id: string; name: string; adoRepoRef: string | null; clientId: string | null; clientName: string | null; linkedClients: number }[] }>("/repos");
export const getAdoProjects = (body: { orgUrl: string; pat: string }) =>
  post<{ ok: boolean; orgUrl: string; projects: string[]; detail: string }>("/connections/ado/projects", body);
export const deleteConnection = (clientId: string, id: string) => del<{ deleted: boolean }>(`/clients/${clientId}/connections/${id}`);
export const checkConnection = (clientId: string, id: string) => post<{ ok: boolean; detail: string }>(`/clients/${clientId}/connections/${id}/check`, {});
export const getConnections = () => get<{ connections: { id: string; kind: string; displayName: string; config: Record<string, string>; clientName: string; clientId: string; lastCheckOk: string | null }[] }>("/connections");
export const getDetail = (id: string) => get<WorkItemDetail>(`/workitems/${id}`);
export const getBrief = (id: string) => getText(`/workitems/${id}/brief`);
export type RequirementCostSummary = {
  totalUsd: number; totalInputTokens: number; totalOutputTokens: number; runCount: number;
  byKind: Record<string, { count: number; usd: number }>;
};
export const getCostSummary = (id: string) => get<RequirementCostSummary>(`/workitems/${id}/cost`);
export const getFlow = (requirementId: string) => get<FlowData>(`/requirements/${requirementId}/flow`);
export const getInbox = (clientId: string) => get<{ events: EventRow[] }>(`/clients/${clientId}/inbox`);

export type AdoSyncResult = { synced: boolean; created?: boolean; adoId?: number; url?: string; error?: string };
export const createRequirement = (body: {
  clientId?: string; parentId?: string; title: string; type?: ReqType;
  priority?: string; risk?: string; executor?: string;
}) => post<WorkItem>("/workitems", body);
export type StartBuildResult = {
  key: string; branch: string;
  repos: { name: string; adoRepoRef: string | null; defaultBranch: string }[];
  openBlockingGaps: number; openBlockers: number; startedWithOpenBlocker: boolean;
};
export const startBuilding = (id: string) => post<StartBuildResult>(`/workitems/${id}/start`, {});
export const getUsers = () => get<{ users: { id: string; email: string; displayName: string }[] }>("/users");
export const assignRequirement = (id: string, body: { ownerId?: string; email?: string }) => post<{ assigned: boolean; ownerId: string }>(`/workitems/${id}/assign`, body);
export type AssessGap = {
  question: string; why: string; kind: GapKind; whoAnswers: "client" | "team";
  options: string[]; impactIfWrong: string; blocking: boolean; confidence: number;
};
export type AssessResult = {
  title: string; summary: string; whatChanges: string[]; baked: boolean; rationale: string[];
  gaps: AssessGap[]; repoUsed: string | null;
};
export type ClientLetter = {
  subject: string; body: string; gapCount: number;
  costUsd: number | null; inputTokens: number | null; outputTokens: number | null;
};
export const composeGapLetter = (id: string, gapIds: string[]) =>
  post<ClientLetter>(`/workitems/${id}/gap-letter`, { gapIds });
export type ClientLetterHistoryItem = {
  id: string; subject: string; body: string; gapCount: number; composedAt: string;
  costUsd: number | null; inputTokens: number | null; outputTokens: number | null; model: string | null;
};
/** Every letter ever composed for this requirement, newest first — read back, never re-runs the AI. */
export const getGapLetters = (id: string) => get<{ letters: ClientLetterHistoryItem[] }>(`/workitems/${id}/gap-letters`);
export type CostDetailRow = {
  id: string; occurredAt: string; kind: string; label: string; model: string | null;
  costUsd: number; inputTokens: number; outputTokens: number; durationMs: number | null; numTurns: number | null;
};
export const getCostDetail = (id: string) => get<{ rows: CostDetailRow[] }>(`/workitems/${id}/cost-detail`);
export type BreakdownResult = {
  depth: number;
  tasks: {
    id: string; seq: number; kind: TaskKind; intent: string; appetite: string; affectedPaths: string[]; compiledComponents: string[];
    dependsOnSeq: number[]; parentSeq: number | null; level: number; adoType: string | null; prompt: string | null;
  }[];
};
export type TaskFlowNode = {
  id: string; seq: number; kind: TaskKind; intent: string; appetite: string; state: string;
  adoType: string | null; level: number; parentTaskId: string | null;
  approved: boolean; active: boolean; linkedAdoId: number | null; adoUrl: string | null; affectedPaths: string[]; compiledComponents: string[];
  prompt: string | null; origin: "ai" | "human"; approvedAt: string | null; adoSyncedAt: string | null;
  checks: { id: string; seq: number; intent: string; state: string }[];
};
export type TaskFlowEdge = { from: string; to: string; kind: "parent" | "depends"; reason: string | null };
export type TaskFlow = { depth: number; nodes: TaskFlowNode[]; edges: TaskFlowEdge[] };
export const getTaskFlow = (id: string) => get<TaskFlow>(`/workitems/${id}/task-flow`);
export type AdoTaskRow = {
  id: string; requirementId: string; requirementKey: string | null; requirementTitle: string;
  seq: number; intent: string; appetite: string; state: string;
  adoType: string | null; linkedAdoId: number | null; adoUrl: string | null; adoSyncedAt: string | null;
  approved: boolean; active: boolean; parentTaskId: string | null; level: number;
  checksCount: number; checksPosted: number;
};
export type AdoTasks = { rows: AdoTaskRow[]; inTfs: number; pending: number };
export const getClientAdoTasks = (clientId: string) => get<AdoTasks>(`/clients/${clientId}/ado-tasks`);
export type AllAdoTasks = {
  clients: { clientId: string; clientName: string; rows: AdoTaskRow[]; inTfs: number; pending: number }[];
  inTfs: number; pending: number;
};
export const getAllAdoTasks = () => get<AllAdoTasks>("/ado-tasks");
export type MaterializeResult = { created: number; skipped: number; links: number; checksPosted: number; items: { taskId: string; seq: number; adoId: number; adoType: string; url: string }[]; detail: string };
export const materializeTasks = (id: string) => post<MaterializeResult>(`/workitems/${id}/materialize`, {});
/** Agile ladder — the breakdown depth picks the rungs, leaves are always Task. */
export const ADO_LADDER = ["Epic", "Feature", "User Story", "Task"] as const;
export const startAssess = (id: string, opts?: { promptKey?: string; customEmphasis?: string; model?: string }) =>
  post<{ runId: string; alreadyRunning: boolean }>(`/workitems/${id}/assess`, opts ?? {});
export type RetroResult = {
  summary: string; tokenSavings: string[]; timeSavings: string[]; unnecessaryActions: string[];
  reworkCausingDecisions: string[]; breakdownFeedback: string[]; emphasize: string[];
};
export type RetroRun = {
  id: string | null; kind: string | null;
  state: "running" | "done" | "error" | "idle" | "rolled_back" | "stopped";
  lines: string[]; result: RetroResult | null; error: string | null;
  startedAt?: string | null; finishedAt?: string | null;
};
export const startRetro = (id: string) => post<{ runId: string; alreadyRunning: boolean }>(`/workitems/${id}/retro`, {});
export const getRetro = (id: string) => get<RetroRun>(`/workitems/${id}/retro`);
export const previewAssess = (id: string, promptKey: string, customEmphasis?: string) =>
  get<{ prompt: string; promptHe: string | null; model: string | null; templateTitle: string }>(
    `/workitems/${id}/assess-preview?${new URLSearchParams({ promptKey, ...(customEmphasis ? { customEmphasis } : {}) })}`,
  );

/* ── prompt library ───────────────────────────────────────────────── */
export type PromptTemplate = {
  id: string; key: string; title: string; description: string | null; body: string; bodyHe: string | null;
  defaultModel: string | null; sortOrder: number; updatedAt: string; updatedBy: string | null;
};
export const getPrompts = () => get<{ items: PromptTemplate[] }>("/prompts");
export const updatePromptTemplate = (id: string, patchBody: Partial<{ title: string; description: string | null; body: string; bodyHe: string | null; defaultModel: string | null }>) =>
  patch<{ updated: boolean }>(`/prompts/${id}`, patchBody);
export const startBreakdown = (id: string, reason?: string) =>
  post<{ runId: string; alreadyRunning: boolean }>(`/workitems/${id}/breakdown`, reason ? { reason } : {});
export const previewBreakdown = (id: string) =>
  get<{ prompt: string; promptHe: string; repoName: string | null }>(`/workitems/${id}/breakdown-preview`);
export const previewImplement = (taskId: string) =>
  get<{ prompt: string; promptHe: string; approved: boolean }>(`/tasks/${taskId}/implement-preview`);
export type FlowRun = {
  id: string | null; kind: "assess" | "breakdown" | "implement" | null;
  /** "rolled_back" — a past implement run whose code was undone; the
   *  transcript/result stay for history, but it's no longer the live state.
   *  "stopped" — the user killed it mid-run; not a failure. */
  state: "running" | "done" | "error" | "idle" | "rolled_back" | "stopped";
  lines: string[]; result: AssessResult | BreakdownResult | ImplementResult | null; error: string | null;
  startedAt?: string | null; finishedAt?: string | null;
};
export const getFlowRun = (id: string) => get<FlowRun>(`/workitems/${id}/flow-run`);
export const stopFlowRun = (id: string) => post<{ stopped: boolean }>(`/workitems/${id}/flow-run/stop`, {});
export const sendRunMessage = (id: string, text: string) => post<{ sent: boolean }>(`/workitems/${id}/flow-run/message`, { text });
export const approveTask = (id: string, body: { clientId: string; intent?: string; appetite?: "small" | "standard" | "large"; prompt?: string }) =>
  post<{ approved: boolean; materialized: MaterializeResult | null; materializeError?: string }>(`/tasks/${id}/approve`, body);
export const rejectTask = (id: string, clientId: string) => post<{ rejected: boolean }>(`/tasks/${id}/reject`, { clientId });
export const updateRequirement = (id: string, body: Partial<{
  title: string; type: ReqType; requirementType: RequirementType; priority: string; risk: string; executor: string; phase: string;
  budgetUsd: string | number | null; dueDate: string | null; parentId: string | null; adoAreaPath: string | null; key: string | null;
  /** Why — required in spirit whenever this patch reopens a done/archived
   *  requirement's phase; recorded to decision history. */
  reopenReason: string;
}>) => patch<WorkItem>(`/workitems/${id}`, body);
export const deleteRequirement = (id: string) => del<{ deleted: boolean; ado?: { ok: boolean; detail: string } }>(`/workitems/${id}`);

// entity edit/delete
export const updateClient = (id: string, body: Partial<{ name: string; connectorType: string; adoProjectRef: string | null }>) => patch<{ updated: boolean }>(`/clients/${id}`, body);
export const deleteClient = (id: string, archive = false) => del<{ deleted?: boolean; archived?: boolean }>(`/clients/${id}${archive ? "?mode=archive" : ""}`);
export const updateRepo = (id: string, body: Partial<{ name: string; adoRepoRef: string | null; defaultBranch: string }>) => patch<{ updated: boolean }>(`/repos/${id}`, body);
export const deleteRepo = (id: string) => del<{ deleted: boolean }>(`/repos/${id}`);
export const unlinkClientRepo = (clientId: string, repoId: string) => del<{ unlinked: boolean }>(`/clients/${clientId}/repos/${repoId}`);
export const linkRepoToClient = (clientId: string, body: { repoId?: string; name?: string; gitUrl?: string; adoRepoRef?: string }) =>
  post<{ id: string; name: string; adoRepoRef: string | null }>(`/clients/${clientId}/repos`, body);
export const updateConnection = (clientId: string, id: string, body: Partial<{ orgUrl: string; project: string; pat: string }>) => patch<{ updated: boolean }>(`/clients/${clientId}/connections/${id}`, body);
export const linkRepoToReq = (wiId: string, body: { repoId?: string; name?: string; gitUrl?: string; linkKind?: "declared" | "auto" }) => post<{ linked: boolean }>(`/workitems/${wiId}/repos`, body);
export const unlinkRepoFromReq = (wiId: string, repoId: string) => del<{ unlinked: boolean }>(`/workitems/${wiId}/repos/${repoId}`);
export const deleteDependency = (wiId: string, depId: string) => del<{ deleted: boolean }>(`/workitems/${wiId}/depends-on/${depId}`);
export const updateGap = (id: string, body: { clientId: string; description?: string; blocking?: boolean }) => patch<{ updated: boolean }>(`/gaps/${id}`, body);
export const deleteGap = (id: string, clientId: string) => del<{ deleted: boolean }>(`/gaps/${id}`, { clientId });
export const updateBlocker = (id: string, body: { clientId: string; question?: string; questionType?: string }) => patch<{ updated: boolean }>(`/blockers/${id}`, body);
export const deleteBlocker = (id: string, clientId: string) => del<{ deleted: boolean }>(`/blockers/${id}`, { clientId });
export const updateTask = (id: string, body: { clientId: string; intent?: string; appetite?: "small" | "standard" | "large" }) => patch<{ updated: boolean }>(`/tasks/${id}`, body);
export const editTask = (id: string, body: { clientId: string; intent?: string; appetite?: "small" | "standard" | "large"; prompt?: string; scopeChanged: boolean }) =>
  patch<{ updated: boolean; adoSynced: boolean }>(`/tasks/${id}`, body);
export const rollbackTask = (id: string) => post<{ rolledBack: boolean; reason?: string; branch?: string; dir?: string; invalidatedRuns?: number }>(`/tasks/${id}/rollback`, {});
export const pushTask = (id: string) => post<{ pushed: boolean; reason?: string; branch?: string; branchUrl?: string; compareUrl?: string }>(`/tasks/${id}/push`, {});

/* ── deleting a task: never a silent cascade ─────────────────────────
 * The backend refuses (409, with a precheck report) unless every risk
 * category it actually found — children, TFS links, implemented code,
 * other tasks already touching the same files — is explicitly confirmed.
 * `precheckTaskDelete` lets the UI show that report BEFORE the user
 * commits to anything. */
export type TaskDeleteNode = {
  id: string; seq: number; intent: string; kind: TaskKind; state: string;
  linkedAdoId: number | null; adoUrl: string | null; approvedAt: string | null; commitCount: number;
};
export type TaskDeletePrecheck = {
  taskId: string;
  subtree: TaskDeleteNode[];
  coTouchedBy: { id: string; seq: number; intent: string; state: string; files: string[] }[];
  hasChildren: boolean; hasAdoLinks: boolean; hasImplementedCode: boolean; hasCoTouch: boolean; safe: boolean;
};
export const precheckTaskDelete = (id: string) => get<TaskDeletePrecheck>(`/tasks/${id}/delete-check`);

export class DeleteBlocked extends Error {
  constructor(message: string, public precheck: TaskDeletePrecheck) { super(message); }
}
export type DeleteTaskConfirm = {
  clientId: string;
  confirmSubtree?: boolean; confirmAdoLinked?: boolean; confirmCoTouch?: boolean;
  rollbackImplemented?: boolean; confirmOrphanCode?: boolean;
};
export async function deleteTask(id: string, body: DeleteTaskConfirm): Promise<{ deleted: boolean; subtreeDeleted: number; adoNotesPosted: number; rolledBack: string[] }> {
  const r = await fetch(`/api/tasks/${id}`, { method: "DELETE", headers: H, body: JSON.stringify(body) });
  if (r.status === 409) {
    const body409 = await r.json() as { error: string; precheck: TaskDeletePrecheck };
    throw new DeleteBlocked(body409.error, body409.precheck);
  }
  return j<{ deleted: boolean; subtreeDeleted: number; adoNotesPosted: number; rolledBack: string[] }>(r);
}
export const correctNote = (workitemId: string, corrects: string, body: string) => post<{ eventId: string }>("/events", { workitemId, kind: "note", note: { body, source: "manual", corrects } });
export type ImportResult = { total: number; created: number; skipped: number; items: { adoId: number; title: string; status: "created" | "skipped-exists" | "skipped-bad" }[] };
export const importAdoCsv = (clientId: string, csv: string) => post<ImportResult>(`/clients/${clientId}/import/ado-csv`, { csv });
export const uploadAttachment = (workitemId: string, name: string, contentBase64: string) =>
  post<{ id: string; name: string; adoUrl: string | null }>(`/workitems/${workitemId}/attachments`, { name, contentBase64 });

export const verifyGap = (gapId: string, body: { outcome: GapState; clientId: string; spunOffTitle?: string; answer?: string }) =>
  post(`/gaps/${gapId}/verify`, body);
export const answerBlocker = (blockerId: string, body: { answer: string; clientId: string }) =>
  post(`/blockers/${blockerId}/answer`, body);
export class ChecksNotPassed extends Error {
  constructor(message: string, public unresolved: { id: string; seq: number; intent: string }[]) { super(message); }
}
export async function progressTask(taskId: string, body: { to: Task["state"]; clientId: string; overrideChecks?: boolean; overrideReason?: string; reopenReason?: string }) {
  const r = await fetch(`/api/tasks/${taskId}/progress`, { method: "POST", headers: H, body: JSON.stringify({ ...body, mode: "interactive" }) });
  if (r.status === 409) {
    const b409 = await r.json() as { error: string; unresolved: { id: string; seq: number; intent: string }[] };
    throw new ChecksNotPassed(b409.error, b409.unresolved);
  }
  return j<{ taskId: string; from: string; to: string }>(r);
}
export const setTaskActive = (taskId: string, active: boolean, clientId: string) =>
  post<{ active: boolean }>(`/tasks/${taskId}/active`, { active, clientId });
export const checkAdoRecheck = (taskId: string, clientId: string) =>
  post<{ checked: boolean; changed: boolean; adoState?: string }>(`/tasks/${taskId}/ado-recheck`, { clientId });

/* ── one task ─────────────────────────────────────────────────────── */
type TaskSlim = {
  id: string; seq: number; intent: string; state: string; kind?: TaskKind; linkedAdoId?: number | null; adoType?: string | null;
  checkResult?: "passed" | "failed" | null; checkResolvedBy?: string | null; active?: boolean; approvedAt?: string | null;
};
export type TaskDetail = {
  task: Task & { workitemId: string; clientId: string; acceptance: { given: string; when: string; then: string }[]; adoSyncedAt: string | null };
  requirement: { id: string; key: string | null; title: string; phase: string; clientId: string };
  parent: { id: string; seq: number; intent: string; adoType: string | null } | null;
  children: TaskSlim[];
  blockedBy: TaskSlim[];
  blocks: TaskSlim[];
  repos: { id: string; name: string; adoRepoRef: string | null }[];
};
export const getTask = (id: string) => get<TaskDetail>(`/tasks/${id}`);
export const implementTask = (id: string) => post<{ runId: string; alreadyRunning: boolean }>(`/tasks/${id}/implement`, {});
export const getTaskRun = (id: string) => get<FlowRun>(`/tasks/${id}/flow-run`);
export type ImplementResult = {
  branch: string; dir: string; repoName: string | null; summary: string;
  filesChanged: string[]; commit: string | null; testsRun: string | null; followUps: string[];
  affectedConsumers: { path: string; usedBy: string[]; reason: string }[];
  /** Present when the run's task had checks bundled into its prompt —
   *  the routed-back, per-check verdict. */
  checks?: { seq: number; passed: boolean; detail: string; likelyCause: "implementation" | "requirement_ambiguity" | null }[];
};

/* ── Bug ↔ Task links (bug-change-request-lifecycle) ─────────────── */
export type LinkedTaskRow = { id: string; intent: string; requirementId: string; requirementTitle: string };
export const getBugLinks = (id: string) => get<{ tasks: LinkedTaskRow[] }>(`/workitems/${id}/bug-links`);
export const linkBugTask = (id: string, taskId: string) => post<{ linked: boolean }>(`/workitems/${id}/bug-links`, { taskId });
export const unlinkBugTask = (id: string, taskId: string) => del<{ unlinked: boolean }>(`/workitems/${id}/bug-links/${taskId}`);
export const searchClientTasks = (clientId: string, q: string) =>
  get<{ tasks: LinkedTaskRow[] }>(`/clients/${clientId}/tasks?${new URLSearchParams({ q })}`);

/* ── research/testing requirement work (requirement-types) ───────── */
export const startResearchWork = (id: string) =>
  post<{ taskId: string; materialized: boolean; materializeError?: string }>(`/workitems/${id}/research/start`, {});
export const finishResearchWork = (id: string, conclusion: string) =>
  post<{ finished: boolean }>(`/workitems/${id}/research/finish`, { conclusion });

/* ── repository AI enablement — the 16-stage onboarding pipeline
 * (`repository-ai-enablement`). Replaces the old 3-step
 * `repository-ai-management` flow entirely (2026-09-16) — its UI
 * (`RepoAiPanel.tsx`) and this client's `repo-ai/*` functions were
 * deleted; the backend `repo-ai/*` module and its data are left alone
 * for now, per the earlier decision to defer old-data cleanup. ────── */
export type OnboardingStatus = "Pending" | "Running" | "WaitingForUser" | "Completed" | "CompletedWithWarnings" | "Failed" | "Skipped" | "Cancelled";
export type OnboardingRun = {
  id: string; repoId: string; clientId: string; status: OnboardingStatus; currentStageKey: string | null;
  onboardingVersion: string; workspaceKind: string | null; workspacePath: string | null; defaultBranch: string | null;
  baselineSha: string | null; branchName: string | null; triggeredBy: string;
  startedAt: string; completedAt: string | null; cancelledAt: string | null; cancelledBy: string | null;
};
export type OnboardingStage = {
  id: string; runId: string; stageKey: string; stageOrder: number; status: OnboardingStatus; attempt: number;
  startedAt: string | null; completedAt: string | null; result: unknown; warnings: string[]; errors: string[];
  claudeExecutionId: string | null; sourceCommitSha: string | null; updatedAt: string;
};
export type OnboardingRunView = { run: OnboardingRun; stages: OnboardingStage[]; profile: unknown };
export const startOnboardingRun = (repoId: string) => post<{ runId: string }>(`/repos/${repoId}/onboarding/runs`, {});
export const getLatestOnboardingRun = (repoId: string) =>
  get<{ runId: string; status: OnboardingStatus; currentStageKey: string | null } | null>(`/repos/${repoId}/onboarding/latest-run`);
export const getOnboardingRun = (repoId: string, runId: string) => get<OnboardingRunView>(`/repos/${repoId}/onboarding/runs/${runId}`);
export const advanceOnboardingRun = (repoId: string, runId: string) =>
  post<{ runStatus: string; stageKey: string | null }>(`/repos/${repoId}/onboarding/runs/${runId}/advance`, {});
export const cancelOnboardingRun = (repoId: string, runId: string) =>
  post<{ cancelled: boolean }>(`/repos/${repoId}/onboarding/runs/${runId}/cancel`, {});
export const submitOnboardingStageInput = (repoId: string, runId: string, stageKey: string, input: unknown) =>
  post<{ runStatus: string; stageKey: string | null }>(`/repos/${repoId}/onboarding/runs/${runId}/stages/${stageKey}/input`, { input });
export type OnboardingRunCostSummary = { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number; totalDurationMs: number; executionCount: number };
export const getOnboardingRunCostSummary = (repoId: string, runId: string) =>
  get<OnboardingRunCostSummary>(`/repos/${repoId}/onboarding/runs/${runId}/cost-summary`);

/* ── global AI component catalog ──────────────────────────────────── */
export type AiComponentRow = { id: string; type: string; title: string; description: string | null; firstSeenAt: string; lastSeenAt: string; activeRepoCount: number };
export const getAiComponents = () => get<{ components: AiComponentRow[] }>("/ai-components");
export const getAiComponentRepos = (id: string) =>
  get<{ repos: { repoId: string; repoName: string; clientName: string | null; detectedPath: string; active: boolean; firstSeenAt: string; lastSeenAt: string; removedAt: string | null }[] }>(`/ai-components/${id}/repos`);
export const updateAiComponent = (id: string, body: { title?: string; description?: string | null }) =>
  patch<{ updated: boolean }>(`/ai-components/${id}`, body);
