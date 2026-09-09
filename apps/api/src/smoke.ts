import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeDb, withTenant } from "@dcc/db";
import { app, db, client, repo, users } from "./server.ts";
import { workitem } from "@dcc/db/schema";

/**
 * In-process API smoke test via fastify.inject (one process → PGlite
 * safe). Exercises the hook capture path and the reads.
 *   npm run dev:reset && npm run dev:setup   (in packages/db)
 *   node src/smoke.ts                         (here)
 */
process.env.DCC_HOOK_TOKEN ??= "smoke-secret";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  cond ? (pass++, console.log(`  \x1b[32mPASS\x1b[0m ${name}`)) : (fail++, console.log(`  \x1b[31mFAIL\x1b[0m ${name} ${detail ? JSON.stringify(detail) : ""}`));
};

const email = `dev+${randomUUID()}@example.com`;
const [dev] = await db.insert(users).values({ entraOid: randomUUID(), email, displayName: "Dev" }).returning();
const [c] = await db.insert(client).values({ name: `Client ${randomUUID().slice(0, 8)}` }).returning();
const [epic] = await withTenant(c!.id, (tx) =>
  tx.insert(workitem).values({ clientId: c!.id, ownerId: dev!.id, title: "Portal", type: "epic" }).returning());
const [wi] = await withTenant(c!.id, (tx) =>
  tx.insert(workitem).values({ clientId: c!.id, parentId: epic!.id, ownerId: dev!.id, key: "WI-9001", title: "Smoke item", phase: "building" }).returning());

const H = { "x-dcc-hook-token": "smoke-secret", "x-dcc-dev-email": email };

// auth
const noauth = await app.inject({ method: "POST", url: "/events", payload: { kind: "note", note: { body: "x" } } });
check("rejects missing hook token", noauth.statusCode === 401, noauth.statusCode);

// git capture, WorkItem resolved from branch
const git = await app.inject({
  method: "POST", url: "/events", headers: H,
  payload: { clientId: c!.id, branch: "feature/WI-9001-smoke", kind: "git", git: { repo: "CRM", branch: "feature/WI-9001-smoke", kind: "commit", count: 2, shas: ["aaa", "bbb"] } },
});
check("git event accepted + assigned", git.statusCode === 201 && git.json().assigned === true, git.json());

// note on an unresolvable branch → unassigned
const orphan = await app.inject({
  method: "POST", url: "/events", headers: H,
  payload: { clientId: c!.id, branch: "main", kind: "note", note: { body: "client wants a delay", source: "phone" } },
});
check("unresolvable → unassigned", orphan.statusCode === 201 && orphan.json().assigned === false, orphan.json());

// session
const sess = await app.inject({
  method: "POST", url: "/events", headers: H,
  payload: { clientId: c!.id, branch: "feature/WI-9001-smoke", kind: "session", session: { sessionId: randomUUID(), summary: "did the thing" } },
});
check("session event accepted", sess.statusCode === 201, sess.json());

// timeline
const tl = await app.inject({ method: "GET", url: `/workitems/${wi!.id}/timeline` });
check("timeline has the 2 assigned events", tl.statusCode === 200 && tl.json().events.length === 2, tl.json().events?.length);

// inbox
const inbox = await app.inject({ method: "GET", url: `/clients/${c!.id}/inbox` });
check("inbox has the 1 orphan event", inbox.statusCode === 200 && inbox.json().events.length === 1, inbox.json().events?.length);

// brief
const brief = await app.inject({ method: "GET", url: `/workitems/${wi!.id}/brief` });
check("brief renders with the key", brief.statusCode === 200 && brief.body.includes("WI-9001"), brief.body.slice(0, 80));

// resolve 404
const r404 = await app.inject({ method: "GET", url: `/resolve?clientId=${c!.id}&branch=nope` });
check("resolve 404 on no match", r404.statusCode === 404, r404.statusCode);

// routing
const rt = await app.inject({ method: "POST", url: `/workitems/${wi!.id}/route`, headers: H, payload: { capability: "gap_detection", signals: { ambiguity: "high" } } });
check("route escalates high-ambiguity gap detection to opus", rt.statusCode === 200 && rt.json().tier === "opus", rt.json());

// flow — rooted at the epic, its subtree is the epic + WI-9001
const flow = await app.inject({ method: "GET", url: `/requirements/${epic!.id}/flow` });
check("flow returns the subtree nodes", flow.statusCode === 200 && flow.json().nodes.length === 2, flow.json());

// contention: two WorkItems touching the same file
await db.insert(repo).values({ name: `CRM-${randomUUID().slice(0, 8)}`, clientId: c!.id }).returning();
const [crm] = await db.select().from(repo).where(sql`${repo.clientId} = ${c!.id}`).limit(1);
const [wi2] = await withTenant(c!.id, (tx) =>
  tx.insert(workitem).values({ clientId: c!.id, parentId: epic!.id, ownerId: dev!.id, key: "WI-9002", title: "Other item" }).returning());
await app.inject({ method: "POST", url: `/workitems/${wi!.id}/touches`, headers: H, payload: { repo: crm!.name, paths: ["src/x.ts"], kind: "branch" } });
const tch = await app.inject({ method: "POST", url: `/workitems/${wi2!.id}/touches`, headers: H, payload: { repo: crm!.name, paths: ["src/x.ts"], kind: "branch" } });
check("touch surfaces the overlap", tch.statusCode === 201 && tch.json().overlaps.length === 1, tch.json());

// reviewer
const rv = await app.inject({ method: "POST", url: `/workitems/${wi!.id}/review`, headers: H, payload: { verdict: "changes_requested", findings: [{ file: "src/x.ts", severity: "block", note: "conflict" }] } });
check("review records with a blocking finding", rv.statusCode === 201 && rv.json().verdict === "changes_requested", rv.json());
const brief2 = await app.inject({ method: "GET", url: `/workitems/${wi!.id}/brief` });
check("brief surfaces the changes-requested review", brief2.body.includes("Review — changes requested"), brief2.body.slice(0, 60));

console.log(`\n${fail === 0 ? `\x1b[32m✓ all ${pass} passed` : `\x1b[31m✗ ${fail} failed`}\x1b[0m\n`);
await app.close();
await closeDb();
process.exit(fail === 0 ? 0 : 1);
void sql;
