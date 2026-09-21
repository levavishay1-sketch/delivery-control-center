import { and, eq, lt, ne } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { conversation, conversationMessage } from "@dcc/db/schema";
import { deleteChatSession } from "./index.ts";

/**
 * Retention (claude-in-dcc §9.10, design §2): conversations accumulate,
 * cost money and hold a client's content, so they have a period. A
 * conversation whose `retain_until` has passed loses its text — every
 * message becomes one fixed sentence, its CLI session file goes — and
 * stays as a row that says it existed, with its cost. The ledger is never
 * touched: a cost record is money. The period is the policy's default or
 * the client's own (`client.chat_retention_days`), stamped on the
 * conversation at every message.
 */

export const ARCHIVED_TEXT = "התוכן נמחק לפי תקופת השמירה";

export async function archiveExpiredConversations(now = new Date()): Promise<{ archived: number; messages: number }> {
  const due = await db.select({ id: conversation.id, clientId: conversation.clientId }).from(conversation)
    .where(and(ne(conversation.status, "archived"), lt(conversation.retainUntil, now)));
  let messages = 0;
  for (const c of due) {
    const blanked = await withTenant(c.clientId, async (tx) => {
      const rows = await tx.update(conversationMessage)
        .set({ text: ARCHIVED_TEXT, payload: {}, helpfulNote: null })
        .where(eq(conversationMessage.conversationId, c.id))
        .returning({ id: conversationMessage.id });
      await tx.update(conversation)
        .set({ status: "archived", contextHash: null, cliSessionId: null, cliBaseline: {} })
        .where(eq(conversation.id, c.id));
      return rows.length;
    });
    deleteChatSession(c.id);
    messages += blanked;
  }
  return { archived: due.length, messages };
}

/**
 * Once shortly after the server is up, then every day — inside the API
 * process, never a second process on the database. Returns the stop
 * function; the timers never keep the process alive.
 */
export function scheduleRetention(log: { info: (msg: string) => void; error: (err: unknown) => void }, everyMs = 24 * 3600 * 1000): () => void {
  const run = () =>
    archiveExpiredConversations()
      .then((r) => { if (r.archived) log.info(`retention: ${r.archived} conversation(s) archived, ${r.messages} message(s) blanked`); })
      .catch((e) => log.error(e));
  const first = setTimeout(run, 30_000);
  const timer = setInterval(run, everyMs);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
