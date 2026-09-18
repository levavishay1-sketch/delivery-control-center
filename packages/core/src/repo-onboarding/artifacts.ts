import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@dcc/db";
import { repositoryAiArtifact } from "@dcc/db/schema";
import type { PlannedArtifact } from "./types.ts";

/**
 * Artifact ledger helpers — DCC's record of what it put in the repository
 * and why. The files themselves are the source of truth; the ledger is
 * what lets a refresh check say deterministically "this artifact MAY be
 * stale" (a watched path changed) or "this was edited outside DCC" (the
 * hash moved) before any model is asked.
 */

/** Rough token estimate for budgeting — characters / 4, the usual
 *  English-prose approximation. Reported as an estimate, never as a fact. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
export const contentHash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

export async function replaceLedger(clientId: string, repoId: string, runId: string, items: PlannedArtifact[]): Promise<void> {
  await withTenant(clientId, async (tx) => {
    await tx.delete(repositoryAiArtifact).where(eq(repositoryAiArtifact.runId, runId));
    if (items.length === 0) return;
    await tx.insert(repositoryAiArtifact).values(items.map((a) => ({
      runId, repoId, clientId, artifactKey: a.key, kind: a.kind, path: a.path, action: a.action, loading: a.loading,
      justification: a.justification, consumers: a.consumers, watchedPaths: a.watchedPaths, sourceOfTruth: a.sourceOfTruth,
      status: a.action === "skip" ? "dropped" : "planned",
    })));
  });
}

/** The text an artifact is measured and hashed by. A directory artifact
 *  (the DCC hooks folder) is the sorted concatenation of its files, so a
 *  manual edit to any of them moves the hash on refresh. */
export function readArtifactText(full: string): string | null {
  if (!existsSync(full)) return null;
  if (!statSync(full).isDirectory()) return readFileSync(full, "utf8");
  const files: string[] = [];
  const walk = (dir: string) => { for (const n of readdirSync(dir).sort()) { const p = path.join(dir, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk(full);
  return files.map((f) => `### ${path.relative(full, f).split(path.sep).join("/")}\n${readFileSync(f, "utf8")}`).join("\n");
}

export async function markWritten(clientId: string, runId: string, workspaceDir: string, entries: { key: string; path: string; action: string }[]): Promise<{ key: string; path: string; lines: number; estimatedTokens: number; hash: string | null }[]> {
  const out: { key: string; path: string; lines: number; estimatedTokens: number; hash: string | null }[] = [];
  await withTenant(clientId, async (tx) => {
    for (const e of entries) {
      const full = path.join(workspaceDir, e.path);
      const content = e.action === "remove" ? null : readArtifactText(full);
      const exists = content !== null;
      const text = content ?? "";
      const row = { lines: exists ? text.split("\n").length : 0, estimatedTokens: exists ? estimateTokens(text) : 0, hash: exists ? contentHash(text) : null };
      await tx.update(repositoryAiArtifact).set({
        status: e.action === "remove" ? "dropped" : "written", lines: row.lines, estimatedTokens: row.estimatedTokens, contentHash: row.hash, updatedAt: new Date(),
      }).where(and(eq(repositoryAiArtifact.runId, runId), eq(repositoryAiArtifact.artifactKey, e.key)));
      out.push({ key: e.key, path: e.path, ...row });
    }
  });
  return out;
}

export async function markDropped(clientId: string, runId: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await withTenant(clientId, async (tx) => {
    for (const p of paths) {
      await tx.update(repositoryAiArtifact).set({ status: "dropped", action: "remove", updatedAt: new Date() })
        .where(and(eq(repositoryAiArtifact.runId, runId), eq(repositoryAiArtifact.path, p)));
    }
  });
}

export async function ledgerForRun(clientId: string, runId: string) {
  return withTenant(clientId, (tx) => tx.select().from(repositoryAiArtifact).where(eq(repositoryAiArtifact.runId, runId)).orderBy(repositoryAiArtifact.createdAt));
}
