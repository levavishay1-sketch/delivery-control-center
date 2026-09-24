/**
 * A task developed by a person, not by Claude.
 *
 * Not every task is developed with Claude, and not every task compiles, so a
 * task can be marked as developed by hand. It then goes through the SAME
 * lifecycle as any other — nothing here is a second path:
 *
 *   - the report of what was done is recorded as a development run, marked
 *     manual, so the task's status, its steps and its checks read it exactly
 *     as they read Claude's work (`ownDevelopment` in ai-assist.ts);
 *   - each check can be set by hand, and is recorded like a check's own run;
 *   - the same done gate, the same reopen, the same timeline.
 *
 * What differs is only who did the work and what they can say about it: no
 * branch, no commit made by DCC — see manual-report.ts.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { appendEvent, db, withTenant } from "@dcc/db";
import { flowRun, task } from "@dcc/db/schema";
import { REQUIRED_CHECKS, ensureStandardChecks, liveTaskPhase } from "./ai-assist.ts";
import { regenerateBrief } from "./brief/generate.ts";
import { checkManualReport, manualReportNote, type ManualReportInput } from "./manual-report.ts";
import { syncTaskStateAfterCheckChange } from "./tasks.ts";

type By = { userId: string };

const isManualRun = (result: unknown) => !!(result as { manual?: unknown } | null)?.manual;

/** A task's finished development runs, newest first — the ones that count as it being developed. */
async function doneRuns(taskId: string) {
  return db.select({ id: flowRun.id, result: flowRun.result, startedAt: flowRun.startedAt }).from(flowRun)
    .where(and(eq(flowRun.taskId, taskId), eq(flowRun.kind, "implement"), eq(flowRun.state, "done")))
    .orderBy(desc(flowRun.startedAt));
}

async function loadTask(clientId: string, taskId: string) {
  const [t] = await withTenant(clientId, (tx) => tx.select().from(task).where(eq(task.id, taskId)).limit(1));
  if (!t) throw new Error("משימה לא נמצאה");
  return t;
}

async function isGroup(clientId: string, taskId: string): Promise<boolean> {
  const kids = await withTenant(clientId, (tx) => tx.select({ id: task.id }).from(task)
    .where(and(eq(task.parentTaskId, taskId), eq(task.kind, "task"), sql`${task.state} <> 'dropped'`)).limit(1));
  return kids.length > 0;
}

const note = (clientId: string, workitemId: string, taskId: string, by: By, body: string) =>
  appendEvent({
    clientId, workitemId, source: "manual", type: "note.added",
    actor: { kind: "user", userId: by.userId, identityType: "interactive" },
    links: [{ rel: "task", ref: taskId }],
    payload: { body },
  });

/**
 * Mark a task as developed by hand — or hand it back to Claude. Refused while
 * either kind of development is in place, so a task never carries two accounts
 * of who built it.
 */
export async function setTaskManual(clientId: string, taskId: string, manual: boolean, by: By): Promise<{ manual: boolean }> {
  const t = await loadTask(clientId, taskId);
  if (t.kind !== "task") throw new Error("רק משימה אפשר לסמן כמפותחת ידנית — לא בדיקה");
  if (await isGroup(clientId, taskId)) throw new Error("קבוצה לא מפותחת בעצמה — סמנו את תת-המשימות שלה");
  if (t.developedManually === manual) return { manual };
  if (liveTaskPhase(taskId)) throw new Error("יש הרצה של Claude על המשימה כרגע — עצרו אותה קודם");
  const latest = (await doneRuns(taskId))[0];
  if (manual && latest && !isManualRun(latest.result)) throw new Error("Claude כבר פיתח את המשימה — בצעו Rollback לפני שעוברים לפיתוח ידני");
  if (!manual && latest && isManualRun(latest.result)) throw new Error("כבר יש דיווח ידני על המשימה — בטלו אותו קודם");
  await withTenant(clientId, (tx) => tx.update(task).set({ developedManually: manual, updatedAt: new Date() }).where(eq(task.id, taskId)));
  await note(clientId, t.workitemId, taskId, by, manual
    ? `✍ משימה #${t.seq} סומנה כמפותחת ידנית — מי שמפתח אותה מדווח על העבודה בעצמו, בלי Claude.`
    : `משימה #${t.seq} חזרה להיות מפותחת עם Claude.`);
  await regenerateBrief(clientId, t.workitemId);
  return { manual };
}

/**
 * The report of a task somebody developed themselves. It counts as the task's
 * development, from then on: its checks are next, and they can be set by hand.
 * Reporting again replaces the earlier report.
 */
