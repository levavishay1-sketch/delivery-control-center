/**
 * A task's status as a person reads it — computed, never stored. Pure (no
 * database, no git), so it is tested on its own; `ai-assist.ts` gathers the
 * facts. The stored `task.state` stays the small set the rest of the system
 * (TFS, the flow graph) runs on; everything finer here — which phase a run is
 * in, why it fell, whether it waits for a dependency — follows from facts
 * that already exist (the live run, the checks, the dependencies), so it can
 * never disagree with them.
 */

export type CheckKind = "build" | "tests" | "regression" | "e2e";
export type StatusTone = "inactive" | "neutral" | "ai" | "active" | "warning" | "critical" | "healthy";
export type RunPhase = "develop" | "build" | "test";

export type TaskStatusKey =
  | "inactive" | "dropped" | "awaiting_approval" | "dependency_open" | "ready" | "blocked"
  | "running" | "failed" | "checks_pending" | "waiting_dependency" | "review" | "done"
  // a check row's own status
  | "check_passed" | "check_failed" | "check_waiting" | "check_not_run";

export type TaskStatus = { key: TaskStatusKey; label: string; tone: StatusTone; reason?: string };

export type StatusCheck = { seq: number; kind: string | null; result: string | null; cause: string | null; active: boolean };
export type StatusDep = { seq: number; developed: boolean };

export type StatusFacts = {
  kind: string;
  state: string;
  active: boolean;
  approved: boolean;
  /** A run of it is going on now, in this phase. */
  running: RunPhase | null;
  /** Its last development run ended in an error (and nothing ran after it). */
  lastRunError: string | null;
  /** It has a development run that finished (not rolled back). */
  developed: boolean;
  checks: StatusCheck[];
  /** Tasks it depends on that are not done. */
  openDeps: StatusDep[];
  /** Tasks it was developed without (task-base.ts) — they are not in its branch. */
  builtWithout: { seq: number; available: boolean }[];
  /** The task it is built on gained work after it was built. */
  onMoved: { seq: number } | null;
  /** Check rows only: why it did not pass. */
  checkResult?: string | null;
  checkCause?: string | null;
};

const PHASE_HE: Record<RunPhase, string> = { develop: "בפיתוח", build: "מקמפלת", test: "בבדיקות" };
const KIND_ORDER: (string | null)[] = ["build", "tests", "regression", "e2e", null];
const refs = (xs: { seq: number }[]) => xs.map((x) => `#${x.seq}`).join(", ");

function whyFailed(c: StatusCheck): string {
  if (c.cause === "environment") return c.kind === "build" ? "אי אפשר לבנות כאן — חסר כלי או SDK" : `בדיקה #${c.seq} לא יכלה לרוץ כאן`;
  if (c.cause === "requirement_ambiguity") return `בדיקה #${c.seq} נכשלה — כנראה עמימות בדרישה`;
  switch (c.kind) {
    case "build": return "ה-Build נכשל";
    case "tests": return "בדיקות הפיתוח נכשלו";
    case "regression": return "בדיקות רגרסיה נכשלו";
    case "e2e": return "בדיקות E2E נכשלו";
    default: return `בדיקה #${c.seq} נכשלה`;
  }
}

