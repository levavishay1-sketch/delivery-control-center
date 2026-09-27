import type {
  AgentTest, AutomationLevel, CoachProposal, ComponentFamily, ComponentGroup, ComponentKind, ComponentStatus, FailureKind, OnboardingComponent, OnboardingEvent,
  OnboardingStatus, OnboardingStepDefinition,
} from "../../api.ts";
import { effortLabel, fmtUsd, modelLabel } from "../../claude/labels.ts";

/**
 * The words of the repository dossier (`openspec/changes/repository-coach`):
 * one Hebrew label per server value, so the screen never restates a map the
 * core already has (KIND_HE, FAMILY_HE, GROUP_HE and FAILURE_HE are copied
 * from `packages/core/src/repo-onboarding` verbatim). Money, model and effort
 * read the same on every screen — those come from `claude/labels.ts`.
 */
export { errText } from "../../api.ts";
export { fmtUsd, fmtInt, fmtDuration, modelLabel, effortLabel } from "../../claude/labels.ts";

export type Tone = "inactive" | "warning" | "healthy" | "critical" | "active" | "ai" | "neutral";

export const RUN_STATUS_HE: Record<OnboardingStatus, { label: string; tone: Tone }> = {
  Pending: { label: "טרם התחיל", tone: "inactive" },
  Running: { label: "בתהליך", tone: "ai" },
  WaitingForUser: { label: "ממתין לך", tone: "warning" },
  Completed: { label: "נמסר", tone: "healthy" },
  Failed: { label: "נכשל", tone: "critical" },
  Cancelled: { label: "בוטל", tone: "inactive" },
};

export const STEP_STATUS_HE: Record<OnboardingStatus, string> = {
  Pending: "לא התחיל", Running: "רץ", WaitingForUser: "ממתין לך", Completed: "הסתיים", Failed: "נכשל", Cancelled: "בוטל",
};

/** The chip next to a step's title: who does the work. */
export const STEP_KIND_CHIP: Record<OnboardingStepDefinition["kind"], { cls: string; label: string }> = {
  deterministic: { cls: "det", label: "דטרמיניסטי · חינם" },
  ai: { cls: "ai", label: "AI" },
  human: { cls: "human", label: "שער אישור" },
};

export const LEVEL_HE: Record<AutomationLevel, { title: string; desc: string }> = {
  reversible_auto: { title: "הפיך = עושה ומדווח", desc: "רכיב הפיך וזול נבנה ומדווח כאן; רכיב משמעותי או חיצוני מחכה לאישורכם. ריצת הניסיון רצה לבד. מומלץ." },
  all_approval: { title: "הכול באישור", desc: "כל רכיב מחכה להחלטה שלכם, וגם ריצת הניסיון מאושרת על העלות לפני שהיא רצה." },
  locked: { title: "נעול", desc: "כמו 'הכול באישור', וגם שום דבר שעולה כסף — כולל חיפוש פתוח ברשת — לא רץ בלי אישור. ללקוח רגיש." },
};

