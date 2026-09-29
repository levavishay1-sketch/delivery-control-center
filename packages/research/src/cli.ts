import { canonical, pilotRoot, verifyChain } from "./evidence.ts";
import { loadParams, PARAMS, STAGES, unsetBy } from "./params.ts";
import { checkProtocol, FROZEN_PROTOCOL, sha256 } from "./protocol.ts";
import { QUESTIONS } from "./questions.ts";

/**
 * `npm run -w @dcc/research pilot -- <command>`
 *
 *   status          the protocol check, what is still UNSET by stage, and
 *                   which pilot questions are blocked by what
 *   verify <dir>    re-derives the hash chain of a campaign's evidence log
 *
 * Nothing here calls a model or the network.
 */

function status(): number {
  const protocol = checkProtocol();
  console.log(`protocol  ${protocol.ok ? "frozen text" : "NOT the frozen text"}  ${protocol.sha256}`);
  if (!protocol.ok) console.log(`          ${protocol.reason}`);
  console.log(`          freeze tag ${FROZEN_PROTOCOL.tag}`);
  const params = loadParams();
  console.log(`params    ${sha256(canonical(params))}`);
  console.log(`pilot dir ${pilotRoot()}`);
  console.log("");
  const seen = new Set<string>();
  for (const stage of STAGES) {
    const open = unsetBy(params, stage).filter((p) => !seen.has(p.id));
    for (const p of open) seen.add(p.id);
    if (open.length) console.log(`UNSET, due ${stage}: ${open.map((p) => p.id).join(", ")}`);
  }
  const isSet = (id: string) => params.entries[id]?.state === "SET";
  console.log("");
  for (const q of QUESTIONS) {
    const missing = q.needs.filter((id) => !isSet(id));
    console.log(`${q.id}  ${missing.length ? `BLOCKED by ${missing.join(", ")}` : "can run"}  ${q.title}`);
    for (const part of q.parts) {
      const m = part.needs.filter((id) => !isSet(id));
      if (m.length) console.log(`      part blocked by ${m.join(", ")}: ${part.what}`);
    }
  }
  const set = PARAMS.filter((p) => isSet(p.id)).length;
  console.log(`\n${set} of ${PARAMS.length} parameters set.`);
  return protocol.ok ? 0 : 2;
}

function verify(dir: string | undefined): number {
  if (!dir) { console.error("usage: verify <campaign dir>"); return 1; }
  const r = verifyChain(dir);
  console.log(r.ok ? `chain intact, ${r.records} record(s)` : `chain BROKEN at line ${r.line} of ${r.records}: ${r.reason}`);
  return r.ok ? 0 : 3;
}

const [cmd, ...args] = process.argv.slice(2);
const code = cmd === "status" ? status() : cmd === "verify" ? verify(args[0]) : (console.error("commands: status | verify <dir>"), 1);
process.exit(code);
