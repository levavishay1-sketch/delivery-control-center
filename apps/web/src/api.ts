import type { FileVersionsData } from "./components/FileCompare.tsx";
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
const put = <T,>(p: string, body: unknown) =>
  fetch(`/api${p}`, { method: "PUT", headers: H, body: JSON.stringify(body) }).then((r) => j<T>(r));
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
export type Attachment = {
  id: string; name: string; adoUrl: string | null; sizeBytes: number | null; source: "dcc" | "ado"; createdAt: string;
  /** DCC holds the bytes (so the file can be opened and read into a prompt). */
  stored: boolean;
  /** How much text was read out of it — 0 ⇒ none, and `extractError` says why. */
  textChars: number;
  extractError: string | null;
};
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

/* ── Claude: the ledger and its control center (claude-in-dcc §8, §9) ── */
export type ClaudeCallView = {
  id: string; startedAt: string; finishedAt: string; durationMs: number | null;
  clientId: string; clientName: string; userId: string; userName: string;
  entityKind: string; entityId: string | null; workitemId: string | null; workitemTitle: string | null; screen: string | null;
  capability: string; trigger: string; label: string;
  conversationId: string | null; messageId: string | null; parentCallId: string | null;
  modelRequested: string | null; modelUsed: string | null; effort: string | null; policyVersion: number | null; policyRule: string | null; numTurns: number | null;
  inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number; costUsd: number; priceListVersion: number | null;
  outcome: string; errorText: string | null; unanswered: boolean; sourceRef: string | null;
  meta: Record<string, unknown>;
};
export type CenterBar = { key: string; label: string; usd: number; calls: number };
export type ClaudeOverview = {
  month: string;
  tiles: {
    costUsd: number; calls: number; budgetPct: number | null;
    questions: number; answeredWithoutModel: number; answeredWithoutModelPct: number;
    unhelpful: number; unhelpfulPct: number; reasked: number;
    errors: number; timeouts: number; escalated: number; unanswered: number;
  };
  byClient: CenterBar[]; byCapability: CenterBar[]; byModel: CenterBar[]; byScreen: CenterBar[];
  byUser: (CenterBar & { questions: number; withoutModelPct: number; unhelpfulPct: number })[];
  policy: { version: number; defaults: number; escalated: number; manual: number; capped: number };
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number; cacheSharePct: number };
  chat: { calls: number; costPerQuestionUsd: number | null; tokensPerTurn: number | null; rollovers: number; rolloverCostUsd: number; archived: number };
  chatByScreen: { screen: string; questions: number; withoutModel: number; withoutModelPct: number; unhelpful: number; unhelpfulPct: number }[];
  escalationByCapability: { capability: string; escalated: number; total: number; pct: number }[];
};
export type CenterQuery = Partial<{ month: string; clientId: string; userId: string; capability: string; model: string; outcome: string; escalated: "1"; workitemId: string; limit: number; offset: number }>;
const qs = (q: CenterQuery) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ""; };
export const getClaudeOverview = (q: CenterQuery) => get<ClaudeOverview>(`/claude/overview${qs(q)}`);
export const getClaudeCalls = (q: CenterQuery) => get<{ rows: ClaudeCallView[]; total: number; month: string }>(`/claude/calls${qs(q)}`);
export const getClaudeCall = (id: string) => get<ClaudeCallView>(`/claude/calls/${id}`);
/** Every call behind a requirement's total, all time — one ledger row each. */
export const getWorkitemCalls = (id: string) => get<{ calls: ClaudeCallView[] }>(`/workitems/${id}/calls`);

