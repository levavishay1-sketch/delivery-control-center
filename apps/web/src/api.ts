const DEV_EMAIL = import.meta.env.VITE_DCC_DEV_EMAIL ?? "you@dcc.local";
const HOOK_TOKEN = import.meta.env.VITE_DCC_HOOK_TOKEN ?? "dev-secret";
const H = { "content-type": "application/json", "x-dcc-hook-token": HOOK_TOKEN, "x-dcc-dev-email": DEV_EMAIL };

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
const get = <T,>(p: string) => fetch(`/api${p}`, { headers: H }).then((r) => j<T>(r));
const post = <T,>(p: string, body: unknown) =>
  fetch(`/api${p}`, { method: "POST", headers: H, body: JSON.stringify(body) }).then((r) => j<T>(r));
export const getText = (p: string) => fetch(`/api${p}`, { headers: H }).then((r) => r.text());

// ---------- types ----------
export type EventRow = {
  id: string; workitemId: string | null; occurredAt: string; recordedAt: string;
  source: string; type: string; actor: { kind: string; triggeredBy?: string };
  payload: Record<string, unknown>; supersedes: string | null; links: { rel: string; ref: string }[];
};
export type Gap = { id: string; description: string; blocking: boolean; confidence: string; state: "proposed" | "verified" | "dismissed" | "spun_off"; spunOffTo: string | null };
export type Blocker = { id: string; workitemId: string; questionType: string; question: string; answer: string | null; state: "open" | "answered" | "abandoned" };
export type Task = { id: string; seq: number; intent: string; appetite: string; state: "pending" | "in_progress" | "blocked" | "done" | "dropped" };

export type WorkItem = {
  id: string; key: string | null; title: string; clientId: string; projectId: string;
  kind: "project" | "task" | "bug" | "change"; phase: string;
  priority: "low" | "medium" | "high" | "critical"; risk: "low" | "medium" | "high";
  executor: "human" | "ai" | "mixed"; budgetUsd: string | null; dueDate: string | null;
  progressPct: number; linkedAdoId: number | null; startedWithOpenBlocker: boolean;
};
export type WorkItemDetail = {
  workitem: WorkItem; gaps: Gap[]; blockers: Blocker[]; tasks: Task[];
  taskDependencies: { taskId: string; dependsOnTaskId: string; reason: string | null }[];
  events: EventRow[];
};

export type Dashboard = {
  stats: {
    activeProjects: number; projectsDelta: number;
    openItems: number; itemsDelta: number;
    blockedItems: number;
    aiCostUsd: number; aiBudgetUsd: number; aiBudgetPct: number;
  };
  projects: {
    id: string; name: string; status: "planning" | "active" | "blocked" | "done";
    connectorType: "manual" | "ado" | "github" | "jira" | "dcc";
    clientName: string; budgetUsd: number | null; aiCostUsd: number; items: number;
    members: { id: string; name: string }[];
  }[];
  recentWorkItems: {
    id: string; key: string | null; title: string; kind: WorkItem["kind"]; priority: string;
    projectName: string; ownerName: string; updatedAt: string;
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
    projectName: string | null; clientName: string | null;
  }[];
};

export type FlowData = {
  nodes: { id: string; key: string | null; title: string; phase: string; level: string; openBlockingGaps: number; openBlockers: number; linkedAdoId: number | null }[];
  edges: { from: string; to: string; kind: string; reason: string | null; adoSynced: boolean }[];
};

// ---------- calls ----------
export const getDashboard = () => get<Dashboard>("/dashboard");
export const getAudit = (q: Record<string, string>) =>
  get<AuditPage>(`/audit?${new URLSearchParams(q).toString()}`);

export type WorkListRow = {
  id: string; key: string | null; title: string; kind: WorkItem["kind"]; phase: string;
  priority: string; risk: string; updatedAt: string; projectName: string; clientName: string;
  ownerName: string; openBlockers: number;
};
export const getWorkList = () => get<{ items: WorkListRow[] }>("/list/workitems");
export const getProjectList = () => get<{ projects: { id: string; name: string; status: string; connectorType: string; budgetUsd: string | null; clientName: string; items: number; updatedAt: string | null }[] }>("/list/projects");
export const getBudgets = () => get<{ budgets: { clientId: string; clientName: string; monthlyUsd: number; spentUsd: number; pct: number }[] }>("/list/budgets");
export const getAlerts = () => get<{ alerts: { id: string; kind: string; severity: string; title: string; body: string | null; createdAt: string; workitemId: string | null }[] }>("/list/alerts");
export const listWorkItems = () => get<{ id: string; key: string | null; title: string; phase: string }[]>("/dev/workitems");
export const getDetail = (id: string) => get<WorkItemDetail>(`/workitems/${id}`);
export const getBrief = (id: string) => getText(`/workitems/${id}/brief`);
export const getFlow = (projectId: string) => get<FlowData>(`/projects/${projectId}/flow`);
export const getInbox = (clientId: string) => get<{ events: EventRow[] }>(`/clients/${clientId}/inbox`);

export const verifyGap = (gapId: string, body: { outcome: "verified" | "dismissed" | "spun_off"; clientId: string; spunOffTitle?: string }) =>
  post(`/gaps/${gapId}/verify`, body);
export const answerBlocker = (blockerId: string, body: { answer: string; clientId: string }) =>
  post(`/blockers/${blockerId}/answer`, body);
export const progressTask = (taskId: string, body: { to: Task["state"]; clientId: string }) =>
  post(`/tasks/${taskId}/progress`, { ...body, mode: "interactive" });
