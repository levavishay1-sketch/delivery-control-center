#!/usr/bin/env node
// SessionStart hook. Its STDOUT becomes the Claude session's context.
// Resolves the WorkItem from the branch, fetches its Context Brief,
// prints it. Prints nothing when there is no match — the session then
// proceeds normally (session-capture spec). A refused token or an
// unreachable server is one stderr line; the session starts regardless.
import { readHookInput, findRepoConfig, currentBranch, api, problem, log, runHook } from "./lib.mjs";

await runHook(async () => {
  const input = readHookInput();
  const cwd = input.cwd || process.cwd();
  const cfg = findRepoConfig(cwd);
  if (!cfg?.clientId) return;

  const branch = currentBranch(cwd);
  if (!branch) return;

  const resolved = await api(
    cfg,
    "GET",
    `/resolve?clientId=${encodeURIComponent(cfg.clientId)}&branch=${encodeURIComponent(branch)}`,
  );
  const refused = problem(resolved);
  if (refused) return log(refused);
  if (resolved.status !== 200) return; // no work item for this branch — not an error

  const { workitemId } = JSON.parse(resolved.body);
  if (!workitemId) return;
  const brief = await api(cfg, "GET", `/workitems/${encodeURIComponent(workitemId)}/brief`);
  const briefRefused = problem(brief);
  if (briefRefused) return log(briefRefused);
  if (brief.status === 200 && brief.body.trim()) {
    // Wait for the write to land: process.exit would cut a large brief short on a pipe.
    await new Promise((done) => process.stdout.write(`\n${brief.body}\n`, done));
  }
});
