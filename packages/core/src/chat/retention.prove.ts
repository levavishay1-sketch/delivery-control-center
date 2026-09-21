import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, db, withTenant } from "@dcc/db";
import { client, conversation, conversationMessage, users } from "@dcc/db/schema";
import { chatDir } from "./index.ts";
import { ARCHIVED_TEXT, archiveExpiredConversations } from "./retention.ts";

/**
 * Proves retention (claude-in-dcc §9.10) against a SCRATCH database:
 *   DCC_PGLITE_DIR=<scratch dir> npx tsx src/chat/retention.prove.ts
 * Never against the running API's database — PGlite is single-process.
 */
if (!process.env.DCC_PGLITE_DIR && !process.env.DATABASE_URL) {
  console.error("refusing to run against the default local database — set DCC_PGLITE_DIR to a scratch directory");
  process.exit(2);
}

let pass = 0;
let fail = 0;
const ok = (name: string) => { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); };
const bad = (name: string, detail?: unknown) => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${String(detail)}` : ""}`); };

const [person] = await db.insert(users).values({ entraOid: randomUUID(), email: `retention+${randomUUID()}@example.com`, displayName: "Retention" }).returning();
const [tenant] = await db.insert(client).values({ name: `Retention ${randomUUID()}` }).returning();

const conversationWith = async (retainUntil: Date, status = "active") => {
  const [row] = await withTenant(tenant!.id, (tx) =>
    tx.insert(conversation).values({ clientId: tenant!.id, topicKey: "app", topicKind: "app", topicTitle: "המערכת", createdBy: person!.id, status, retainUntil, cliSessionId: randomUUID() }).returning());
  await withTenant(tenant!.id, (tx) => tx.insert(conversationMessage).values([
    { conversationId: row!.id, clientId: tenant!.id, role: "user", kind: "answer", source: "system", text: "מה השלב הבא?" },
    { conversationId: row!.id, clientId: tenant!.id, role: "assistant", kind: "answer", source: "model", text: "התשובה שניתנה", payload: { unanswered: false }, helpfulNote: "הערה" },
  ]));
  const dir = chatDir(row!.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "system.txt"), "rules", "utf8");
  return row!;
};
const day = 864e5;
const expired = await conversationWith(new Date(Date.now() - day));
const rolledExpired = await conversationWith(new Date(Date.now() - day), "rolled");
const fresh = await conversationWith(new Date(Date.now() + day));

console.log("\n\x1b[1mclaude-in-dcc — retention\x1b[0m");
const first = await archiveExpiredConversations();
first.archived === 2 && first.messages === 4 ? ok("two expired conversations archived, four messages blanked") : bad("archive counts", JSON.stringify(first));

const blanked = await db.select().from(conversationMessage).where(eq(conversationMessage.conversationId, expired.id));
blanked.length === 2 && blanked.every((m) => m.text === ARCHIVED_TEXT && Object.keys(m.payload).length === 0 && m.helpfulNote === null)
  ? ok("every message is the fixed sentence — no text, no payload, no note")
  : bad("message content kept", blanked.map((m) => m.text).join(" | "));
const [ex] = await db.select().from(conversation).where(eq(conversation.id, expired.id));
ex?.status === "archived" && ex.cliSessionId === null && ex.contextHash === null ? ok("the conversation is archived, its session id and context hash gone") : bad("conversation state", `${ex?.status} ${ex?.cliSessionId}`);
!existsSync(chatDir(expired.id)) ? ok("the CLI session folder was deleted with it") : bad("session folder still there");
const [rolled] = await db.select().from(conversation).where(eq(conversation.id, rolledExpired.id));
rolled?.status === "archived" ? ok("a rolled conversation past its period is archived too") : bad("rolled conversation not archived", rolled?.status);

const [kept] = await db.select().from(conversation).where(eq(conversation.id, fresh.id));
const keptMsgs = await db.select().from(conversationMessage).where(eq(conversationMessage.conversationId, fresh.id));
kept?.status === "active" && keptMsgs.every((m) => m.text !== ARCHIVED_TEXT) && existsSync(chatDir(fresh.id))
  ? ok("a conversation inside its period is untouched, session folder included")
  : bad("fresh conversation changed");

const second = await archiveExpiredConversations();
second.archived === 0 && second.messages === 0 ? ok("a second pass finds nothing — the job is idempotent") : bad("second pass archived again", JSON.stringify(second));

rmSync(chatDir(fresh.id), { recursive: true, force: true });
console.log(`\n${fail === 0 ? "\x1b[32m✓ all " + pass + " checks passed" : "\x1b[31m✗ " + fail + " failed, " + pass + " passed"}\x1b[0m\n`);
await closeDb();
process.exit(fail === 0 ? 0 : 1);
