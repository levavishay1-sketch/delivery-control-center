import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { withTenant } from "@dcc/db";
import { task, workitem } from "@dcc/db/schema";
import { existingCheckout, firstRepo, git, taskBranchName } from "./ai-assist.ts";

/**
 * The code map: one picture of where a piece of work sits in git, drawn the
 * same way everywhere in DCC (`openspec/changes/pull-request-center`).
 *
 * Screens never compute it and never draw their own version of it: they ask
 * for a `CodeMap` and hand it to the one component that knows the visual
 * language. Adding a place that touches git means calling `codeMapFor…` here,
 * not inventing a drawing — and changing how the drawing reads is one change,
 * in one file, for every screen at once.
 */

export type CodeMapPlace = "cloud" | "local" | "both";

/** What a dot on a line means. `attention` is a change that touches the same files as ours. */
export type CodeMapNodeKind = "other" | "ours" | "attention" | "current" | "branchPoint" | "pr" | "uncommitted" | "empty";

export type CodeMapNode = { kind: CodeMapNodeKind; title?: string };

export type CodeMapLane = {
  id: string;
  /** Above the line, near where it starts. */
  label?: string;
  /** Muted, under the label — a time or a count. */
  note?: string;
  /** The badge at the end of the line: where this code exists right now. */
  place?: CodeMapPlace;
  /** Oldest first; the drawing lays them out newest-to-the-left. */
  nodes: CodeMapNode[];
  /** Where this line leaves another one. */
  from?: { lane: string; at: number };
};

/** A transfer between lines: push, pull, a pull request, a merge. */
export type CodeMapArrow = { from: string; to: string; label: string; state: "done" | "pending" };

export type CodeMap = { lanes: CodeMapLane[]; arrows: CodeMapArrow[]; caption?: string };

/* ── what git says ────────────────────────────────────────────────── */

export type CodeMapFacts = {
  baseBranch: string;
  branch: string | null;
  baselineSha: string | null;
  /** Commits on our branch since the baseline, newest first. */
  ourCommits: { sha: string; subject: string }[];
  /** Files changed but not yet in any commit. */
  uncommittedFiles: number;
  /** Commits the base gained since we branched. */
  behind: number;
  /** Of those, how many touch a file we also changed. */
  behindTouching: number;
  pushed: boolean;
  merged: boolean;
  prUrl: string | null;
  prNumber: number | null;
  /** When the local copy last heard from the host. */
  fetchedAt: string | null;
};

const EMPTY: CodeMapFacts = {
  baseBranch: "main", branch: null, baselineSha: null, ourCommits: [], uncommittedFiles: 0,
  behind: 0, behindTouching: 0, pushed: false, merged: false, prUrl: null, prNumber: null, fetchedAt: null,
};

const MAX_COMMITS = 6;
const TTL_MS = 8_000;
const cache = new Map<string, { at: number; facts: CodeMapFacts }>();

const count = (out: string) => Number(out.trim()) || 0;
const lines = (out: string) => out.split("\n").map((s) => s.trim()).filter(Boolean);

/** Read the git facts of a working copy. Local commands only — no network, so
 *  a screen that polls every couple of seconds stays cheap; the result is
 *  memoised briefly on top of that. */
