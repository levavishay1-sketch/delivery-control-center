/**
 * Proves that a task can be developed before the task it depends on, and
 * that what its branch is built on is right at every step (task-base.ts):
 *
 *   B depends on A. B is developed first → from the default branch, "without A";
 *   its check that needs A waits (not failed). A is developed. B says A exists
 *   now. Rollback + run B again → built on A's branch, the check passes. Push
 *   says to push A first; once A is pushed, B's request targets A's branch. A
 *   moves → B says so.
 *
 * Its own database, git repository and Claude stand-in (prove-kit.ts).
 * Run: `npm run -w @dcc/core prove:built-on`
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { proveKit } from "./prove-kit.ts";

const k = await proveKit("built-on");
const { check, g, cache, clientId, workitemId, by, core } = k;

try {
  const A = await k.addTask("A", "write a.txt");
  const B = await k.addTask("B", "write b.txt", { dependsOn: [A.id] });
  const C = await k.addTask("C", "B works — needs a.txt", { parent: B.id });
  await core.approveTask(clientId, A.id, by);
  await core.approveTask(clientId, B.id, by);
  await k.syncSeq();
  const branchA = k.branchOf(A), branchB = k.branchOf(B);

  // 1. Before anything is developed: B would be built without A.
  let b = await core.taskBuiltOn(clientId, B.id);
  check("before anything: B would start from the default branch, without A", b.state === "planned" && !b.on && b.missing.length === 1 && b.missing[0]!.id === A.id && b.missing[0]!.why === "not_developed", JSON.stringify(b));

  // 2. Develop B first.
  let from = k.callCount();
  await k.develop(B.id);
  check("B developed first is told A is not here yet", k.calls(from)[0]!.prompt.includes("NOT HERE YET — this task depends on work that is not in this branch: #1 (A)."));
  let rb = await k.row(B.id);
  check("B records that it was built without A, on the default branch", rb.baseTaskId === null && rb.baseBranch === "main" && JSON.stringify(rb.builtWithout) === JSON.stringify([A.id]), JSON.stringify(rb));
  check("B's check that needs A waits — it did not fail", (await k.row(C.id)).checkResult === "waiting", String((await k.row(C.id)).checkResult));
  check("B is in progress, not 'failed checks'", rb.state === "in_progress", rb.state);

  // 3. Develop A; B now says A exists.
  await k.develop(A.id);
  b = await core.taskBuiltOn(clientId, B.id);
  check("after A is developed, B says A is available now", b.state === "built" && b.nowAvailable.some((x) => x.id === A.id), JSON.stringify(b));

  // 4. Rollback B and develop it again: built on A's branch, and the check passes.
  await core.rollbackTask({ clientId, workitemId, taskId: B.id, by });
  rb = await k.row(B.id);
  check("rollback forgets what B was built on", rb.baseTaskId === null && rb.baseSha === null && (rb.builtWithout as string[]).length === 0, JSON.stringify(rb));
  b = await core.taskBuiltOn(clientId, B.id);
  check("after rollback, B would be built on A's branch", b.state === "planned" && b.on?.id === A.id && b.missing.length === 0, JSON.stringify(b));
  from = k.callCount();
  await k.develop(B.id);
  check("B developed again is told it is built on A", k.calls(from)[0]!.prompt.includes("BUILT ON — this branch starts from the branch of a task this one depends on, which is not in the default branch yet: #1 (A)."));
  rb = await k.row(B.id);
  check("B records A's branch as its base", rb.baseTaskId === A.id && rb.baseBranch === branchA && (rb.builtWithout as string[]).length === 0, JSON.stringify(rb));
  check("B's branch holds A's work", g(cache, "ls-tree", "--name-only", branchB).split("\n").includes("a.txt"));
  check("B's own work is one commit, A's not counted", g(cache, "rev-list", "--count", `${rb.baseSha}..${branchB}`) === "1");
  check("B's check passes now that A is under it", (await k.row(C.id)).checkResult === "passed", String((await k.row(C.id)).checkResult));

  // 5. Push: A first, then B targets A's branch.
  let p = await core.pushTask({ clientId, workitemId, taskId: B.id, by });
  check("pushing B before A says to push A first", p.pushed && !!p.note && p.base === "main", JSON.stringify(p));
  await core.pushTask({ clientId, workitemId, taskId: A.id, by });
  p = await core.pushTask({ clientId, workitemId, taskId: B.id, by });
  check("once A is on the host, B's request targets A's branch", p.pushed && p.base === branchA && !p.note, JSON.stringify(p));

  // 6. A moves on after B was built on it.
  g(cache, "checkout", "--quiet", branchA);
  writeFileSync(path.join(cache, "a2.txt"), "more\n");
  g(cache, "add", "-A"); g(cache, "commit", "--quiet", "-m", "A moves");
  b = await core.taskBuiltOn(clientId, B.id);
  check("when A gains work after B was built on it, B says so", b.state === "built" && b.onMoved, JSON.stringify(b));

  // 7. Rollback returns B to A's tip at the time — never into A's work.
  await core.rollbackTask({ clientId, workitemId, taskId: B.id, by });
  const files = g(cache, "ls-tree", "--name-only", branchB).split("\n");
  check("rollback of B stops at A's work", files.includes("a.txt") && !files.includes("b.txt"));
} finally {
  await k.finish();
}
