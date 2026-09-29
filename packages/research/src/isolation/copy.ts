import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git, gitOk } from "./git.ts";
import { findTokens } from "./tokens.ts";

/**
 * The agent's copy of protocol 5.4 item 6, and the temporal-order check of
 * 5.4 item 5.
 *
 * PROTOCOL: the agent's copy is an independent repository, not a worktree of
 * a shared clone, holding the history up to S_c only, with no remote, no
 * tags or other branches, no reflog, and no unreachable objects; before every
 * run it is checked mechanically that the task commit and its solution are
 * not reachable. The files of an arm are generated from information no later
 * than S_c; a run where that is violated is invalid evidence, neither PASS
 * nor FAIL nor a tripwire.
 *
 * HOW: the source is cloned bare into a harness-side scratch directory (never
 * the source itself is touched), a scratch ref there points at S_c, and a new
 * repository fetches only that ref; git transfers exactly the objects
 * reachable from it. The scratch clone is then deleted.
 *
 * ASSUMPTIONS OF THIS CODE: "no later than S_c" for an arm's files is read as
 * "generated from a commit that is S_c or an ancestor of it". Where commit
 * dates disagree with ancestry the check reports it and does not decide
 * (open point). Files are checked out byte-exact (core.autocrlf=false).
 */

export type Overlay = { generatedFrom: string; files: readonly { path: string; content: string }[] };

export type ViolationKind =
  | "HEAD_NOT_START" | "FOREIGN_OBJECT" | "TASK_COMMIT_PRESENT" | "EXTRA_REF" | "REMOTE_CONFIGURED" | "ALTERNATES"
  | "REFLOG_PRESENT" | "STATE_FILE" | "WORKTREE_MISMATCH" | "OVERLAY_NOT_BEFORE_START"
  | "OVERLAY_DATE_ANCESTRY_DISAGREE" | "SOLUTION_TOKEN_IN_OVERLAY" | "FOREIGN_COMMIT_AFTER_RUN";

/**
 * How a violation bears on the evidence, in the protocol's own terms only:
 * INVALID (5.4.5: information later than S_c, or a copy that is not the
 * defined state), or UNKNOWN (0.2: assessed, the evidence is not enough to
 * decide; used for a heuristic sign and for a case the protocol does not settle).
 */
export type Consequence = "INVALID" | "UNKNOWN";

export const CONSEQUENCE: Record<ViolationKind, Consequence> = {
  HEAD_NOT_START: "INVALID", FOREIGN_OBJECT: "INVALID", TASK_COMMIT_PRESENT: "INVALID", EXTRA_REF: "INVALID",
  REMOTE_CONFIGURED: "INVALID", ALTERNATES: "INVALID", REFLOG_PRESENT: "INVALID", STATE_FILE: "INVALID",
  WORKTREE_MISMATCH: "INVALID", OVERLAY_NOT_BEFORE_START: "INVALID", FOREIGN_COMMIT_AFTER_RUN: "INVALID",
  // A heuristic: a sign, not a proof.
  SOLUTION_TOKEN_IN_OVERLAY: "UNKNOWN",
  // Dates and ancestry disagree: the protocol uses both words; not decided here.
  OVERLAY_DATE_ANCESTRY_DISAGREE: "UNKNOWN",
};

export type Violation = { kind: ViolationKind; consequence: Consequence; detail: string };

export const BRANCH = "start";

