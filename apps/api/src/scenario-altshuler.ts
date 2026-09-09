import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeDb } from "@dcc/db";
import { app, db, users } from "./server.ts";

/**
 * The pilot scenario: an under-baked requirement comes in for Altshuler
 * Trade. Walks the whole flow through the API the way the hooks + skills
 * would — capture → gaps → verify → blocker → answer → the Context Brief
 * carries it all for the next session.
 *
 *   packages/db  » npm run dev:reset && npm run dev:setup
 *   apps/api     » node src/scenario-altshuler.ts
 */
process.env.DCC_HOOK_TOKEN ??= "scenario-secret";
const TOKEN = process.env.DCC_HOOK_TOKEN;

const email = `analyst+${randomUUID()}@altshuler.example`;
const [analyst] = await db.insert(users).values({ entraOid: randomUUID(), email, displayName: "Analyst" }).returning();
const ownerId = analyst!.id;
const H = { "x-dcc-hook-token": TOKEN, "x-dcc-dev-email": email };
type Res = { statusCode: number; body: string; json: <T = unknown>() => T };
const post = (url: string, payload: Record<string, unknown>): Promise<Res> =>
  app.inject({ method: "POST", url, headers: H, payload }) as unknown as Promise<Res>;
const get = (url: string): Promise<Res> =>
  app.inject({ method: "GET", url, headers: H }) as unknown as Promise<Res>;
const show = (label: string, r: Res) =>
  console.log(`\n▸ ${label}  →  ${r.statusCode}\n  ${r.body.slice(0, 300)}`);

// 1 ── onboard the client, project, repo, and the WorkItem
const setup = await post("/admin/setup-client", {
  clientName: "Altshuler Trade",
  projectName: "Trading Platform",
  repo: { name: "ALTSHULER_TRADE", gitUrl: "https://github.com/levavishay1-sketch/ALTSHULER_TRADE.git" },
  firstWorkItem: { key: "WI-3001", title: "Position size limits per instrument class", level: "story" },
});
show("setup-client", setup);
const { clientId, workitemId } = setup.json() as { clientId: string; workitemId: string };

// 2 ── the raw, under-baked requirement lands (email, forwarded)
show(
  "raw requirement (email → timeline)",
  await post("/events", {
    clientId, branch: "feature/WI-3001-position-limits", kind: "note",
    note: {
      source: "email",
      body: "Need to cap position size per instrument class. Compliance asked for it. Should apply to all account types I think.",
    },
  }),
);

// 3 ── a mid-analysis phone call, before any formal doc
show(
  "phone call mid-analysis",
  await post("/events", {
    clientId, branch: "feature/WI-3001-position-limits", kind: "note",
    note: { source: "phone", body: "Analyst: limits are notional value, not share count. Formal doc tomorrow — is that even feasible against the current risk engine?" },
  }),
);

// 4 ── developer + Claude open the code. The gap-report skill routes
//      the model first (high ambiguity → escalate), then fires twice.
show(
  "route: gap_detection (high ambiguity)",
  await post(`/workitems/${workitemId}/route`, { capability: "gap_detection", signals: { ambiguity: "high" } }),
);
show(
  "gap #1 — blocking",
  await post(`/workitems/${workitemId}/gaps`, {
    description: "Undefined: does the limit block the order outright, or warn and allow with sign-off? Compliance vs UX — nobody decided.",
    blocking: true, confidence: 0.9,
  }),
);
show(
  "gap #2 — non-blocking",
  await post(`/workitems/${workitemId}/gaps`, {
    description: "No rounding rule for notional value in a non-base currency.",
    blocking: false, confidence: 0.7,
  }),
);

// 5 ── the owner verifies the blocking gap, spins off the non-blocking one
const detail = (await get(`/workitems/${workitemId}`)).json() as {
  gaps: { id: string; blocking: boolean }[];
  workitem: { projectId: string };
};
const projectId = detail.workitem.projectId;
const blockingGap = detail.gaps.find((g) => g.blocking)!;
const otherGap = detail.gaps.find((g) => !g.blocking)!;
void sql;
show("verify blocking gap", await post(`/gaps/${blockingGap.id}/verify`, { outcome: "verified", clientId }));
show(
  "spin off non-blocking gap",
  await post(`/gaps/${otherGap.id}/verify`, {
    outcome: "spun_off", clientId, projectId, ownerId, spunOffTitle: "Notional rounding rule for non-base currency",
  }),
);

// 6 ── Claude hits a wall — raises a structured blocker
show(
  "blocker raised",
  await post(`/workitems/${workitemId}/blockers`, {
    questionType: "missing_access",
    question: "Need read access to the risk engine's limits API to check whether it can express notional-value caps at all. Which endpoint / credential?",
  }),
);

// 7 ── the owner answers (from the 'waiting on me' queue)
const b = (await get(`/clients/${clientId}/blockers`)).json() as { blockers: { id: string }[] };
show("answer blocker", await post(`/blockers/${b.blockers[0]!.id}/answer`, {
  clientId,
  answer: "Risk engine v4 supports notional caps via /limits/notional. Read token in Key Vault under altshuler/risk-engine-ro. It does NOT support per-class grouping — you'll aggregate in our layer.",
}));

// 8 ── with the blocking gap verified and the access decision on record,
//      the task-breakdown skill routes (cross-repo → escalate), runs
//      OpenSpec, and registers the plan
show(
  "route: decomposition (cross-repo)",
  await post(`/workitems/${workitemId}/route`, { capability: "decomposition", signals: { breadth: 5, openGaps: 0 } }),
);
show(
  "tasks proposed (via task-breakdown / OpenSpec)",
  await post(`/workitems/${workitemId}/tasks`, {
    openspecChangeId: "add-position-limits",
    tasks: [
      { intent: "Aggregation layer: group instruments into classes and sum notional exposure", acceptance: [{ given: "positions across 3 instruments in class FX", when: "class exposure is computed", then: "it equals the sum of the three notional values in base currency" }], appetite: "standard", dependsOn: [] },
      { intent: "Wire the limits API (/limits/notional) read path", acceptance: [{ given: "a valid risk-engine token", when: "the limit for a class is fetched", then: "the notional cap is returned" }], appetite: "small", dependsOn: [] },
      { intent: "Enforce: block the order outright when class exposure would exceed the cap (per the verified gap)", acceptance: [{ given: "an order that would push class exposure over the cap", when: "the order is submitted", then: "it is rejected with a compliance reason code" }], appetite: "standard", dependsOn: [0, 1], dependencyReason: "needs aggregation + the cap value; behaviour fixed by gap #1" },
    ],
  }),
);
const tOut = (await get(`/workitems/${workitemId}/tasks`)).json() as { tasks: { id: string; intent: string }[] };
show("start task 1", await post(`/tasks/${tOut.tasks[0]!.id}/progress`, { to: "in_progress", clientId }));

// 9 ── what the NEXT Claude session starts from
console.log("\n" + "═".repeat(72));
console.log("Context Brief the next SessionStart injects:");
console.log("═".repeat(72));
console.log((await get(`/workitems/${workitemId}/brief`)).body);

await app.close();
await closeDb();
