import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { repo, repoAiEvent, repositoryAiArtifact, repositoryOnboardingRun, repositoryOnboardingStage } from "@dcc/db/schema";
import { ensureCheckout, git } from "../ai-assist.ts";
import { contentHash, readArtifactText } from "./artifacts.ts";
import { appendRepoAiEvent } from "./events.ts";
import { getActiveOnboardingPrompt } from "./prompts.ts";
import { createClaudeCodeRunner, READ_ONLY_TOOLS } from "./runner.ts";
import { REFRESH_SCHEMA } from "./schemas.ts";
import { ONBOARDING_VERSION } from "./types.ts";

/**
 * Knowledge lifecycle — staleness detection. Deterministic signals first
 * (no model, no cost): did the repository change under a path an artifact
 * depends on, did a build manifest change, was an artifact edited by hand
 * (hash moved), does CLAUDE.md still fit its budget, do referenced paths
 * still exist. Only when a signal fires is one small AI call asked
 * whether the change MATERIALLY affects the artifacts. The outcome is a
 * proposal; acting on it is a refresh run (`startOnboardingRun` with
 * `mode: "refresh"`), which goes through the same gates as the first one.
 */

export type StaleSignal = { kind: "watched_path_changed" | "manifest_changed" | "artifact_edited_outside_dcc" | "artifact_missing" | "claude_md_too_long" | "referenced_path_missing" | "age"; detail: string; artifacts: string[] };
export type RefreshResult = {
  checkedAt: string;
  lastRunId: string; analyzedCommit: string; currentCommit: string;
  changedPaths: string[];
  signals: StaleSignal[];
  updateRequired: boolean;
  /** Present only when the AI was consulted (a signal fired). */
  ai?: { impactedArtifacts: string[]; requiredUpdates_he: string[]; evidence: string[]; reason_he: string; executionId: string } | null;
  reason_he: string;
};

const MANIFESTS = /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|.*\.csproj|.*\.sln|.*\.fsproj|go\.mod|pom\.xml|build\.gradle(\.kts)?|Cargo\.toml|pyproject\.toml|requirements\.txt|Gemfile|composer\.json|Dockerfile|azure-pipelines\.yml|\.github\/workflows\/.*)$/i;

async function lastCompleted(repoId: string) {
  const runs = await db.select().from(repositoryOnboardingRun)
    .where(and(eq(repositoryOnboardingRun.repoId, repoId), eq(repositoryOnboardingRun.onboardingVersion, ONBOARDING_VERSION)))
    .orderBy(desc(repositoryOnboardingRun.startedAt)).limit(10);
  return runs.find((r) => r.status === "Completed" || r.status === "CompletedWithWarnings") ?? null;
}

