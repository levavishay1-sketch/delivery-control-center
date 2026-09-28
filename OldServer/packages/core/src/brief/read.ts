import { sql } from "drizzle-orm";
import { withTenant } from "@dcc/db";
import { contextBrief, workitem } from "@dcc/db/schema";
import { regenerateBrief } from "./generate.ts";

/**
 * The exact text a `SessionStart` hook prints to stdout so it becomes
 * the session's context. Returns "" when there is no WorkItem or no
 * events yet — the hook then prints nothing and the session proceeds
 * normally (architecture session-capture spec).
 */
export async function briefFor(clientId: string, workitemId: string): Promise<string> {
  const [row] = await withTenant(clientId, (tx) =>
    tx.select({ body: contextBrief.body }).from(contextBrief).where(sql`${contextBrief.workitemId} = ${workitemId}`).limit(1),
  );
  if (row?.body) return row.body;

  // No brief yet — build one now if the WorkItem exists.
  const [wi] = await withTenant(clientId, (tx) =>
    tx.select({ id: workitem.id }).from(workitem).where(sql`${workitem.id} = ${workitemId}`).limit(1),
  );
  if (!wi) return "";
  await regenerateBrief(clientId, workitemId);
  const [after] = await withTenant(clientId, (tx) =>
    tx.select({ body: contextBrief.body }).from(contextBrief).where(sql`${contextBrief.workitemId} = ${workitemId}`).limit(1),
  );
  return after?.body ?? "";
}