export async function readCodeMapFacts(dir: string, input: { branch?: string | null; baselineSha?: string | null; prUrl?: string | null; prNumber?: number | null; ref?: string }): Promise<CodeMapFacts> {
  if (!dir || !existsSync(dir)) return { ...EMPTY, ...input } as CodeMapFacts;
  // A task's branch is read without checking it out, so the tip is a named ref rather than HEAD.
  const R = input.ref ?? "HEAD";
  const key = `${dir}|${R}|${input.branch ?? ""}|${input.baselineSha ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...hit.facts, prUrl: input.prUrl ?? hit.facts.prUrl, prNumber: input.prNumber ?? hit.facts.prNumber };

  const head = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir)).out.trim().replace(/^origin\//, "");
  const baseBranch = head || "main";
  const baseRef = `origin/${baseBranch}`;
  const branch = input.branch ?? ((await git(["branch", "--show-current"], dir)).out.trim() || null);

  // The point the work started from: what was recorded, or where the branch left the base.
  let baseline = input.baselineSha ?? null;
  if (!baseline && branch) {
    const mb = await git(["merge-base", input.ref ?? branch, baseRef], dir);
    baseline = mb.code === 0 ? mb.out.trim() || null : null;
  }

  const facts: CodeMapFacts = { ...EMPTY, baseBranch, branch, baselineSha: baseline };
  if (baseline) {
    const log = await git(["log", "--format=%h\t%s", "-n", String(MAX_COMMITS + 1), `${baseline}..${R}`], dir, { timeoutMs: 20_000 });
    facts.ourCommits = lines(log.out).map((l) => { const [sha, ...rest] = l.split("\t"); return { sha: sha!, subject: rest.join("\t") }; });
    const behind = await git(["rev-list", "--count", `${R}..${baseRef}`], dir, { timeoutMs: 20_000 });
    facts.behind = behind.code === 0 ? count(behind.out) : 0;
    if (facts.behind > 0) {
      const theirs = new Set(lines((await git(["diff", "--name-only", `${R}..${baseRef}`], dir, { timeoutMs: 20_000 })).out));
      const ours = lines((await git(["diff", "--name-only", `${baseline}..${R}`], dir, { timeoutMs: 20_000 })).out);
      facts.behindTouching = ours.filter((f) => theirs.has(f)).length;
    }
  }
  // Only meaningful for the copy that is actually checked out.
  if (R === "HEAD") facts.uncommittedFiles = lines((await git(["status", "--porcelain"], dir, { timeoutMs: 20_000 })).out).length;

  if (branch) {
    const remote = await git(["rev-list", "--count", `origin/${branch}..${R}`], dir);
    facts.pushed = remote.code === 0 && count(remote.out) === 0;
    const merged = await git(["merge-base", "--is-ancestor", R, baseRef], dir);
    facts.merged = merged.code === 0 && facts.ourCommits.length > 0;
  }

  // A worktree's `.git` is a file; the fetch record lives in the shared directory.
  const common = (await git(["rev-parse", "--git-common-dir"], dir)).out.trim();
  const fetchHead = common ? path.resolve(dir, common, "FETCH_HEAD") : "";
  if (fetchHead && existsSync(fetchHead)) { try { facts.fetchedAt = statSync(fetchHead).mtime.toISOString(); } catch { /* unreadable */ } }

  cache.set(key, { at: Date.now(), facts });
  return { ...facts, prUrl: input.prUrl ?? null, prNumber: input.prNumber ?? null };
}

/* ── the picture ──────────────────────────────────────────────────── */

const he = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** Facts → the drawing. The only place that decides what the map shows. */
export function codeMapFrom(f: CodeMapFacts, opts: { branchLabel?: string; showBase?: boolean } = {}): CodeMap {
  const base: CodeMapLane = { id: "base", label: f.baseBranch, place: "both", nodes: [] };
  // A little history before the branch point, so the line reads as a line.
  base.nodes.push({ kind: "other" }, { kind: "other" });
  const branchAt = base.nodes.length;
  base.nodes.push({ kind: f.behind > 0 ? "branchPoint" : "current", title: f.baselineSha ?? undefined });
  if (f.behind > 0) {
    const shown = Math.min(f.behind, 12);
    const attention = Math.min(f.behindTouching, shown);
    for (let i = 0; i < shown - 1; i++) base.nodes.push({ kind: i < attention ? "attention" : "other" });
    base.nodes.push({ kind: "current" });
    base.note = f.behindTouching > 0
      ? `${he(f.behind, "שינוי אחד נכנס", "שינויים נכנסו")} מאז · ${he(f.behindTouching, "אחד נוגע", "נוגעים")} באותם קבצים`
      : `${he(f.behind, "שינוי אחד נכנס", "שינויים נכנסו")} מאז שהתחלנו`;
  } else if (f.fetchedAt) {
    base.note = `נמשך ${new Date(f.fetchedAt).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  }

  const ours: CodeMapLane = {
    id: "ours",
    label: opts.branchLabel ?? f.branch ?? "הענף שלנו",
    place: f.pushed ? "both" : "local",
    from: { lane: "base", at: branchAt },
    nodes: [],
  };
  for (const c of f.ourCommits.slice(0, MAX_COMMITS).reverse()) ours.nodes.push({ kind: "ours", title: `${c.sha} ${c.subject}`.slice(0, 80) });
  if (f.uncommittedFiles > 0) ours.nodes.push({ kind: "uncommitted", title: `${f.uncommittedFiles} קבצים שעוד לא נשמרו` });
  if (f.prUrl) ours.nodes.push({ kind: "pr", title: f.prNumber ? `PR #${f.prNumber}` : "PR" });
  if (!ours.nodes.length) ours.nodes.push({ kind: "empty", title: "עדיין אין commits" });
  ours.note = f.ourCommits.length
    ? `${he(f.ourCommits.length, "commit אחד", "commits")}${f.uncommittedFiles ? ` · ${f.uncommittedFiles} קבצים שעוד לא נשמרו` : ""}`
    : f.uncommittedFiles
      ? `${f.uncommittedFiles} קבצים שעוד לא נשמרו`
      : "נפתח מהנקודה הזו";

  const arrows: CodeMapArrow[] = [];
  const hasWork = f.ourCommits.length > 0 || f.uncommittedFiles > 0;
  if (f.merged) arrows.push({ from: "ours", to: "base", label: `נמזג ל-${f.baseBranch}`, state: "done" });
  else if (f.prUrl) arrows.push({ from: "ours", to: "base", label: f.prNumber ? `PR #${f.prNumber} · ממתין למיזוג` : "ממתין למיזוג", state: "pending" });
  else if (f.pushed && hasWork) arrows.push({ from: "ours", to: "base", label: "נדחף, עדיין בלי PR", state: "pending" });
  else if (hasWork) arrows.push({ from: "ours", to: "base", label: "טרם נדחף", state: "pending" });

  return {
    lanes: opts.showBase === false ? [ours] : [base, ours],
    arrows,
    caption: caption(f),
  };
}

