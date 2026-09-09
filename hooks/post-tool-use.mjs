#!/usr/bin/env node
// PostToolUse hook. Fires after every tool call; acts only on git
// commit / push / branch / PR, posts a `git.activity` event.
import { execFileSync } from "node:child_process";
import { readHookInput, findRepoConfig, currentBranch, api, log } from "./lib.mjs";

const input = readHookInput();
const cwd = input.cwd || process.cwd();
const cfg = findRepoConfig(cwd);
if (!cfg?.clientId) process.exit(0);

const cmd =
  input.tool_name === "Bash" && typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
if (!/\bgit\s+(commit|push|checkout\s+-b|switch\s+-c)\b/.test(cmd) && !/\bgh\s+pr\s+create\b/.test(cmd)) {
  process.exit(0);
}

const branch = currentBranch(cwd);
if (!branch) process.exit(0);

let kind = "commit";
if (/\bgit\s+push\b/.test(cmd)) kind = "push";
else if (/\bgit\s+(checkout\s+-b|switch\s+-c)\b/.test(cmd)) kind = "branch_created";
else if (/\bgh\s+pr\s+create\b/.test(cmd)) kind = "pull_request";

let shas;
let repoName = cfg.repo;
try {
  if (kind === "commit") shas = [execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim()];
  if (!repoName) {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" }).trim();
    repoName = url.split("/").pop()?.replace(/\.git$/, "") ?? "unknown";
  }
} catch {
  /* best effort */
}

const res = await api(cfg, "POST", "/events", {
  clientId: cfg.clientId,
  branch,
  kind: "git",
  git: { repo: repoName ?? "unknown", branch, kind, count: shas?.length, shas },
});
log(res.skipped ?? `git ${kind} → ${res.status}`);
process.exit(0);
