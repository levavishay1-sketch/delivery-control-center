import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, withTenant, closeDb, appendEvent, timeline } from "@dcc/db";
import { client, project, users, workitem, gap } from "@dcc/db/schema";
import { recordSession, recordGitActivity, recordNote, resolveWorkItem, briefFor } from "./index.ts";

/**
 * The Phase 0 exit gate, end to end:
 *   raw requirement → gap → session + commits → a fresh session starts
 *   from the Context Brief, not from zero.
 *
 * Run: `npm run dev:reset && npm run dev:setup` in packages/db, then
 * `npm run demo` in packages/core.
 */

const [dev] = await db.insert(users).values({
  entraOid: randomUUID(), email: `dev+${randomUUID()}@example.com`, displayName: "Dev",
}).returning();
const [c] = await db.insert(client).values({ name: `Medipharm ${randomUUID().slice(0, 8)}` }).returning();
const [p] = await withTenant(c!.id, (tx) =>
  tx.insert(project).values({ clientId: c!.id, name: "Customer Portal", adoProjectRef: "Medipharm.Portal" }).returning());
const [wi] = await withTenant(c!.id, (tx) =>
  tx.insert(workitem).values({
    clientId: c!.id, projectId: p!.id, ownerId: dev!.id, key: "WI-1284",
    title: "Tiered discounts for business customers", phase: "building", linkedAdoId: 4471,
  }).returning());

const dctx = { clientId: c!.id, workitemId: wi!.id, dev: { userId: dev!.id } };

// 1. raw requirement, by email, then a phone call mid-build
await recordNote({ ...dctx, source: "email", body: "Need tiered discounts by turnover, like we discussed." });
await recordNote({ ...dctx, source: "phone", body: "Ronit called — mid-month tier change: pro-rata or end-of-month? She'll send a formal req tomorrow." });

// 2. a verified blocking gap
await withTenant(c!.id, (tx) =>
  tx.insert(gap).values({
    clientId: c!.id, workitemId: wi!.id, blocking: true, state: "verified", resolvedBy: dev!.id,
    confidence: "0.88", description: "Mid-month tier crossing — pro-rata vs end-of-month is undefined.",
  }));

// 3. a Claude session + commits on the convention branch
const branch = "feature/WI-1284-tiered-discount";
const resolved = await resolveWorkItem({ clientId: c!.id, branch });
console.log(`\nresolveWorkItem("${branch}") → ${resolved?.key} (${resolved?.title})\n`);

await recordSession({
  clientId: c!.id, workitemId: resolved!.id, dev: { userId: dev!.id },
  session: {
    sessionId: randomUUID(), model: "claude-sonnet-5", tokensIn: 48000, tokensOut: 9000, costUsd: 0.31,
    summary: "Built the DiscountTier model and the schema migration. Implemented flat-tier calc; pro-rata path stubbed pending the gap answer.",
  },
});
await recordGitActivity({
  clientId: c!.id, workitemId: resolved!.id, dev: { userId: dev!.id },
  git: { repo: "CRM", branch, kind: "commit", count: 4, shas: ["a1b2c3d", "e4f5g6h", "i7j8k9l", "m0n1o2p"] },
});

// 4. the timeline is complete
const tl = await timeline(c!.id, wi!.id);
console.log(`timeline: ${tl.length} events, newest first:`);
for (const e of tl) console.log(`  ${e.occurredAt.toISOString().slice(0, 16)}  ${e.source.padEnd(14)} ${e.type}`);

// 5. a FRESH session starts from the Brief
console.log("\n" + "═".repeat(70));
console.log("what SessionStart injects into the next Claude session:");
console.log("═".repeat(70));
console.log(await briefFor(c!.id, wi!.id));

await closeDb();
