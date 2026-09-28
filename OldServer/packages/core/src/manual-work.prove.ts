/**
 * Proves a task developed by a person goes through the same lifecycle as one
 * developed by Claude (manual-work.ts), and is never a second path:
 *
 *   A task is marked as developed by hand; from then on Claude is refused it
 *   and its checks. The person reports what was done — a summary, the
 *   customisations under the CUSTOMISATION: heading, the components — and that
 *   is recorded as the task's development: the status, the steps and the
 *   timeline read it like a run. Each check is then set by hand; a failure
 *   needs its reason; the done gate refuses while one has not passed, and lets
 *   go when they all have. A report can be replaced or taken back. A task
 *   cannot be both: Claude's development blocks the mark, a report blocks
 *   un-marking it, and a group is never marked.
 *
 * Its own database, git repository and Claude stand-in (prove-kit.ts).
 * Run: `npm run -w @dcc/core prove:manual`
 */
import { proveKit } from "./prove-kit.ts";

const k = await proveKit("manual");
const { check, clientId, by, core, dbm, schema, eq } = k;
const statusOf = async (id: string) => (await core.taskStatusOf(clientId, id)).status;
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return (e as Error).message; } };
const closeRefusal = async (id: string) => refusal(() => core.progressTask({ clientId, taskId: id, by, mode: "interactive", to: "done" }));
const ready = async (id: string) => { await core.approveTask(clientId, id, by); await k.syncSeq(); await k.inTfs(id); };
const runsOf = async (id: string) => dbm.db.select().from(schema.flowRun).where(eq(schema.flowRun.taskId, id));
const entity = (id: string) => ({ kind: "task" as const, id, clientId, workitemId: k.workitemId });

