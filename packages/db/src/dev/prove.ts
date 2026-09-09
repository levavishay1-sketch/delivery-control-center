import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, withTenant, closeDb } from "../client.ts";
import { client, users, workitem } from "../schema/index.ts";
import { eventLog } from "../schema/events.ts";
import { appendEvent, timeline } from "../events/index.ts";

/**
 * Proves the two foundational decisions that are painful to reverse:
 *   01 — event_log is append-only
 *   03 — the client wall (RLS) actually holds
 * plus the payload-validation discipline that keeps decision 01 honest.
 *
 * Run against a fresh dev DB: `npm run dev:reset && npm run dev:prove`.
 */

let pass = 0;
let fail = 0;
const ok = (name: string) => {
  pass++;
  console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
};
const bad = (name: string, detail?: unknown) => {
  fail++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${String(detail)}` : ""}`);
};

// ── seed: two clients, isolated ──────────────────────────────────────
const [alice] = await db.insert(users).values({
  entraOid: randomUUID(), email: `alice+${randomUUID()}@example.com`, displayName: "Alice",
}).returning();

const [cA] = await db.insert(client).values({ name: `Client A ${randomUUID()}` }).returning();
const [cB] = await db.insert(client).values({ name: `Client B ${randomUUID()}` }).returning();

const mk = async (c: { id: string; name: string }) => {
  const [wi] = await withTenant(c.id, (tx) =>
    tx.insert(workitem).values({
      clientId: c.id, ownerId: alice!.id, title: "Tiered discounts",
    }).returning());
  await appendEvent({
    clientId: c.id, workitemId: wi!.id, source: "manual", type: "note.added",
    actor: { kind: "user", userId: alice!.id, identityType: "interactive" },
    payload: { body: `hello from ${c.name}` },
  });
  return wi!;
};
const wiA = await mk(cA!);
const wiB = await mk(cB!);

console.log("\n\x1b[1m03 — client wall (RLS)\x1b[0m");
{
  const seenByA = await timeline(cA!.id, wiA.id);
  seenByA.length === 1 ? ok("tenant A sees its own event") : bad("tenant A event count", seenByA.length);

  // A asks for B's workitem timeline — RLS must yield nothing
  const crossread = await withTenant(cA!.id, (tx) =>
    tx.select().from(eventLog).where(sql`${eventLog.workitemId} = ${wiB.id}`));
  crossread.length === 0
    ? ok("tenant A cannot read tenant B's events")
    : bad("cross-tenant read leaked", `${crossread.length} rows`);

  // A tries to write an event tagged as B — RLS WITH CHECK must refuse
  try {
    await withTenant(cA!.id, (tx) =>
      tx.insert(eventLog).values({
        clientId: cB!.id, workitemId: wiB.id, occurredAt: new Date(), source: "manual",
        type: "note.added", actor: { kind: "user", userId: alice!.id, identityType: "interactive" },
        payload: { body: "smuggled" },
      }));
    bad("tenant A wrote a row tagged as tenant B");
  } catch {
    ok("tenant A cannot write events for tenant B");
  }
}

console.log("\n\x1b[1m01 — event_log is append-only\x1b[0m");
{
  try {
    await withTenant(cA!.id, (tx) =>
      tx.update(eventLog).set({ type: "tampered" }).where(sql`${eventLog.workitemId} = ${wiA.id}`));
    bad("UPDATE on event_log was allowed");
  } catch {
    ok("UPDATE on event_log is rejected");
  }
  try {
    await withTenant(cA!.id, (tx) =>
      tx.delete(eventLog).where(sql`${eventLog.workitemId} = ${wiA.id}`));
    bad("DELETE on event_log was allowed");
  } catch {
    ok("DELETE on event_log is rejected");
  }
  const still = await timeline(cA!.id, wiA.id);
  still.length === 1 ? ok("history intact after tamper attempts") : bad("history changed", still.length);
}

console.log("\n\x1b[1m01 — payload validation\x1b[0m");
{
  try {
    await appendEvent({
      clientId: cA!.id, workitemId: wiA.id, source: "manual", type: "totally.made.up",
      actor: { kind: "user", userId: alice!.id, identityType: "interactive" }, payload: {},
    });
    bad("unknown event type was accepted");
  } catch {
    ok("unknown event type is rejected");
  }
  try {
    await appendEvent({
      clientId: cA!.id, workitemId: wiA.id, source: "manual", type: "gap.proposed",
      actor: { kind: "user", userId: alice!.id, identityType: "interactive" },
      payload: { description: "x", blocking: "yes-please", confidence: 5 },
    });
    bad("malformed payload was accepted");
  } catch {
    ok("malformed payload is rejected");
  }
}

console.log("\n\x1b[1m01 — correction via supersedes\x1b[0m");
{
  const [orig] = await timeline(cA!.id, wiA.id);
  const corrected = await appendEvent({
    clientId: cA!.id, workitemId: wiA.id, source: "manual", type: "note.added",
    actor: { kind: "user", userId: alice!.id, identityType: "interactive" },
    supersedes: orig!.id, payload: { body: "actually, hello (corrected)" },
    links: [{ rel: "supersedes", ref: orig!.id }],
  });
  const now = await timeline(cA!.id, wiA.id);
  now.length === 2 && now.some((e) => e.supersedes === orig!.id)
    ? ok("correction is a new row; original still present")
    : bad("supersedes chain wrong", now.length);
  void corrected;
}

console.log(`\n${fail === 0 ? "\x1b[32m✓ all " + pass + " checks passed" : "\x1b[31m✗ " + fail + " failed, " + pass + " passed"}\x1b[0m\n`);
await closeDb();
process.exit(fail === 0 ? 0 : 1);