/* the one chat (claude-in-dcc §4) */
/** `gaps` — the conversation about one requirement's open gaps (id = the requirement). */
export type TopicRef = { kind: "wi" | "task" | "pr" | "run" | "app" | "gaps"; id?: string | null };
export type ChatContext = { screen?: string | null; facts?: Record<string, unknown>; suggestions?: string[]; actions?: string[]; place?: string | null };
export type ChatMessage = {
  id: string; conversationId: string; role: string; kind: string; text: string; source: string;
  callId: string | null; payload: Record<string, unknown>; helpful: boolean | null; helpfulSource: string | null; createdAt: string;
  cost: { model: string | null; effort: string | null; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number } | null;
};
export type ConversationView = {
  id: string; clientId: string; clientName: string | null; topicKey: string; topicKind: string; topicId: string | null; topicTitle: string;
  status: string; continuedFrom: string | null; continuesAs: string | null; createdBy: string; createdByName: string | null;
  lastMessageAt: string; createdAt: string; retainUntil: string | null; messageCount: number; costUsd: number; calls: number; lastText: string | null;
};
/** One explained concept — the same entry the "i" opens and the chat answers with (packages/core/src/glossary). */
export type Concept = { key: string; title: string; aliases?: string[]; explain: string; press?: string; kind: "button" | "term" | "field" | "section" };
export type ScreenGlossary = { screen: string; about: string; entries: Concept[] };
export type ChatOpen = { topic: { key: string; kind: string; id: string | null; title: string; screen: string }; conversation: ConversationView | null; messages: ChatMessage[]; glossary: ScreenGlossary | null; suggestions: string[] };
export type ChatAnswer = { conversation: ConversationView; messages: ChatMessage[]; rolledOver: boolean; suggestions: string[] };
export const openChat = (body: { topic: TopicRef; context?: ChatContext }) => post<ChatOpen>("/claude/chat/open", body);
export const askChat = (body: { topic: TopicRef; context?: ChatContext; question: string }) => post<ChatAnswer>("/claude/chat/ask", body);
export const markHelpful = (messageId: string, helpful: boolean, note?: string) => post<{ helpful: boolean }>(`/claude/messages/${messageId}/helpful`, { helpful, note });
export const getConversations = (q: { clientId?: string; userId?: string; limit?: number } = {}) => get<{ conversations: ConversationView[] }>(`/claude/conversations${qs(q as CenterQuery)}`);
export const getConversation = (id: string) => get<{ conversation: ConversationView; messages: ChatMessage[]; topic: TopicRef; suggestions: string[]; glossary: ScreenGlossary | null }>(`/claude/conversations/${id}`);
export const getConcepts = () => get<{ concepts: Concept[] }>("/claude/glossary");
/* actions through the chat (claude-in-dcc §5): a proposal is a message; running it is the person's click */
export type ProposalPayload = {
  key: string; title: string; describe: string; params: Record<string, unknown>; consequential: boolean;
  estimate: { capability: string; model: string; effort: string; usd: number | null } | null;
  status: "proposed" | "running" | "done" | "cancelled" | "failed"; result?: unknown; error?: string; ranAt?: string; recorded?: string;
  /** The approve button's words, when "אשר והרץ" would say the wrong thing (closing a gap). */
  approveLabel?: string;
};
export type DeclaredCostPayload = {
  reason: string; question: string; estimate: { model: string; effort: string; usdMin: number; usdMax: number };
  /** What the reading will open — a request's own change is not a local copy of the repository. */
  reads?: string;
  status: "proposed" | "running" | "done" | "cancelled" | "failed"; error?: string;
};
export const runProposal = (messageId: string) => post<{ message: ChatMessage }>(`/claude/proposals/${messageId}/run`, {});
export const cancelProposal = (messageId: string) => post<{ message: ChatMessage }>(`/claude/proposals/${messageId}/cancel`, {});
export const getProposalPreview = (messageId: string) => get<{ prompt: string; promptHe: string }>(`/claude/proposals/${messageId}/preview`);
export const runCodeQuestion = (messageId: string) => post<{ message: ChatMessage; answer: ChatMessage }>(`/claude/messages/${messageId}/run-code`, {});
export const cancelCodeQuestion = (messageId: string) => post<{ message: ChatMessage }>(`/claude/messages/${messageId}/run-code/cancel`, {});

