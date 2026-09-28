/**
 * A list of repository paths as the rows of a tree drawn the way a terminal
 * draws one (├── └── │): the root's own files first — the instructions an
 * agent reads first at the top — then the folders, `.claude/` first and DCC's
 * own `.dcc/` last. Pure, so the delivery screen and a probe draw the same.
 */

type Node = { name: string; path: string; dir: boolean; children: Node[] };
export type Row = { key: string; prefix: string; name: string; path: string; dir: boolean } | { key: string; spacer: string };

/** The instructions an agent reads first come first; DCC's own dossier comes last. */
const FILE_FIRST = ["CLAUDE.md", "AGENTS.md"];
const DIR_FIRST = [".claude"];
const DIR_LAST = [".dcc"];
const bare = (n: string) => n.replace(/^\./, "").toLowerCase();
function order(a: Node, b: Node): number {
  if (a.dir !== b.dir) return a.dir ? 1 : -1;
  const first = a.dir ? DIR_FIRST : FILE_FIRST;
  const ia = first.indexOf(a.name), ib = first.indexOf(b.name);
  if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  if (a.dir) { const la = DIR_LAST.includes(a.name), lb = DIR_LAST.includes(b.name); if (la !== lb) return la ? 1 : -1; }
  return bare(a.name).localeCompare(bare(b.name));
}

export function buildTree(paths: readonly string[]): Node {
  const root: Node = { name: "", path: "", dir: true, children: [] };
  for (const p of paths) {
    let at = root;
    const parts = p.split("/").filter(Boolean);
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      let next = at.children.find((c) => c.name === part && c.dir === !last);
      if (!next) { next = { name: part, path: parts.slice(0, i + 1).join("/"), dir: !last, children: [] }; at.children.push(next); }
      at = next;
    });
  }
  const sort = (n: Node) => { n.children.sort(order); n.children.forEach(sort); };
  sort(root);
  return root;
}

export const treeRows = (paths: readonly string[]): Row[] => rowsOf(buildTree(paths), "", true);

function rowsOf(n: Node, prefix: string, top: boolean): Row[] {
  const out: Row[] = [];
  n.children.forEach((c, i) => {
    const last = i === n.children.length - 1;
    out.push({ key: c.path + (c.dir ? "/" : ""), prefix: prefix + (last ? "└── " : "├── "), name: c.name, path: c.path, dir: c.dir });
    if (c.dir) out.push(...rowsOf(c, prefix + (last ? "    " : "│   "), false));
    // At the top, a breathing line after the root's own files and after .claude/ — the groups a person scans for.
    const next = n.children[i + 1];
    if (top && next && ((!c.dir && next.dir) || (c.dir && c.name === ".claude"))) out.push({ key: `gap:${c.path}`, spacer: "│" });
  });
  return out;
}
