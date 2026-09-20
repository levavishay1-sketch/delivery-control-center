import type { Effort } from "../routing.ts";

/**
 * Repository onboarding — four stages around one live Claude Code session
 * (`openspec/changes/repository-onboarding-native-init`). The stage list is
 * the extension point: a new stage slots in between `init` and `deliver`
 * by adding a definition here and a runner in `runs.ts`.
 */

export const STAGE_KEYS = ["prepare", "init", "review", "deliver"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export type StageStatus = "Pending" | "Running" | "WaitingForUser" | "Completed" | "Failed" | "Cancelled";
export type RunStatus = StageStatus;
export const LIVE_RUN_STATUSES: readonly RunStatus[] = ["Pending", "Running", "WaitingForUser"];

export type StageDefinition = {
  key: StageKey;
  order: number;
  /** deterministic = DCC alone; ai = Claude does the work; human = waits for a person's decision. */
  kind: "deterministic" | "ai" | "human";
  /** A gate waits for a person unless the automation policy resolves it. */
  gate: boolean;
  title_he: string;
  short_he: string;
  why_he: string;
  what_he: string;
  output_he: string;
};

export const STAGES: readonly StageDefinition[] = [
  {
    key: "prepare", order: 0, kind: "deterministic", gate: false,
    title_he: "הכנת ריפו", short_he: "עותק מבודד על ענף חדש",
    why_he: "צריך עותק מבודד לעבוד עליו, בלי לגעת בריפו שלך.",
    what_he: "DCC מושך את הריפו, פותח ענף חדש ורושם את נקודת ההתחלה.",
    output_he: "ענף ai/onboarding/<הרצה> ונקודת התחלה (commit).",
  },
  {
    key: "init", order: 1, kind: "ai", gate: false,
    title_he: "הטמעה עם Claude (/init)", short_he: "שיחה חיה עם Claude Code",
    why_he: "כאן נוצר התוכן: הוראות, skills ו-hooks.",
    what_he: "/init של Claude Code סורק את הריפו, שואל אותך וכותב את הקבצים בענף. הסשן נשאר פתוח עד סוף ההרצה.",
    output_he: "CLAUDE.md, skills ו-hooks בענף. עדיין לא נשמרים ב-git.",
  },
  {
    key: "review", order: 2, kind: "human", gate: true,
    title_he: "סקירת תוצרים", short_he: "כל השינויים כ-diff, לאישורך",
    why_he: "ל-Claude אין מילה אחרונה. אדם מאשר מה ייכנס.",
    what_he: "מציג את כל השינויים מול נקודת ההתחלה. שינוי? מבקשים מ-Claude בטרמינל, ומרעננים את הרשימה.",
    output_he: "אישור למעבר לשלב המסירה.",
  },
  {
    key: "deliver", order: 3, kind: "deterministic", gate: false,
    title_he: "מסירה: commit ו-push", short_he: "commit על שמך, push ו-PR",
    why_he: "השינויים צריכים להגיע ל-git כדי שהצוות יקבל אותם.",
    what_he: "DCC עושה commit על שמך, push לענף ופותח PR. אחרי זה הסשן נסגר.",
    output_he: "PR פתוח שממתין למיזוג ידני.",
  },
];

export const stageDefinition = (key: string): StageDefinition | undefined => STAGES.find((s) => s.key === key);
export const isStageKey = (k: string): k is StageKey => (STAGE_KEYS as readonly string[]).includes(k);

/* ── automation ───────────────────────────────────────────────────── */

export type AutomationPreset = "step_by_step" | "guided" | "automatic" | "custom";
export type StageAutomation = { run: "auto" | "manual"; gate?: "auto" | "human" };
export type AutomationPolicy = { preset: AutomationPreset; stages: Record<StageKey, StageAutomation> };

export function presetPolicy(preset: AutomationPreset): AutomationPolicy {
  const run: StageAutomation["run"] = preset === "step_by_step" ? "manual" : "auto";
  const stages = Object.fromEntries(
    STAGES.map((s) => [s.key, s.gate ? { run, gate: preset === "automatic" ? "auto" : "human" } : { run }]),
  ) as Record<StageKey, StageAutomation>;
  return { preset, stages };
}

/** Any stored shape → a complete policy. Unknown stages are dropped, missing ones filled from the preset. */
export function normalizePolicy(raw: unknown): AutomationPolicy {
  const r = (raw ?? {}) as { preset?: unknown; stages?: Record<string, unknown> };
  const preset: AutomationPreset = ["step_by_step", "guided", "automatic", "custom"].includes(String(r.preset)) ? (r.preset as AutomationPreset) : "step_by_step";
  const base = presetPolicy(preset === "custom" ? "step_by_step" : preset);
  if (preset !== "custom") return base;
  const stages = { ...base.stages };
  for (const s of STAGES) {
    const v = (r.stages?.[s.key] ?? {}) as { run?: unknown; gate?: unknown };
    stages[s.key] = {
      run: v.run === "auto" ? "auto" : "manual",
      ...(s.gate ? { gate: v.gate === "auto" ? "auto" : "human" } : {}),
    };
  }
  return { preset, stages };
}

/** A policy that lets a gate resolve without a person needs explicit consent. */
export const policyNeedsConsent = (p: AutomationPolicy): boolean => STAGES.some((s) => s.gate && p.stages[s.key]?.gate === "auto");

/* ── model and effort ─────────────────────────────────────────────── */

export type ModelChoice = { model?: string; effort?: Effort };
/** Only AI stages carry a choice; today that is the Claude session. */
export type ModelPolicy = Partial<Record<StageKey, ModelChoice>>;

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];
export function normalizeModelPolicy(raw: unknown): ModelPolicy {
  const out: ModelPolicy = {};
  for (const s of STAGES.filter((x) => x.kind === "ai")) {
    const v = ((raw ?? {}) as Record<string, unknown>)[s.key] as { model?: unknown; effort?: unknown } | undefined;
    if (!v) continue;
    const model = typeof v.model === "string" && /^[a-z0-9.\-]+$/i.test(v.model) ? v.model : undefined;
    const effort = EFFORTS.includes(v.effort as Effort) ? (v.effort as Effort) : undefined;
    if (model || effort) out[s.key] = { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  }
  return out;
}

/* ── the Claude session ───────────────────────────────────────────── */

export type SessionState = "none" | "live" | "ended" | "disconnected";

/** The last status-line snapshot Claude Code handed to DCC. */
export type SessionStatus = {
  costUsd: number;
  apiDurationMs: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  modelId: string | null;
  effort: string | null;
  linesAdded: number;
  linesRemoved: number;
  updatedAt: string;
};

export type RunSession = {
  id?: string;
  state: SessionState;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  model?: string;
  effort?: string;
  transcriptPath?: string;
  /** Lines of the transcript already turned into events. */
  transcriptCursor?: number;
  /** Assistant responses seen in the transcript (model calls). */
  apiCalls?: number;
  lastMessageId?: string | null;
  /** The current Claude Code process's own counters (each process starts from zero). */
  status?: SessionStatus;
  /** What earlier processes of the same conversation spent — a resume starts a new process. */
  base?: SessionTotals;
  /** Up to where the session's spend is already in the `claude_call` ledger
   *  (claude-in-dcc design §1: a live session is recorded in slices). This is
   *  a cursor, never a total — the money is only in the ledger. */
  ledgerCursor?: SessionTotals & { stageKey?: string | null; at?: string };
};

export type SessionTotals = { costUsd: number; inputTokens: number; outputTokens: number; apiDurationMs: number };
export const sessionTotals = (s: RunSession): SessionTotals => ({
  costUsd: (s.base?.costUsd ?? 0) + (s.status?.costUsd ?? 0),
  inputTokens: (s.base?.inputTokens ?? 0) + (s.status?.inputTokens ?? 0),
  outputTokens: (s.base?.outputTokens ?? 0) + (s.status?.outputTokens ?? 0),
  apiDurationMs: (s.base?.apiDurationMs ?? 0) + (s.status?.apiDurationMs ?? 0),
});

/* ── stage results ────────────────────────────────────────────────── */

export type ExistingSetup = {
  claudeMdLines: number | null;
  agentsMd: boolean;
  rules: number;
  skills: number;
  hooks: number;
  agents: number;
  settings: boolean;
};

export type PrepareResult = {
  branch: string;
  baselineSha: string;
  defaultBranch: string | null;
  fileCount: number;
  existing: ExistingSetup;
};

export type InitResult = { sessionId: string; changedFiles: number; completedBy: string };

export type ChangedFile = { path: string; status: "A" | "M" | "D" | "R" | string; additions: number; deletions: number };
export type ReviewResult = { changedFiles: ChangedFile[]; checkedAt: string; approvedBy?: string; approvedAt?: string; auto?: boolean };

export type DeliverResult = {
  branch: string;
  base: string;
  commitSha: string | null;
  filesCommitted: number;
  remote: string | null;
  pushed: boolean;
  prNumber: number | null;
  prUrl: string | null;
  compareUrl: string | null;
  localOnly: boolean;
  note?: string;
};

/** The model and effort the session ran with while this stage was open — its cost is in the ledger, sliced by stage. */
export type StageUsage = { model?: string | null; effort?: string | null };