/* conclusions and the policy editor (claude-in-dcc §9.3–§9.4, §9.9–§9.10) */
export type InsightCluster = {
  id: string | null; clientId: string; clientName: string; screen: string; questionKey: string; sampleQuestion: string;
  count: number; firstAskedAt: string; lastAskedAt: string; aboveThreshold: boolean;
  finding: string | null; recommendation: string | null; status: "new" | "open" | "task_opened" | "dismissed";
  workitemId: string | null; analysedCount: number | null; analysedAt: string | null;
  /** The element whose "i" the question is about, when it names one. */
  concept: { key: string; title: string; explain: string } | null;
};
export type InsightCallRow = {
  id: string; startedAt: string; clientName: string; userName: string; screen: string | null; capability: string; label: string;
  modelUsed: string | null; policyRule: string | null; costUsd: number; outcome: string; errorText: string | null; conversationId: string | null; workitemId: string | null;
};
export type UnhelpfulRow = { id: string; createdAt: string; clientName: string; screen: string; question: string | null; answer: string; note: string | null; source: string | null; conversationId: string };
export type InsightsView = {
  month: string; threshold: number; estimate: { model: string; effort: string; usd: number | null };
  clusters: InsightCluster[]; unanswered: InsightCallRow[]; unhelpful: UnhelpfulRow[]; failed: InsightCallRow[]; escalated: InsightCallRow[];
};
export const getInsights = (q: CenterQuery) => get<InsightsView>(`/claude/insights${qs(q)}`);
export const analyseInsights = (body: { month?: string; clientId?: string }) => post<{ analysed: number; callId: string | null; costUsd: number | null; clusters: InsightCluster[] }>("/claude/insights/analyse", body);
export const openImprovementTask = (id: string) => post<{ workitemId: string; created: boolean }>(`/claude/insights/${id}/task`, {});
export const dismissInsight = (id: string) => post<{ status: string }>(`/claude/insights/${id}/dismiss`, {});

export type PolicyCapability = { default: string; effort?: string; maxUsdPerCall?: number; maxInputTokens?: number; escalateOn?: Record<string, unknown>[]; downgradeOn?: Record<string, unknown>[] };
export type PolicyPrice = { input: number; cacheWrite: number; cacheRead: number; output: number };
export type PolicyDoc = {
  version: number;
  tiers: Record<string, { model: string; maxUsdPerCall: number }>;
  /** `$comment` keys ride along from the file — a value that is a string is one of those. */
  prices: Record<string, PolicyPrice | string>;
  capabilities: Record<string, PolicyCapability | string>;
  chat: { rolloverInputTokens: number; rolloverColdDays: number; retentionDays: number; declareCostAboveUsd: number; insightsMinRepeats: number };
  guardrails: { killAfterStuckIterations: number; budgetWarnAtFraction: number };
};
export type PolicyChange = { path: string; from?: unknown; to?: unknown };
export type PolicyView = {
  policy: PolicyDoc;
  lastChange: { at: string; byName: string | null; fromVersion: number; toVersion: number; changes: PolicyChange[] } | null;
  retention: { defaultDays: number; clients: { clientId: string; clientName: string; days: number | null }[] };
};
export const getPolicy = () => get<PolicyView>("/claude/policy");
export const putPolicy = (patch: Record<string, unknown>) => put<{ policy: PolicyDoc; changes: PolicyChange[] }>("/claude/policy", patch);
export const setClientRetention = (clientId: string, days: number | null) => put<{ clientId: string; days: number | null }>(`/clients/${clientId}/claude-retention`, { days });
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
export const deleteClient = (id: string) => del<{ deleted: boolean }>(`/clients/${id}`);
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
  post<{ id: string; name: string; adoUrl: string | null; textChars: number; extractError: string | null }>(
    `/workitems/${workitemId}/attachments`, { name, contentBase64 },
  );
