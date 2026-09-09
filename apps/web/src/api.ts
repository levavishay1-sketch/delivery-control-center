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
export type Gap = { id: string; description: string; blocking: boolean; confidence: string; state: GapState; spunOffTo: string | null };
export type Blocker = { id: string; workitemId: string; questionType: string; question: string; answer: string | null; state: "open" | "answered" | "abandoned" };
export type Task = {
  id: string; seq: number; intent: string; appetite: string;
  state: "pending" | "in_progress" | "blocked" | "done" | "dropped";
  origin: "ai" | "human"; approvedAt: string | null; affectedPaths: string[];
};

export type WorkItem = {
  id: string; key: string | null; title: string; clientId: string; parentId: string | null;
  type: ReqType; phase: string;
  priority: "low" | "medium" | "high" | "critical"; risk: "low" | "medium" | "high";
  executor: "human" | "ai" | "mixed"; budgetUsd: string | null; dueDate: string | null;
  progressPct: number; linkedAdoId: number | null; adoAreaPath: string | null; startedWithOpenBlocker: boolean;
};
export type LinkedRepo = { id: string; name: string; adoRepoRef: string | null; linkKind: "declared" | "auto"; addedAt: string };
export type Attachment = { id: string; name: string; adoUrl: string | null; sizeBytes: number | null; source: "dcc" | "ado"; createdAt: string };
export type WorkItemDetail = {
  workitem: WorkItem; adoUrl: string | null; adoMissing?: boolean; attachments: Attachment[]; repos: LinkedRepo[]; gaps: Gap[]; blockers: Blocker[]; tasks: Task[];
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
  nodes: { id: string; key: string | null; title: string; phase: string; type: ReqType; parentId: string | null; openBlockingGaps: number; openBlockers: number; linkedAdoId: number | null }[];
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
export const getDetail = (id: string, verifyAdo = false) => get<WorkItemDetail>(`/workitems/${id}${verifyAdo ? "?verifyAdo=1" : ""}`);
export const getBrief = (id: string) => getText(`/workitems/${id}/brief`);
export const getFlow = (requirementId: string) => get<FlowData>(`/requirements/${requirementId}/flow`);
export const getInbox = (clientId: string) => get<{ events: EventRow[] }>(`/clients/${clientId}/inbox`);

export type AdoSyncResult = { synced: boolean; created?: boolean; adoId?: number; url?: string; error?: string };
export const createRequirement = (body: {
  clientId?: string; parentId?: string; title: string; type?: ReqType;
  priority?: string; risk?: string; executor?: string;
}) => post<WorkItem & { ado?: AdoSyncResult }>("/workitems", body);
export const syncToAdo = (id: string) => post<{ adoId: number; url: string; created: boolean }>(`/workitems/${id}/ado-sync`, {});
export type StartBuildResult = {
  key: string; branch: string;
  repos: { name: string; adoRepoRef: string | null; defaultBranch: string }[];
  openBlockingGaps: number; openBlockers: number; startedWithOpenBlocker: boolean;
};
export const startBuilding = (id: string) => post<StartBuildResult>(`/workitems/${id}/start`, {});
export const getUsers = () => get<{ users: { id: string; email: string; displayName: string }[] }>("/users");
export const assignRequirement = (id: string, body: { ownerId?: string; email?: string }) => post<{ assigned: boolean; ownerId: string }>(`/workitems/${id}/assign`, body);
export type AssessResult = { title: string; summary: string; baked: boolean; rationale: string; gaps: { description: string; blocking: boolean; confidence: number }[]; repoUsed: string | null };
export type BreakdownResult = {
  depth: number;
  tasks: {
    id: string; seq: number; intent: string; appetite: string; affectedPaths: string[];
    dependsOnSeq: number[]; parentSeq: number | null; level: number; adoType: string;
  }[];
};
export type TaskFlowNode = {
  id: string; seq: number; intent: string; appetite: string; state: string;
  adoType: string | null; level: number; parentTaskId: string | null;
  approved: boolean; linkedAdoId: number | null; adoUrl: string | null; affectedPaths: string[];
};
export type TaskFlow = { depth: number; nodes: TaskFlowNode[]; edges: { from: string; to: string; kind: "parent" | "depends" }[] };
export const getTaskFlow = (id: string) => get<TaskFlow>(`/workitems/${id}/task-flow`);
export type MaterializeResult = { created: number; skipped: number; links: number; items: { taskId: string; seq: number; adoId: number; adoType: string; url: string }[]; detail: string };
export const materializeTasks = (id: string) => post<MaterializeResult>(`/workitems/${id}/materialize`, {});
/** Agile ladder — the breakdown depth picks the rungs, leaves are always Task. */
export const ADO_LADDER = ["Epic", "Feature", "User Story", "Task"] as const;
export const startAssess = (id: string) => post<{ runId: string; alreadyRunning: boolean }>(`/workitems/${id}/assess`, {});
export const startBreakdown = (id: string) => post<{ runId: string; alreadyRunning: boolean }>(`/workitems/${id}/breakdown`, {});
export type FlowRun = {
  id: string | null; kind: "assess" | "breakdown" | null;
  state: "running" | "done" | "error" | "idle";
  lines: string[]; result: AssessResult | BreakdownResult | null; error: string | null;
  startedAt?: string | null; finishedAt?: string | null;
};
export const getFlowRun = (id: string) => get<FlowRun>(`/workitems/${id}/flow-run`);
export const approveTask = (id: string, body: { clientId: string; intent?: string; appetite?: "small" | "standard" | "large" }) => post<{ approved: boolean }>(`/tasks/${id}/approve`, body);
export const rejectTask = (id: string, clientId: string) => post<{ rejected: boolean }>(`/tasks/${id}/reject`, { clientId });
export const updateRequirement = (id: string, body: Partial<{
  title: string; type: ReqType; priority: string; risk: string; executor: string; phase: string;
  budgetUsd: string | number | null; dueDate: string | null; parentId: string | null; adoAreaPath: string | null; key: string | null;
}>) => patch<WorkItem>(`/workitems/${id}`, body);
export const deleteRequirement = (id: string) => del<{ deleted: boolean; ado?: { ok: boolean; detail: string } }>(`/workitems/${id}`);

// entity edit/delete
export const updateClient = (id: string, body: Partial<{ name: string; connectorType: string; adoProjectRef: string | null }>) => patch<{ updated: boolean }>(`/clients/${id}`, body);
export const deleteClient = (id: string, archive = false) => del<{ deleted?: boolean; archived?: boolean }>(`/clients/${id}${archive ? "?mode=archive" : ""}`);
export const updateRepo = (id: string, body: Partial<{ name: string; adoRepoRef: string | null; defaultBranch: string }>) => patch<{ updated: boolean }>(`/repos/${id}`, body);
export const deleteRepo = (id: string) => del<{ deleted: boolean }>(`/repos/${id}`);
export const unlinkClientRepo = (clientId: string, repoId: string) => del<{ unlinked: boolean }>(`/clients/${clientId}/repos/${repoId}`);
export const updateConnection = (clientId: string, id: string, body: Partial<{ orgUrl: string; project: string; pat: string }>) => patch<{ updated: boolean }>(`/clients/${clientId}/connections/${id}`, body);
export const linkRepoToReq = (wiId: string, body: { repoId?: string; name?: string; gitUrl?: string; linkKind?: "declared" | "auto" }) => post<{ linked: boolean }>(`/workitems/${wiId}/repos`, body);
export const unlinkRepoFromReq = (wiId: string, repoId: string) => del<{ unlinked: boolean }>(`/workitems/${wiId}/repos/${repoId}`);
export const deleteDependency = (wiId: string, depId: string) => del<{ deleted: boolean }>(`/workitems/${wiId}/depends-on/${depId}`);
export const updateGap = (id: string, body: { clientId: string; description?: string; blocking?: boolean }) => patch<{ updated: boolean }>(`/gaps/${id}`, body);
export const deleteGap = (id: string, clientId: string) => del<{ deleted: boolean }>(`/gaps/${id}`, { clientId });
export const updateBlocker = (id: string, body: { clientId: string; question?: string; questionType?: string }) => patch<{ updated: boolean }>(`/blockers/${id}`, body);
export const deleteBlocker = (id: string, clientId: string) => del<{ deleted: boolean }>(`/blockers/${id}`, { clientId });
export const updateTask = (id: string, body: { clientId: string; intent?: string; appetite?: "small" | "standard" | "large" }) => patch<{ updated: boolean }>(`/tasks/${id}`, body);
export const deleteTask = (id: string, clientId: string) => del<{ deleted: boolean }>(`/tasks/${id}`, { clientId });
export const correctNote = (workitemId: string, corrects: string, body: string) => post<{ eventId: string }>("/events", { workitemId, kind: "note", note: { body, source: "manual", corrects } });
export type ImportResult = { total: number; created: number; skipped: number; items: { adoId: number; title: string; status: "created" | "skipped-exists" | "skipped-bad" }[] };
export const importAdoCsv = (clientId: string, csv: string) => post<ImportResult>(`/clients/${clientId}/import/ado-csv`, { csv });
export type SyncAllResult = { total: number; created: number; failed: number; items: { title: string; ok: boolean; adoId?: number; url?: string; error?: string }[] };
export const syncAllToAdo = (clientId: string) => post<SyncAllResult>(`/clients/${clientId}/sync-all-to-ado`, {});
export type PullResult = { created: number; updated: number; deleted: number; attachmentsAdded: number; detail: string };
export const syncFromAdo = (clientId: string) => post<PullResult>(`/clients/${clientId}/sync-from-ado`, {});
export const uploadAttachment = (workitemId: string, name: string, contentBase64: string) =>
  post<{ id: string; name: string; adoUrl: string | null }>(`/workitems/${workitemId}/attachments`, { name, contentBase64 });

export const verifyGap = (gapId: string, body: { outcome: GapState; clientId: string; spunOffTitle?: string; answer?: string }) =>
  post(`/gaps/${gapId}/verify`, body);
export const answerBlocker = (blockerId: string, body: { answer: string; clientId: string }) =>
  post(`/blockers/${blockerId}/answer`, body);
export const progressTask = (taskId: string, body: { to: Task["state"]; clientId: string }) =>
  post(`/tasks/${taskId}/progress`, { ...body, mode: "interactive" });