/* the component cards — the same words as packages/core/src/repo-onboarding/components.ts */
export const KIND_HE: Record<ComponentKind, string> = {
  rule: "שורת הנחיה", hook: "hook", permission: "הרשאה", skill: "skill", agent: "סוכן", mcp: "MCP", plugin: "plugin", lsp: "LSP", scaffold: "קובץ בסיס",
  doc: "מסמך", report: "דיווח", runner: "מריץ", settings: "הגדרות", gitattributes: ".gitattributes", gitignore: ".gitignore", review: "REVIEW.md", pr_template: "תבנית PR", devcontainer: "devcontainer", script: "סקריפט",
};
export const FAMILY_HE: Record<ComponentFamily, string> = {
  safety: "בטיחות", verification: "אימות", knowledge: "ידע", connections: "חיבורים", skills: "skills", agents: "סוכנים", enforcement: "אכיפה", measurement: "מדידה ודיווח",
};
export const GROUP_HE: Record<ComponentGroup, string> = { auto: "נעשה ודווח", approval: "מחכה לאישורך", not_recommended: "לא מומלץ כאן" };
export const FAILURE_HE: Record<FailureKind, string> = {
  missing_fact: "לא ידע עובדה", rule_violated: "ידע ועבר על כלל", needs_external: "חסר מידע חיצוני", cannot_verify: "לא יכול לאמת", bad_judgment: "שיפוט שגוי",
};
export const SOURCE_HE: Record<OnboardingComponent["source"], string> = {
  rule: "כלל החלטה", trial: "ריצת הניסיון", process: "צעד בתהליך", marketplace: "רכיב מוכן", reviewer: "הסוקר", user: "בקשה שלכם", init: "טיוטת /init", coach: "המאמן",
};
export const RISK_HE: Record<OnboardingComponent["risk"], { label: string; cls: string }> = {
  reversible: { label: "הפיך", cls: "ok" }, significant: { label: "משמעותי", cls: "human" }, external: { label: "חיצוני", cls: "bad" },
};
export const TRUST_HE: Record<string, { label: string; cls: string }> = {
  official: { label: "רשמי", cls: "ok" }, known_community: { label: "קהילה מוכרת", cls: "det" }, unverified: { label: "לא מאומת", cls: "bad" },
};
export const COMPONENT_STATUS_HE: Record<ComponentStatus, { label: string; cls: string }> = {
  proposed: { label: "מחכה להחלטה", cls: "human" }, approved: { label: "אושר", cls: "ok" }, declined: { label: "נדחה", cls: "bad" }, installed: { label: "הותקן", cls: "det" },
  verified: { label: "אומת", cls: "ok" }, failed: { label: "נכשל באימות", cls: "bad" }, removed: { label: "הוסר", cls: "" }, deferred: { label: "נדחה להמשך", cls: "" }, reported: { label: "דיווח", cls: "det" },
};
export const PROCESS_SOURCE_HE: Record<string, string> = {
  git: "היסטוריית git", ci: "CI", contributing: "CONTRIBUTING", pr_template: "תבנית PR", docs: "תיעוד", tracker: "מערכת המשימות", interview: "הראיון", model: "קלוד",
};
export const DECISION_HE: Record<"agent" | "skill" | "none", { label: string; cls: string }> = {
  agent: { label: "סוכן", cls: "ai" }, skill: { label: "skill", cls: "det" }, none: { label: "כלום", cls: "" },
};
export const JUDGE_HE: Record<string, string> = { code: "הקוד שופט", model: "מודל שופט" };
export const PROPOSAL_KIND_HE: Record<CoachProposal["kind"], string> = { add: "הוספה", change: "שינוי", remove: "הסרה", new_in_world: "חדש בעולם" };
/** The five questions of the agent test, in the order the concept explains them. */
export const AGENT_TEST_HE: { key: Exclude<keyof AgentTest, "why">; label: string }[] = [
  { key: "judgment", label: "צריך שיפוט עצמאי" }, { key: "externalInfo", label: "צריך מידע או גישה שאין לסוכן הראשי" }, { key: "readsALot", label: "צריך לקרוא הרבה" },
  { key: "parallel", label: "יכול לרוץ במקביל" }, { key: "failsToday", label: "נכשל היום" },
];
export const validationLabel = (passed: boolean | null | undefined): { label: string; cls: string } =>
  passed === true ? { label: "עבר", cls: "ok" } : passed === false ? { label: "נכשל", cls: "bad" } : { label: "לא נבדק כאן", cls: "human" };
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
export const signedPct = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n * 100))}%`);

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
export const fmtDate = (iso: string) => new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "—");

const DECIDE_HE: Record<string, string> = { approve: "אושר", decline: "נדחה", defer: "נדחה להמשך", undo: "ההחלטה בוטלה על" };

/** One line of the decision and event log — every event the run writes, in the words a person reads. */
export function eventLabel(e: OnboardingEvent, title: (key: string) => string): { text: string; tone: Tone | "" } {
  const p = e.payload as Record<string, unknown>;
  const s = (k: string) => String(p[k] ?? "");
  const n = (k: string) => Number(p[k] ?? 0);
  switch (e.type) {
    case "onboarding.run.started": return { text: `ההרצה התחילה · ${LEVEL_HE[s("level") as AutomationLevel]?.title ?? s("level")}${p.kind === "coach" ? " · הרצת מאמן" : ""}`, tone: "" };
    case "onboarding.step.started": return { text: `${title(s("stepKey"))}: התחיל${p.automated ? " (לבד)" : ""}`, tone: "" };
    case "onboarding.step.completed": return { text: `${title(s("stepKey"))}: הסתיים`, tone: "healthy" };
    case "onboarding.step.failed": return { text: `${title(s("stepKey"))}: נכשל — ${s("error")}`, tone: "critical" };
    case "onboarding.step.waiting": return { text: `${title(s("stepKey"))}: ממתין לך — ${s("why")}`, tone: "warning" };
    case "onboarding.profile.written": return { text: `הפרופיל נכתב: ${n("facts")} עובדות`, tone: "" };
    case "onboarding.profile.corrected": return p.undo ? { text: `התיקון על "${s("path")}" בוטל`, tone: "" } : { text: `עובדה סומנה כלא נכונה: ${s("path")}${p.note ? ` — ${s("note")}` : ""}`, tone: "warning" };
    case "onboarding.interview.answered": return { text: `הראיון נענה: ${n("answered")} תשובות, ${n("assumed")} הנחות`, tone: "" };
    case "onboarding.processes.mapped": return { text: `${n("processes")} תהליכים, ${n("steps")} צעדים: ${n("agents")} סוכנים, ${n("skills")} skills`, tone: "ai" };
    case "onboarding.trial.approved": return { text: "ריצת הניסיון אושרה על העלות", tone: "" };
    case "onboarding.trial.task": {
      const verdict = p.passed === true ? "עבר" : p.passed === false ? `נכשל (${FAILURE_HE[s("failureKind") as FailureKind] ?? s("failureKind")})` : "לא הוכרע";
      return { text: `${p.phase === "after" ? "ניסיון חוזר" : "ניסיון"}: "${s("title")}" — ${verdict} · ${fmtUsd(n("costUsd"))}`, tone: p.passed === true ? "healthy" : p.passed === false ? "critical" : "" };
    }
    case "onboarding.marketplace.found": return { text: `נמצא רכיב מוכן: ${s("name")} (${s("kind")}) — ${TRUST_HE[s("trust")]?.label ?? s("trust")}`, tone: "ai" };
    case "onboarding.plan.drawn": {
      const g = (p.byGroup ?? {}) as Partial<Record<ComponentGroup, number>>;
      const rules = Array.isArray(p.rulesFired) ? p.rulesFired.length : 0;
      return { text: `התוכנית צוירה: ${rules} כללים, ${n("components")} כרטיסים (${g.auto ?? 0} נעשה ודווח · ${g.approval ?? 0} לאישור · ${g.not_recommended ?? 0} לא מומלץ)`, tone: "ai" };
    }
    case "onboarding.plan.redrawn": return { text: `התוכנית צוירה מחדש${p.why === "corrected" ? " אחרי תיקון עובדה" : ` (${s("why")})`}`, tone: "warning" };
    case "onboarding.card.decided": return { text: `${DECIDE_HE[s("decision")] ?? s("decision")}: ${s("title")}${p.reason ? ` — ${s("reason")}` : ""}`, tone: p.decision === "approve" ? "healthy" : p.decision === "decline" ? "warning" : "" };
    case "onboarding.cards.decided_set": return { text: `${p.decision === "approve" ? "אושרו" : "נדחו"} כסט: ${Array.isArray(p.keys) ? p.keys.length : 0} כרטיסים`, tone: "healthy" };
    case "onboarding.card.requested": return { text: `רכיב התבקש: ${s("title")} (${KIND_HE[s("kind") as ComponentKind] ?? s("kind")})`, tone: "ai" };
    case "onboarding.build.component": {
      const v = p.validation as { passed?: boolean | null } | null | undefined;
      const st = COMPONENT_STATUS_HE[s("status") as ComponentStatus]?.label ?? s("status");
      return { text: `נבנה: ${s("title")} — ${st}${v ? ` · ${validationLabel(v.passed).label}` : ""}`, tone: p.status === "failed" ? "critical" : p.status === "verified" ? "healthy" : "ai" };
    }
    case "onboarding.build.done": {
      const d = p.delta as { before: { passed: number; total: number }; after: { passed: number; total: number } } | null | undefined;
      return { text: `הבנייה הסתיימה: ${n("installed")} הותקנו, ${n("verified")} אומתו, ${n("failed")} נכשלו${d ? ` · לפני ${d.before.passed}/${d.before.total} → אחרי ${d.after.passed}/${d.after.total}` : ""}`, tone: "healthy" };
    }
    case "onboarding.delivered": return { text: p.prUrl ? `נמסר: commit ${shortSha(s("commitSha"))} ו-PR נפתח` : p.localOnly ? "נמסר: commit בענף מקומי, אין remote" : `נמסר: commit ${shortSha(s("commitSha"))}`, tone: "healthy" };
    case "onboarding.run.completed": return { text: "ההרצה הושלמה", tone: "healthy" };
    case "onboarding.run.cancelled": return { text: "ההרצה בוטלה", tone: "warning" };
    case "onboarding.automation.updated": return { text: `מדרגת האוטומציה שונתה: ${LEVEL_HE[s("level") as AutomationLevel]?.title ?? s("level")}`, tone: "" };
    case "onboarding.session.started": return { text: `סשן טיוטת /init נפתח · ${modelLabel(s("model"))} · מאמץ ${effortLabel(s("effort"))}`, tone: "ai" };
    case "onboarding.session.resumed": return { text: "סשן הטיוטה חודש מאותה נקודה", tone: "ai" };
    case "onboarding.session.ended": return { text: "סשן הטיוטה נסגר", tone: "" };
    case "onboarding.session.disconnected": return { text: "סשן הטיוטה נותק — השרת הופעל מחדש", tone: "warning" };
    case "onboarding.session.prompt": return { text: `נכתב ל-Claude: ${s("text")}`, tone: "ai" };
    case "onboarding.session.command": return { text: `פקודה בסשן: ${s("command")}`, tone: "ai" };
    case "onboarding.session.answer": return { text: `${s("question")} → ${s("answer")}`, tone: "" };
    case "onboarding.session.instructed": return { text: `נשלחה לסשן הוראה מהצ'אט${p.forced ? " (למרות שהסשן נראה עסוק)" : ""}: ${s("text")}`, tone: "ai" };
    case "coach.proposal.created": return { text: `המאמן הציע: ${s("title")} (${PROPOSAL_KIND_HE[s("kind") as CoachProposal["kind"]] ?? s("kind")})`, tone: "ai" };
    case "coach.proposal.decided": return { text: `הצעת המאמן ${p.decision === "approve" ? "אושרה" : "נדחתה"}: ${s("title")}${p.reason ? ` — ${s("reason")}` : ""}`, tone: p.decision === "approve" ? "healthy" : "" };
    default: return { text: e.type, tone: "" };
  }
}
