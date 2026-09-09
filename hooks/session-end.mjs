#!/usr/bin/env node
// SessionEnd hook. Reads the transcript, makes a naive summary, posts a
// `claude.session` event. Cannot and does not block termination.
import { readFileSync } from "node:fs";
import { readHookInput, findRepoConfig, currentBranch, api, log } from "./lib.mjs";

const input = readHookInput();
const cwd = input.cwd || process.cwd();
const cfg = findRepoConfig(cwd);
if (!cfg?.clientId) process.exit(0);

const branch = currentBranch(cwd);

// Naive Phase-0 summary: last assistant message + a count. The LLM
// summary path is a later slice (model routing).
let summary = "Claude Code session";
let turns = 0;
try {
  const lines = readFileSync(input.transcript_path, "utf8").trim().split("\n");
  const msgs = lines.map((l) => JSON.parse(l)).filter((m) => m.type === "assistant" || m.role === "assistant");
  turns = lines.length;
  const last = msgs.at(-1);
  const text =
    typeof last?.message?.content === "string"
      ? last.message.content
      : (last?.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(" ");
  if (text) summary = text.slice(0, 500);
} catch (e) {
  log("could not read transcript:", String(e));
}

const res = await api(cfg, "POST", "/events", {
  clientId: cfg.clientId,
  branch,
  kind: "session",
  session: { sessionId: input.session_id ?? `sess-${Date.now()}`, transcriptPath: input.transcript_path, summary },
});
log(res.skipped ?? `session → ${res.status} (${turns} transcript lines)`);
process.exit(0);
