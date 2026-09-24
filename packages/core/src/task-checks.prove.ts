/**
 * Proves how every task is verified and what its status says (task-status.ts):
 *
 *   A task gets a build, a tests and a regression check when approved — once.
 *   Developing it: the code (a model call, write access), the build (run
 *   directly — the real build of the projects it changed, never a model call),
 *   then the other checks (a model call, commands, no write access); a check
 *   that changes a file has it put back. A build that fails stops the tests,
 *   and passing it on its own rerun takes the task out of failed_checks. A task
 *   that changed nothing has nothing to build. A dependent task that passes
 *   everything still waits for its dependency, and cannot be closed until it
 *   is done. E2E is added on request. A task with sub-tasks is a group: it is
 *   never developed itself, its status follows its sub-tasks, and its own
 *   check runs on all of their work together.
 *
 * Its own database, git repository and Claude stand-in (prove-kit.ts).
 * Run: `npm run -w @dcc/core prove:checks`
 */
import { proveKit } from "./prove-kit.ts";

const k = await proveKit("checks");
const { check, g, cache, clientId, by, core } = k;
/** The tools a call was given — the value of --allowed-tools. */
const tools = (args: string[]) => args[args.indexOf("--allowed-tools") + 1] ?? "";
const statusOf = async (id: string) => (await core.taskStatusOf(clientId, id)).status;
const closeRefusal = async (id: string, override?: string) => {
  try { await core.progressTask({ clientId, taskId: id, by, mode: "interactive", to: "done", ...(override ? { overrideChecks: true, overrideReason: override } : {}) }); return null; }
  catch (e) { return (e as Error).message; }
};

