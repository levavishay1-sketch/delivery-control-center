import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeDb, withTenant } from "@dcc/db";
import { app, db, users } from "./server.ts";
import { blocker, clientBudget, gap, notification, workitem } from "@dcc/db/schema";

/**
 * Builds a realistic multi-client dataset so the Dashboard looks like the
 * approved mockup. Run against a fresh dev DB:
 *   packages/db » npm run dev:reset && npm run dev:setup
 *   apps/api    » node src/seed-dashboard.ts
 */
process.env.DCC_HOOK_TOKEN ??= "dev-secret";
const email = "you@dcc.local";
await db.insert(users).values({ entraOid: `dev-${randomUUID()}`, email, displayName: "Avishay Lev" }).returning();
const [rl] = await db.insert(users).values({ entraOid: `dev-${randomUUID()}`, email: `rosa+${randomUUID()}@x.co`, displayName: "Rosa Lin" }).returning();
const H = { "x-dcc-hook-token": "dev-secret", "x-dcc-dev-email": email };
const post = (url: string, p: Record<string, unknown>) =>
  app.inject({ method: "POST", url, headers: H, payload: p }) as unknown as Promise<{ json: <T>() => T }>;

type WI = { id: string; clientId: string; projectId: string };

async function project(clientName: string, projectName: string, repoName: string) {
  const s = (await post("/admin/setup-client", {
    clientName, projectName, repo: { name: repoName, adoRepoRef: `${clientName}/${repoName}` },
  })).json<{ clientId: string; projectId: string }>();
  return s;
}
async function wi(projectId: string, opts: Record<string, unknown>): Promise<WI> {
  const w = (await post("/workitems", { projectId, ownerId: rl!.id, ...opts })).json<{ id: string; clientId: string; projectId: string }>();
  return w;
}

// ───────── Meridian Health ─────────
const pp = await project("Meridian Health", "Patient Portal", "patient-portal");
const clm = await project("Meridian Health", "Claims API", "claims-api");

const w1 = await wi(pp.projectId, { key: "PPR-14", title: "Add insurance eligibility check", kind: "task", priority: "high", risk: "medium" });
await post(`/workitems/${w1.id}/route`, { capability: "gap_detection", signals: { ambiguity: "high" } });
await post(`/workitems/${w1.id}/gaps`, { description: "Which payers are in scope for the first release? Undefined.", blocking: false, confidence: 0.7 });

const w2 = await wi(clm.projectId, { key: "CLM-9", title: "Patient record export is slow", kind: "bug", priority: "critical", risk: "high", executor: "human", dueInDays: -2 });
await post(`/workitems/${w2.id}/blockers`, { questionType: "missing_access", question: "Need a read-replica provisioned for the export query so it stops competing with live traffic." });

const w3 = await wi(pp.projectId, { key: "PPR-21", title: "Redesign appointment reminders", kind: "change", priority: "medium", risk: "low" });
await post(`/workitems/${w3.id}/route`, { capability: "decomposition", signals: { breadth: 3 } });
await post(`/workitems/${w3.id}/gaps`, { description: "SMS vs push vs email — channel priority not decided.", blocking: true, confidence: 0.85 });

await wi(clm.projectId, { key: "CLM-11", title: "Bulk claim status endpoint", kind: "task", priority: "medium", risk: "low" });

// ───────── Atlas Logistics ─────────
const fta = await project("Atlas Logistics", "Fleet Tracking", "fleet-tracking");
const drv = await project("Atlas Logistics", "Driver App", "driver-app");

const w4 = await wi(fta.projectId, { key: "FTA-7", title: "Position size limits per instrument class", kind: "task", priority: "high", risk: "high", executor: "mixed", dueInDays: 4 });
await post(`/workitems/${w4.id}/route`, { capability: "gap_detection", signals: { ambiguity: "high" } });
await post(`/workitems/${w4.id}/gaps`, { description: "Block the order outright, or warn and allow with sign-off? Compliance vs UX — undecided.", blocking: true, confidence: 0.9 });
await post(`/workitems/${w4.id}/blockers`, { questionType: "missing_access", question: "Read access to the risk engine limits API — which endpoint / credential?" });

await wi(fta.projectId, { key: "FTA-12", title: "Geofence breach alerts", kind: "task", priority: "medium", risk: "low" });
await wi(drv.projectId, { key: "DRV-3", title: "Offline trip queue", kind: "task", priority: "high", risk: "medium", dueInDays: 1 });
const w5 = await wi(drv.projectId, { key: "DRV-5", title: "Driver login fails on Android 13", kind: "bug", priority: "critical", risk: "high" });
await post(`/workitems/${w5.id}/route`, { capability: "execution", signals: {} });

// budgets — set spent to something realistic
await withTenant(pp.clientId, (tx) => tx.update(clientBudget).set({ spentUsd: "186.40", monthlyUsd: "300" }).where(sql`${clientBudget.clientId} = ${pp.clientId}`));
await withTenant(fta.clientId, (tx) => tx.update(clientBudget).set({ spentUsd: "254.10", monthlyUsd: "300" }).where(sql`${clientBudget.clientId} = ${fta.clientId}`));

// a few notifications for the dashboard's "recent alerts"
const me = (await db.select().from(users).where(sql`${users.email} = ${email}`))[0]!;
await db.insert(notification).values([
  { clientId: pp.clientId, forUserId: me.id, workitemId: w2.id, kind: "blocker", severity: "critical", title: "CLM-9 blocked — waiting on database team for a read-replica" },
  { clientId: fta.clientId, forUserId: me.id, kind: "budget", severity: "warn", title: "Fleet Tracking is at 85% of its AI budget" },
  { clientId: pp.clientId, forUserId: me.id, workitemId: w1.id, kind: "review", severity: "info", title: "PPR-14 — AI finished the SPEC draft, ready for review" },
]);

console.log("dashboard seeded:");
console.log("  Meridian Health — Patient Portal, Claims API");
console.log("  Atlas Logistics — Fleet Tracking, Driver App");
console.log("  ~10 work items, 2 budgets, 3 notifications");
console.log(`\n  open:  http://localhost:5173`);
await app.close();
await closeDb();