/** The one sentence under the drawing: what the picture means for the person. */
function caption(f: CodeMapFacts): string {
  if (f.merged) return `העבודה נכנסה ל-${f.baseBranch}.`;
  if (f.behind === 0 && !f.pushed) return `העבודה יושבת על הגרסה העדכנית של ${f.baseBranch}, ועדיין לא יצאה מהמחשב.`;
  if (f.behind === 0) return `העבודה יושבת על הגרסה העדכנית של ${f.baseBranch}.`;
  if (f.behindTouching > 0) return `${f.baseBranch} התקדם ב-${f.behind} מאז שהתחלנו, ו-${f.behindTouching} מהם נוגעים באותם קבצים — כדאי לעדכן את הענף לפני המיזוג.`;
  return `${f.baseBranch} התקדם ב-${f.behind} מאז שהתחלנו, ואף אחד מהם לא נוגע בקבצים שלנו.`;
}

/** The map of a working copy, in one call — what every screen uses. */
export async function codeMapForWorkspace(dir: string, input: { branch?: string | null; baselineSha?: string | null; prUrl?: string | null; prNumber?: number | null; branchLabel?: string; ref?: string }): Promise<CodeMap> {
  const facts = await readCodeMapFacts(dir, input);
  return codeMapFrom(facts, { branchLabel: input.branchLabel ?? input.branch ?? undefined });
}

/* ── a task's branch ──────────────────────────────────────────────── */

/** The same map for a task's implementation branch. Read-only: the branch is
 *  inspected by name, without checking it out, so nothing about the shared
 *  clone changes just because a screen was opened. */
export async function codeMapForTask(input: { clientId: string; workitemId: string; taskId: string }): Promise<{ codeMap: CodeMap | null; branch: string | null; reason?: string }> {
  const [t] = await withTenant(input.clientId, (tx) => tx.select({ seq: task.seq, intent: task.intent }).from(task).where(eq(task.id, input.taskId)).limit(1));
  if (!t) return { codeMap: null, branch: null, reason: "משימה לא נמצאה" };
  const [wi] = await withTenant(input.clientId, (tx) => tx.select({ key: workitem.key }).from(workitem).where(eq(workitem.id, input.workitemId)).limit(1));
  const r = await firstRepo(input.clientId, input.workitemId);
  if (!r) return { codeMap: null, branch: null, reason: "אין repository מקושר לדרישה" };
  // Opening a screen must never start a clone: only a copy that already exists is read.
  const dir = await existingCheckout(r);
  if (!dir) return { codeMap: null, branch: null, reason: "אין עותק מקומי של הריפו — הוא ייווצר בהרצה הבאה" };
  const branch = taskBranchName(wi?.key, t);
  const exists = await git(["rev-parse", "--verify", "--quiet", branch], dir);
  if (exists.code !== 0) return { codeMap: null, branch, reason: "עוד לא נוצר ענף למשימה הזו" };
  const codeMap = await codeMapForWorkspace(dir, { branch, ref: branch }).catch(() => null);
  return { codeMap, branch };
}