try {
  // 1. The checks every task gets.
  const A = await k.addTask("A", "write a.txt");
  check("before approval: waiting for approval and the TFS setup", (await statusOf(A.id)).key === "awaiting_approval");
  await core.approveTask(clientId, A.id, by);
  await k.syncSeq();
  const entityA = { kind: "task" as const, id: A.id, clientId, workitemId: k.workitemId };
  check("approved, not in TFS yet: waiting for it, and development is refused", (await statusOf(A.id)).key === "awaiting_tfs" && !(await core.ACTIONS.implement.allowed(by, entityA, {})).ok);
  await k.inTfs(A.id);
  check("in TFS: development is allowed", (await core.ACTIONS.implement.allowed(by, entityA, {})).ok);
  let checksA = await k.checksOf(A.id);
  check("approval adds a build, a tests and a regression check, approved with it", JSON.stringify(checksA.map((c) => c.checkKind)) === JSON.stringify(["build", "tests", "regression"]) && checksA.every((c) => !!c.approvedAt), JSON.stringify(checksA.map((c) => [c.checkKind, !!c.approvedAt])));
  check("each carries its own copy of its instruction", checksA[0]!.prompt?.startsWith("Build לשינוי") === true && checksA[2]!.prompt?.startsWith("בדיקות רגרסיה") === true);
  await core.approveTask(clientId, A.id, by);
  check("approving again adds nothing", (await k.checksOf(A.id)).length === 3);
  check("approved and nothing it waits for: ready to develop", (await statusOf(A.id)).key === "ready");

  // 2. Developing: the code, the build (directly), the other checks — in order.
  let from = k.callCount();
  const run = await k.develop(A.id);
  const calls = k.calls(from);
  check("development is two model calls: the code, then the other checks — the build is not one", calls.length === 2, String(calls.length));
  check("the code is written with write access, and is told to write tests — not to report checks", tools(calls[0]!.args) === "Read,Grep,Glob,Edit,Write,Bash" && calls[0]!.prompt.includes("3. Tests: add tests") && !calls[0]!.prompt.includes('"checks"'));
  check("the other checks run after the build, with no write access, and without it", calls[1]!.prompt.includes("[tests]") && calls[1]!.prompt.includes("[regression]") && !calls[1]!.prompt.includes("[build]") && tools(calls[1]!.args) === "Read,Grep,Glob,Bash");
  const lines = (run.log ?? []) as string[];
  check("the build ran directly: the real build of the package the task changed", lines.some((l) => l.includes("Build ישירות (בלי AI): package.json")), lines.filter((l) => l.includes("Build")).join(" / "));
  const at = (s: string) => lines.findIndex((l) => l.includes(s));
  check("the run says each step as it gets to it", at("שלב 1 מתוך 3") >= 0 && at("שלב 1 מתוך 3") < at("שלב 2 מתוך 3") && at("שלב 2 מתוך 3") < at("שלב 3 מתוך 3"));
  checksA = await k.checksOf(A.id);
  check("every check passed, and says so", checksA.every((c) => c.checkResult === "passed"), JSON.stringify(checksA.map((c) => c.checkResult)));
  check("all passed, nothing waited for: ready for review and closing", (await statusOf(A.id)).key === "review");

  // 3. A dependent task passes everything, and still waits for its dependency.
  const B = await k.addTask("B", "write b.txt", { dependsOn: [A.id] });
  await core.approveTask(clientId, B.id, by);
  await k.syncSeq();
  await k.inTfs(B.id);
  const readyB = await statusOf(B.id);
  check("a dependent task whose dependency has code is ready, with an orange dependency tag beside it", readyB.key === "ready" && readyB.dependency?.tone === "warning" && readyB.dependency.label === "🔗 תלויה ב-#1", JSON.stringify(readyB));
  await k.develop(B.id);
  const waitB = await statusOf(B.id);
  check("B passed everything and waits for A: 'finished — waiting for its dependency'", waitB.key === "waiting_dependency" && waitB.tone === "warning", JSON.stringify(waitB));
  const refused = await closeRefusal(B.id);
  check("B cannot be closed while A is not done", !!refused && refused.includes("#1 עוד לא הושלמה"), String(refused));
  check("A can be closed", (await closeRefusal(A.id)) === null);
  check("once A is done, B is ready for review, and the tag is gone", (await statusOf(B.id)).key === "review" && !(await statusOf(B.id)).dependency, JSON.stringify(await statusOf(B.id)));
  check("and can be closed", (await closeRefusal(B.id)) === null);

  // 4. A build that fails stops the tests, and the status says why.
  const Cx = await k.addTask("C", "write broken.txt");
  await core.approveTask(clientId, Cx.id, by);
  await k.syncSeq();
  await k.inTfs(Cx.id);
  from = k.callCount();
  await k.develop(Cx.id);
  check("a failed build stops there: the one model call is the code, the tests never ran", k.calls(from).length === 1, String(k.calls(from).length));
  const checksC = await k.checksOf(Cx.id);
  check("the build failed and the others did not run", checksC[0]!.checkResult === "failed" && checksC.slice(1).every((c) => c.checkResult === null), JSON.stringify(checksC.map((c) => c.checkResult)));
  const fellC = await statusOf(Cx.id);
  check("status: fell, because the build failed", fellC.key === "failed" && fellC.reason === "ה-Build נכשל" && fellC.tone === "critical", JSON.stringify(fellC));
  check("and it is 'failed checks' underneath", (await k.row(Cx.id)).state === "failed_checks");

  // 4b. The live bug: the build is fixed and passes on its own rerun, the other checks have not run —
  //     nothing failed any more, so the stored state leaves failed_checks, and the status says what is left.
  g(cache, "checkout", "--quiet", k.branchOf(Cx));
  g(cache, "rm", "--quiet", "broken.txt");
  g(cache, "commit", "--quiet", "-m", "fix the build");
  const buildC = checksC.find((c) => c.checkKind === "build")!;
  from = k.callCount();
  await k.develop(buildC.id);
  check("the build rerun on its own is not a model call", k.calls(from).length === 0, String(k.calls(from).length));
  const rerunC = await k.checksOf(Cx.id);
  check("the build passed; the others still have not run", rerunC[0]!.checkResult === "passed" && rerunC.slice(1).every((c) => c.checkResult === null), JSON.stringify(rerunC.map((c) => c.checkResult)));
  check("so it is no longer 'failed checks' underneath", (await k.row(Cx.id)).state === "in_progress", (await k.row(Cx.id)).state);
  check("and the status: waiting for the checks to run", (await statusOf(Cx.id)).key === "checks_pending", JSON.stringify(await statusOf(Cx.id)));
  const outcome = (await core.checkOutcomesOf(clientId, Cx.id))[buildC.id];
  check("each check's last outcome is its own rerun's, not the stale one of the task's run", outcome?.passed === true, JSON.stringify(outcome));

  // 4c. Rollback: the checks verified code that is gone — they read as not run, and the task as ready again.
  await core.rollbackTask({ clientId, workitemId: k.workitemId, taskId: Cx.id, by });
  const rolledC = await k.checksOf(Cx.id);
  const afterRollback = [rolledC.map((c) => c.checkResult), (await k.row(Cx.id)).state, (await statusOf(Cx.id)).key];
  check("after Rollback its checks have not run, and it is ready to develop again", rolledC.every((c) => c.checkResult === null) && afterRollback[1] === "pending" && afterRollback[2] === "ready", JSON.stringify(afterRollback));

  // 4d. A task that changed no file has nothing to build — said, not guessed.
  const N = await k.addTask("N", "decide the wording, no code");
  await core.approveTask(clientId, N.id, by);
  await k.syncSeq();
  await k.inTfs(N.id);
  await k.develop(N.id);
  const buildN = (await k.checksOf(N.id)).find((c) => c.checkKind === "build")!;
  const outN = (await core.checkOutcomesOf(clientId, N.id))[buildN.id];
  check("a task that changed nothing: its build passes as 'nothing to build'", buildN.checkResult === "passed" && !!outN?.detail.includes("אין מה לבנות"), JSON.stringify(outN));
  const previewN = await core.previewImplementPrompt({ clientId, workitemId: k.workitemId, taskId: buildN.id });
  check("and its preview says so — never a prompt", previewN.deterministic === true && previewN.prompt.includes("אין מה לבנות"), previewN.prompt);
  const previewA = await core.previewImplementPrompt({ clientId, workitemId: k.workitemId, taskId: checksA[0]!.id });
  check("a build's preview is the real command", previewA.deterministic === true && previewA.prompt.includes("npm run build"), previewA.prompt);

  // 5. Developed without a dependency: the check that needs it waits, and the task cannot be closed.
  const E = await k.addTask("E", "write e.txt");
  const D = await k.addTask("D", "write d.txt", { dependsOn: [E.id] });
  await k.addTask("D uses E", "D works — needs e.txt", { parent: D.id });
  await core.approveTask(clientId, D.id, by);
  await k.syncSeq();
  await k.inTfs(D.id);
  const readyD = await statusOf(D.id);
  check("D depends on E, which has no code: ready, with a red 'a dependency exists' tag", readyD.key === "ready" && readyD.dependency?.tone === "critical", JSON.stringify(readyD));
  await k.develop(D.id);
  const waitD = await statusOf(D.id);
  check("D developed without E waits for it", waitD.key === "waiting_dependency", JSON.stringify(waitD));
  const refusedD = await closeRefusal(D.id);
  check("D cannot be closed: its check waits and it was built without E", !!refusedD && refusedD.includes("מחכות לתלות") && refusedD.includes("פותחה בלי #"), String(refusedD));
  check("a person can still close it, with a reason, and it is recorded", (await closeRefusal(D.id, "E is dropped from scope")) === null && (await k.row(D.id)).state === "done");

  // 6. A check that changes a file has it put back.
  const F = await k.addTask("F", "write f.txt");
  await k.addTask("F check", "tamper with base.txt", { parent: F.id });
  await core.approveTask(clientId, F.id, by);
  await k.syncSeq();
  await k.inTfs(F.id);
  const runF = await k.develop(F.id);
  check("what a check changed is put back, and said", g(cache, "status", "--porcelain", "--untracked-files=no") === "" && g(cache, "show", `${k.branchOf(F)}:base.txt`) === "base" && ((runF.log ?? []) as string[]).some((l) => l.includes("השינוי בוטל")));

  // 7. E2E on request, once; a task with sub-tasks gets none.
  const addedE2E = await core.ensureStandardChecks(clientId, F.id, ["e2e"], { by });
  const again = await core.ensureStandardChecks(clientId, F.id, ["e2e"], { by });
  check("E2E is added on request, once", addedE2E.length === 1 && again.length === 0 && (await k.checksOf(F.id)).some((c) => c.checkKind === "e2e"));
  const P = await k.addTask("P", "a grouping");
  const child = await k.addTask("P child", "write p.txt");
  await k.dbm.withTenant(clientId, (tx) => tx.update(k.schema.task).set({ parentTaskId: P.id }).where(k.eq(k.schema.task.id, child.id)));
  check("a task with sub-tasks gets no checks of its own — its sub-tasks do", (await core.ensureStandardChecks(clientId, P.id)).length === 0);

  // 7b. A group: never developed itself; its status follows its sub-tasks; a sub-task waits for what its group
  //     waits for; its own check runs on all its sub-tasks' work together, and says so when two of them collide.
  const subtask = async (intent: string, prompt: string, parent: string) => {
    const t = await k.addTask(intent, prompt);
    await k.dbm.withTenant(clientId, (tx) => tx.update(k.schema.task).set({ parentTaskId: parent }).where(k.eq(k.schema.task.id, t.id)));
    return t;
  };
  const Z = await k.addTask("Z", "write z.txt");
  const Q = await k.addTask("Q", "the q feature", { dependsOn: [Z.id] });
  const Q1 = await subtask("Q1", "write q1.txt", Q.id);
  const Q2 = await subtask("Q2", "write q2.txt", Q.id);
  const QC = await k.addTask("Q together", "Q works — needs q2.txt", { parent: Q.id });
  for (const x of [Z, Q, Q1, Q2]) { await core.approveTask(clientId, x.id, by); await k.syncSeq(); await k.inTfs(x.id); }
  const allowedQ = await core.ACTIONS.implement.allowed(by, { kind: "task", id: Q.id, clientId, workitemId: k.workitemId }, {});
  check("a group is refused development, and told why", !allowedQ.ok && (allowedQ.reason ?? "").includes("קבוצה"), JSON.stringify(allowedQ));
  check("a group gets none of the standard checks", (await k.checksOf(Q.id)).filter((c) => c.checkKind).length === 0);
  const openQ = await statusOf(Q.id);
  check("its status follows its sub-tasks — never 'ready to develop'", openQ.key === "group_open" && openQ.label === "0/2 תת-משימות הסתיימו", JSON.stringify(openQ));
  check("a sub-task waits for what its group waits for — the tag names it", (await statusOf(Q1.id)).dependency?.label === `🔗 קיימת תלות · #${Z.seq}`, JSON.stringify(await statusOf(Q1.id)));
  // Z first — a sub-task developed before its group's dependency would have to be rebuilt on it.
  await k.develop(Z.id);
  check("the group's dependency is done, and so the sub-tasks' tag is gone", (await closeRefusal(Z.id)) === null && !(await statusOf(Q1.id)).dependency, JSON.stringify(await statusOf(Q1.id)));
  let early = "";
  try { await k.develop(QC.id); } catch (e) { early = (e as Error).message; }
  check("the group's check does not run before every sub-task is developed", early.includes(`#${Q2.seq}`) && early.includes("עוד לא פותחה"), early);
  await k.develop(Q1.id);
  await k.develop(Q2.id);
  check("every sub-task developed: waiting for the group's own check", (await statusOf(Q.id)).key === "checks_pending", JSON.stringify(await statusOf(Q.id)));
  await k.develop(QC.id);
  check("the group's check ran on both sub-tasks' work together — and passed", (await k.row(QC.id)).checkResult === "passed", String((await k.row(QC.id)).checkResult));
  const refusedQ = await closeRefusal(Q.id);
  check("a group cannot close while its sub-tasks are open", !!refusedQ && refusedQ.includes("עוד לא הסתיימה"), String(refusedQ));
  const closedSubs = (await closeRefusal(Q1.id)) === null && (await closeRefusal(Q2.id)) === null;
  check("each sub-task closes — then the group is ready to close, and closes", closedSubs && (await statusOf(Q.id)).key === "review" && (await closeRefusal(Q.id)) === null, JSON.stringify(await statusOf(Q.id)));

  const R = await k.addTask("R", "the r feature");
  const R1 = await subtask("R1", "write same.txt now", R.id);
  const R2 = await subtask("R2", "write same.txt later", R.id);
  const RC = await k.addTask("R together", "R works", { parent: R.id });
  for (const x of [R, R1, R2]) { await core.approveTask(clientId, x.id, by); await k.syncSeq(); await k.inTfs(x.id); }
  await k.develop(R1.id);
  await k.develop(R2.id);
  await k.develop(RC.id);
  const outcomesR = JSON.stringify(await core.checkOutcomesOf(clientId, R.id));
  check("two sub-tasks that change the same lines differently: the group's check fails, naming the file", (await k.row(RC.id)).checkResult === "failed" && outcomesR.includes("same.txt"), outcomesR);
  check("and the group says it fell on it", (await statusOf(R.id)).key === "failed", JSON.stringify(await statusOf(R.id)));

  // 8. The task's steps: a dependency that arrives after the checks ran is a step of its own, and the checks run again after it.
  const H = await k.addTask("H", "write h.txt");
  const G = await k.addTask("G", "write g.txt", { dependsOn: [H.id] });
  for (const x of [G, H]) { await core.approveTask(clientId, x.id, by); await k.syncSeq(); await k.inTfs(x.id); }
  const steps = async () => (await core.taskFlowOf(clientId, G.id)).map((s) => `${s.kind}:${s.state}`).join(" ");
  check("before any run: three steps, development first, nothing marked done", (await steps()) === "develop:current checks:todo review:todo", await steps());
  await k.develop(G.id);
  check("developed without H: development and checks done, review next", (await steps()) === "develop:done checks:done review:current", await steps());
  check("the dependency tag stays on while it runs and after — red, H has no code", (await statusOf(G.id)).dependency?.tone === "critical");
  await k.develop(H.id);
  const pending = "develop:done checks:done dependency:current checks:todo review:todo";
  check("H has code now: a dependency step comes in as the next thing to do", (await steps()) === pending, await steps());
  check("and the tag turns orange — H has code but is not done", (await statusOf(G.id)).dependency?.tone === "warning");
  await core.rollbackTask({ clientId, workitemId: k.workitemId, taskId: G.id, by });
  check("after Rollback the dependency step is still the next thing to do", (await steps()) === pending, await steps());
  await k.develop(G.id);
  check("run again on H: the dependency step is done, and the checks ran again after it", (await steps()) === "develop:done checks:done dependency:done checks:done review:current", await steps());
  const flowG = await core.taskFlowOf(clientId, G.id);
  check("the first round stays as history, and the dependency step names H", flowG.slice(0, 2).every((s) => s.past) && JSON.stringify(flowG[2]!.deps) === JSON.stringify([(await k.row(H.id)).seq]));
  check("H closes, then G closes — its review step is done", (await closeRefusal(H.id)) === null && (await closeRefusal(G.id)) === null && (await steps()).endsWith("review:done"), await steps());
} finally {
  await k.finish();
}
