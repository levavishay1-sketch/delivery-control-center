import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { repo, repoAiProfile } from "@dcc/db/schema";
import { ensureCheckout } from "../ai-assist.ts";
import { appendRepoAiEvent } from "./events.ts";

/**
 * Onboarding step 2 (design discussion, 2026-09-16): `Read` deny rules,
 * suggested from a deterministic directory-name scan (no AI, no cost —
 * same category of work as `inventory.ts`'s scanner), shown to a human
 * for review/edit, then explicitly approved before step 3 (`/init`) is
 * allowed to run. This is the concrete fix for the real failure this
 * session found live: `/init` on a large repo burned turns and money
 * partly because nothing stopped it from reading `bin`/`obj` build
 * output — this step exists specifically to put that fence up first.
 */

/** Directory names that are almost always build output, dependency
 *  caches, or vendored code — never something a repo's own knowledge
 *  should describe, and expensive to read. Deliberately only names with
 *  no reasonable false-positive (unlike e.g. "packages", which is a
 *  legitimate source folder in many repos) — precision over recall. */
const KNOWN_JUNK_DIR_NAMES = [
  "bin", "obj", "dist", "build", "out", "target",
  "node_modules", "vendor", ".git", ".next", ".nuxt", "__pycache__",
  ".venv", "venv", ".gradle", ".terraform",
];

/** Binary file extensions that are never source code and never worth
 *  Claude reading, regardless of which directory holds them. Added
 *  2026-09-16 after a real gap was found live: Altshuler Trade vendors
 *  its old-style (packages.config, pre-`PackageReference`) NuGet
 *  dependencies under a top-level `packages/` folder — ~970 `.dll` +
 *  50 `.pdb` files — which `KNOWN_JUNK_DIR_NAMES` never catches because
 *  "packages" was deliberately left off that list (too many legitimate
 *  repos use "packages/" as a real source folder, e.g. npm/monorepo
 *  workspaces). Blocking by extension instead of directory name closes
 *  that gap without the false-positive risk: a `.dll`/`.pdb`/`.exe` is
 *  binary and unreadable as text no matter which folder it sits in. */
const KNOWN_JUNK_EXTENSIONS = ["dll", "pdb", "exe", "so", "dylib"];

/** Walks the tree (same depth-limited style as `structuralMap`) looking
 *  for the known junk directory names actually present — only suggest a
 *  deny rule for a directory that's really there, never the full list
 *  unconditionally. Also collects which of `KNOWN_JUNK_EXTENSIONS` are
 *  actually present on files anywhere in the tree, same "only suggest
 *  what's really there" precision. */
function scanForJunk(root: string): { dirs: string[]; extensions: string[] } {
  const foundDirs = new Set<string>();
  const foundExt = new Set<string>();
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || !existsSync(dir)) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const full = path.join(dir, name);
      let isDir: boolean;
      try { isDir = statSync(full).isDirectory(); } catch { continue; }
      if (isDir) {
        if (KNOWN_JUNK_DIR_NAMES.includes(name)) { foundDirs.add(name); continue; }
        if (name.startsWith(".")) continue;
        walk(full, depth + 1);
      } else {
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
        if (KNOWN_JUNK_EXTENSIONS.includes(ext)) foundExt.add(ext);
      }
    }
  };
  walk(root, 0);
  return { dirs: Array.from(foundDirs).sort(), extensions: Array.from(foundExt).sort() };
}

/** Suggested (not yet saved) deny rules for a repo — the UI shows these
 *  as an editable default. Pure filesystem scan, no model call. */
export async function suggestDenyRules(repoId: string): Promise<string[]> {
  const [r] = await db.select().from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r) throw new Error("repo not found");
  const dir = await ensureCheckout({ ...r, localPath: null });
  if (!dir) return [];
  const { dirs, extensions } = scanForJunk(dir);
  return [
    ...dirs.map((name) => `Read(./**/${name}/**/*)`),
    ...extensions.map((ext) => `Read(./**/*.${ext})`),
  ];
}

/** Saves the (possibly human-edited) deny rules and marks step 2 done.
 *  An empty array is a valid, deliberate choice ("nothing to block
 *  here") — distinct from `null`/unapproved, which is what keeps step 3
 *  locked. */
export async function approveDenyRules(input: { repoId: string; rules: string[]; by: { userId: string } }) {
  const [r] = await db.select().from(repo).where(eq(repo.id, input.repoId)).limit(1);
  if (!r) throw new Error("repo not found");
  if (!r.clientId) throw new Error("ניהול AI זמין רק ל-repository ששייך ללקוח יחיד");
  const clientId = r.clientId;

  const [row] = await withTenant(clientId, (tx) =>
    tx.update(repoAiProfile).set({
      denyRules: input.rules, denyRulesApprovedAt: new Date(), denyRulesApprovedBy: input.by.userId, updatedAt: new Date(),
    }).where(eq(repoAiProfile.repoId, input.repoId)).returning(),
  );
  await appendRepoAiEvent({
    clientId, repoId: input.repoId, type: "deny_rules.approved",
    payload: { rules: input.rules }, actorUserId: input.by.userId,
  });
  return row!;
}

/** What every AI call against this repo should actually pass to the
 *  CLI's `--settings` flag. `null` when step 2 hasn't been approved yet
 *  — callers (bootstrap.ts, knowledge.ts) use this to REFUSE running,
 *  not just skip the flag, so the lock holds even if someone calls the
 *  API directly instead of going through the UI's gated flow. */
export async function getApprovedDenyRules(clientId: string, repoId: string): Promise<string[] | null> {
  const [row] = await withTenant(clientId, (tx) => tx.select().from(repoAiProfile).where(eq(repoAiProfile.repoId, repoId)).limit(1));
  if (!row || !row.denyRulesApprovedAt) return null;
  return (row.denyRules as string[] | null) ?? [];
}
