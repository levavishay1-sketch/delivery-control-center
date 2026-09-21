import type { AutomationPolicy, AutomationPreset, Effort, OnboardingEvent, OnboardingStageDefinition, OnboardingStatus } from "../../api.ts";

export type Tone = "inactive" | "warning" | "healthy" | "critical" | "active" | "ai";

export const RUN_STATUS_HE: Record<OnboardingStatus, { label: string; tone: Tone }> = {
  Pending: { label: "טרם התחיל", tone: "inactive" },
  Running: { label: "בתהליך", tone: "ai" },
  WaitingForUser: { label: "ממתין לך", tone: "warning" },
  Completed: { label: "הושלם", tone: "healthy" },
  Failed: { label: "נכשל", tone: "critical" },
  Cancelled: { label: "בוטל", tone: "inactive" },
};

export const STAGE_STATUS_HE: Record<OnboardingStatus, string> = {
  Pending: "לא התחיל",
  Running: "רץ",
  WaitingForUser: "ממתין לאישורך",
  Completed: "הסתיים",
  Failed: "נכשל",
  Cancelled: "בוטל",
};

export const KIND_CHIP: Record<OnboardingStageDefinition["kind"], { cls: string; label: string }> = {
  deterministic: { cls: "det", label: "דטרמיניסטי" },
  ai: { cls: "ai", label: "AI" },
  human: { cls: "human", label: "שער אישור" },
};

export const PRESET_HE: Record<AutomationPreset, { title: string; desc: string }> = {
  step_by_step: { title: "צעד אחר צעד", desc: "שום שלב לא מתחיל לבד: כל שלב מתחיל מהכפתור שלו, והסקירה מחכה לאישור שלכם." },
  guided: { title: "מודרך", desc: "השלבים מתחילים לבד אחד אחרי השני. ההטמעה היא שיחה איתכם, והסקירה מחכה לאישור שלכם." },
  automatic: { title: "אוטומטי מלא", desc: "גם הסקירה מאושרת לבד, בהסכמה מפורשת מראש. ההטמעה עדיין שיחה איתכם, ושום דבר לא מתמזג לבד." },
  custom: { title: "מותאם אישית", desc: "לכל שלב בנפרד: האם הוא מתחיל לבד, והאם הסקירה מחכה לאדם." },
};

export function describePolicy(p: AutomationPolicy, defs: readonly OnboardingStageDefinition[]): string {
  const manual = defs.filter((d) => p.stages[d.key]?.run === "manual").length;
  const gates = defs.filter((d) => d.gate);
  const autoGates = gates.filter((d) => p.stages[d.key]?.gate === "auto").length;
  const runs = manual === 0 ? "כל השלבים מתחילים לבד" : manual === defs.length ? "כל השלבים מתחילים ידנית" : `${manual} שלבים ידניים`;
  const gate = autoGates === 0 ? `${gates.length === 1 ? "שער אחד ממתין" : `${gates.length} שערים ממתינים`} לאדם` : `${autoGates}/${gates.length} שערים אוטומטיים`;
  return `${PRESET_HE[p.preset].title} · ${runs} · ${gate}`;
}

export const policyNeedsConsent = (p: AutomationPolicy, defs: readonly OnboardingStageDefinition[]) => defs.some((d) => d.gate && p.stages[d.key]?.gate === "auto");

export function presetPolicy(preset: AutomationPreset, defs: readonly OnboardingStageDefinition[]): AutomationPolicy {
  const run = preset === "step_by_step" ? "manual" : "auto";
  const stages = Object.fromEntries(defs.map((d) => [d.key, d.gate ? { run, gate: preset === "automatic" ? "auto" : "human" } : { run }]));
  return { preset, stages } as AutomationPolicy;
}