export const attachmentHref = (workitemId: string, attachmentId: string) =>
  `/api/workitems/${workitemId}/attachments/${attachmentId}/content`;

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

/* ── repository onboarding — four stages around one live Claude Code
 * session (`repository-onboarding-native-init`). ── */
export type OnboardingStatus = "Pending" | "Running" | "WaitingForUser" | "Completed" | "Failed" | "Cancelled";
export type OnboardingStageKey = "prepare" | "init" | "review" | "deliver";
export type OnboardingStageDefinition = {
  key: OnboardingStageKey; order: number; kind: "deterministic" | "ai" | "human"; gate: boolean;
  title_he: string; short_he: string; why_he: string; what_he: string; output_he: string;
};
export type AutomationPreset = "step_by_step" | "guided" | "automatic" | "custom";
export type StageAutomation = { run: "auto" | "manual"; gate?: "auto" | "human" };
export type AutomationPolicy = { preset: AutomationPreset; stages: Record<OnboardingStageKey, StageAutomation> };
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ModelChoice = { model?: string; effort?: Effort };
export type ModelPolicy = Partial<Record<OnboardingStageKey, ModelChoice>>;
export type SessionState = "none" | "live" | "ended" | "disconnected";
export type OnboardingSession = {
  id?: string; state: SessionState; startedAt?: string; endedAt?: string; exitCode?: number | null; model?: string; effort?: string;
  apiCalls?: number;
  status?: { costUsd: number; apiDurationMs: number; inputTokens: number; outputTokens: number; model: string | null; effort: string | null; linesAdded: number; linesRemoved: number };
};
export type ChangedFile = { path: string; status: string; additions: number; deletions: number };
export type ExistingSetup = { claudeMdLines: number | null; agentsMd: boolean; rules: number; skills: number; hooks: number; agents: number; settings: boolean };
export type PrepareResult = {
  branch: string; baselineSha: string;
  /** The main line the copy was cut from, and the one its request will target. */
  defaultBranch: string | null;
  /** Where that came from: the remote's main line, a local one, or the copy's current branch when neither was found. */
  baseFrom: "remote" | "local" | "head";
  fileCount: number; existing: ExistingSetup;
};
export type InitResult = { sessionId: string; changedFiles: number; completedBy: string; auto?: boolean };
export type ReviewResult = { changedFiles: ChangedFile[]; checkedAt: string; approvedBy?: string; approvedAt?: string; auto?: boolean; notes?: Record<string, { text: string; sig: string }> };
export type DeliverResult = {
  branch: string; base: string; commitSha: string | null; filesCommitted: number; remote: string | null; pushed: boolean;
  prNumber: number | null; prUrl: string | null; compareUrl: string | null; localOnly: boolean; note?: string;
};
export type OnboardingRun = {
  id: string; repoId: string; clientId: string; status: OnboardingStatus; currentStageKey: OnboardingStageKey | null;
  workspacePath: string | null; defaultBranch: string | null; baselineSha: string | null; branchName: string | null;
  session: OnboardingSession; triggeredBy: string; startedAt: string; completedAt: string | null; cancelledAt: string | null;
};
export type OnboardingStage = {
  id: string; stageKey: OnboardingStageKey; stageOrder: number; status: OnboardingStatus;
  startedAt: string | null; completedAt: string | null; result: unknown; errors: string[]; updatedAt: string;
};
export type OnboardingEvent = { id: string; type: string; payload: Record<string, unknown>; actorUserId: string | null; occurredAt: string };
export type OnboardingCost = {
  /** Ledger rows for this run plus what the live process spent since the last slice (`liveUsd`, not yet recorded). */
  totalCostUsd: number; liveUsd: number; apiCalls: number; inputTokens: number; outputTokens: number; apiDurationMs: number;
  /** What the chat has cost on this run — its own ledger rows, not part of the session. */
  chat: { costUsd: number; calls: number; inputTokens: number; outputTokens: number } | null;
  byStage: { stageKey: string; model: string | null; effort: string | null; costUsd: number }[];
  calls: ClaudeCallView[];
};
export type CodeMapPlace = "cloud" | "local" | "both";
export type CodeMapNodeKind = "other" | "ours" | "attention" | "current" | "merge" | "branchPoint" | "pr" | "uncommitted" | "empty";
export type CodeMapNode = {
  kind: CodeMapNodeKind; heading?: string; title?: string; sha?: string; subject?: string; author?: string; at?: string;
  files?: number; url?: string; detail?: string; folder?: string; message?: string;
  /** The same pull request inside DCC (a `#/…` address). */
  dccPath?: string;
  /** For a merge: the commits it brought in, oldest first. */
  brought?: { sha: string; subject: string }[];
};
export type CodeMapLane = { id: string; label?: string; note?: string; place?: CodeMapPlace; nodes: CodeMapNode[]; from?: { lane: string; at: number }; name?: string; url?: string; detail?: string; folder?: string };
export type CodeMapArrow = { from: string; to: string; label: string; state: "done" | "pending" };
/** The one drawing DCC uses wherever git is involved; built on the server. */
export type CodeMap = { lanes: CodeMapLane[]; arrows: CodeMapArrow[]; caption?: string; problem?: { text: string; folder?: string } };
export const getTaskCodeMap = (taskId: string) => get<{ codeMap: CodeMap | null; branch: string | null; reason?: string }>(`/tasks/${taskId}/code-map`);