export function taskStatus(f: StatusFacts): TaskStatus {
  if (f.kind === "check") return checkStatus(f);
  if (!f.active) return { key: "inactive", label: "לא פעילה", tone: "inactive" };
  if (f.state === "dropped") return { key: "dropped", label: "נדחתה", tone: "inactive" };
  if (f.state === "done") return { key: "done", label: "הסתיימה", tone: "healthy" };
  if (!f.approved) return { key: "awaiting_approval", label: "ממתינה לאישור והקמה ב-TFS", tone: "inactive" };
  if (f.running) return { key: "running", label: `בעבודה · ${PHASE_HE[f.running]}`, tone: "active" };

  const checks = f.checks.filter((c) => c.active).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.seq - b.seq);
  const failed = checks.filter((c) => c.result === "failed");
  if (failed.length) {
    return { key: "failed", label: "נפלה", tone: "critical", reason: `${whyFailed(failed[0]!)}${failed.length > 1 ? ` (ועוד ${failed.length - 1})` : ""}` };
  }
  if (f.lastRunError) return { key: "failed", label: "נפלה", tone: "critical", reason: `ההרצה לא הסתיימה: ${f.lastRunError.slice(0, 120)}` };
  if (f.state === "blocked") return { key: "blocked", label: "חסומה", tone: "critical", reason: "סומנה כחסומה ידנית" };

  if (!f.developed) {
    const notDeveloped = f.openDeps.filter((d) => !d.developed);
    if (notDeveloped.length) return { key: "dependency_open", label: "קיימת תלות", tone: "critical", reason: `${refs(notDeveloped)} עוד לא פותחה — אפשר לפתח בכל זאת, ולחזור אליה אחר כך` };
    return { key: "ready", label: "מוכנה לפיתוח", tone: "neutral", ...(f.openDeps.length ? { reason: `תיבנה על גבי ${refs(f.openDeps)}` } : {}) };
  }

  // Developed: what is left before it can be closed. Checks that never ran come first —
  // nothing can be said to wait for a dependency before the checks have said anything.
  const notRun = checks.filter((c) => c.result == null);
  if (notRun.length) return { key: "checks_pending", label: "בעבודה · בדיקות שלא רצו", tone: "active", reason: `${notRun.length} בדיקות עוד לא רצו — הרצה חוזרת תריץ אותן` };
  const waiting = checks.filter((c) => c.result === "waiting");
  const available = f.builtWithout.filter((d) => d.available);
  if (available.length) return { key: "waiting_dependency", label: "הסתיימה — ממתינה לתלות", tone: "warning", reason: `${refs(available)} פותחה מאז — Rollback והרצה חוזרת כדי לבנות עליה ולהריץ שוב את הבדיקות` };
  if (f.onMoved) return { key: "waiting_dependency", label: "הסתיימה — ממתינה לתלות", tone: "warning", reason: `#${f.onMoved.seq} השתנתה אחרי שהמשימה נבנתה — Rollback והרצה חוזרת` };
  if (f.builtWithout.length || waiting.length || f.openDeps.length) {
    const on = [...new Map([...f.builtWithout, ...f.openDeps].map((d) => [d.seq, d])).values()];
    return {
      key: "waiting_dependency", label: "הסתיימה — ממתינה לתלות", tone: "warning",
      reason: on.length ? `${refs(on)} עוד לא הושלמה — אחרי שתושלם, הבדיקות ירוצו שוב` : `${waiting.length} בדיקות מחכות לעבודה שעוד לא קיימת`,
    };
  }
  return { key: "review", label: "ממתינה לסקירה וסגירה", tone: "ai", reason: "הפיתוח והבדיקות עברו — נשאר לסקור, לדחוף ולסמן כהסתיימה" };
}

function checkStatus(f: StatusFacts): TaskStatus {
  if (!f.active) return { key: "inactive", label: "לא פעילה", tone: "inactive" };
  if (f.running) return { key: "running", label: "רצה", tone: "active" };
  if (f.checkResult === "passed") return { key: "check_passed", label: "עברה", tone: "healthy" };
  if (f.checkResult === "waiting") return { key: "check_waiting", label: "מחכה לתלות", tone: "warning" };
  if (f.checkResult === "failed") {
    return f.checkCause === "environment"
      ? { key: "check_failed", label: "לא יכלה לרוץ כאן", tone: "critical" }
      : { key: "check_failed", label: "נכשלה", tone: "critical" };
  }
  return { key: "check_not_run", label: "לא רצה עדיין", tone: "inactive" };
}

/** What stops a task from being closed — the dependency side of it (the checks are counted apart). Empty = nothing. */
export function dependencyBlockers(f: Pick<StatusFacts, "openDeps" | "builtWithout" | "onMoved">): string[] {
  const out: string[] = [];
  if (f.openDeps.length) out.push(`${refs(f.openDeps)} עוד לא הושלמה — משימה תלויה נסגרת רק אחרי התלות שלה`);
  if (f.builtWithout.length) out.push(`המשימה פותחה בלי ${refs(f.builtWithout)} — Rollback והרצה חוזרת כדי שתיבנה עליה והבדיקות ירוצו שוב`);
  if (f.onMoved) out.push(`#${f.onMoved.seq} השתנתה אחרי שהמשימה נבנתה — Rollback והרצה חוזרת כדי שהבדיקות ירוצו על המצב הסופי שלה`);
  return out;
}
