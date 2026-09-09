#!/usr/bin/env node
// SessionStart hook. Its STDOUT becomes the Claude session's context.
// Resolves the WorkItem from the branch, fetches its Context Brief,
// prints it. Prints nothing when there is no match — the session then
// proceeds normally (session-capture spec).
import { readHookInput, findRepoConfig, currentBranch, api, log } from "./lib.mjs";

const input = readHookInput();
const cwd = input.cwd || process.cwd();
const cfg = findRepoConfig(cwd);
if (!cfg?.clientId) process.exit(0);

const branch = currentBranch(cwd);
if (!branch) process.exit(0);

const resolved = await api(cfg, "GET", `/resolve?clientId=${cfg.clientId}&branch=${encodeURIComponent(branch)}`);
if (resolved.skipped) {
  log(resolved.skipped);
  process.exit(0);
}
if (resolved.status !== 200) process.exit(0);

const { workitemId } = JSON.parse(resolved.body);
const brief = await api(cfg, "GET", `/workitems/${workitemId}/brief`);
if (brief.status === 200 && brief.body.trim()) {
  process.stdout.write(`\n${brief.body}\n`);
}
process.exit(0);