export type PullRequestRow = {
  id: string; provider: "github" | "ado"; number: number; title: string; url: string;
  state: "open" | "merged" | "closed"; draft: boolean; author: string; headBranch: string; baseBranch: string;
  createdAt: string; updatedAt: string; closedAt: string | null; changedFiles: number; additions: number; deletions: number;
  mergeable: boolean | null; conflicts: boolean; review: "approved" | "changes_requested" | "none";
  checks: "passing" | "failing" | "running" | "none"; parentId: string | null;
  repo: { id: string; name: string }; client: { id: string | null; name: string | null };
  flags: { key: string; text: string; tone: "critical" | "warning" | "healthy" | "neutral" }[]; waitingHours: number;
};
export type PullRequestList = {
  rows: PullRequestRow[];
  /** Recently merged and closed requests. */
  history: PullRequestRow[];
  repos: { id: string; name: string; clientId: string | null; clientName: string | null; provider: "github" | "ado" | null; reason?: string }[];
  syncedAt: string; problems: { repo: string; reason: string }[];
};
export type PrBlocker = { key: string; ok: boolean | null; title: string; detail: string };
export type NextStep = { title: string; detail: string; action: "update_branch" | "request_review" | "merge" | "open_host" | "wait" | "done" };
export type PullRequestFile = { path: string; status: string; additions: number; deletions: number; note?: string; from?: string };
export type FileGroup = { key: string; title: string; note?: string; files: PullRequestFile[]; additions: number; deletions: number };
export type TimelineItem = { at: string; kind: string; text: string; detail?: string; tag?: string; tone?: "warning" | "healthy" | "neutral" };
/** Which files clash. `exact`: they are the ones that really conflict; otherwise they are only the files both sides changed. */
export type ConflictFile = { path: string; ours: { additions: number; deletions: number } | null; theirs: { additions: number; deletions: number } | null };
export type ConflictView = { exact: boolean; files: ConflictFile[] };
export type PullRequestDetail = {
  pr: PullRequestRow;
  conflict: ConflictView | null;
  blockers: PrBlocker[];
  nextStep: NextStep;
  codeMap: CodeMap | null;
  codeMapProblem: string | null;
  freshness: { behind: number; sharedFiles: number; ahead: number; baseBranch: string } | null;
  groups: FileGroup[];
  topics: { title: string; detail: string }[];
  refs: { base: string; head: string } | null;
  fileCount: number;
  timeline: TimelineItem[];
  body: string;
};
export type ReviewDecision = "comment" | "approve" | "request_changes";
export const submitPullRequestReview = (repoId: string, number: number, decision: ReviewDecision, text: string) =>
  post<{ posted: true }>(`/repos/${repoId}/pull-requests/${number}/review`, { decision, text });