export async function reportManualDevelopment(input: { clientId: string; taskId: string; by: By } & ManualReportInput): Promise<{ reported: true }> {
  const { clientId, taskId, by } = input;
  const t = await loadTask(clientId, taskId);
  if (!t.developedManually) throw new Error("סמנו קודם את המשימה כמפותחת ידנית");
  if (!t.active || t.state === "dropped") throw new Error("המשימה לא פעילה");
  // The same rule as a run: nothing is developed before the task is approved and has a work item in TFS.
  if (!t.approvedAt || t.linkedAdoId == null) throw new Error("אי אפשר לדווח לפני שהמשימה מאושרת ומוקמה ב-TFS — על זה העבודה נעקבת");
  if (t.state === "done") throw new Error("המשימה כבר הושלמה — פתחו אותה מחדש כדי לעדכן את הדיווח");
  if (liveTaskPhase(taskId)) throw new Error("יש הרצה של Claude על המשימה כרגע");
  const checked = checkManualReport(input);
  if (!checked.ok) throw new Error(checked.why);
  const report = checked.value;

  const earlier = await doneRuns(taskId);
  if (earlier.some((r) => !isManualRun(r.result))) throw new Error("Claude כבר פיתח את המשימה — בצעו Rollback קודם");
  // A report replaces the one before it: that one stays in the history, no longer the current account.
  if (earlier.length) await db.update(flowRun).set({ state: "rolled_back" }).where(and(eq(flowRun.taskId, taskId), eq(flowRun.kind, "implement"), eq(flowRun.state, "done")));

  // The checks a task always has — the ones a person will now set by hand.
  await ensureStandardChecks(clientId, taskId, REQUIRED_CHECKS, { by });

  const now = new Date();
  await db.insert(flowRun).values({
    clientId, workitemId: t.workitemId, taskId, kind: "implement", state: "done", log: ["דווח ידנית — בלי Claude"],
    result: {
      manual: { customisations: report.customisations, components: report.components, reference: report.reference, reportedBy: by.userId, reportedAt: now.toISOString() },
      branch: "", dir: "", repoName: null, summary: report.summary, filesChanged: [], commit: null, testsRun: null, followUps: [], affectedConsumers: [],
    },
    startedBy: by.userId, startedAt: now, finishedAt: now,
  });
  if (t.state === "pending") await withTenant(clientId, (tx) => tx.update(task).set({ state: "in_progress", updatedAt: now }).where(eq(task.id, taskId)));
  await note(clientId, t.workitemId, taskId, by, manualReportNote(t.seq, report));
  await regenerateBrief(clientId, t.workitemId);
  return { reported: true };
}

/** Take a manual report back: the task looks as it did before it was reported, and the history keeps it. */
export async function cancelManualReport(clientId: string, taskId: string, by: By): Promise<{ cancelled: true }> {
  const t = await loadTask(clientId, taskId);
  const runs = await doneRuns(taskId);
  if (!runs.some((r) => isManualRun(r.result))) throw new Error("אין דיווח ידני לבטל");
  await db.update(flowRun).set({ state: "rolled_back" }).where(and(eq(flowRun.taskId, taskId), eq(flowRun.kind, "implement"), eq(flowRun.state, "done")));
  await withTenant(clientId, async (tx) => {
    await tx.update(task).set({ state: t.state === "in_progress" || t.state === "failed_checks" ? "pending" : t.state, wasDone: false, updatedAt: new Date() }).where(eq(task.id, taskId));
    // What its checks said described work that is no longer reported.
    await tx.update(task).set({ checkResult: null, checkCause: null, checkResolvedBy: null, checkResolvedAt: null, state: "pending", updatedAt: new Date() })
      .where(and(eq(task.parentTaskId, taskId), eq(task.kind, "check"), sql`${task.state} <> 'dropped'`));
  });
  await note(clientId, t.workitemId, taskId, by, `↩ הדיווח הידני על משימה #${t.seq} בוטל — המשימה נקייה כמו לפני שדווחה; מה שקרה נשאר בהיסטוריה.`);
  await regenerateBrief(clientId, t.workitemId);
  return { cancelled: true };
}

/**
 * Set one check of a task developed by hand: it passed, it failed, or it is
 * back to "not run". Recorded as that check's own run, so what the person
 * wrote is what the check shows — and the done gate reads it like any result.
 */
export async function setCheckManually(input: { clientId: string; checkId: string; result: "passed" | "failed" | "not_run"; note?: string; by: By }): Promise<{ result: string }> {
  const { clientId, checkId, by } = input;
  const c = await loadTask(clientId, checkId);
  if (c.kind !== "check" || !c.parentTaskId) throw new Error("זו לא בדיקה");
  const parent = await loadTask(clientId, c.parentTaskId);
  if (!parent.developedManually) throw new Error("רק בדיקה של משימה שסומנה כמפותחת ידנית אפשר לערוך ידנית");
  if (!(await doneRuns(parent.id)).some((r) => isManualRun(r.result))) throw new Error("דווחו קודם על הפיתוח — ואז אפשר לסמן את הבדיקות");
  const text = (input.note ?? "").trim();
  if (input.result === "failed" && !text) throw new Error("כתבו מה נכשל — כדי שמי שימשיך יבין");

  const now = new Date();
  await withTenant(clientId, (tx) => tx.update(task).set(
    input.result === "not_run"
      ? { checkResult: null, checkCause: null, checkResolvedBy: null, checkResolvedAt: null, state: "pending", updatedAt: now }
      : {
          checkResult: input.result, checkCause: null, state: input.result === "passed" ? "done" : "pending", updatedAt: now,
          // A person decided this one; a failure is not an approval, so it carries no resolver.
          ...(input.result === "passed" ? { checkResolvedBy: by.userId, checkResolvedAt: now } : { checkResolvedBy: null, checkResolvedAt: null }),
        },
  ).where(eq(task.id, checkId)));
  if (input.result !== "not_run") {
    await db.insert(flowRun).values({
      clientId, workitemId: c.workitemId, taskId: checkId, kind: "implement", state: "done", log: ["סומן ידנית"],
      result: {
        manual: { by: by.userId }, summary: text || "סומן ידנית",
        checks: [{ seq: c.seq, passed: input.result === "passed", detail: text || "סומן ידנית כעברה", likelyCause: null, kind: c.checkKind }],
      },
      startedBy: by.userId, startedAt: now, finishedAt: now,
    });
  }
  await syncTaskStateAfterCheckChange(clientId, parent.id);
  const word = input.result === "passed" ? "✓ עברה" : input.result === "failed" ? "✕ נכשלה" : "· חזרה להיות לא רצה";
  await note(clientId, c.workitemId, checkId, by, `✍ בדיקה #${c.seq} של משימה #${parent.seq} סומנה ידנית: ${word}${text ? ` — ${text}` : ""}`);
  await regenerateBrief(clientId, c.workitemId);
  return { result: input.result };
}
