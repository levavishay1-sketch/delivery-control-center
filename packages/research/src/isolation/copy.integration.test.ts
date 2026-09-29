import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAgentCopy, verifyAgentCopy, type Overlay } from "./copy.ts";
import { makeFixtureRepo, type FixtureCommits } from "./fixture.ts";
import { git } from "./git.ts";
import { solutionOnlyTokens } from "./tokens.ts";

/**
 * Temporal order (protocol 5.4 items 5 and 6) on a synthetic repository:
 * a correct copy verifies clean, and every deliberate violation is caught and
 * classified. These are CODE TESTS of the builder and the checker.
 */

let root: string;
let source: string;
let c: FixtureCommits;
let n = 0;
const fresh = (overlay?: Overlay) => buildAgentCopy({ source, start: c.start, target: path.join(root, `copy-${++n}`), scratch: path.join(root, "scratch"), overlay });
const goodOverlay = (): Overlay => ({ generatedFrom: c.F, files: [{ path: "CLAUDE.md", content: "Sum entries with sumEntries in src/ledger.js.\n" }] });

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "dcc-copy-"));
  source = path.join(root, "source");
  c = makeFixtureRepo(source);
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the solution-only names (heuristic)", () => {
  it("finds the name the task introduces and not one that already exists at S_c", () => {
    const t = solutionOnlyTokens(source, c.start, c.task);
    expect(t).toContain("computeLedgerChecksum");
    expect(t).not.toContain("sumEntries");
  });
});

describe("a correct copy", () => {
  it("holds S_c and nothing later: HEAD, one branch, no remote, no reflog, only reachable objects, no task commit", () => {
    const refsBefore = git(source, ["for-each-ref"]);
    const { dir, head } = fresh(goodOverlay());
    expect(head).toBe(c.start);
    const v = verifyAgentCopy({ dir, start: c.start, task: c.task, overlay: goodOverlay(), source, solutionTokens: solutionOnlyTokens(source, c.start, c.task) });
    expect(v.violations).toEqual([]);
    expect(v.status).toBe("PASS");
    expect(git(source, ["for-each-ref"])).toBe(refsBefore); // the source was not touched
  }, 60_000);

  it("contains neither the later commit nor the tag", () => {
    const { dir } = fresh();
    expect(() => git(dir, ["cat-file", "-e", c.later])).toThrow();
    expect(git(dir, ["tag"])).toBe("");
  }, 60_000);
});

