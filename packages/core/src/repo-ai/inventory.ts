import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { aiComponent, repo, repoAiComponentLink, repoAiProfile } from "@dcc/db/schema";
import { ensureCheckout, git } from "../ai-assist.ts";
import { appendRepoAiEvent } from "./events.ts";

/**
 * Deterministic AI-component inventory (`repository-ai-management` §6.2,
 * decision "the Repository itself is the source of truth"). No model
 * call — pure filesystem inspection of the repo's own DCC-owned cache
 * checkout (`ensureCheckout`, same clone `runImplement` uses). DCC keeps
 * no second copy of a component's own files: this only records TYPE,
 * TITLE and WHERE it was found, then links that to the global catalog.
 *
 * Detected conventions are the ones this very repository already uses
 * (see `hooks/README.md`, `skills/*`, `.claude/agents/*`,
 * `.claude/settings.json`) — grounded in a real example, not invented.
 */

export type DetectedComponent = { type: string; name: string; description: string | null; detectedPath: string };

function parseFrontmatter(text: string): { name?: string; description?: string } {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const val = kv[2]!.trim();
    if (key === "name") out.name = val;
    else if (key === "description") out.description = val;
  }
  return out;
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isDirectory());
  } catch { return []; }
}
function listFiles(dir: string, ext?: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((n) => {
      const p = path.join(dir, n);
      return statSync(p).isFile() && (!ext || n.endsWith(ext));
    });
  } catch { return []; }
}
function readJson(p: string): unknown {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

/** Scans one checked-out repo root; returns everything it found, no DB access. */
export function scanRepoDir(root: string): DetectedComponent[] {
  const found: DetectedComponent[] = [];

  // base configuration — CLAUDE.md at the root
  if (existsSync(path.join(root, "CLAUDE.md"))) {
    found.push({ type: "base_configuration", name: "CLAUDE.md", description: "הוראות הפרויקט שנטענות אוטומטית בכל session", detectedPath: "CLAUDE.md" });
  }

  // skills — either convention: `skills/<name>/SKILL.md` (this repo's own layout)
  // or `.claude/skills/<name>/SKILL.md` (the more common project-local convention)
  for (const base of ["skills", path.join(".claude", "skills")]) {
    for (const name of listDirs(path.join(root, base))) {
      const skillFile = path.join(root, base, name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const fm = parseFrontmatter(readFileSync(skillFile, "utf8"));
      found.push({ type: "skill", name: fm.name ?? name, description: fm.description ?? null, detectedPath: path.join(base, name, "SKILL.md").replace(/\\/g, "/") });
    }
  }

  // agents / subagents — `.claude/agents/*.md`
  for (const f of listFiles(path.join(root, ".claude", "agents"), ".md")) {
    const full = path.join(root, ".claude", "agents", f);
    const fm = parseFrontmatter(readFileSync(full, "utf8"));
    found.push({ type: "agent", name: fm.name ?? f.replace(/\.md$/, ""), description: fm.description ?? null, detectedPath: `.claude/agents/${f}` });
  }

  // slash commands — `.claude/commands/*.md`
  for (const f of listFiles(path.join(root, ".claude", "commands"), ".md")) {
    found.push({ type: "command", name: f.replace(/\.md$/, ""), description: null, detectedPath: `.claude/commands/${f}` });
  }

  // hooks + MCP servers — both live inside .claude/settings.json (and settings.local.json)
  for (const settingsFile of ["settings.json", "settings.local.json"]) {
    const p = path.join(root, ".claude", settingsFile);
    const cfg = existsSync(p) ? (readJson(p) as { hooks?: Record<string, unknown>; mcpServers?: Record<string, unknown> } | null) : null;
    if (!cfg) continue;
    for (const eventName of Object.keys(cfg.hooks ?? {})) {
      found.push({ type: "hook", name: `Hook: ${eventName}`, description: `מוגדר תחת .claude/${settingsFile}`, detectedPath: `.claude/${settingsFile}#hooks.${eventName}` });
    }
    for (const serverName of Object.keys(cfg.mcpServers ?? {})) {
      found.push({ type: "mcp", name: serverName, description: `מוגדר תחת .claude/${settingsFile}`, detectedPath: `.claude/${settingsFile}#mcpServers.${serverName}` });
    }
  }
  // MCP servers can also live in a root .mcp.json (project-scoped, shareable convention)
  const rootMcp = readJson(path.join(root, ".mcp.json")) as { mcpServers?: Record<string, unknown> } | null;
  for (const serverName of Object.keys(rootMcp?.mcpServers ?? {})) {
    found.push({ type: "mcp", name: serverName, description: "מוגדר תחת .mcp.json", detectedPath: `.mcp.json#mcpServers.${serverName}` });
  }

  // plugins — `.claude/plugins/<name>/` or a marketplace manifest
  for (const name of listDirs(path.join(root, ".claude", "plugins"))) {
    found.push({ type: "plugin", name, description: null, detectedPath: `.claude/plugins/${name}` });
  }

  // methodology — structural markers, not a file convention; OpenSpec is the
  // one this codebase itself uses, so it's the one detector built for now.
  if (existsSync(path.join(root, "openspec"))) {
    found.push({ type: "methodology", name: "OpenSpec", description: "זרימת עבודה מבוססת openspec/changes עם appetite מסוג Shape-Up", detectedPath: "openspec/" });
  }

  return found;
}

const keyFor = (type: string, name: string) => `${type}:${name.trim().toLowerCase().replace(/\s+/g, "-")}`;

/**
 * Sync one Repository's inventory: scan its checkout, upsert each
 * detected component into the global catalog (`ai_component` — created
 * the first time ANY repo has it, `last_seen_at` bumped every time), and
 * reconcile `repo_ai_component_link` rows for this repo — mark rows for
 * components no longer found as inactive rather than deleting them
 * (design: "this repo used to have X" stays visible, mirrors
 * `task.active`), and (re)activate a previously-removed one that
 * reappeared instead of creating a duplicate link.
 */
export async function syncRepoInventory(repoId: string, by: { userId: string }) {
  const [r] = await db.select().from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r) throw new Error("repo not found");
  if (!r.clientId) throw new Error("לא ניתן לנהל AI על repository משותף בין לקוחות (ללא לקוח יחיד) — ראה החלטת scope");
  const clientId = r.clientId;

  const dir = await ensureCheckout({ ...r, localPath: null });
  if (!dir) throw new Error(`לא הצלחתי להביא עותק של ${r.name}`);
  const commit = (await git(["rev-parse", "HEAD"], dir)).out.trim() || null;

  const detected = scanRepoDir(dir);

  const result = await withTenant(clientId, async (tx) => {
    const existingLinks = await tx.select().from(repoAiComponentLink).where(eq(repoAiComponentLink.repoId, repoId));
    const seenLinkIds = new Set<string>();
    let added = 0, reactivated = 0, unchanged = 0;

    for (const d of detected) {
      const key = keyFor(d.type, d.name);
      let [comp] = await db.select().from(aiComponent).where(eq(aiComponent.key, key)).limit(1);
      if (!comp) {
        [comp] = await db.insert(aiComponent).values({ type: d.type, key, title: d.name, description: d.description }).returning();
      } else {
        await db.update(aiComponent).set({ lastSeenAt: new Date() }).where(eq(aiComponent.id, comp!.id));
      }
      const existing = existingLinks.find((l) => l.componentId === comp!.id && l.detectedPath === d.detectedPath);
      if (existing) {
        seenLinkIds.add(existing.id);
        if (!existing.active) {
          await tx.update(repoAiComponentLink).set({ active: true, lastSeenAt: new Date(), removedAt: null }).where(eq(repoAiComponentLink.id, existing.id));
          reactivated++;
        } else {
          await tx.update(repoAiComponentLink).set({ lastSeenAt: new Date() }).where(eq(repoAiComponentLink.id, existing.id));
          unchanged++;
        }
      } else {
        const [ins] = await tx.insert(repoAiComponentLink).values({
          repoId, clientId, componentId: comp!.id, detectedPath: d.detectedPath, active: true,
        }).returning();
        seenLinkIds.add(ins!.id);
        added++;
      }
    }

    let removed = 0;
    for (const l of existingLinks) {
      if (l.active && !seenLinkIds.has(l.id)) {
        await tx.update(repoAiComponentLink).set({ active: false, removedAt: new Date() }).where(eq(repoAiComponentLink.id, l.id));
        removed++;
      }
    }

    await tx.update(repoAiProfile)
      .set({ lastInventorySyncAt: new Date(), lastInventorySyncCommit: commit, updatedAt: new Date() })
      .where(eq(repoAiProfile.repoId, repoId));

    return { added, reactivated, removed, unchanged, total: detected.length };
  });

  await appendRepoAiEvent({
    clientId, repoId, type: "inventory.synced",
    payload: { commit, ...result },
    actorUserId: by.userId,
  });

  return result;
}

/** Grouped, human-facing inventory for one repo — active links only by default. */
export async function repoInventoryView(clientId: string, repoId: string, opts: { includeInactive?: boolean } = {}) {
  const rows = await withTenant(clientId, (tx) =>
    tx.select({
      linkId: repoAiComponentLink.id, detectedPath: repoAiComponentLink.detectedPath, active: repoAiComponentLink.active,
      firstSeenAt: repoAiComponentLink.firstSeenAt, lastSeenAt: repoAiComponentLink.lastSeenAt, removedAt: repoAiComponentLink.removedAt,
      componentId: aiComponent.id, type: aiComponent.type, title: aiComponent.title, description: aiComponent.description,
    })
      .from(repoAiComponentLink)
      .innerJoin(aiComponent, eq(aiComponent.id, repoAiComponentLink.componentId))
      .where(opts.includeInactive ? eq(repoAiComponentLink.repoId, repoId) : and(eq(repoAiComponentLink.repoId, repoId), eq(repoAiComponentLink.active, true)))
      .orderBy(aiComponent.type, aiComponent.title),
  );
  const byType = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byType.has(row.type)) byType.set(row.type, []);
    byType.get(row.type)!.push(row);
  }
  return Array.from(byType.entries()).map(([type, items]) => ({ type, items }));
}
