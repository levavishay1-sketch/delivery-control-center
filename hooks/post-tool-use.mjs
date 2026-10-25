#!/usr/bin/env node
// PostToolUse hook. Fires after every Bash call; acts only on git
// commit / push / branch / PR, posts a `git.activity` event.
import { readHookInput, findRepoConfig, currentBranch, git, api, problem, compact, log, runHook } from "./lib.mjs";

await runHook(async () => {
  const input = readHookInput();
  const cmd =
    input.tool_name === "Bash" && typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  if (!/\bgit\s+(commit|push|checkout\s+-b|switch\s+-c)\b/.test(cmd) && !/\bgh\s+pr\s+create\b/.test(cmd)) return;

  const cwd = input.cwd || process.cwd();
  const cfg = findRepoConfig(cwd);
  if (!cfg?.clientId) return;

  const branch = currentBranch(cwd);
  if (!branch) return;

  let kind = "commit";
  if (/\bgit\s+push\b/.test(cmd)) kind = "push";
  else if (/\bgit\s+(checkout\s+-b|switch\s+-c)\b/.test(cmd)) kind = "branch_created";
  else if (/\bgh\s+pr\s+create\b/.test(cmd)) kind = "pull_request";

  let shas;
  let repoName = cfg.repo;
  try {
    if (kind === "commit") shas = [git(cwd, "rev-parse", "HEAD")];
    if (!repoName) repoName = git(cwd, "remote", "get-url", "origin").split("/").pop()?.replace(/\.git$/, "");
  } catch {
    /* best effort */
  }

  const res = await api(cfg, "POST", "/events", {
    clientId: cfg.clientId,
    branch,
    kind: "git",
    git: compact({ repo: repoName || "unknown", branch, kind, count: shas?.length, shas }),
  });
  log(problem(res) ?? `git ${kind} → ${res.status}`);
});