describe("deliberate violations are caught and classified", () => {
  it("a future commit fetched into the store, even with its ref deleted", () => {
    const { dir } = fresh();
    git(dir, ["fetch", "--quiet", "--no-tags", source, "main:refs/heads/tmp"]);
    git(dir, ["update-ref", "-d", "refs/heads/tmp"]);
    const v = verifyAgentCopy({ dir, start: c.start, task: c.task });
    expect(v.violations.map((x) => x.kind)).toEqual(expect.arrayContaining(["FOREIGN_OBJECT", "TASK_COMMIT_PRESENT"]));
    expect(v.status).toBe("FAIL");
    expect(v.evidence).toBe("INVALID");
  }, 60_000);

  it("a tag, a remote, alternates, a reflog and FETCH_HEAD", () => {
    const { dir } = fresh();
    git(dir, ["tag", "extra"]);
    git(dir, ["remote", "add", "origin", source]);
    mkdirSync(path.join(dir, ".git", "objects", "info"), { recursive: true });
    writeFileSync(path.join(dir, ".git", "objects", "info", "alternates"), path.join(source, ".git", "objects") + "\n");
    mkdirSync(path.join(dir, ".git", "logs"), { recursive: true });
    writeFileSync(path.join(dir, ".git", "FETCH_HEAD"), `${c.task}\t\tbranch 'main'\n`);
    const kinds = verifyAgentCopy({ dir, start: c.start, task: c.task }).violations.map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(["EXTRA_REF", "REMOTE_CONFIGURED", "ALTERNATES", "REFLOG_PRESENT", "STATE_FILE", "TASK_COMMIT_PRESENT"]));
  }, 60_000);

  it("an overlay generated from the task commit (later than S_c) is invalid evidence", () => {
    const overlay: Overlay = { generatedFrom: c.task, files: [{ path: "CLAUDE.md", content: "notes\n" }] };
    const { dir } = fresh(overlay);
    const v = verifyAgentCopy({ dir, start: c.start, overlay, source });
    expect(v.violations.map((x) => x.kind)).toContain("OVERLAY_NOT_BEFORE_START");
    expect(v.status).toBe("FAIL");
    expect(v.evidence).toBe("INVALID");
  }, 60_000);

  it("an overlay from a commit dated before S_c but not its ancestor: invalid by ancestry, and the disagreement is reported, not decided", () => {
    const overlay: Overlay = { generatedFrom: c.side, files: [{ path: "CLAUDE.md", content: "notes\n" }] };
    const { dir } = fresh(overlay);
    const v = verifyAgentCopy({ dir, start: c.start, overlay, source });
    const kinds = v.violations.map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(["OVERLAY_NOT_BEFORE_START", "OVERLAY_DATE_ANCESTRY_DISAGREE"]));
    expect(v.violations.find((x) => x.kind === "OVERLAY_DATE_ANCESTRY_DISAGREE")!.consequence).toBe("UNKNOWN");
  }, 60_000);

  it("an overlay that names what the solution introduces: UNKNOWN (a heuristic sign, not invalid by itself)", () => {
    const overlay: Overlay = { generatedFrom: c.F, files: [{ path: "CLAUDE.md", content: "Use computeLedgerChecksum for checksums.\n" }] };
    const { dir } = fresh(overlay);
    const v = verifyAgentCopy({ dir, start: c.start, overlay, source, solutionTokens: solutionOnlyTokens(source, c.start, c.task) });
    expect(v.violations.map((x) => x.kind)).toEqual(["SOLUTION_TOKEN_IN_OVERLAY"]);
    expect(v.status).toBe("UNKNOWN");
    expect(v.evidence).toBeNull();
  }, 60_000);

  it("a working tree that is not S_c plus the overlay: a future file, a changed file, an undeclared file", () => {
    const { dir } = fresh();
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src", "checksum.js"), git(source, ["show", `${c.task}:src/checksum.js`]) + "\n");
    appendFileSync(path.join(dir, "README.md"), "changed\n");
    const v = verifyAgentCopy({ dir, start: c.start });
    const m = v.violations.find((x) => x.kind === "WORKTREE_MISMATCH")!;
    expect(m.detail).toMatch(/extra src\/checksum\.js/);
    expect(m.detail).toMatch(/changed README\.md/);
  }, 60_000);

  it("a directory the harness declares as prepared is excluded from the comparison", () => {
    const { dir } = fresh();
    mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
    writeFileSync(path.join(dir, "node_modules", "x", "index.js"), "export {};\n");
    expect(verifyAgentCopy({ dir, start: c.start }).violations.map((x) => x.kind)).toContain("WORKTREE_MISMATCH");
    expect(verifyAgentCopy({ dir, start: c.start, preparedDirs: ["node_modules"] }).violations).toEqual([]);
  }, 60_000);
});

describe("after a run", () => {
  it("the agent's own commit is not foreign; a commit fetched from the source is", () => {
    const { dir } = fresh();
    writeFileSync(path.join(dir, "src", "own.js"), "export const own = 1;\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "--quiet", "-m", "agent work"]);
    expect(verifyAgentCopy({ dir, start: c.start, source, afterRun: true }).violations).toEqual([]);
    git(dir, ["fetch", "--quiet", "--no-tags", source, `${c.task}`]);
    const v = verifyAgentCopy({ dir, start: c.start, task: c.task, source, afterRun: true });
    expect(v.violations.map((x) => x.kind)).toEqual(expect.arrayContaining(["FOREIGN_COMMIT_AFTER_RUN", "TASK_COMMIT_PRESENT"]));
  }, 60_000);
});
