import type {
  AgentCriterion, AutomationLevel, CoachProposal, ComponentFamily, ComponentGroup, ComponentKind, ComponentStatus, EvalArm, EvalTaskKind, EvalVerdict, FailureKind, OnboardingComponent, OnboardingEvent,
  OnboardingStatus, OnboardingStepDefinition, PlanPhase,
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
  reversible_auto: { title: "הפיך = עושה ומדווח", desc: "רכיב הפיך וזול נבנה ומדווח כאן; רכיב משמעותי או חיצוני מחכה לאישורכם. המדידה רצה לבד, עד התקרה. מומלץ." },
  all_approval: { title: "הכול באישור", desc: "כל רכיב מחכה להחלטה שלכם, וגם המדידה מאושרת על העלות לפני שהיא רצה." },
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
  rule: "כלל החלטה", trial: "המדידה", process: "צעד בתהליך", marketplace: "רכיב מוכן", reviewer: "הסוקר", user: "בקשה שלכם", init: "טיוטת /init", coach: "המאמן",
};
export const RISK_HE: Record<OnboardingComponent["risk"], { label: string; cls: string }> = {
  reversible: { label: "הפיך", cls: "ok" }, significant: { label: "משמעותי", cls: "human" }, external: { label: "חיצוני", cls: "bad" },
};
export const TRUST_HE: Record<string, { label: string; cls: string }> = {
  official: { label: "רשמי", cls: "ok" }, known_community: { label: "קהילה מוכרת", cls: "det" }, unverified: { label: "לא מאומת", cls: "bad" },
};
export const COMPONENT_STATUS_HE: Record<ComponentStatus, { label: string; cls: string }> = {
  proposed: { label: "מחכה להחלטה", cls: "human" }, approved: { label: "אושר", cls: "ok" }, declined: { label: "נדחה", cls: "bad" }, installed: { label: "הותקן", cls: "det" },
  verified: { label: "אומת", cls: "ok" }, configured: { label: "הוגדר · יחובר אצל הלקוח", cls: "det" }, failed: { label: "נכשל באימות", cls: "bad" }, removed: { label: "הוסר", cls: "" }, deferred: { label: "נדחה להמשך", cls: "" }, reported: { label: "דיווח", cls: "det" },
};
export const PROCESS_SOURCE_HE: Record<string, string> = {
  git: "היסטוריית git", ci: "CI", contributing: "CONTRIBUTING", pr_template: "תבנית PR", docs: "תיעוד", tracker: "מערכת המשימות", interview: "הראיון", model: "קלוד",
};
export const DECISION_HE: Record<"agent" | "skill" | "none", { label: string; cls: string }> = {
  agent: { label: "סוכן", cls: "ai" }, skill: { label: "skill", cls: "det" }, none: { label: "אין צורך בסוכן או סקיל", cls: "" },
};
export const JUDGE_HE: Record<string, string> = { code: "הקוד שופט", model: "מודל שופט" };

