/**
 * The words every Claude-related component uses — one place, so the same
 * capability, model or outcome reads the same on every screen
 * (claude-in-dcc §11.4). Screens import from here, never restate.
 */

export const MODEL_OPTIONS = [
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-opus-5", label: "Opus 5" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];
const MODEL_ALIAS: Record<string, string> = { haiku: "Haiku 4.5", sonnet: "Sonnet 5", opus: "Opus 5" };
export const modelLabel = (id: string | null | undefined): string => {
  if (!id) return "—";
  const hit = MODEL_OPTIONS.find((m) => m.value === id || id.startsWith(m.value.replace(/-\d{8}$/, "")));
  return hit?.label ?? MODEL_ALIAS[id] ?? id;
};

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
export const EFFORT_HE: Record<Effort, string> = { low: "נמוך", medium: "בינוני", high: "גבוה", xhigh: "גבוה מאוד", max: "מקסימלי" };
export const effortLabel = (e: string | null | undefined) => (e ? EFFORT_HE[e as Effort] ?? e : "—");

export const CAPABILITY_HE: Record<string, string> = {
  gap_detection: "בחינת בשלות",
  decomposition: "פירוק למשימות",
  execution: "ביצוע משימה",
  onboarding_init: "הטמעת מאגר",
  chat: "צ'אט",
  chat_code_read: "קריאה בקוד מהצ'אט",
  conversation_summary: "סיכום שיחה",
  usage_insights: "ניתוח שאלות",
  interactive_session: "סשן Claude Code",
  retro: "המלצות לשיפור",
  client_letter: "מכתב ללקוח",
};
export const capabilityLabel = (c: string | null | undefined) => (c ? CAPABILITY_HE[c] ?? c : "—");

export const TRIGGER_HE: Record<string, string> = { button: "כפתור", chat: "מהצ'אט", rollover: "גלגול שיחה", insights: "ניתוח", session: "סשן", hook: "hook" };
export const triggerLabel = (t: string | null | undefined) => (t ? TRIGGER_HE[t] ?? t : "—");

export const OUTCOME_HE: Record<string, { label: string; tone: "healthy" | "critical" | "warning" | "inactive" }> = {
  ok: { label: "הצליח", tone: "healthy" },
  error: { label: "שגיאה", tone: "critical" },
  timeout: { label: "פסק זמן", tone: "critical" },
  stopped: { label: "נעצר", tone: "inactive" },
  refused: { label: "נדחה — מעל התקרה", tone: "warning" },
};
export const outcomeOf = (o: string) => OUTCOME_HE[o] ?? { label: o, tone: "inactive" as const };

export const SCREEN_HE: Record<string, string> = {
  requirement: "מסך דרישה", task: "מסך משימה", onboarding: "הטמעת מאגר", pull_request: "בקשת מיזוג",
  dashboard: "לוח בקרה", claude: "מסך קלוד", none: "—", workitem: "דרישה", onboarding_run: "הטמעת מאגר",
};
export const screenLabel = (s: string | null | undefined) => (s ? SCREEN_HE[s] ?? s : "—");

/** Money the way the ledger shows it: three decimals below ten cents, two above — the same everywhere. */
export const fmtUsd = (n: number) => (Math.abs(n) < 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtDuration = (ms: number | null | undefined) => {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} שנ'` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} דק'`;
};
export const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `היום ${time}`;
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `אתמול ${time}`;
  return `${d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric" })} ${time}`;
};
