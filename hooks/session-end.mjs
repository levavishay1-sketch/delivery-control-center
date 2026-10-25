#!/usr/bin/env node
// SessionEnd hook. Reads the transcript, makes a naive summary, posts a
// `claude.session` event. Cannot and does not block termination.
//
// It sends what it always sent: the last assistant text (up to 500
// characters) and the transcript's path — no model, tokens or cost.
import { readFileSync } from "node:fs";
import { readHookInput, findRepoConfig, currentBranch, api, problem, compact, log, runHook } from "./lib.mjs";

/** The text of the last assistant message that has any; a session that ended on a tool call still has one. */
function lastAssistantText(transcript) {
  let last = null;
  let lines = 0;
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    lines++;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue; // one torn line must not lose the whole summary
    }
    if (m?.type !== "assistant" && m?.role !== "assistant") continue;
    const content = m.message?.content;
    const text =
      typeof content === "string"
        ? content
        : (Array.isArray(content) ? content : [])
            .filter((c) => c?.type === "text" && typeof c.text === "string")
            .map((c) => c.text)
            .join(" ");
    if (text.trim()) last = text;
  }
  return { text: last, lines };
}

await runHook(async () => {
  const input = readHookInput();
  const cwd = input.cwd || process.cwd();
  const cfg = findRepoConfig(cwd);
  if (!cfg?.clientId) return;

  // Naive Phase-0 summary: the last assistant text. The LLM summary path is
  // a later slice (model routing).
  let summary = "Claude Code session";
  let turns = 0;
  try {
    const { text, lines } = lastAssistantText(readFileSync(input.transcript_path, "utf8"));
    turns = lines;
    if (text) summary = text.slice(0, 500);
  } catch (e) {
    log("could not read transcript:", e?.message ?? String(e));
  }

  const res = await api(
    cfg,
    "POST",
    "/events",
    // A detached HEAD has no branch: leave it out rather than send null.
    compact({
      clientId: cfg.clientId,
      branch: currentBranch(cwd),
      kind: "session",
      session: compact({
        sessionId: input.session_id ?? `sess-${Date.now()}`,
        transcriptPath: input.transcript_path,
        summary,
      }),
    }),
  );
  log(problem(res) ?? `session → ${res.status} (${turns} transcript lines)`);
});