export const mergePullRequest = (repoId: string, number: number) =>
  post<{ merged: true }>(`/repos/${repoId}/pull-requests/${number}/merge`, {});
export const getPullRequestFile =(repoId: string, number: number, path: string) =>
  get<FileVersionsData>(`/repos/${repoId}/pull-requests/${number}/file?${new URLSearchParams({ path })}`);

/** What the two sides wrote where they disagree, and the decision that settles it. */
export type ConflictSegment = { kind: "text"; text: string } | { kind: "conflict"; ours: string; theirs: string };
export type ConflictFileContent = { path: string; content: string; segments: ConflictSegment[]; conflicts: number; resolvable: boolean; why?: string; oursFile: string; theirsFile: string };
export type ConflictContent = { head: string; base: string; headSha: string; baseSha: string; files: ConflictFileContent[]; needsCommandLine: boolean };
export const getPullRequestConflict = (repoId: string, number: number) =>
  get<ConflictContent>(`/repos/${repoId}/pull-requests/${number}/conflict`);
/** The repository's own checks, run on the merged result before anything is pushed. */
export type CheckResult = { name: string; command: string; ok: boolean; skipped?: string; ms: number; output: string };
export type VerifyResult = { ran: boolean; why?: string; commit: string; checks: CheckResult[] };
export const verifyPullRequestConflict = (repoId: string, number: number, files: { path: string; content: string }[]) =>
  post<VerifyResult>(`/repos/${repoId}/pull-requests/${number}/conflict/verify`, { files });
export const resolvePullRequestConflict = (repoId: string, number: number, files: { path: string; content: string }[]) =>
  post<{ commitSha: string; branch: string; base: string; files: number }>(`/repos/${repoId}/pull-requests/${number}/conflict/resolve`, { files });

/** Every branch of a repository and what to do about it. */
export type BranchHealth = {
  name: string; status: "default" | "merged" | "open_pr" | "work" | "stale";
  unique: number; behind: number; pr: { number: number; state: string; draft: boolean } | null;
  lastAt: string | null; lastBy: string | null; lastMessage: string | null; origin: string;
  advice: { title: string; detail: string; tone: "healthy" | "warning" | "critical" | "neutral" }; url: string | null;
};
export type RepoBranches = { defaultBranch: string; rows: BranchHealth[]; syncedAt: string };
export const getRepoBranches = (repoId: string, refresh?: boolean) => get<RepoBranches>(`/repos/${repoId}/branches${refresh ? "?refresh=1" : ""}`);

export const listPullRequests = (refresh?: boolean) => get<PullRequestList>(`/pull-requests${refresh ? "?refresh=1" : ""}`);
export type PullRequestQuick = { pr: PullRequestRow; blockers: PrBlocker[]; nextStep: NextStep };
export const getPullRequestQuick = (repoId: string, number: number) => get<PullRequestQuick>(`/repos/${repoId}/pull-requests/${number}/quick`);

/** What the screen already has, so switching tabs paints at once instead of asking again. */
const prDetails = new Map<string, PullRequestDetail>();
const prInflight = new Map<string, Promise<PullRequestDetail>>();
export const cachedPullRequest = (repoId: string, number: number) => prDetails.get(`${repoId}:${number}`) ?? null;
export function getPullRequest(repoId: string, number: number, refresh?: boolean): Promise<PullRequestDetail> {
  const key = `${repoId}:${number}`;
  const running = prInflight.get(key);
  // Two mounts of the same screen — a tab switch, or React mounting twice in development — share one call.
  if (running && !refresh) return running;
  const p = get<PullRequestDetail>(`/repos/${repoId}/pull-requests/${number}${refresh ? "?refresh=1" : ""}`)
    .then((d) => { prDetails.set(key, d); return d; })
    .finally(() => { if (prInflight.get(key) === p) prInflight.delete(key); });
  prInflight.set(key, p);
  return p;
}