export function buildAgentCopy(o: { source: string; start: string; target: string; scratch: string; overlay?: Overlay }): { dir: string; head: string } {
  const start = git(o.source, ["rev-parse", "--verify", `${o.start}^{commit}`]);
  mkdirSync(o.scratch, { recursive: true });
  const bare = path.join(o.scratch, `source-${process.pid}-${Date.now()}.git`);
  try {
    git(o.scratch, ["clone", "--bare", "--no-local", "--no-tags", "--quiet", o.source, bare]);
    git(bare, ["update-ref", "refs/dcc-pilot/start", start]);
    mkdirSync(path.dirname(o.target), { recursive: true });
    git(path.dirname(o.target), ["init", "--quiet", `--initial-branch=${BRANCH}`, o.target]);
    git(o.target, ["config", "core.autocrlf", "false"]);
    git(o.target, ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--update-head-ok", bare, `refs/dcc-pilot/start:refs/heads/${BRANCH}`]);
    git(o.target, ["reset", "--hard", "--quiet", BRANCH]);
    for (const f of o.overlay?.files ?? []) {
      const p = path.join(o.target, f.path);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, f.content);
    }
    git(o.target, ["reflog", "expire", "--expire=now", "--all"]);
    rmSync(path.join(o.target, ".git", "logs"), { recursive: true, force: true });
    for (const f of ["FETCH_HEAD", "ORIG_HEAD"]) rmSync(path.join(o.target, ".git", f), { force: true });
    git(o.target, ["gc", "--quiet", "--prune=now"]);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
  return { dir: o.target, head: git(o.target, ["rev-parse", "HEAD"]) };
}

function walk(dir: string, root: string, skip: ReadonlySet<string>, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (rel === ".git" || skip.has(rel)) continue;
    if (statSync(full).isDirectory()) walk(full, root, skip, out);
    else out.push(rel);
  }
}

export type VerifyInput = {
  dir: string;
  start: string;
  /** The task commit c; must not be present. */
  task?: string;
  overlay?: Overlay;
  /** The source repository, harness side, for commit dates of an overlay that is not an ancestor. */
  source?: string;
  solutionTokens?: readonly string[];
  /** Directories declared by the harness (e.g. dependencies prepared before the run), excluded from the tree comparison. */
  preparedDirs?: readonly string[];
  /** After a run: only commits and tags count as foreign, since the agent's own work legitimately adds blobs and trees. */
  afterRun?: boolean;
};

/** The copy condition in three-valued terms (0.2): FAIL when a violation makes the evidence INVALID, UNKNOWN when only undecidable signs were found, PASS otherwise. */
export type VerifyResult = { status: "PASS" | "FAIL" | "UNKNOWN"; evidence: "INVALID" | null; violations: Violation[]; checks: string[] };

