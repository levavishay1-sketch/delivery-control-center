/**
 * The TFS work-item type of a task comes from the ROLE it plays in the tree,
 * never from how deep it happens to sit.
 *
 *   a leaf                                — Task
 *   a node whose children are Tasks       — User Story
 *   a node whose children are User Stories — Feature
 *   a node whose children are Features    — Epic
 *
 * Height is counted from the bottom, so a ragged tree (one story with three
 * tasks beside one bare task) types every node by what it holds, not by which
 * level of the page it was drawn on. A type says where a node sits in the
 * organisation's backlog and nothing else — it carries no behaviour.
 *
 * The REQUIREMENT is a node of the same tree. The organisation's rule is that
 * more than one User Story needs a Feature above it, and a single one does
 * not: so the requirement takes the rung above its top-level nodes when there
 * are two or more of them and they are stories or higher. Loose Tasks side by
 * side need no parent (that has always been so), and nothing sits above an
 * Epic.
 *
 * Pure — no database. The unit test drives it directly.
 */

export const RUNGS = ["Task", "User Story", "Feature", "Epic"] as const;
export type Rung = (typeof RUNGS)[number];

type Node = { id: string; parentId: string | null };

/** How far each node sits above the leaves under it: a leaf is 0. */
function heights(nodes: Node[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map<string, string[]>();
  for (const n of nodes) if (n.parentId && ids.has(n.parentId) && n.parentId !== n.id) (kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId)!).push(n.id);
  const h = new Map<string, number>();
  const of = (id: string, seen: Set<string>): number => {
    const known = h.get(id);
    if (known != null) return known;
    if (seen.has(id)) return 0; // a ring in the parents — treat the node as a leaf rather than recurse forever
    seen.add(id);
    const c = kids.get(id) ?? [];
    const v = c.length ? 1 + Math.max(...c.map((k) => of(k, seen))) : 0;
    seen.delete(id);
    h.set(id, v);
    return v;
  };
  for (const n of nodes) of(n.id, new Set());
  return h;
}

/** The type of every node, by what it holds. Pass only the nodes that are real work — never a check. */
export function structuralTypes(nodes: Node[]): Map<string, Rung> {
  const h = heights(nodes);
  return new Map(nodes.map((n) => [n.id, RUNGS[Math.min(h.get(n.id) ?? 0, RUNGS.length - 1)]!]));
}

/**
 * The type the requirement takes above its top-level nodes, or null when it
 * takes none. `over` is how many top-level nodes it stands over.
 */
export function requirementRung(nodes: Node[]): { type: Rung; over: number; of: Rung } | null {
  const ids = new Set(nodes.map((n) => n.id));
  const top = nodes.filter((n) => !n.parentId || !ids.has(n.parentId) || n.parentId === n.id);
  if (top.length < 2) return null;
  const h = heights(nodes);
  const topHeight = Math.max(...top.map((n) => h.get(n.id) ?? 0));
  if (topHeight < 1 || topHeight >= RUNGS.length - 1) return null;
  return { type: RUNGS[topHeight + 1]!, over: top.length, of: RUNGS[topHeight]! };
}
