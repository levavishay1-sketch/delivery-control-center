import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { withTenant } from "@dcc/db";
import { task, workitem } from "@dcc/db/schema";
import { existingCheckout, firstRepo, git, httpsRepoUrl, taskBranchName } from "./ai-assist.ts";
import { displayPath } from "./local-folder.ts";

/**
 * The code map: one picture of where a piece of work sits in git, drawn the
 * same way everywhere in DCC (`openspec/changes/pull-request-center`).
 *
 * Screens never compute it and never draw their own version of it: they ask
 * for a `CodeMap` and hand it to the one component that knows the visual
 * language. Adding a place that touches git means calling `codeMapFor…` here,
 * not inventing a drawing — and changing how the drawing reads is one change,
 * in one file, for every screen at once.
 *
 * Every dot is a real commit carrying its subject, author, time, file count
 * and link, so pressing one can say what it actually was.
 */

export type CodeMapPlace = "cloud" | "local" | "both";

/** What a dot on a line means. `attention` is a change that touches the same files as ours; `merge` is a merge commit on the base line. */
export type CodeMapNodeKind = "other" | "ours" | "attention" | "current" | "merge" | "branchPoint" | "pr" | "uncommitted" | "empty";

export type CodeMapNode = {
  kind: CodeMapNodeKind;
  /** Hover text; the panel shows the fields below when a dot is pressed. */
  title?: string;
  sha?: string;
  subject?: string;
  author?: string;
  at?: string;
  /** Files this commit touched, or files still unsaved. */
  files?: number;
  /** What the commit's author wrote about it, after the first line — shown as it was written. */
  message?: string;
  /** The commit or the pull request on the host. */
  url?: string;
  /** The same pull request inside DCC (a `#/…` address), when it is known which repository and which request. */
  dccPath?: string;
  /** For a merge: the commits it brought in, oldest first — their titles are what pressing the dot lists. */
  brought?: { sha: string; subject: string }[];
  /** One line in Hebrew: what this dot is, for someone who does not read git. */
  detail?: string;
  /** For work that exists only on this computer: the folder it sits in. */
  folder?: string;
};

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
  /** Pressing the line itself says what it is: the branch's full name, where it lives, and a link. */
  name?: string;
  url?: string;
  detail?: string;
  folder?: string;
};

/** A transfer between lines: push, pull, a pull request, a merge. */
export type CodeMapArrow = { from: string; to: string; label: string; state: "done" | "pending" };

/** `problem`: the folder could not be read as a git repository — the map says so in words instead of drawing something wrong. */
export type CodeMap = { lanes: CodeMapLane[]; arrows: CodeMapArrow[]; caption?: string; problem?: { text: string; folder?: string } };

/* ── what git says ────────────────────────────────────────────────── */

export type CodeMapCommit = { sha: string; subject: string; author: string; at: string; files: string[]; /** The rest of the commit message, after its first line. */ body?: string; /** A merge commit: it has more than one parent, and brings in work done on another branch. */ merge?: boolean; /** Its parents, as short shas — how a merge is tied to the commits it brought in. */ parents?: string[] };

export type CodeMapFacts = {
  baseBranch: string;
  branch: string | null;
  baselineSha: string | null;
  /** The branch point itself, and a little of what came before it. */
  baselineCommit: CodeMapCommit | null;
  baseBefore: CodeMapCommit[];
  /** What the base gained since we branched, oldest first. */
  baseAfter: CodeMapCommit[];
  /** Our commits since the baseline, oldest first. */
  ourCommits: CodeMapCommit[];
  uncommittedFiles: number;
  behind: number;
  /** How many of the commits that came in after the branch opened touch a file of ours. Needs each commit's own files. */
  behindTouching: number;
  /** When the commits' own files are unknown (`perCommitFiles` false): how many files both sides changed. Says nothing about which commit. */
  sharedFiles?: number;
  pushed: boolean;
  merged: boolean;
  prUrl: string | null;
  prNumber: number | null;
  fetchedAt: string | null;
  /** The repository on the host, for linking a commit. */
  repoUrl: string | null;
  /** DCC's own id for that repository, when known: it is what lets a merge link to its request inside DCC. */
  repoId?: string | null;
  /** false when a commit's `files` is not that commit's own list (a host answer that only knows the whole branch's files): the map then shows no per-commit count. */
  perCommitFiles?: boolean;
  /** The working folder these facts were read from. */
  dir: string | null;
  /** Set when the folder could not be read; nothing else in the facts is meaningful then. */
  unreadable: string | null;
};

