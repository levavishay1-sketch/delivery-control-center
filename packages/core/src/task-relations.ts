/**
 * What a task is and what it really depends on — decided by structure alone,
 * never by its TFS type. Pure (no database, no git), so the rules are tested
 * on their own; the callers gather the rows.
 *
 * Two kinds of task, and only two:
 * - a task with no sub-tasks is DEVELOPED: every one goes through the same
 *   lifecycle (development with the build, checks, review, closing);
 * - a task with sub-tasks is a GROUP: its work is its sub-tasks, so it is never
 *   developed itself. Its status follows them; its own checks verify them together.
 *
 * A dependency is declared between any two rows, but what a task waits for is
 * always developed work: on a group — each of its sub-tasks; on a check — the
 * task that check belongs to. A sub-task also waits for whatever its group waits for.
 */

export type RelRow = { id: string; seq: number; kind: string; parentTaskId: string | null; active: boolean; state: string };
export type RelDep = { taskId: string; dependsOnTaskId: string };
/** How an effective dependency came to be: declared on the task itself, reached through a group or a check, or inherited from the task's group. */
export type DepVia = { through: "group" | "check" | "parent"; seq: number };
export type EffectiveDep = { id: string; via?: DepVia };

const inPlay = (r: RelRow | undefined): r is RelRow => !!r && r.active && r.state !== "dropped";

export function taskRelations(rows: RelRow[], deps: RelDep[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const subtasksOf = (id: string) => rows.filter((r) => r.parentTaskId === id && r.kind === "task" && inPlay(r));
  const isGroup = (id: string) => byId.get(id)?.kind === "task" && subtasksOf(id).length > 0;
  const declared = (id: string) => deps.filter((d) => d.taskId === id).map((d) => d.dependsOnTaskId);

  /** The developed tasks behind one dependency target. */
  const expand = (targetId: string, via?: DepVia): EffectiveDep[] => {
    const t = byId.get(targetId);
    if (!inPlay(t)) return [];
    if (t.kind === "check") return t.parentTaskId ? expand(t.parentTaskId, via ?? { through: "check", seq: t.seq }) : [];
    const subs = subtasksOf(t.id);
    if (subs.length) return subs.flatMap((s) => expand(s.id, via ?? { through: "group", seq: t.seq }));
    return [{ id: t.id, ...(via ? { via } : {}) }];
  };

  /** Every developed task this one waits for, once each; never itself, its own group or its own sub-tasks. */
  const effectiveDeps = (id: string): EffectiveDep[] => {
    const t = byId.get(id);
    if (!t) return [];
    const parent = t.parentTaskId ? byId.get(t.parentTaskId) : undefined;
    const own = declared(id).filter((d) => d !== t.parentTaskId).flatMap((d) => expand(d));
    const inherited = t.kind === "task" && parent && inPlay(parent) ? declared(parent.id).flatMap((d) => expand(d, { through: "parent", seq: parent.seq })) : [];
    const skip = new Set([id, ...(t.parentTaskId ? [t.parentTaskId] : []), ...subtasksOf(id).map((s) => s.id)]);
    const out = new Map<string, EffectiveDep>();
    for (const d of [...own, ...inherited]) if (!skip.has(d.id) && !out.has(d.id)) out.set(d.id, d);
    return [...out.values()];
  };

  /** The rows that wait for this one — the reverse of effectiveDeps. For a group: those outside it waiting for any of its sub-tasks. */
  const waitingOn = (id: string): string[] => {
    const work = new Set(expand(id).map((d) => d.id));
    return rows.filter((r) => inPlay(r) && r.id !== id && r.parentTaskId !== id && effectiveDeps(r.id).some((d) => work.has(d.id))).map((r) => r.id);
  };

  return { subtasksOf, isGroup, effectiveDeps, waitingOn };
}
