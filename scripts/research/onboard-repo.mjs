#!/usr/bin/env node
/**
 * Drive one repository-onboarding run through the running API, up to the
 * delivery gate (never past it — a research run on a public repository ships
 * nothing). Plain Node, no DCC imports: safe while the API holds the PGlite
 * directory.
 *
 *   node scripts/research/onboard-repo.mjs --name tokio --git https://github.com/tokio-rs/tokio.git --out <dir> [--client Research] [--level all_approval] [--stop deliver|trial|plan]
 *
 * Every waiting gate is answered the way a person pressing "the recommended"
 * would: the interview with its defaults, the measurement approved, the /init
 * draft skipped, the whole proposed set approved, the build started. Writes
 * <out>/<name>.view.json (the run's view at the end) and <out>/<name>.events.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, xs) => (a.startsWith("--") ? [a.slice(2), xs[i + 1] && !xs[i + 1].startsWith("--") ? xs[i + 1] : "true"] : [])).filter((x) => x.length));
const BASE = process.env.DCC_API ?? "http://localhost:3001";
const H = { "content-type": "application/json", "x-dcc-hook-token": process.env.DCC_HOOK_TOKEN ?? "dev-secret", "x-dcc-dev-email": process.env.DCC_DEV_EMAIL ?? "lev.avishay.1@gmail.com" };
const name = args.name, git = args.git, out = args.out ?? "scratch", client = args.client ?? "Research", level = args.level ?? "all_approval", stopAt = args.stop ?? "deliver";
if (!name) { console.error("usage: --name <repo> [--git <url>] [--repo-id <id>] --out <dir>"); process.exit(2); }
mkdirSync(out, { recursive: true });

const log = (s) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
async function call(method, url, body) {
  const r = await fetch(`${BASE}${url}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 400)}`);
  return json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. the client and the repository
let repoId = args["repo-id"];
if (!repoId) {
  const setup = await call("POST", "/admin/setup-client", { clientName: client, repo: { name, gitUrl: git } });
  repoId = setup.repoId;
  if (!repoId) { const { repos } = await call("GET", "/repos"); repoId = repos.find((r) => r.name === name)?.id; }
  if (!repoId) throw new Error("no repository id after setup");
  log(`client ${client} · repo ${name} = ${repoId}`);
}

// 2. the run
const latest = await call("GET", `/repos/${repoId}/onboarding/latest-run`);
let runId = args["run-id"];
// --fresh: a live run of an earlier round (waiting at its delivery gate) is cancelled so a new one can start; its data stays as the record.
if (args.fresh === "true" && latest && ["Pending", "Running", "WaitingForUser"].includes(latest.status)) { await call("POST", `/repos/${repoId}/onboarding/runs/${latest.runId}/cancel`, {}); log(`cancelled the earlier live run ${latest.runId}`); }
else if (!runId && latest && ["Pending", "Running", "WaitingForUser"].includes(latest.status)) { runId = latest.runId; log(`resuming live run ${runId}`); }
if (!runId) { runId = (await call("POST", `/repos/${repoId}/onboarding/runs`, { automation: { level, draftCapUsd: 3, draftCapMinutes: 40 } })).runId; log(`run ${runId} started (level ${level})`); }

const view = () => call("GET", `/repos/${repoId}/onboarding/runs/${runId}`);
const step = (v, k) => v.steps.find((s) => s.stepKey === k);
const save = (v) => { writeFileSync(path.join(out, `${name}.view.json`), JSON.stringify({ ...v, events: undefined }, null, 2)); writeFileSync(path.join(out, `${name}.events.json`), JSON.stringify(v.events ?? [], null, 2)); };

// 3. every gate, the recommended way
const t0 = Date.now();
let lastLine = "";
const acted = new Set();
for (;;) {
  const v = await view();
  const cur = `${v.run.status} · ${v.steps.map((s) => `${s.stepKey}:${s.status[0]}`).join(" ")} · $${(v.cost?.totalCostUsd ?? 0).toFixed(2)}`;
  if (cur !== lastLine) { log(cur); lastLine = cur; }
  save(v);
  if (v.run.status === "Failed" || v.run.status === "Cancelled") { log(`run ${v.run.status}: ${v.run.error ?? ""}`); process.exit(1); }
  if (v.run.status === "Completed") { log("run completed"); break; }
  if (Date.now() - t0 > 4 * 3600_000) { log("gave up after 4 hours"); process.exit(3); }
  const waiting = v.steps.find((s) => s.status === "WaitingForUser");
  if (waiting) {
    const key = waiting.stepKey;
    if (key === stopAt) { log(`stopped at the ${key} gate, as asked`); break; }
    const once = (tag, f) => { if (acted.has(tag)) return Promise.resolve(); acted.add(tag); return f(); };
    try {
      if (key === "processes") await once("interview", async () => { await call("POST", `/repos/${repoId}/onboarding/runs/${runId}/interview`, { answers: {} }); log("interview answered with its defaults"); });
      else if (key === "trial") await once("trial", async () => { await call("POST", `/repos/${repoId}/onboarding/runs/${runId}/trial/approve`); log(`measurement approved (~$${v.trials?.waiting?.estimateUsd?.toFixed?.(2)}, cap $${v.trials?.waiting?.capUsd})`); });
      else if (key === "plan") {
        const phase = v.plan?.phase ?? "decide";
        if (phase === "draft") await once("skip", async () => { await call("POST", `/repos/${repoId}/onboarding/runs/${runId}/draft/skip`); log("draft skipped"); });
        else if (phase === "decide") {
          await once("decide", async () => {
            // A careful person declines what the code could not vouch for: a source the trust check left "unverified".
            const unverified = v.components.filter((c) => c.status === "proposed" && c.params?.trust === "unverified").map((c) => c.key);
            if (unverified.length) { await call("POST", `/repos/${repoId}/onboarding/runs/${runId}/components/decide-set`, { decision: "decline", keys: unverified, reason: "מקור לא מאומת" }); log(`declined ${unverified.length} unverified cards`); }
            const r = await call("POST", `/repos/${repoId}/onboarding/runs/${runId}/components/decide-set`, { decision: "approve" });
            log(`approved the proposed set (${r.decided} cards)`);
            const v2 = await view();
            const open = v2.components.filter((c) => c.status === "proposed");
            for (const c of open) { await call("POST", `/repos/${repoId}/onboarding/runs/${runId}/components/${encodeURIComponent(c.key)}/decide`, { decision: "approve", answers: Object.fromEntries((c.questions ?? []).map((q) => [q.key, q.default || "כן"])) }).catch((e) => log(`could not approve ${c.key}: ${e.message}`)); }
            if (open.length) log(`answered ${open.length} cards with questions with their defaults`);
            await call("POST", `/repos/${repoId}/onboarding/runs/${runId}/build`);
            log("build started");
          });
        }
      } else if (key === "deliver") { log("at the delivery gate — nothing is sent"); break; }
    } catch (e) { log(`gate ${key}: ${e.message}`); await sleep(15_000); }
  }
  await sleep(20_000);
}
const v = await view();
save(v);
const t = v.trials?.eval?.totals;
log(`done: ${v.components.filter((c) => c.status === "verified" || c.status === "configured").length} deliverable cards · files ${step(v, "deliver")?.result?.files?.length ?? "?"} · measured ${t ? `${t.measured} tasks, with ${t.with.passK} / without ${t.without.passK}, improved ${t.improved}, worse ${t.worse}, cost ${t.costChange}` : "—"}`);