const EMPTY: CodeMapFacts = {
  baseBranch: "main", branch: null, baselineSha: null, baselineCommit: null, baseBefore: [], baseAfter: [], ourCommits: [],
  uncommittedFiles: 0, behind: 0, behindTouching: 0, pushed: false, merged: false, prUrl: null, prNumber: null, fetchedAt: null, repoUrl: null, dir: null, unreadable: null,
};

const MAX_OURS = 8;
const MAX_BASE_AFTER = 12;
const BEFORE = 2;
const TTL_MS = 8_000;
const cache = new Map<string, { at: number; facts: CodeMapFacts }>();

const num = (out: string) => Number(out.trim()) || 0;
const lines = (out: string) => out.split("\n").map((s) => s.trim()).filter(Boolean);

/** One `git log` gives each commit and the files it touched: a record starts
 *  with a NUL-separated header, and its file paths follow, one per line. */
// A record separator and a field separator, so a subject or a path containing
// either one is impossible: git writes them, the text never does.
const RS = "\x1e";
const FS = "\x1f";
const LOG_FORMAT = `%x1e%h%x1f%an%x1f%aI%x1f%s%x1f%b%x1f%P%x1f`;

function parseLog(out: string): CodeMapCommit[] {
  const commits: CodeMapCommit[] = [];
  for (const record of out.split(RS).slice(1)) {
    const [sha, author, at, subject, body, parents, filesText] = record.split(FS);
    if (!sha || filesText === undefined) continue;
    commits.push({
      sha: sha.trim(), author: (author ?? "").trim(), at: (at ?? "").trim(),
      subject: (subject ?? "").trim(), body: (body ?? "").trim() || undefined,
      files: filesText.split("\n").map((f) => f.trim()).filter(Boolean),
      merge: (parents ?? "").trim().split(/\s+/).filter(Boolean).length > 1 || undefined,
      parents: (parents ?? "").trim().split(/\s+/).filter(Boolean).map((p) => p.slice(0, 7)),
    });
  }
  return commits;
}

async function logCommits(dir: string, range: string, limit: number): Promise<CodeMapCommit[]> {
  const r = await git(["log", `--format=${LOG_FORMAT}`, "--name-only", "-n", String(limit), range], dir, { timeoutMs: 25_000 });
  return r.code === 0 ? parseLog(r.out) : [];
}

/** Read the git facts of a working copy. Local commands only — no network, so
 *  a screen that polls every couple of seconds stays cheap; the result is
 *  memoised briefly on top of that. */
