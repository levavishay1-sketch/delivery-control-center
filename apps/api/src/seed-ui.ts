import { randomUUID } from "node:crypto";
import { closeDb } from "@dcc/db";
import { app, db, users } from "./server.ts";

/**
 * Seeds a WorkItem left in a state with LIVE actions for the UI:
 * a proposed (unverified) gap and an open blocker.
 *   packages/db » npm run dev:reset && npm run dev:setup
 *   apps/api    » node src/seed-ui.ts
 */
process.env.DCC_HOOK_TOKEN ??= "dev-secret";
const email = "you@dcc.local";
await db.insert(users).values({ entraOid: `dev-${randomUUID()}`, email, displayName: "you" }).returning();
const H = { "x-dcc-hook-token": "dev-secret", "x-dcc-dev-email": email };
const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url, headers: H, payload }) as unknown as Promise<{ json: <T>() => T }>;

const s = (await post("/admin/setup-client", {
  clientName: "Altshuler Trade",
  projectName: "Trading Platform",
  repo: { name: "ALTSHULER_TRADE", gitUrl: "https://github.com/levavishay1-sketch/ALTSHULER_TRADE.git" },
  firstWorkItem: { key: "WI-3001", title: "Position size limits per instrument class" },
})).json<{ clientId: string; workitemId: string }>();

await post("/events", {
  clientId: s.clientId, branch: "feature/WI-3001-position-limits", kind: "note",
  note: { source: "email", body: "Need to cap position size per instrument class. Compliance asked for it. Should apply to all account types I think." },
});
await post("/events", {
  clientId: s.clientId, branch: "feature/WI-3001-position-limits", kind: "note",
  note: { source: "phone", body: "Analyst: limits are notional value, not share count. Formal doc tomorrow — feasible against the current risk engine?" },
});
await post(`/workitems/${s.workitemId}/gaps`, {
  description: "Does the limit block the order outright, or warn and allow with sign-off? Compliance vs UX — nobody decided.",
  blocking: true, confidence: 0.9,
});
await post(`/workitems/${s.workitemId}/gaps`, {
  description: "No rounding rule for notional value in a non-base currency.",
  blocking: false, confidence: 0.7,
});
await post(`/workitems/${s.workitemId}/blockers`, {
  questionType: "missing_access",
  question: "Need read access to the risk engine's limits API — can it express notional-value caps at all? Which endpoint / credential?",
});

console.log(`seeded WI-3001 (${s.workitemId}) — 2 proposed gaps, 1 open blocker, client ${s.clientId}`);
await app.close();
await closeDb();
