// DCC's status line for an onboarding session. Claude Code runs this with the
// session's JSON on stdin (cost, model, effort, transcript path); DCC keeps
// the latest copy at the path given as the first argument, and the terminal
// shows one line of it. Plain Node, no dependencies: it runs inside the
// person's Claude Code session.
import { renameSync, writeFileSync } from "node:fs";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const out = process.argv[2];
  let s = {};
  try { s = JSON.parse(raw); } catch { /* print the fallback line below */ }
  if (out && raw.trim()) {
    try { writeFileSync(`${out}.tmp`, raw, "utf8"); renameSync(`${out}.tmp`, out); } catch { /* the screen still shows the line */ }
  }
  const cost = Number(s?.cost?.total_cost_usd ?? 0);
  const model = s?.model?.display_name ?? "";
  const effort = s?.effort?.level ? ` · ${s.effort.level}` : "";
  process.stdout.write(`DCC · $${cost.toFixed(2)}${model ? ` · ${model}` : ""}${effort}`);
});