export function verifyAgentCopy(v: VerifyInput): VerifyResult {
  const violations: Violation[] = [];
  const checks: string[] = [];
  const add = (kind: ViolationKind, detail: string) => violations.push({ kind, consequence: CONSEQUENCE[kind], detail });
  const gitDir = path.join(v.dir, ".git");
  const start = git(v.dir, ["rev-parse", "--verify", `${v.start}^{commit}`]);

  if (!v.afterRun) {
    checks.push("HEAD is S_c");
    const head = git(v.dir, ["rev-parse", "HEAD"]);
    if (head !== start) add("HEAD_NOT_START", `HEAD ${head} is not S_c ${start}`);
  }

  checks.push("no ref other than the single branch");
  const refs = git(v.dir, ["for-each-ref", "--format=%(refname)"]).split("\n").filter(Boolean);
  for (const r of refs) if (r !== `refs/heads/${BRANCH}`) add("EXTRA_REF", r);

  checks.push("no remote");
  if (git(v.dir, ["remote"]).trim()) add("REMOTE_CONFIGURED", git(v.dir, ["remote", "-v"]));

  checks.push("no alternates");
  if (existsSync(path.join(gitDir, "objects", "info", "alternates"))) add("ALTERNATES", readFileSync(path.join(gitDir, "objects", "info", "alternates"), "utf8").trim());

  if (!v.afterRun) {
    checks.push("no reflog, FETCH_HEAD or ORIG_HEAD");
    if (existsSync(path.join(gitDir, "logs"))) add("REFLOG_PRESENT", ".git/logs exists");
    for (const f of ["FETCH_HEAD", "ORIG_HEAD", "MERGE_HEAD"]) if (existsSync(path.join(gitDir, f))) add("STATE_FILE", f);
  }

  checks.push(v.afterRun ? "every commit or tag object is reachable from S_c or new" : "every object in the store is reachable from S_c");
  const all = git(v.dir, ["cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype)"]).split("\n").filter(Boolean).map((l) => l.split(" ") as [string, string]);
  const reachable = new Set(git(v.dir, ["rev-list", "--objects", start]).split("\n").map((l) => l.split(" ")[0]!).filter(Boolean));
  if (v.afterRun) {
    // A commit the agent made has S_c among its ancestors and is not in the source; a foreign one is in the source.
    for (const [sha, type] of all) {
      if (reachable.has(sha) || (type !== "commit" && type !== "tag")) continue;
      const fromSource = v.source ? gitOk(v.source, ["cat-file", "-e", `${sha}^{object}`]) : true;
      if (fromSource) add("FOREIGN_COMMIT_AFTER_RUN", `${type} ${sha}`);
    }
  } else {
    const extra = all.filter(([sha]) => !reachable.has(sha));
    if (extra.length) add("FOREIGN_OBJECT", `${extra.length} object(s) not reachable from S_c, e.g. ${extra.slice(0, 3).map(([s, t]) => `${t} ${s}`).join(", ")}`);
  }

  if (v.task) {
    checks.push("the task commit is not in the store");
    if (gitOk(v.dir, ["cat-file", "-e", `${v.task}^{commit}`])) add("TASK_COMMIT_PRESENT", v.task);
  }

  if (!v.afterRun) {
    checks.push("the working tree is S_c plus the declared overlay, byte for byte");
    const expected = new Map<string, string>();
    for (const line of git(v.dir, ["ls-tree", "-r", "-z", "--full-tree", start]).split("\0").filter(Boolean)) {
      const [meta, p] = line.split("\t") as [string, string];
      const [mode, , sha] = meta.split(" ") as [string, string, string];
      if (mode !== "160000") expected.set(p, sha);
    }
    for (const f of v.overlay?.files ?? []) expected.set(f.path.split(path.sep).join("/"), git(v.dir, ["hash-object", "--stdin"], { input: f.content }));
    const files: string[] = [];
    walk(v.dir, v.dir, new Set(v.preparedDirs ?? []), files);
    const hashes = files.length ? git(v.dir, ["hash-object", "--no-filters", "--stdin-paths"], { input: files.join("\n") + "\n" }).split("\n") : [];
    const actual = new Map(files.map((f, i) => [f, hashes[i]!]));
    const extra = files.filter((f) => !expected.has(f));
    const missing = [...expected.keys()].filter((f) => !actual.has(f));
    const changed = [...actual].filter(([f, h]) => expected.has(f) && expected.get(f) !== h).map(([f]) => f);
    if (extra.length || missing.length || changed.length) add("WORKTREE_MISMATCH", `extra ${extra.slice(0, 3).join(", ") || "none"}; missing ${missing.slice(0, 3).join(", ") || "none"}; changed ${changed.slice(0, 3).join(", ") || "none"}`);
  }

  if (v.overlay) {
    checks.push("the overlay was generated from S_c or an ancestor of it");
    const from = v.overlay.generatedFrom;
    const presentHere = gitOk(v.dir, ["cat-file", "-e", `${from}^{commit}`]);
    const isAncestor = presentHere && gitOk(v.dir, ["merge-base", "--is-ancestor", from, start]);
    if (!isAncestor) add("OVERLAY_NOT_BEFORE_START", `${from} is not S_c or an ancestor of it`);
    const dateRepo = presentHere ? v.dir : v.source;
    if (dateRepo) {
      const dateOf = (repo: string, sha: string) => Number(git(repo, ["show", "-s", "--format=%ct", sha]));
      try {
        const fromDate = dateOf(dateRepo, from);
        const startDate = dateOf(v.dir, start);
        if (isAncestor && fromDate > startDate) add("OVERLAY_DATE_ANCESTRY_DISAGREE", `${from} is an ancestor of S_c but dated after it`);
        if (!isAncestor && fromDate <= startDate) add("OVERLAY_DATE_ANCESTRY_DISAGREE", `${from} is dated no later than S_c but is not its ancestor`);
      } catch { /* the commit is unknown to the repository that was asked; the ancestry finding stands */ }
    }
    if (v.solutionTokens?.length) {
      checks.push("the overlay contains no name the solution introduces (heuristic)");
      const hits = findTokens(Object.fromEntries(v.overlay.files.map((f) => [f.path, f.content])), v.solutionTokens);
      for (const h of hits) add("SOLUTION_TOKEN_IN_OVERLAY", `${h.token} in ${h.where}`);
    }
  }

  const invalid = violations.some((x) => x.consequence === "INVALID");
  const status = invalid ? "FAIL" : violations.length ? "UNKNOWN" : "PASS";
  return { status, evidence: invalid ? "INVALID" : null, violations, checks };
}