function globToWatched(globs: string[], changed: string[]): string[] {
  const hits: string[] = [];
  for (const g of globs) {
    const prefix = g.replace(/\*.*$/, "").replace(/\/$/, "");
    for (const c of changed) {
      if (!prefix) { if (c.endsWith(g.replace(/^\*\*\//, ""))) hits.push(c); continue; }
      if (c === prefix || c.startsWith(prefix + "/") || c.startsWith(prefix)) hits.push(c);
    }
  }
  return Array.from(new Set(hits));
}

export async function checkRepositoryRefresh(repoId: string, userId: string): Promise<RefreshResult> {
  const [r] = await db.select().from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r || !r.clientId) throw new Error("הטמעת AI זמינה רק ל-repository ששייך ללקוח יחיד");
  const last = await lastCompleted(repoId);
  if (!last) throw new Error("הריפוזיטורי טרם עבר onboarding שהושלם — אין מה לרענן");
  const [deliver] = await withTenant(r.clientId, (tx) => tx.select().from(repositoryOnboardingStage).where(and(eq(repositoryOnboardingStage.runId, last.id), eq(repositoryOnboardingStage.stageKey, "deliver"))).limit(1));
  // The state the artifacts describe is the MERGED commit (it contains
  // them); comparing against the pre-onboarding baseline would report the
  // artifacts themselves as "changed paths" on every check.
  const deliverResult = deliver?.result as { analyzedCommitSha?: string; merged?: boolean; mergedSha?: string } | undefined;
  const analyzedCommit = (deliverResult?.merged && deliverResult.mergedSha) || deliverResult?.analyzedCommitSha || last.baselineSha;
  if (!analyzedCommit) throw new Error("ההרצה האחרונה לא רשמה commit בסיס");

  const dir = await ensureCheckout({ id: r.id, name: r.name, localPath: r.localPath, adoRepoRef: r.adoRepoRef });
  if (!dir) throw new Error(`לא הצלחתי להביא עותק של ${r.name}`);
  const currentCommit = (await git(["rev-parse", "HEAD"], dir)).out.trim();
  const checkedAt = new Date().toISOString();
  const artifacts = await withTenant(r.clientId, (tx) => tx.select().from(repositoryAiArtifact).where(eq(repositoryAiArtifact.runId, last.id)));
  const written = artifacts.filter((a) => a.status === "written" || a.status === "validated");

  const signals: StaleSignal[] = [];
  let changedPaths: string[] = [];
  if (currentCommit !== analyzedCommit) {
    const diff = await git(["diff", `${analyzedCommit}..${currentCommit}`, "--name-only"], dir);
    changedPaths = diff.out.split("\n").map((s) => s.trim()).filter(Boolean);
    const manifests = changedPaths.filter((p) => MANIFESTS.test(p));
    if (manifests.length) signals.push({ kind: "manifest_changed", detail: manifests.slice(0, 10).join(", "), artifacts: written.filter((a) => a.kind === "claude_md").map((a) => a.path) });
    for (const a of written) {
      const hits = globToWatched((a.watchedPaths as string[]) ?? [], changedPaths);
      if (hits.length) signals.push({ kind: "watched_path_changed", detail: `${a.path}: ${hits.slice(0, 6).join(", ")}${hits.length > 6 ? ` +${hits.length - 6}` : ""}`, artifacts: [a.path] });
    }
  }
  for (const a of written) {
    const full = path.join(dir, a.path);
    const content = readArtifactText(full);
    if (content === null) { signals.push({ kind: "artifact_missing", detail: `${a.path} לא קיים יותר ב-${r.defaultBranch}`, artifacts: [a.path] }); continue; }
    const text = content;
    if (a.contentHash && contentHash(text) !== a.contentHash) signals.push({ kind: "artifact_edited_outside_dcc", detail: `${a.path} נערך מחוץ ל-DCC (ה-hash השתנה) — הגרסה ב-repository היא מקור האמת`, artifacts: [a.path] });
    if (a.kind === "claude_md" && text.split("\n").length > 150) signals.push({ kind: "claude_md_too_long", detail: `${a.path}: ${text.split("\n").length} שורות (מקסימום 150)`, artifacts: [a.path] });
    if (a.kind === "rule" || a.kind === "knowledge_skill" || a.kind === "workflow_skill") {
      const fm = text.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? "";
      const globs = Array.from(fm.matchAll(/^\s+-\s+"?([^"\n]+)"?$/gm)).map((m) => m[1]!.trim());
      if (globs.length) {
        let n = 0;
        for (const g of globs) { try { n += globSync(g, { cwd: dir }).length; } catch { /* ignore */ } }
        if (n === 0) signals.push({ kind: "referenced_path_missing", detail: `${a.path}: ה-paths (${globs.join(", ")}) לא תואמים אף קובץ יותר`, artifacts: [a.path] });
      }
    }
  }
  const ageDays = (Date.now() - new Date(last.completedAt ?? last.startedAt).getTime()) / 86_400_000;
  if (ageDays > 90 && changedPaths.length > 0) signals.push({ kind: "age", detail: `${Math.round(ageDays)} ימים מאז ה-onboarding האחרון ו-${changedPaths.length} קבצים השתנו`, artifacts: [] });

  let ai: RefreshResult["ai"] = null;
  let updateRequired = signals.some((s) => s.kind === "artifact_missing" || s.kind === "claude_md_too_long" || s.kind === "referenced_path_missing");
  if (signals.length && changedPaths.length) {
    const prompt = await getActiveOnboardingPrompt("onboarding.v2.refresh");
    if (prompt) {
      const runner = createClaudeCodeRunner();
      const exec = await runner.run({
        runId: last.id, stageKey: "refresh", repoId, clientId: r.clientId, cwd: dir, promptId: prompt.id, capability: "onboarding_refresh",
        tools: [...READ_ONLY_TOOLS], jsonSchema: REFRESH_SCHEMA as unknown as Record<string, unknown>,
        promptVars: {
          OLD_COMMIT: analyzedCommit, NEW_COMMIT: currentCommit, CHANGED_PATHS: JSON.stringify(changedPaths.slice(0, 400)),
          ARTIFACTS: JSON.stringify(written.map((a) => ({ path: a.path, kind: a.kind, watched_paths: a.watchedPaths }))),
          SIGNALS: JSON.stringify(signals),
        },
        maxTurns: 25, timeoutMs: 300_000,
      });
      if (exec.status === "Completed" && exec.json) {
        const j = exec.json as { update_required: boolean; impacted_artifacts?: string[]; required_updates_he?: string[]; evidence?: string[]; reason_he: string };
        ai = { impactedArtifacts: j.impacted_artifacts ?? [], requiredUpdates_he: j.required_updates_he ?? [], evidence: j.evidence ?? [], reason_he: j.reason_he, executionId: exec.executionId };
        updateRequired = updateRequired || j.update_required;
      }
    }
  }
  const reason_he = signals.length === 0
    ? (currentCommit === analyzedCommit ? "אין commit חדש מאז ה-onboarding האחרון" : `${changedPaths.length} קבצים השתנו, אך אף אחד מהם לא נוגע בנתיבים שה-artifacts תלויים בהם`)
    : ai?.reason_he ?? `${signals.length} סימני התיישנות דטרמיניסטיים`;
  const result: RefreshResult = { checkedAt, lastRunId: last.id, analyzedCommit, currentCommit, changedPaths, signals, updateRequired, ai, reason_he };
  await appendRepoAiEvent({ clientId: r.clientId, repoId, type: "onboarding.refresh_checked", payload: { ...result, changedPaths: changedPaths.slice(0, 200) }, actorUserId: userId });
  return result;
}

export type RefreshMetrics = {
  totalChecks: number; noUpdateCount: number; updateRequiredCount: number;
  lastCheckedAt: string | null; lastResult: RefreshResult | null; avgDaysBetweenChecks: number | null;
};

export async function repositoryRefreshMetrics(repoId: string): Promise<RefreshMetrics> {
  const rows = await db.select().from(repoAiEvent)
    .where(and(eq(repoAiEvent.repoId, repoId), eq(repoAiEvent.type, "onboarding.refresh_checked")))
    .orderBy(desc(repoAiEvent.occurredAt));
  const totalChecks = rows.length;
  const updateRequiredCount = rows.filter((r) => (r.payload as { updateRequired?: boolean })?.updateRequired === true).length;
  const noUpdateCount = totalChecks - updateRequiredCount;
  const lastCheckedAt = rows[0] ? new Date(rows[0].occurredAt).toISOString() : null;
  let avgDaysBetweenChecks: number | null = null;
  if (rows.length >= 2) {
    const first = new Date(rows[rows.length - 1]!.occurredAt).getTime();
    const lastTs = new Date(rows[0]!.occurredAt).getTime();
    avgDaysBetweenChecks = (lastTs - first) / (rows.length - 1) / 86_400_000;
  }
  return { totalChecks, noUpdateCount, updateRequiredCount, lastCheckedAt, lastResult: (rows[0]?.payload as RefreshResult | undefined) ?? null, avgDaysBetweenChecks };
}