export async function readCodeMapFacts(dir: string, input: { branch?: string | null; baselineSha?: string | null; prUrl?: string | null; prNumber?: number | null; ref?: string }): Promise<CodeMapFacts> {
  if (!dir || !existsSync(dir)) return { ...EMPTY, dir: dir ? displayPath(dir) : null, unreadable: "התיקייה לא קיימת במחשב הזה — ייתכן שנמחקה." };
  // A folder that exists but is not a git repository (its parent clone was deleted, a clone was cut short) must be
  // reported as that, never read further: git's error text would otherwise end up on the screen as if it were data.
  const inside = await git(["rev-parse", "--is-inside-work-tree"], dir);
  if (inside.code !== 0 || inside.out.trim() !== "true") {
    return { ...EMPTY, dir: displayPath(dir), unreadable: "git לא מזהה בתיקייה הזו ריפו. כנראה העותק המקומי של הריפו נמחק או נפגע. אין בזה נזק לעבודה שב-GitHub; כדאי לבטל את ההרצה ולהתחיל חדשה." };
  }
  // Text out of git is data only when the command succeeded.
  const okOut = async (args: string[]) => { const r = await git(args, dir); return r.code === 0 ? r.out.trim() : ""; };
  // A task's branch is read without checking it out, so the tip is a named ref rather than HEAD.
  const R = input.ref ?? "HEAD";
  const key = `${dir}|${R}|${input.branch ?? ""}|${input.baselineSha ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...hit.facts, prUrl: input.prUrl ?? hit.facts.prUrl, prNumber: input.prNumber ?? hit.facts.prNumber };

  const head = (await okOut(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).replace(/^origin\//, "");
  const baseBranch = head || "main";
  const baseRef = `origin/${baseBranch}`;
  const branch = input.branch ?? ((await okOut(["branch", "--show-current"])) || null);
  const remote = await okOut(["remote", "get-url", "origin"]);

  let baseline = input.baselineSha ?? null;
  if (!baseline && branch) {
    const mb = await git(["merge-base", input.ref ?? branch, baseRef], dir);
    baseline = mb.code === 0 ? mb.out.trim() || null : null;
  }

  const facts: CodeMapFacts = { ...EMPTY, baseBranch, branch, baselineSha: baseline, repoUrl: remote ? httpsRepoUrl(remote) : null, dir: displayPath(dir) };
  if (baseline) {
    facts.ourCommits = (await logCommits(dir, `${baseline}..${R}`, MAX_OURS)).reverse();
    facts.baseAfter = (await logCommits(dir, `${baseline}..${baseRef}`, MAX_BASE_AFTER)).reverse();
    facts.baselineCommit = (await logCommits(dir, baseline, 1))[0] ?? null;
    facts.baseBefore = (await logCommits(dir, `${baseline}~1`, BEFORE)).reverse();
    const behind = await git(["rev-list", "--count", `${R}..${baseRef}`], dir, { timeoutMs: 20_000 });
    facts.behind = behind.code === 0 ? num(behind.out) : 0;
    const ourFiles = new Set(facts.ourCommits.flatMap((c) => c.files));
    facts.behindTouching = facts.baseAfter.filter((c) => c.files.some((f) => ourFiles.has(f))).length;
  }
  if (R === "HEAD") facts.uncommittedFiles = lines((await git(["status", "--porcelain"], dir, { timeoutMs: 20_000 })).out).length;

  if (branch) {
    const remoteAhead = await git(["rev-list", "--count", `origin/${branch}..${R}`], dir);
    facts.pushed = remoteAhead.code === 0 && num(remoteAhead.out) === 0;
    const merged = await git(["merge-base", "--is-ancestor", R, baseRef], dir);
    facts.merged = merged.code === 0 && facts.ourCommits.length > 0;
  }

  // A worktree's `.git` is a file; the fetch record lives in the shared directory.
  const common = await okOut(["rev-parse", "--git-common-dir"]);
  const fetchHead = common ? path.resolve(dir, common, "FETCH_HEAD") : "";
  if (fetchHead && existsSync(fetchHead)) { try { facts.fetchedAt = statSync(fetchHead).mtime.toISOString(); } catch { /* unreadable */ } }

  cache.set(key, { at: Date.now(), facts });
  return { ...facts, prUrl: input.prUrl ?? null, prNumber: input.prNumber ?? null };
}

/* ── the picture ──────────────────────────────────────────────────── */

const he = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
/** "One shared file" / "3 shared files" — what the host can tell us when it does not say which commit touched what. */
const sharedFilesPhrase = (n: number) => he(n, "קובץ אחד משותף", "קבצים משותפים");
const commitUrl = (repoUrl: string | null, sha: string) => (repoUrl ? `${repoUrl}/commit/${sha}` : undefined);
const filesLine = (n: number) => (n === 1 ? "קובץ אחד" : `${n} קבצים`);

/** `onHost`: the commit exists on the host, so it has a page there. `folder`: it also exists in a folder on this computer. */
function nodeFrom(c: CodeMapCommit, kind: CodeMapNodeKind, repoUrl: string | null, detail: string, where: { onHost: boolean; folder?: string } = { onHost: true }): CodeMapNode {
  return {
    kind, sha: c.sha, subject: c.subject, author: c.author, at: c.at,
    files: c.files.length || undefined, message: c.body ? c.body.slice(0, 1500) : undefined, url: where.onHost ? commitUrl(repoUrl, c.sha) : undefined, folder: where.folder, detail,
    title: `${c.sha} ${c.subject}`.slice(0, 90),
  };
}

/** Facts → the drawing. The only place that decides what the map shows. */
export function codeMapFrom(f: CodeMapFacts, opts: { branchLabel?: string } = {}): CodeMap {
  if (f.unreadable) return { lanes: [], arrows: [], caption: f.unreadable, problem: { text: f.unreadable, folder: f.dir ?? undefined } };
  // The folder the facts were read from: everything the map shows that exists there can be opened from it.
  const here = f.dir ?? undefined;
  const base: CodeMapLane = {
    id: "base", label: f.baseBranch, place: "both", nodes: [],
    name: f.baseBranch,
    folder: here,
    url: f.repoUrl ? `${f.repoUrl}/tree/${encodeURIComponent(f.baseBranch)}` : undefined,
    detail: `הענף הראשי של הריפו — הגרסה הרשמית, שכולם עובדים ממנה. כל שינוי מתמזג אליו בסוף, ורק אז הצוות מקבל אותו.`,
  };
  for (const c of f.baseBefore) base.nodes.push(nodeFrom(c, c.merge ? "merge" : "other", f.repoUrl, c.merge ? `מיזוג ב-${f.baseBranch} מלפני שהענף שלנו נפתח.` : `שינוי ב-${f.baseBranch} מלפני שהענף שלנו נפתח.`, { onHost: true, folder: here }));
  const branchAt = base.nodes.length;
  const pointDetail = `הנקודה שממנה הענף שלנו יצא. כל מה שהיה ב-${f.baseBranch} עד כאן נמצא גם אצלנו.`;
  // The request's number, from "Merge pull request #7 …" or a squash commit's "… (#7)".
  const requestNumber = (subject: string) => /^Merge pull request #(\d+)\b/.exec(subject)?.[1] ?? /\(#(\d+)\)\s*$/.exec(subject)?.[1];
  const dccPathFor = (subject: string) => { const n = requestNumber(subject); return n && f.repoId ? `#/pull-requests/${f.repoId}/${n}` : undefined; };
  const point: CodeMapNode = f.baselineCommit
    ? nodeFrom(f.baselineCommit, f.baseAfter.length ? "branchPoint" : "current", f.repoUrl, pointDetail, { onHost: true, folder: here })
    : { kind: f.baseAfter.length ? "branchPoint" : "current", detail: pointDetail, sha: f.baselineSha?.slice(0, 7) };
  const pointDcc = f.baselineCommit ? dccPathFor(f.baselineCommit.subject) : undefined;
  if (pointDcc) point.dccPath = pointDcc;
  base.nodes.push(point);

  const ourFiles = new Set(f.ourCommits.flatMap((c) => c.files));
  // What a merge brought in: the commits reachable from its later parents that are not already reachable from its first —
  // the first parent is the base line itself, the others are the branches folded in. Only commits in this list can be named.
  const inList = new Map(f.baseAfter.map((c) => [c.sha.slice(0, 7), c]));
  const reach = (starts: string[]) => {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length) {
      const s = stack.pop()!.slice(0, 7);
      if (seen.has(s) || !inList.has(s)) continue;
      seen.add(s);
      stack.push(...(inList.get(s)!.parents ?? []));
    }
    return seen;
  };
  const broughtBy = (c: CodeMapCommit) => {
    const [first, ...others] = c.parents ?? [];
    const onBaseLine = reach(first ? [first] : []);
    return [...reach(others)].filter((s) => !onBaseLine.has(s)).map((s) => inList.get(s)!)
      .sort((a, b) => a.at.localeCompare(b.at)).map((x) => ({ sha: x.sha, subject: x.subject }));
  };
  f.baseAfter.forEach((c, i) => {
    const touching = c.files.some((x) => ourFiles.has(x));
    const newest = i === f.baseAfter.length - 1;
    const detail = c.merge
      ? `מיזוג: הוא הכניס ל-${f.baseBranch} אחרי שהתחלנו עבודה שנעשתה בענף אחר.`
      : touching
        ? `נכנס ל-${f.baseBranch} אחרי שהתחלנו, ונוגע בקבצים שגם אנחנו שינינו.`
        : `נכנס ל-${f.baseBranch} אחרי שהתחלנו, ולא נוגע בקבצים שלנו.`;
    // A merge is drawn black, like the newest dot, wherever it sits on the base line.
    const node = nodeFrom(c, touching ? "attention" : newest ? "current" : c.merge ? "merge" : "other", f.repoUrl, detail, { onHost: true, folder: here });
    if (c.merge) { const brought = broughtBy(c); if (brought.length) node.brought = brought; }
    const dcc = dccPathFor(c.subject);
    if (dcc) node.dccPath = dcc;
    base.nodes.push(node);
  });

  if (f.behind > 0) {
    const came = he(f.behind, "שינוי אחד נכנס", "שינויים נכנסו");
    if (f.perCommitFiles === false) {
      base.note = f.sharedFiles ? `${came} מאז · ${sharedFilesPhrase(f.sharedFiles)}` : `${came} מאז שהתחלנו`;
    } else {
      base.note = f.behindTouching > 0
        ? `${came} מאז · ${he(f.behindTouching, "אחד נוגע", "נוגעים")} באותם קבצים`
        : `${came} מאז שהתחלנו`;
    }
  } else if (f.fetchedAt) {
    base.note = `נמשך ${new Date(f.fetchedAt).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  }

  const ours: CodeMapLane = {
    id: "ours",
    label: opts.branchLabel ?? f.branch ?? "הענף שלנו",
    place: f.pushed ? "both" : "local",
    from: { lane: "base", at: branchAt },
    nodes: [],
    name: f.branch ?? undefined,
    // A branch that was never pushed has no page on the host to open.
    url: f.pushed && f.repoUrl && f.branch ? `${f.repoUrl}/tree/${encodeURIComponent(f.branch)}` : undefined,
    folder: here,
    detail: `הענף שבו העבודה הזו נעשית. ${f.pushed ? "הוא כבר הועלה ל-GitHub, ויש לו עותק גם במחשב הזה." : "הוא קיים רק במחשב הזה ועדיין לא הועלה ל-GitHub."}${f.ourCommits.length ? ` יש בו ${he(f.ourCommits.length, "commit אחד", "commits")} שעוד לא נמצאים ב-${f.baseBranch}: העלאה לא מכניסה אותם לשם, את זה עושה בקשת מיזוג.` : " עדיין לא נשמר בו שום שינוי."}`,
  };
  // A commit is where it exists: pushed → a page on the host and the folder; not pushed → the folder only.
  for (const c of f.ourCommits) {
    ours.nodes.push(nodeFrom(c, "ours", f.repoUrl, f.pushed
      ? `שינוי שנשמר בענף שלנו. הענף כבר הועלה ל-GitHub, אבל השינוי הזה עדיין לא נמצא ב-${f.baseBranch}${f.prUrl ? ": בקשת המיזוג מבקשת להכניס אותו." : ", ועוד אין בקשת מיזוג שמבקשת להכניס אותו."}`
      : "שינוי שנשמר בענף שלנו, עדיין רק במחשב הזה. הוא יופיע ב-GitHub אחרי שהענף יועלה.",
      { onHost: f.pushed, folder: here }));
  }
  if (f.uncommittedFiles > 0) {
    ours.nodes.push({
      kind: "uncommitted", files: f.uncommittedFiles, folder: here,
      subject: `${filesLine(f.uncommittedFiles)} שעוד לא נשמרו`,
      detail: "שינויים שקיימים בתיקייה אבל עדיין לא נשמרו ב-git. הם ייכנסו ב-commit של המסירה, לפי מה שתאשרו בסקירה.",
    });
  }
  if (f.prUrl) {
    ours.nodes.push({
      kind: "pr", url: f.prUrl, subject: f.prNumber ? `בקשת מיזוג #${f.prNumber}` : "בקשת מיזוג",
      detail: `בקשת מיזוג היא בקשה, לא העלאה: הענף כבר נמצא ב-GitHub. הבקשה מציעה להכניס אותו ל-${f.baseBranch}, והמיזוג עצמו נעשה בגיט־האוסט, בלחיצה של אדם.`,
    });
  }
  if (!ours.nodes.length) ours.nodes.push({ kind: "empty", subject: "עדיין אין commits", detail: "הענף נפתח, ועדיין לא נשמר בו שום שינוי.", folder: here });
  ours.note = f.ourCommits.length
    ? `${he(f.ourCommits.length, "commit אחד", "commits")}${f.uncommittedFiles ? ` · ${filesLine(f.uncommittedFiles)} שעוד לא נשמרו` : ""}`
    : f.uncommittedFiles
      ? `${filesLine(f.uncommittedFiles)} שעוד לא נשמרו`
      : "נפתח מהנקודה הזו";

  const arrows: CodeMapArrow[] = [];
  const hasWork = f.ourCommits.length > 0 || f.uncommittedFiles > 0;
  if (f.merged) arrows.push({ from: "ours", to: "base", label: `נמזג ל-${f.baseBranch}`, state: "done" });
  else if (f.prUrl) arrows.push({ from: "ours", to: "base", label: f.prNumber ? `בקשה #${f.prNumber} · ממתינה למיזוג` : "ממתינה למיזוג", state: "pending" });
  else if (f.pushed && hasWork) arrows.push({ from: "ours", to: "base", label: "הועלה, עדיין בלי בקשת מיזוג", state: "pending" });
  else if (hasWork) arrows.push({ from: "ours", to: "base", label: "טרם הועלה ל-GitHub", state: "pending" });

  if (f.perCommitFiles === false) for (const lane of [base, ours]) for (const n of lane.nodes) delete n.files;
  return { lanes: [base, ours], arrows, caption: caption(f) };
}