// Model, effort and money read the same on every screen — one source (claude/labels.ts).
import { modelLabel, effortLabel } from "../../claude/labels.ts";
export { MODEL_OPTIONS, modelLabel, EFFORTS, EFFORT_HE, effortLabel, fmtUsd, fmtInt, fmtDuration } from "../../claude/labels.ts";
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
export const fmtDate = (iso: string) => new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "—");

/** The server refuses with `{ "error": "<message for the person>" }`. */
export function errText(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  const body = s.replace(/^\d{3}\s+/, "");
  try {
    const j = JSON.parse(body) as { error?: unknown };
    if (typeof j.error === "string") return j.error;
  } catch { /* not JSON */ }
  return body;
}

/** One line of the decision and event log. */
export function eventLabel(e: OnboardingEvent, title: (key: string) => string): { text: string; tone: Tone | "" } {
  const p = e.payload as Record<string, unknown>;
  const s = (k: string) => String(p[k] ?? "");
  switch (e.type) {
    case "onboarding.run.started": return { text: `ההרצה התחילה · ${PRESET_HE[s("preset") as AutomationPreset]?.title ?? s("preset")}`, tone: "" };
    case "onboarding.stage.started": return { text: `${title(s("stageKey"))}: התחיל${p.automated ? " (לפי המדיניות)" : ""}`, tone: "" };
    case "onboarding.stage.completed": return { text: `${title(s("stageKey"))}: הסתיים`, tone: "healthy" };
    case "onboarding.stage.failed": return { text: `${title(s("stageKey"))}: נכשל — ${s("error")}`, tone: "critical" };
    case "onboarding.session.started": return { text: `סשן Claude התחיל · ${modelLabel(s("model"))} · ${effortLabel(s("effort"))}`, tone: "ai" };
    case "onboarding.session.resumed": return { text: "סשן Claude חודש מאותה נקודה", tone: "ai" };
    case "onboarding.session.ended": return { text: "סשן Claude נסגר", tone: "" };
    case "onboarding.session.disconnected": return { text: "סשן Claude נותק — השרת הופעל מחדש", tone: "warning" };
    case "onboarding.session.command": return { text: `פקודה בסשן: ${s("command")}`, tone: "ai" };
    case "onboarding.session.prompt": return { text: `נכתב ל-Claude: ${s("text")}`, tone: "ai" };
    case "onboarding.session.answer": return { text: `${s("question")} → ${s("answer")}`, tone: "" };
    case "onboarding.session.instructed": return { text: `נשלחה לסשן הוראה מהצ'אט${p.forced ? " (למרות שהסשן נראה עסוק)" : ""}: ${s("text")}`, tone: "ai" };
    case "onboarding.init.auto_completed": return { text: `DCC זיהה ש-Claude סיים לכתוב (${s("files")} קבצים) ועבר לסקירה`, tone: "ai" };
    case "onboarding.review.approved": return { text: `סקירת התוצרים אושרה · ${s("files")} קבצים${p.auto ? " (לפי המדיניות)" : ""}`, tone: "healthy" };
    case "onboarding.gate.auto_resolved": return { text: `${title(s("stageKey"))}: השער אושר לפי המדיניות`, tone: "warning" };
    case "onboarding.delivered": return { text: p.prUrl ? `נמסר: commit ${s("commitSha")} ו-PR נפתח` : p.localOnly ? "נמסר: commit בענף מקומי" : `נמסר: commit ${s("commitSha") || "—"}`, tone: "healthy" };
    case "onboarding.run.completed": return { text: "ההרצה הושלמה", tone: "healthy" };
    case "onboarding.run.cancelled": return { text: "ההרצה בוטלה", tone: "warning" };
    case "onboarding.automation.updated": return { text: `מדיניות האוטומציה שונתה: ${PRESET_HE[s("preset") as AutomationPreset]?.title ?? s("preset")}`, tone: "" };
    case "onboarding.model_choices.updated": return { text: "בחירת המודל והמאמץ עודכנה", tone: "" };
    default: return { text: e.type, tone: "" };
  }
}