try {
  // 1. The mark, and what it does to Claude.
  const M = await k.addTask("M", "write m.txt");
  const NOT_MARKED = await k.addTask("plain", "write plain.txt");
  await ready(M.id); await ready(NOT_MARKED.id);
  check("a task that is not marked cannot be reported", (await refusal(() => core.reportManualDevelopment({ clientId, taskId: M.id, by, summary: "עשיתי" })))?.includes("סמנו קודם") === true);
  check("and Claude may develop it", (await core.ACTIONS.implement.allowed(by, entity(M.id), {})).ok);

  await core.setTaskManual(clientId, M.id, true, by);
  check("marked: the row says so", (await k.row(M.id)).developedManually === true);
  const denied = await core.ACTIONS.implement.allowed(by, entity(M.id), {});
  check("Claude is refused the task, and says why", !denied.ok && denied.reason.includes("מפותחת ידנית"), JSON.stringify(denied));
  const checksM = await k.checksOf(M.id);
  check("and its checks — the code is not in DCC's copy", checksM.length === 3 && (await Promise.all(checksM.map((c) => core.ACTIONS.implement.allowed(by, entity(c.id), {})))).every((a) => !a.ok));
  check("a task nobody marked is not affected", (await core.ACTIONS.implement.allowed(by, entity(NOT_MARKED.id), {})).ok);
  check("marked but not reported: ready to develop, like any other task", (await statusOf(M.id)).key === "ready", JSON.stringify(await statusOf(M.id)));

  // 2. What cannot be marked.
  const G = await k.addTask("G", "write g.txt");
  const sub = await k.addTask("g-sub", "write gs.txt");
  await dbm.withTenant(clientId, (tx) => tx.update(schema.task).set({ parentTaskId: G.id }).where(eq(schema.task.id, sub.id)));
  check("a group is never marked — its work is its sub-tasks", (await refusal(() => core.setTaskManual(clientId, G.id, true, by)))?.includes("קבוצה") === true);
  const chk = checksM[0]!;
  check("a check is not marked either", (await refusal(() => core.setTaskManual(clientId, chk.id, true, by)))?.includes("לא בדיקה") === true);

  // 3. The report — refused where a run would be, then accepted.
  const LATE = await k.addTask("late", "write late.txt");
  await core.approveTask(clientId, LATE.id, by);
  await core.setTaskManual(clientId, LATE.id, true, by);
  check("not in TFS yet: the report is refused, as development is", (await refusal(() => core.reportManualDevelopment({ clientId, taskId: LATE.id, by, summary: "עשיתי" })))?.includes("TFS") === true);
  check("a report that says nothing was done is refused", (await refusal(() => core.reportManualDevelopment({ clientId, taskId: M.id, by, summary: " " }))) !== null);

  await core.reportManualDevelopment({
    clientId, taskId: M.id, by, summary: "הוקם השדה וחובר לטופס", customisation: `${core.CUSTOMISATION_TEMPLATE}FormCancellation\nControlStageStatus`, components: "Alt.BL", reference: "branch/wi-1",
  });
  const dev = await core.latestDevelopment(M.id);
  check("the report is the task's development: what was said is what is kept", dev?.summary === "הוקם השדה וחובר לטופס" && JSON.stringify(dev.manual?.customisations) === JSON.stringify(["FormCancellation", "ControlStageStatus"]) && dev.manual?.reference === "branch/wi-1", JSON.stringify(dev));
  const afterReport = await core.taskStatusOf(clientId, M.id);
  check("so the status reads it as developed — and the build has not yet said anything", afterReport.developed && afterReport.status.key === "build_pending", JSON.stringify(afterReport.status));
  check("the task moved on: in progress", (await k.row(M.id)).state === "in_progress");
  const steps = (await core.taskFlowOf(clientId, M.id)).map((s) => `${s.kind}:${s.state}`).join(" ");
  check("its steps are the ordinary three", steps.split(" ").map((x) => x.split(":")[0]).join(",") === "develop,checks,review", steps);
  const events = await dbm.db.select().from(schema.eventLog).where(eq(schema.eventLog.workitemId, k.workitemId));
  check("the timeline says who reported, without Claude, with the customisation heading", events.some((e) => String((e.payload as { body?: string }).body ?? "").includes("CUSTOMISATION: FormCancellation · ControlStageStatus")));
  check("Claude is still refused after the report", !(await core.ACTIONS.implement.allowed(by, entity(M.id), {})).ok);

  // 4. Each check by hand, and the done gate reads them like any result.
  const [build, tests, regression] = await k.checksOf(M.id);
  const plainCheck = (await k.checksOf(NOT_MARKED.id))[0]!;
  check("a check of a task nobody has developed yet has nothing to be set on", (await refusal(() => core.setCheckManually({ clientId, checkId: plainCheck.id, result: "passed", by })))?.includes("עוד לא פותחה") === true);
  // Whoever developed the task, the last word on a check is a person's.
  await k.develop(NOT_MARKED.id);
  const claudeCheck = (await k.checksOf(NOT_MARKED.id)).find((c) => c.checkKind === "regression")!;
  await core.setCheckManually({ clientId, checkId: claudeCheck.id, result: "failed", note: "נבדק ידנית — נפל", by });
  check("a check of a task Claude developed can be set by hand too", (await k.row(claudeCheck.id)).checkResult === "failed");
  check("a failure needs its reason", (await refusal(() => core.setCheckManually({ clientId, checkId: regression!.id, result: "failed", by })))?.includes("מה נכשל") === true);
  await core.setCheckManually({ clientId, checkId: build!.id, result: "passed", note: "אין קימפול במשימה הזו — סקריפט בלבד", by });
  check("the build passed by hand: the row says so, and a person decided it", (await k.row(build!.id)).checkResult === "passed" && (await k.row(build!.id)).checkResolvedBy === by.userId);
  check("what the person wrote is what the check shows", (await core.checkOutcomesOf(clientId, M.id))[build!.id]?.detail === "אין קימפול במשימה הזו — סקריפט בלבד");
  await core.setCheckManually({ clientId, checkId: tests!.id, result: "passed", by });
  const midSteps = (await core.taskFlowOf(clientId, M.id)).map((s) => `${s.kind}:${s.state}`).join(" ");
  check("two of three checks marked: the checks step is still open, as the status says", midSteps === "develop:done checks:current review:todo" && (await statusOf(M.id)).key === "checks_pending", midSteps);
  await core.setCheckManually({ clientId, checkId: regression!.id, result: "failed", note: "נפל בעדכון הטופס", by });
  const failedStatus = await statusOf(M.id);
  check("a failed check makes the task failed, naming it", failedStatus.key === "failed" && failedStatus.label.includes("רגרסיה"), JSON.stringify(failedStatus));
  check("and the task cannot be closed while it stands", (await closeRefusal(M.id)) !== null);
  check("a failure carries no approval", (await k.row(regression!.id)).checkResolvedBy === null);
  await core.setCheckManually({ clientId, checkId: regression!.id, result: "passed", note: "תוקן", by });
  check("passed by hand: the task is ready for review", (await statusOf(M.id)).key === "review", JSON.stringify(await statusOf(M.id)));
  await core.setCheckManually({ clientId, checkId: tests!.id, result: "not_run", by });
  check("a check can go back to not run", (await k.row(tests!.id)).checkResult === null && (await statusOf(M.id)).key === "checks_pending");
  await core.setCheckManually({ clientId, checkId: tests!.id, result: "passed", by });
  // Not every task compiles: a check that does not apply is set aside with the ordinary switch, and stops counting.
  await core.setTaskActive(clientId, regression!.id, false, by);
  check("a check set aside as not applicable does not block", (await statusOf(M.id)).key === "review");
  await core.setTaskActive(clientId, regression!.id, true, by);
  await core.setCheckManually({ clientId, checkId: regression!.id, result: "passed", by });
  check("all passed by hand: the task closes through the ordinary gate", (await closeRefusal(M.id)) === null && (await k.row(M.id)).state === "done");
  await core.progressTask({ clientId, taskId: M.id, by, mode: "interactive", to: "in_progress", reopenReason: "בדיקה נוספת" });

  // 5. A report can be replaced, and taken back.
  await core.reportManualDevelopment({ clientId, taskId: M.id, by, summary: "נוסח מתוקן", customisation: `${core.CUSTOMISATION_TEMPLATE}Only` });
  const runs = await runsOf(M.id);
  check("replaced: the new report is current, the old one stays as history", (await core.latestDevelopment(M.id))?.summary === "נוסח מתוקן" && runs.filter((r) => r.state === "rolled_back").length === 1 && runs.filter((r) => r.state === "done").length === 1);
  check("it cannot be un-marked while a report stands", (await refusal(() => core.setTaskManual(clientId, M.id, false, by)))?.includes("דיווח ידני") === true);
  await core.cancelManualReport(clientId, M.id, by);
  check("taken back: not developed, checks cleared, ready to develop again", !(await core.taskStatusOf(clientId, M.id)).developed && (await k.checksOf(M.id)).every((c) => c.checkResult === null) && (await statusOf(M.id)).key === "ready", JSON.stringify(await statusOf(M.id)));
  check("and there is nothing more to take back", (await refusal(() => core.cancelManualReport(clientId, M.id, by))) !== null);
  await core.setTaskManual(clientId, M.id, false, by);
  check("handed back: Claude may develop it again", !(await k.row(M.id)).developedManually && (await core.ACTIONS.implement.allowed(by, entity(M.id), {})).ok);

  // 6. Never both: Claude's development blocks the mark.
  const C = await k.addTask("byClaude", "write c.txt");
  await ready(C.id);
  await k.develop(C.id);
  check("a task Claude developed cannot be marked — Rollback first", (await refusal(() => core.setTaskManual(clientId, C.id, true, by)))?.includes("Rollback") === true);
  await core.rollbackTask({ clientId, workitemId: k.workitemId, taskId: C.id, by });
  check("after Rollback it can", (await core.setTaskManual(clientId, C.id, true, by)).manual === true);
} finally {
  await k.finish();
}
