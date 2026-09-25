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

  // 8. The requirement gets its real key and the instruction is reworded after B was developed:
  //    B still finds its own branch — a branch is recorded when it is created, never worked out again.
  await k.develop(B.id);
  check("a branch is recorded on the task when its run creates it", (await k.row(B.id)).branch === branchB, String((await k.row(B.id)).branch));
  await k.dbm.withTenant(clientId, (tx) => tx.update(k.schema.workitem).set({ key: "WI-2000" }).where(k.eq(k.schema.workitem.id, workitemId)));
  await k.dbm.withTenant(clientId, (tx) => tx.update(k.schema.task).set({ intent: "B, reworded" }).where(k.eq(k.schema.task.id, B.id)));
  b = await core.taskBuiltOn(clientId, B.id);
  check("after the key and the wording changed, B still counts as developed", b.state === "built", JSON.stringify(b));
  let changed = await core.taskChangedFiles(clientId, B.id);
  check("...and still shows the files it changed", !!changed && changed.some((f) => f.path === "b.txt"), JSON.stringify(changed));

  // A task from before branches were recorded: the name looked for no longer exists, so the branch is not found
  // (null — not an empty list, which would say 'changed nothing'); the repair records it from what its run reported.
  await k.dbm.withTenant(clientId, (tx) => tx.update(k.schema.task).set({ branch: null }).where(k.eq(k.schema.task.id, B.id)));
  changed = await core.taskChangedFiles(clientId, B.id);
  check("with no branch recorded and a renamed requirement, the branch is 'not found', not 'no changes'", changed === null, JSON.stringify(changed));
  const { recordTaskBranches } = await import("./task-branch-repair.ts");
  const fixed = await recordTaskBranches();
  check("the repair records the branch the task's own run reported", fixed.some((r) => r.seq === B.seq && r.recorded === branchB && !r.wasRight), JSON.stringify(fixed));
  changed = await core.taskChangedFiles(clientId, B.id);
  check("...and the files show again", !!changed && changed.some((f) => f.path === "b.txt"), JSON.stringify(changed));
  check("running the repair again changes nothing", (await recordTaskBranches()).every((r) => r.seq !== B.seq));

  // 9. Merging a dependency the task was developed without, and two tasks that changed the same file.
  // The key was renamed above, so a branch is read from what the task recorded, never worked out.
  const branchNow = async (t: { id: string }) => (await k.row(t.id)).branch!;
  const E = await k.addTask("E", "write e.txt");
  const D = await k.addTask("D", "write d.txt", { dependsOn: [E.id] });
  const Dcheck = await k.addTask("Dchk", "D works", { parent: D.id });
  await core.approveTask(clientId, E.id, by);
  await core.approveTask(clientId, D.id, by);
  await k.syncSeq();
  await k.develop(D.id);
  await k.develop(E.id);
  const refusedNotDep = await core.mergeDependencyIntoTask({ clientId, taskId: E.id, dependencyId: D.id, by }).then(() => null, (e: Error) => e.message);
  check("only a dependency of the task can be merged into it", !!refusedNotDep && refusedNotDep.includes("לא תלות"), String(refusedNotDep));
  await k.dbm.withTenant(clientId, (tx) => tx.update(k.schema.task).set({ checkResult: "passed", state: "done" }).where(k.eq(k.schema.task.id, Dcheck.id)));
  const merged = await core.mergeDependencyIntoTask({ clientId, taskId: D.id, dependencyId: E.id, by });
  check("a clean merge is done", merged.merged === true && !(merged as { already: boolean }).already, JSON.stringify(merged));
  check("D's branch holds E's work now, and its own", g(cache, "ls-tree", "--name-only", await branchNow(D)).split(String.fromCharCode(10)).includes("e.txt") && g(cache, "ls-tree", "--name-only", await branchNow(D)).split(String.fromCharCode(10)).includes("d.txt"));
  const rd = await k.row(D.id);
  check("D counts as built on E, with nothing left out", rd.baseTaskId === E.id && (rd.builtWithout as string[]).length === 0, JSON.stringify(rd));
  check("D's own work is still only its own file", JSON.stringify((await core.taskChangedFiles(clientId, D.id))?.map((f) => f.path)) === JSON.stringify(["d.txt"]));
  check("its checks ran on other code, so they are reset", (await k.row(Dcheck.id)).checkResult === null);
  const again = await core.mergeDependencyIntoTask({ clientId, taskId: D.id, dependencyId: E.id, by });
  check("merging again says it is already there", again.merged === true && (again as { already: boolean }).already === true, JSON.stringify(again));

  // Two tasks that write the same file differently, tied by a dependency: the merge is refused, nothing changes.
  const S = await k.addTask("S", "write shared.txt for S");
  const R = await k.addTask("R", "write shared.txt for R", { dependsOn: [S.id] });
  await core.approveTask(clientId, S.id, by);
  await core.approveTask(clientId, R.id, by);
  await k.syncSeq();
  await k.develop(R.id);
  await k.develop(S.id);
  const tipBefore = g(cache, "rev-parse", await branchNow(R));
  const clash = await core.mergeDependencyIntoTask({ clientId, taskId: R.id, dependencyId: S.id, by });
  check("a conflict is reported with the file, and says what to do", clash.merged === false && (clash as { conflictFiles: string[] }).conflictFiles.includes("shared.txt") && (clash as { reason: string }).reason.includes("Rollback"), JSON.stringify(clash));
  check("and changes nothing: R's branch and record are as they were", g(cache, "rev-parse", await branchNow(R)) === tipBefore && (await k.row(R.id)).baseTaskId === null);
  const ovR = await core.taskOverlaps(clientId, R.id);
  check("R is told S changed the same file, that R waits for S, and that they conflict", ovR.length === 1 && ovR[0]!.seq === S.seq && ovR[0]!.relation === "waits_for" && ovR[0]!.files.includes("shared.txt") && ovR[0]!.merge?.clean === false, JSON.stringify(ovR));

  // Two tasks with no dependency on each other that changed the same file: told the same way.
  const P = await k.addTask("P", "write clash.txt for P");
  const Q = await k.addTask("Q", "write clash.txt for Q");
  await core.approveTask(clientId, P.id, by);
  await core.approveTask(clientId, Q.id, by);
  await k.syncSeq();
  await k.develop(P.id);
  await k.develop(Q.id);
  const ovP = await core.taskOverlaps(clientId, P.id);
  check("two unrelated tasks on one file: told, with 'no dependency' and the conflict", ovP.length === 1 && ovP[0]!.seq === Q.seq && ovP[0]!.relation === "none" && ovP[0]!.merge?.clean === false, JSON.stringify(ovP));
  check("tasks that touch different files are not told about each other", (await core.taskOverlaps(clientId, E.id)).every((o) => o.seq !== P.seq && o.seq !== Q.seq));
} finally {
  await k.finish();
}