/** The one sentence under the drawing: what the picture means for the person. */
function caption(f: CodeMapFacts): string {
  if (f.merged) return `העבודה נכנסה ל-${f.baseBranch}.`;
  if (f.behind === 0 && !f.pushed) return `העבודה יושבת על הגרסה העדכנית של ${f.baseBranch}, ועדיין לא יצאה מהמחשב.`;
  if (f.behind === 0) return `העבודה יושבת על הגרסה העדכנית של ${f.baseBranch}.`;
  if (f.perCommitFiles === false && f.sharedFiles) return `${f.baseBranch} התקדם ב-${f.behind} מאז שהתחלנו, ויש ${sharedFilesPhrase(f.sharedFiles)} שגם אנחנו שינינו — כדאי לעדכן את הענף לפני המיזוג.`;
  if (f.perCommitFiles !== false && f.behindTouching > 0) return `${f.baseBranch} התקדם ב-${f.behind} מאז שהתחלנו, ו-${f.behindTouching} מהם נוגעים באותם קבצים — כדאי לעדכן את הענף לפני המיזוג.`;
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
  const dir = existingCheckout(r);
  if (!dir) return { codeMap: null, branch: null, reason: "אין עותק מקומי של הריפו — הוא ייווצר בהרצה הבאה" };
  const branch = taskBranchName(wi?.key, t);
  const exists = await git(["rev-parse", "--verify", "--quiet", branch], dir);
  if (exists.code !== 0) return { codeMap: null, branch, reason: "עוד לא נוצר ענף למשימה הזו" };
  const codeMap = await codeMapForWorkspace(dir, { branch, ref: branch }).catch(() => null);
  return { codeMap, branch };
}