/* the measurement "with" against "without" — the words of packages/core/src/repo-onboarding/eval/ */
export const ARM_HE: Record<EvalArm, string> = { with: "עם", without: "בלי" };
export const TASK_KIND_HE: Record<EvalTaskKind, string> = { knowledge: "ידע", action: "פעולה" };
/** A task's verdict: it passes in every run with the set and not without it, or the other way round. */
export const TASK_VERDICT_HE: Record<EvalVerdict, { label: string; cls: string }> = {
  improved: { label: "השתפרה", cls: "ok" }, same: { label: "אותו דבר", cls: "" }, worse: { label: "הורעה", cls: "bad" }, unmeasured: { label: "לא נמדדה", cls: "human" },
};
/** A component's verdict, from the tasks that exercise it — one map for the card and the build step. */
export const DELTA_HE: Record<EvalVerdict, { label: string; cls: string }> = {
  improved: { label: "הרוויח את מקומו", cls: "ok" }, same: { label: "לא הוכיח תרומה", cls: "human" }, worse: { label: "הזיק", cls: "bad" }, unmeasured: { label: "לא נמדד", cls: "" },
};
/** What each code grader checks, in a line a person reads. */
export const GRADER_HE: Record<string, string> = {
  files_untouched: "לא נגע בקבצים אסורים", files_changed_within: "שינה רק איפה שצריך", no_secret_in_output: "לא חשף סוד", command_ran: "הריץ את הפקודה הנכונה",
  claim_requires_evidence: "לא טען בלי ראיה", tool_blocked: "נחסם כשצריך", skill_used: "השתמש ב-skill", diff_lines_max: "שינוי קטן כנדרש", must_mention: "אמר את מה שחייב",
  must_not_claim: "לא טען את מה שאסור", diff_contains: "השינוי מכיל את הנדרש", new_files_under: "קבצים חדשים במקום הנכון", commit_excludes: "commit בלי קבצים אסורים",
};
export const PLAN_PHASE_HE: Record<PlanPhase, string> = {
  draft: "טיוטת /init — לפני ההחלטות", aside: "הטיוטה מוזזת הצידה…", scan: "הטיוטה נסרקת…", decide: "הכרטיסים פתוחים להחלטה",
};
/** One arm of one task as "passed/runs"; a dash when the arm did not run. */
export const passedOf = (a: { runs: number; passed: number }) => (a.runs ? `${a.passed}/${a.runs}` : "—");
export const PROPOSAL_KIND_HE: Record<CoachProposal["kind"], string> = { add: "הוספה", change: "שינוי", remove: "הסרה", new_in_world: "חדש בעולם" };
/** The five questions of the agent test, in the order the concept explains them. */
export const AGENT_TEST_HE: { key: AgentCriterion; label: string }[] = [
  { key: "judgment", label: "צריך שיפוט עצמאי" }, { key: "externalInfo", label: "צריך מידע או גישה שאין לסוכן הראשי" }, { key: "readsALot", label: "צריך לקרוא הרבה" },
  { key: "parallel", label: "יכול לרוץ במקביל" }, { key: "failsToday", label: "כבר נכשל בפועל" },
];
export const validationLabel = (passed: boolean | null | undefined): { label: string; cls: string } =>
  passed === true ? { label: "עבר", cls: "ok" } : passed === false ? { label: "נכשל", cls: "bad" } : { label: "לא נבדק כאן", cls: "human" };
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
export const signedPct = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n * 100))}%`);

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
export const fmtDate = (iso: string) => new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "—");

const DECIDE_HE: Record<string, string> = { approve: "אושר", decline: "נדחה", defer: "נדחה להמשך", undo: "ההחלטה בוטלה על" };
const PHASE_WHY_HE: Record<string, string> = { skipped_draft: "בלי טיוטת /init", draft_scanned: "אחרי שהטיוטה הוזזה הצידה ונסרקה", draft_empty: "סשן הטיוטה לא כתב כלום" };
const armOf = (p: Record<string, unknown>): EvalArm => (p.arm === "with" || p.arm === "without" ? p.arm : p.phase === "after" ? "with" : "without");

/**
 * One line of the decision and event log — every event the run writes, in the words a person reads.
 * `card` names a component by its key, for the events that carry only keys.
 */
export function eventLabel(e: OnboardingEvent, title: (key: string) => string, card: (key: string) => string = (k) => k): { text: string; tone: Tone | "" } {
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
    case "onboarding.trial.approved": return { text: "המדידה אושרה על העלות", tone: "" };
    case "onboarding.trial.task": {
      const verdict = p.passed === true ? "עבר" : p.passed === false ? `נכשל (${FAILURE_HE[s("failureKind") as FailureKind] ?? s("failureKind")})` : "לא הוכרע";
      const run = typeof p.runIndex === "number" && p.runIndex > 0 ? ` (הרצה ${p.runIndex + 1})` : "";
      const turns = typeof p.numTurns === "number" ? ` · ${p.numTurns} תורות` : "";
      return { text: `מדידה ${ARM_HE[armOf(p)]}: "${s("title")}"${run} — ${verdict} · ${fmtUsd(n("costUsd"))}${turns}`, tone: p.passed === true ? "healthy" : p.passed === false ? "critical" : "" };
    }
    case "onboarding.trial.stopped_at_cap": return { text: `המדידה ${p.phase === "after" ? "עם" : "בלי"} נעצרה בתקרה: ${fmtUsd(n("spentUsd"))} מתוך ${fmtUsd(n("capUsd"))}, אחרי ${n("runs")} הרצות — מה שנמדד עד כאן נשמר`, tone: "warning" };
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
      // A configured connection says so in its status; "not checked here" beside it would contradict it.
      const retried = p.retried ? (p.status === "failed" ? " · נכשל גם אחרי ניסיון תיקון" : " · עבר בניסיון התיקון") : "";
      const gone = Array.isArray(p.removed) && p.removed.length ? ` · ${p.removed.length} קבצים שלו נמחקו` : "";
      return { text: `נבנה: ${s("title")} — ${st}${v && p.status !== "configured" ? ` · ${validationLabel(v.passed).label}` : ""}${retried}${gone}`, tone: p.status === "failed" ? "critical" : p.status === "verified" || p.status === "configured" ? "healthy" : "ai" };
    }
    case "onboarding.build.removed": return { text: `קבצים של רכיבים שנכשלו נמחקו מהעותק: ${Array.isArray(p.files) ? p.files.join(", ") : ""}`, tone: "warning" };
    case "onboarding.build.done": {
      const t = p.eval as { measured: number; with: { passK: number }; without: { passK: number } } | null | undefined;
      const d = p.delta as { before: { passed: number; total: number }; after: { passed: number; total: number } } | null | undefined;
      const m = t ? ` · עם ${t.with.passK}/${t.measured} · בלי ${t.without.passK}/${t.measured}` : d ? ` · בלי ${d.before.passed}/${d.before.total} → עם ${d.after.passed}/${d.after.total}` : "";
      return { text: `הבנייה הסתיימה: ${n("verified")} אומתו, ${n("failed")} נכשלו${m}`, tone: "healthy" };
    }
    case "onboarding.component.removed": return { text: `הוסר לפני המסירה: ${s("title")}${Array.isArray(p.files) && p.files.length ? ` (${p.files.length} קבצים נמחקו)` : ""}${p.reason ? ` — ${s("reason")}` : ""}`, tone: "warning" };
    case "onboarding.delivered": return { text: p.prUrl ? `נמסר: commit ${shortSha(s("commitSha"))} ו-PR נפתח` : p.localOnly ? "נמסר: commit בענף מקומי, אין remote" : `נמסר: commit ${shortSha(s("commitSha"))}`, tone: "healthy" };
    case "onboarding.run.completed": return { text: "ההרצה הושלמה", tone: "healthy" };
    case "onboarding.run.cancelled": return { text: "ההרצה בוטלה", tone: "warning" };
    case "onboarding.automation.updated": {
      const changed = Array.isArray(p.changed) ? (p.changed as string[]) : ["level"];
      const parts = [
        ...(changed.includes("level") ? [`מדרגת האוטומציה: ${LEVEL_HE[s("level") as AutomationLevel]?.title ?? s("level")}`] : []),
        ...(changed.includes("draftCapUsd") ? [`תקרת סשן הטיוטה: $${s("draftCapUsd")}`] : []),
        ...(changed.includes("draftCapMinutes") ? [`זמן הסשן: ${s("draftCapMinutes")} דק'`] : []),
      ];
      return { text: parts.length ? `ההגדרות שונו — ${parts.join(" · ")}` : "ההגדרות נשמרו בלי שינוי", tone: "" };
    }
    case "onboarding.session.started": return { text: `סשן טיוטת /init נפתח · ${modelLabel(s("model"))} · מאמץ ${effortLabel(s("effort"))}`, tone: "ai" };
    case "onboarding.session.resumed": return { text: "סשן הטיוטה חודש מאותה נקודה", tone: "ai" };
    case "onboarding.session.ended": return { text: "סשן הטיוטה נסגר", tone: "" };
    case "onboarding.session.disconnected": return { text: "סשן הטיוטה נותק — השרת הופעל מחדש", tone: "warning" };
    case "onboarding.session.capped": return { text: `סשן הטיוטה נעצר בתקרה: ${fmtUsd(n("costUsd"))} · ${n("minutes")} דקות (התקרה ${fmtUsd(n("capUsd"))} · ${n("capMinutes")} דקות)`, tone: "warning" };
    case "onboarding.session.prompt": return { text: `נכתב ל-Claude: ${s("text")}`, tone: "ai" };
    case "onboarding.session.command": return { text: `פקודה בסשן: ${s("command")}`, tone: "ai" };
    case "onboarding.session.answer": return { text: `${s("question")} → ${s("answer")}`, tone: "" };
    case "onboarding.draft.scan_started": return { text: `סריקת טיוטת /init התחילה: ${Array.isArray(p.files) ? p.files.length : 0} קבצים`, tone: "ai" };
    case "onboarding.draft.scanned": return { text: `טיוטת /init נסרקה: ${n("cards")} כרטיסים לאישורך${n("asks") ? ` (${n("asks")} החלטות שלך)` : ""}, ${n("dropOurs")} משלנו מסומנים כמיותרים, ${n("rejected")} לא נלקחו · ${fmtUsd(n("costUsd"))}`, tone: "ai" };
    case "onboarding.draft.scan_failed": return { text: `סריקת טיוטת /init נכשלה: ${s("error")}`, tone: "critical" };
    case "onboarding.draft.set_aside": return { text: `טיוטת /init הוזזה הצידה (${n("count") || (Array.isArray(p.files) ? p.files.length : 0)} קבצים, נשמרו) — נכנס רק מה שאושר בכרטיס`, tone: "" };
    case "onboarding.draft.set_aside_failed": return { text: `הזזת הטיוטה הצידה נכשלה: ${s("error")}`, tone: "critical" };
    case "onboarding.draft.scan_applied": {
      const keys = Array.isArray(p.declined) ? (p.declined as string[]) : [];
      return { text: `הסריקה דחתה ${keys.length} כרטיסים משלנו כמיותרים: ${keys.map(card).join(", ")} — אפשר "בכל זאת" על כל אחד`, tone: "warning" };
    }
    case "onboarding.plan.reviewer_applied": {
      const keys = Array.isArray(p.declined) ? (p.declined as string[]) : [];
      return { text: `הסוקר דחה ${keys.length} כרטיסים כמיותרים: ${keys.map(card).join(", ")} — אפשר "בכל זאת" על כל אחד`, tone: "warning" };
    }
    case "onboarding.plan.pruned": {
      const m = Array.isArray(p.measured) ? (p.measured as string[]) : [];
      const d = Array.isArray(p.documented) ? (p.documented as string[]) : [];
      const parts = [...(m.length ? [`${m.length} שהמדידה הראתה שאין בהם צורך (${m.map(card).join(", ")})`] : []), ...(d.length ? [`${d.length} עזרי-תהליך שהתיעוד של הריפו כבר מכסה`] : [])];
      return { text: `לא מוצעים — ${parts.join(" · ")}`, tone: "" };
    }
    case "onboarding.plan.phase": {
      const why = s("why");
      const failed = why.startsWith("after_draft_failed");
      const reason = PHASE_WHY_HE[why] ?? (failed ? `הטיפול בטיוטה נכשל (${why.replace(/^after_draft_failed:\s*/, "")})` : why);
      return { text: `${PLAN_PHASE_HE[s("phase") as PlanPhase] ?? s("phase")}${reason ? ` — ${reason}` : ""}`, tone: failed ? "warning" : "" };
    }
    case "onboarding.session.instructed": return { text: `נשלחה לסשן הוראה מהצ'אט${p.forced ? " (למרות שהסשן נראה עסוק)" : ""}: ${s("text")}`, tone: "ai" };
    case "coach.proposal.created": return { text: `המאמן הציע: ${s("title")} (${PROPOSAL_KIND_HE[s("kind") as CoachProposal["kind"]] ?? s("kind")})`, tone: "ai" };
    case "coach.proposal.decided": return { text: `הצעת המאמן ${p.decision === "approve" ? "אושרה" : "נדחתה"}: ${s("title")}${p.reason ? ` — ${s("reason")}` : ""}`, tone: p.decision === "approve" ? "healthy" : "" };
    default: return { text: e.type, tone: "" };
  }
}
