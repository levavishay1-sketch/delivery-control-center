#!/usr/bin/env node
// dcc — the CLI the DCC skills call. Reads .dcc.json (repo) +
// DCC_DEV_EMAIL / DCC_HOOK_TOKEN (env). Zero dependencies.
//
//   node dcc.mjs resolve --branch feature/WI-1284-x
//   node dcc.mjs gap     --workitem <id> --description "..." --blocking --confidence 0.8
//   node dcc.mjs blocker --workitem <id> --type missing_access --question "..."
//   node dcc.mjs tasks   --workitem <id> --file tasks.json [--change <openspec-change-id>]
//   node dcc.mjs brief   --workitem <id>
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";

function cfg() {
  let dir = process.cwd();
  const root = parse(dir).root;
  while (true) {
    const f = join(dir, ".dcc.json");
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
    if (dir === root) break;
    dir = dirname(dir);
  }
  throw new Error("no .dcc.json found from " + process.cwd());
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) (o[k] = next), i++;
      else o[k] = true;
    }
  }
  return o;
}

async function call(method, path, body) {
  const c = cfg();
  const email = process.env.DCC_DEV_EMAIL;
  const token = process.env.DCC_HOOK_TOKEN;
  if (!email || !token) throw new Error("set DCC_DEV_EMAIL and DCC_HOOK_TOKEN");
  const res = await fetch(new URL(path, c.apiUrl), {
    method,
    headers: { "content-type": "application/json", "x-dcc-hook-token": token, "x-dcc-dev-email": email },
    body: body ? JSON.stringify({ clientId: c.clientId, ...body }) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text;
}

const [cmd, ...rest] = process.argv.slice(2);
const a = args(rest);
const c = cfg();

try {
  if (cmd === "resolve") {
    console.log(await call("GET", `/resolve?clientId=${c.clientId}&branch=${encodeURIComponent(a.branch)}`));
  } else if (cmd === "brief") {
    console.log(await call("GET", `/workitems/${a.workitem}/brief`));
  } else if (cmd === "gap") {
    console.log(
      await call("POST", `/workitems/${a.workitem}/gaps`, {
        description: a.description,
        blocking: !!a.blocking,
        confidence: Number(a.confidence ?? 0.5),
        mode: "delegated",
      }),
    );
  } else if (cmd === "blocker") {
    console.log(
      await call("POST", `/workitems/${a.workitem}/blockers`, {
        questionType: a.type ?? "unclear_requirement",
        question: a.question,
      }),
    );
  } else if (cmd === "tasks") {
    const parsed = JSON.parse(readFileSync(a.file, "utf8"));
    const tasks = Array.isArray(parsed) ? parsed : parsed.tasks;
    console.log(
      await call("POST", `/workitems/${a.workitem}/tasks`, {
        tasks,
        openspecChangeId: a.change || parsed.openspecChangeId,
      }),
    );
  } else {
    console.error("usage: dcc <resolve|brief|gap|blocker|tasks> [--flags]");
    process.exit(2);
  }
} catch (e) {
  console.error("dcc error:", String(e.message ?? e));
  process.exit(1);
}
