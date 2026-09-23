/**
 * Proves how every task is verified and what its status says (task-status.ts):
 *
 *   A task gets a build, a tests and a regression check when approved — once.
 *   Developing it is three calls: the code (write access), the build checks,
 *   then the others (commands, no write access); a check that changes a file
 *   has it put back. A build that fails stops the tests. A dependent task that
 *   passes everything still waits for its dependency, and cannot be closed
 *   until it is done. E2E is added on request. A task with sub-tasks gets none.
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
  let checksA = await k.checksOf(A.id);
  check("approval adds a build, a tests and a regression check, approved with it", JSON.stringify(checksA.map((c) => c.checkKind)) === JSON.stringify(["build", "tests", "regression"]) && checksA.every((c) => !!c.approvedAt), JSON.stringify(checksA.map((c) => [c.checkKind, !!c.approvedAt])));
  check("each carries its own copy of its instruction", checksA[0]!.prompt?.startsWith("Build לשינוי") === true && checksA[2]!.prompt?.startsWith("בדיקות רגרסיה") === true);
  await core.approveTask(clientId, A.id, by);
  check("approving again adds nothing", (await k.checksOf(A.id)).length === 3);
  check("approved and nothing it waits for: ready to develop", (await statusOf(A.id)).key === "ready");

  // 2. Developing is three calls, in order.
  let from = k.callCount();
  const run = await k.develop(A.id);
  const calls = k.calls(from);
  check("development is three calls: the code, the build, the other checks", calls.length === 3, String(calls.length));
  check("the code is written with write access, and is told to write tests — not to report checks", tools(calls[0]!.args) === "Read,Grep,Glob,Edit,Write,Bash" && calls[0]!.prompt.includes("3. Tests: add tests") && !calls[0]!.prompt.includes('"checks"'));
  check("the build runs alone, with commands and no write access", tools(calls[1]!.args) === "Read,Grep,Glob,Bash" && /#\d+ \[build\]/.test(calls[1]!.prompt) && !calls[1]!.prompt.includes("[tests]"));
  check("the other checks run after it, with no write access", calls[2]!.prompt.includes("[tests]") && calls[2]!.prompt.includes("[regression]") && tools(calls[2]!.args) === "Read,Grep,Glob,Bash");
  const lines = (run.log ?? []) as string[];
  const at = (s: string) => lines.findIndex((l) => l.includes(s));
  check("the run says each step as it gets to it", at("שלב 1 מתוך 3") >= 0 && at("שלב 1 מתוך 3") < at("שלב 2 מתוך 3") && at("שלב 2 מתוך 3") < at("שלב 3 מתוך 3"));
  checksA = await k.checksOf(A.id);
  check("every check passed, and says so", checksA.every((c) => c.checkResult === "passed"), JSON.stringify(checksA.map((c) => c.checkResult)));
  check("all passed, nothing waited for: ready for review and closing", (await statusOf(A.id)).key === "review");

  // 3. A dependent task passes everything, and still waits for its dependency.
  const B = await k.addTask("B", "write b.txt", { dependsOn: [A.id] });
  await core.approveTask(clientId, B.id, by);
  await k.syncSeq();
  const readyB = await statusOf(B.id);
  check("a dependent task whose dependency has code is ready, and says what it will be built on", readyB.key === "ready" && readyB.reason === "תיבנה על גבי #1", JSON.stringify(readyB));
  await k.develop(B.id);
  const waitB = await statusOf(B.id);
  check("B passed everything and waits for A: 'finished — waiting for its dependency'", waitB.key === "waiting_dependency" && waitB.tone === "warning", JSON.stringify(waitB));
  const refused = await closeRefusal(B.id);
  check("B cannot be closed while A is not done", !!refused && refused.includes("#1 עוד לא הושלמה"), String(refused));
  check("A can be closed", (await closeRefusal(A.id)) === null);
  check("once A is done, B is ready for review", (await statusOf(B.id)).key === "review", JSON.stringify(await statusOf(B.id)));
  check("and can be closed", (await closeRefusal(B.id)) === null);

  // 4. A build that fails stops the tests, and the status says why.
  const Cx = await k.addTask("C", "write broken.txt");
  await core.approveTask(clientId, Cx.id, by);
  await k.syncSeq();
  from = k.callCount();
  await k.develop(Cx.id);
  check("a failed build stops there: two calls, the tests never ran", k.calls(from).length === 2, String(k.calls(from).length));
  const checksC = await k.checksOf(Cx.id);
  check("the build failed and the others did not run", checksC[0]!.checkResult === "failed" && checksC.slice(1).every((c) => c.checkResult === null), JSON.stringify(checksC.map((c) => c.checkResult)));
  const fellC = await statusOf(Cx.id);
  check("status: fell, because the build failed", fellC.key === "failed" && fellC.reason === "ה-Build נכשל" && fellC.tone === "critical", JSON.stringify(fellC));
  check("and it is 'failed checks' underneath", (await k.row(Cx.id)).state === "failed_checks");

  // 5. Developed without a dependency: the check that needs it waits, and the task cannot be closed.
  const E = await k.addTask("E", "write e.txt");
  const D = await k.addTask("D", "write d.txt", { dependsOn: [E.id] });
  await k.addTask("D uses E", "D works — needs e.txt", { parent: D.id });
  await core.approveTask(clientId, D.id, by);
  await k.syncSeq();
  check("D depends on E, which has no code: 'a dependency exists', in red", (await statusOf(D.id)).key === "dependency_open" && (await statusOf(D.id)).tone === "critical");
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
} finally {
  await k.finish();
}
