import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeDb, withTenant } from "@dcc/db";
import { app, db, users } from "./server.ts";
import { clientBudget, notification, project, workitem } from "@dcc/db/schema";

/**
 * Realistic dataset so the Dashboard shows real backend data in the
 * approved template's shape. Fresh dev DB:
 *   packages/db » npm run dev:reset && npm run dev:setup
 *   apps/api    » node src/seed-dashboard.ts
 */
process.env.DCC_HOOK_TOKEN ??= "dev-secret";
const email = "you@dcc.local";
await db.insert(users).values({ entraOid: `d-${randomUUID()}`, email, displayName: "ניר כהן" });
const people = await Promise.all(["דנה לוי", "יואב כהן", "מיכל רז", "אורי בר", "נועה שרת"].map((n) =>
  db.insert(users).values({ entraOid: `d-${randomUUID()}`, email: `${randomUUID().slice(0, 6)}@x.co`, displayName: n }).returning().then((r) => r[0]!),
));
const H = { "x-dcc-hook-token": "dev-secret", "x-dcc-dev-email": email };
const post = (url: string, p: Record<string, unknown>) => app.inject({ method: "POST", url, headers: H, payload: p }) as unknown as Promise<{ json: <T>() => T }>;

async function proj(clientName: string, projectName: string, repoName: string, opts: { connectorType: string; status: string; budgetUsd: number }) {
  const s = (await post("/admin/setup-client", { clientName, projectName, repo: { name: repoName } })).json<{ clientId: string; projectId: string }>();
  await withTenant(s.clientId, (tx) => tx.update(project).set({ connectorType: opts.connectorType as never, status: opts.status as never, budgetUsd: String(opts.budgetUsd) }).where(sql`${project.id} = ${s.projectId}`));
  return s;
}
async function wi(s: { clientId: string; projectId: string }, opts: Record<string, unknown>) {
  const ownerId = people[Math.floor(Math.random() * people.length)]!.id;
  const w = (await post("/workitems", { projectId: s.projectId, ownerId, ...opts })).json<{ id: string }>();
  return w.id;
}

const p1 = await proj("בנק הפועלים", "מערכת ניהול לקוחות", "crm-core", { connectorType: "ado", status: "active", budgetUsd: 15000 });
const p2 = await proj("שטראוס", "פורטל ספקים", "supplier-portal", { connectorType: "manual", status: "planning", budgetUsd: 8000 });
const p3 = await proj("מגדל ביטוח", "אוטומציית דוחות", "report-automation", { connectorType: "dcc", status: "blocked", budgetUsd: 12000 });
const p4 = await proj("אלטשולר שחם", "שדרוג מערכת CRM", "crm-upgrade", { connectorType: "ado", status: "done", budgetUsd: 10000 });

const wa = await wi(p1, { key: "CRM-142", title: "תיקון שגיאת API בטעינת לקוחות", kind: "bug", priority: "critical", risk: "high", budgetUsd: 40, dueInDays: 1 });
await post(`/workitems/${wa}/route`, { capability: "execution", signals: {} });
await post(`/workitems/${wa}/blockers`, { questionType: "missing_access", question: "צריך גישת קריאה ל-API של מערכת הליבה כדי לשחזר את השגיאה." });

await wi(p1, { key: "CRM-150", title: "אינטגרציה עם מערכת חיוב חיצונית", kind: "change", priority: "high", risk: "medium", budgetUsd: 120 });
const wc = await wi(p2, { key: "SUP-9", title: "בדיקת נתונים בטופס הרשמה", kind: "task", priority: "medium", risk: "low", budgetUsd: 25 });
await post(`/workitems/${wc}/route`, { capability: "gap_detection", signals: { ambiguity: "high" } });
await post(`/workitems/${wc}/gaps`, { description: "אילו שדות חובה בטופס? לא הוגדר.", blocking: false, confidence: 0.7 });

await wi(p1, { key: "CRM-155", title: "פיתוח מסך דשבורד ניהולי", kind: "task", priority: "high", risk: "medium", budgetUsd: 200 });
await wi(p4, { key: "CRMU-3", title: "עדכון תיעוד למערכת החדשה", kind: "task", priority: "low", risk: "low", budgetUsd: 15 });
const wd = await wi(p3, { key: "RPT-7", title: "תקרת גודל דוח לפי סוג לקוח", kind: "task", priority: "high", risk: "high", budgetUsd: 90, dueInDays: 4 });
await post(`/workitems/${wd}/route`, { capability: "decomposition", signals: { breadth: 3 } });
await post(`/workitems/${wd}/gaps`, { description: "האם לחסום ייצוא מעל הגודל, או להזהיר ולאפשר? לא הוכרע.", blocking: true, confidence: 0.85 });
await post(`/workitems/${wd}/blockers`, { questionType: "unclear_requirement", question: "מי מאשר חריגה מהתקרה — הלקוח או ניהול הסיכונים?" });

// budgets
await withTenant(p1.clientId, (tx) => tx.update(clientBudget).set({ spentUsd: "1250", monthlyUsd: "2000" }).where(sql`${clientBudget.clientId} = ${p1.clientId}`));
await withTenant(p2.clientId, (tx) => tx.update(clientBudget).set({ spentUsd: "450", monthlyUsd: "1000" }).where(sql`${clientBudget.clientId} = ${p2.clientId}`));
await withTenant(p3.clientId, (tx) => tx.update(clientBudget).set({ spentUsd: "750", monthlyUsd: "1000" }).where(sql`${clientBudget.clientId} = ${p3.clientId}`));
await withTenant(p4.clientId, (tx) => tx.update(clientBudget).set({ spentUsd: "0", monthlyUsd: "1000" }).where(sql`${clientBudget.clientId} = ${p4.clientId}`));

const me = (await db.select().from(users).where(sql`${users.email} = ${email}`))[0]!;
await db.insert(notification).values([
  { clientId: p1.clientId, forUserId: me.id, workitemId: wa, kind: "blocker", severity: "critical", title: "עבודה חסומה", body: "אוטומציית דוחות" },
  { clientId: p3.clientId, forUserId: me.id, kind: "budget", severity: "warn", title: "תקציב מתקרב לסף", body: "מערכת ניהול לקוחות" },
  { clientId: p4.clientId, forUserId: me.id, workitemId: wd, kind: "review", severity: "info", title: "עבודה הושלמה", body: "שדרוג מערכת CRM" },
]);

console.log("seeded — 4 projects, ~8 work items, 4 budgets, 3 alerts. open http://localhost:5173");
await app.close();
await closeDb();