export const openFolder = (path: string) => post<{ opened: string }>("/open-folder", { path });

export type OnboardingRunView = {
  repo: { id: string; name: string }; run: OnboardingRun; stages: OnboardingStage[]; events: OnboardingEvent[];
  definitions: OnboardingStageDefinition[]; automation: AutomationPolicy; modelChoices: ModelPolicy;
  recommended: { init: { model: string; effort: Effort } }; codeMap: CodeMap | null; cost: OnboardingCost;
};
export type OnboardingRunSummary = { id: string; status: OnboardingStatus; currentStageKey: OnboardingStageKey | null; startedAt: string; completedAt: string | null; branchName: string | null };

const ob = (repoId: string, runId: string) => `/repos/${repoId}/onboarding/runs/${runId}`;
export const getOnboardingStages = () => get<{ stages: OnboardingStageDefinition[]; recommended: { init: { model: string; effort: Effort } } }>("/onboarding/stages");
export const startOnboardingRun = (repoId: string, body: { automation?: AutomationPolicy | { preset: AutomationPreset }; modelChoices?: ModelPolicy; consent?: boolean }) =>
  post<{ runId: string }>(`/repos/${repoId}/onboarding/runs`, body);
export const getLatestOnboardingRun = (repoId: string) =>
  get<{ runId: string; status: OnboardingStatus; currentStageKey: OnboardingStageKey | null; completedAt: string | null } | null>(`/repos/${repoId}/onboarding/latest-run`);
export const listOnboardingRuns = (repoId: string) => get<{ runs: OnboardingRunSummary[] }>(`/repos/${repoId}/onboarding/runs`);
export const getOnboardingRun = (repoId: string, runId: string) => get<OnboardingRunView>(ob(repoId, runId));
export const runOnboardingStage = (repoId: string, runId: string, stageKey: OnboardingStageKey) => post<{ started: string }>(`${ob(repoId, runId)}/stages/${stageKey}/run`, {});
export const resumeOnboardingSession = (repoId: string, runId: string) => post<{ resumed: boolean }>(`${ob(repoId, runId)}/session/resume`, {});
export const refreshOnboardingReview = (repoId: string, runId: string) => post<{ changedFiles: ChangedFile[] }>(`${ob(repoId, runId)}/review/refresh`, {});
export const approveOnboardingReview =(repoId: string, runId: string) => post<{ approved: boolean }>(`${ob(repoId, runId)}/review/approve`, {});
export const cancelOnboardingRun = (repoId: string, runId: string) => post<{ cancelled: boolean }>(`${ob(repoId, runId)}/cancel`, {});
export const updateOnboardingAutomation = (repoId: string, runId: string, automation: AutomationPolicy | { preset: AutomationPreset }, consent?: boolean) =>
  patch<AutomationPolicy>(`${ob(repoId, runId)}/automation`, { automation, consent });
export const updateOnboardingModelChoices = (repoId: string, runId: string, choices: ModelPolicy) => patch<ModelPolicy>(`${ob(repoId, runId)}/model-choices`, { choices });
export const getOnboardingFile = (repoId: string, runId: string, path: string) =>
  get<FileVersionsData>(`${ob(repoId, runId)}/file?${new URLSearchParams({ path })}`);
/** The run's terminal socket, through the same `/api` proxy as every call. */
export const onboardingTerminalUrl = (repoId: string, runId: string) =>
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api${ob(repoId, runId)}/terminal`;
/** A WebSocket cannot carry headers — its first message carries the same credentials. */
export const terminalAuthMessage = () => JSON.stringify({ type: "auth", token: HOOK_TOKEN, email: DEV_EMAIL });
