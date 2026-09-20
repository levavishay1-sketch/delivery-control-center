import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { git, httpsRepoUrl, resolveCommitIdentity } from "../ai-assist.ts";
import type { DeliverResult } from "./types.ts";

/**
 * Delivery: commit what the session produced under the acting person's own
 * name, push the onboarding branch, and open a pull request — with `gh`
 * when it is installed, otherwise a compare link. Uses the operator's own
 * git/gh credentials, so every push and PR is attributable to a person.
 * Merging stays a human action in the git host.
 */

const LONGPATHS = process.platform === "win32" ? ["-c", "core.longpaths=true"] : [];

function hasGh(): boolean {
  try { execFileSync("gh", ["--version"], { stdio: "ignore", windowsHide: true }); return true; } catch { return false; }
}

export async function deliverWorkspace(input: {
  dir: string;
  branch: string;
  defaultBranch: string | null;
  /** Where the run started — what the session committed itself since then is delivered too. */
  baselineSha?: string | null;
  userId: string;
  title: string;
  body: string;
  log: (line: string) => void;
}): Promise<DeliverResult> {
  const { dir, branch, log } = input;

  await git([...LONGPATHS, "add", "-A"], dir);
  const staged = (await git(["diff", "--cached", "--name-only"], dir)).out.split("\n").map((s) => s.trim()).filter(Boolean);
  let commitSha: string | null = null;
  if (staged.length) {
    const who = await resolveCommitIdentity(input.userId);
    log(`dcc$ git commit -m "${input.title}"   (${who.name} <${who.email}>)`);
    const c = await git([...LONGPATHS, "-c", `user.name=${who.name}`, "-c", `user.email=${who.email}`, "commit", "-m", `${input.title}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`], dir);
    if (c.code !== 0) throw new Error(`commit נכשל: ${c.out.slice(0, 300)}`);
    commitSha = (await git(["rev-parse", "--short", "HEAD"], dir)).out.trim();
    log(`[${branch} ${commitSha}] ${staged.length} files changed`);
  }

  // Claude may have committed by itself during the session: whatever is on the branch since the baseline is work to deliver,
  // whether or not anything was left for this commit.
  const sinceBaseline = input.baselineSha ? await git(["diff", "--name-only", `${input.baselineSha}..HEAD`], dir) : null;
  const committedFiles = sinceBaseline ? sinceBaseline.out.split("\n").map((x) => x.trim()).filter(Boolean).length : staged.length;
  const ahead = input.baselineSha ? Number((await git(["rev-list", "--count", `${input.baselineSha}..HEAD`], dir)).out.trim()) || 0 : staged.length ? 1 : 0;
  const nothingToDeliver = !staged.length && !ahead;

  const remoteRes = await git(["remote", "get-url", "origin"], dir);
  const remote = remoteRes.code === 0 ? remoteRes.out.trim() || null : null;
  const originHead = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir);
  const base = (originHead.code === 0 ? originHead.out.trim().replace(/^origin\//, "") : "") || input.defaultBranch || "main";
  const common = { branch, base, commitSha, filesCommitted: committedFiles, remote };

  if (nothingToDeliver) {
    return { ...common, pushed: false, prNumber: null, prUrl: null, compareUrl: null, localOnly: !remote, note: "לא היו שינויים למסור" };
  }
  if (!remote) {
    log(`no remote — branch ${branch} stays in the local clone; merge it into ${base} by hand`);
    return { ...common, pushed: false, prNumber: null, prUrl: null, compareUrl: null, localOnly: true };
  }

  log(`dcc$ git push -u origin ${branch}`);
  const push = await git([...LONGPATHS, "push", "-u", "origin", branch], dir, { timeoutMs: 180_000 });
  if (push.code !== 0) throw new Error(`git push נכשל: ${push.out.slice(0, 400)}`);
  const httpsBase = httpsRepoUrl(remote);
  const compareUrl = httpsBase ? `${httpsBase}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1` : null;
  if (!hasGh()) {
    log("gh is not installed — open the pull request from the compare link");
    return { ...common, pushed: true, prNumber: null, prUrl: null, compareUrl, localOnly: false };
  }
  const bodyFile = path.join(os.tmpdir(), `dcc-pr-body-${randomUUID()}.md`);
  writeFileSync(bodyFile, input.body, "utf8");
  try {
    log(`dcc$ gh pr create --base ${base} --head ${branch}`);
    const out = execFileSync("gh", ["pr", "create", "--title", input.title, "--body-file", bodyFile, "--base", base, "--head", branch], { cwd: dir, encoding: "utf8", windowsHide: true }).toString();
    const prUrl = out.trim().split("\n").pop() ?? out.trim();
    const m = prUrl.match(/\/pull\/(\d+)/);
    log(`✓ ${prUrl}`);
    return { ...common, pushed: true, prNumber: m ? Number(m[1]) : null, prUrl, compareUrl, localOnly: false };
  } catch (e) {
    log(`gh pr create failed — open the pull request from the compare link`);
    return { ...common, pushed: true, prNumber: null, prUrl: null, compareUrl, localOnly: false, note: `gh pr create נכשל: ${String((e as Error).message).slice(0, 200)}` };
  } finally {
    try { unlinkSync(bodyFile); } catch { /* best effort */ }
  }
}
