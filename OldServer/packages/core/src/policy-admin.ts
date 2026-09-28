import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { appendEvent, db, withoutTenant } from "@dcc/db";
import { client, eventLog, users } from "@dcc/db/schema";
import { internalClientId } from "./chat/index.ts";
import { chatPolicy, loadPolicy, savePolicy, type Policy } from "./routing.ts";

/**
 * The policy editor's back end (claude-in-dcc §9.9, §9.10, design §5): the
 * one place the routing policy is changed. A change is validated, merged
 * over the current file, written back with a bumped `version`, and recorded
 * as a `policy.changed` event in the person's name — so the version on
 * every ledger row can be tied to who changed what, and when. A client's
 * own retention period is the same kind of change, recorded on that client.
 */

export class PolicyError extends Error {}

const tier = z.enum(["haiku", "sonnet", "opus"]);
const effort = z.enum(["low", "medium", "high", "xhigh", "max"]);
const price = z.object({ input: z.number().nonnegative(), cacheWrite: z.number().nonnegative(), cacheRead: z.number().nonnegative(), output: z.number().nonnegative() });
const rule = z.array(z.record(z.string(), z.unknown()));

/** What the editor may send: any subset of the policy's editable values. */
export const policyPatch = z.object({
  tiers: z.record(tier, z.object({ model: z.string().min(1).optional(), maxUsdPerCall: z.number().positive().optional() })).optional(),
  prices: z.record(z.string().min(1), price).optional(),
  capabilities: z.record(z.string().min(1), z.object({
    default: tier.optional(), effort: effort.optional(),
    maxUsdPerCall: z.number().positive().nullable().optional(), maxInputTokens: z.number().int().positive().nullable().optional(),
    escalateOn: rule.optional(), downgradeOn: rule.optional(),
  })).optional(),
  chat: z.object({
    rolloverInputTokens: z.number().int().min(2_000).max(180_000), rolloverColdDays: z.number().int().min(1).max(365),
    retentionDays: z.number().int().min(1).max(3650), declareCostAboveUsd: z.number().nonnegative(), insightsMinRepeats: z.number().int().min(2).max(100),
  }).partial().optional(),
  guardrails: z.object({ killAfterStuckIterations: z.number().int().min(1), budgetWarnAtFraction: z.number().min(0).max(1) }).partial().optional(),
});
export type PolicyPatch = z.infer<typeof policyPatch>;
export type PolicyChange = { path: string; from?: unknown; to?: unknown };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep-merge a patch over the current values; `null` removes an optional value (a cap, an input limit). */
function merge(cur: Json, patch: Json): Json {
  const out: Json = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) { delete out[k]; continue; }
    out[k] = isObj(v) && isObj(cur[k]) ? merge(cur[k], v) : v;
  }
  return out;
}
function diff(path: string, from: unknown, to: unknown, out: PolicyChange[]) {
  if (to === undefined) return;
  if (isObj(to) && (isObj(from) || from === undefined)) {
    for (const k of Object.keys(to)) diff(path ? `${path}.${k}` : k, isObj(from) ? from[k] : undefined, to[k], out);
    return;
  }
  const toV = to === null ? undefined : to;
  if (JSON.stringify(from) !== JSON.stringify(toV)) out.push({ path, from, to: toV });
}

export type PolicyView = {
  policy: Policy;
  lastChange: { at: string; byName: string | null; fromVersion: number; toVersion: number; changes: PolicyChange[] } | null;
  retention: { defaultDays: number; clients: { clientId: string; clientName: string; days: number | null }[] };
};

export async function policyView(): Promise<PolicyView> {
  const [ev] = await db.select({ at: eventLog.occurredAt, actor: eventLog.actor, payload: eventLog.payload }).from(eventLog)
    .where(eq(eventLog.type, "policy.changed")).orderBy(desc(eventLog.occurredAt)).limit(1);
  let lastChange: PolicyView["lastChange"] = null;
  if (ev) {
    const userId = (ev.actor as { userId?: string } | null)?.userId;
    const [u] = userId ? await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId)).limit(1) : [];
    const p = ev.payload as { fromVersion: number; toVersion: number; changes: PolicyChange[] };
    lastChange = { at: new Date(ev.at).toISOString(), byName: u?.name ?? null, fromVersion: p.fromVersion, toVersion: p.toVersion, changes: p.changes ?? [] };
  }
  const clients = await db.select({ clientId: client.id, clientName: client.name, days: client.chatRetentionDays }).from(client).where(isNull(client.archivedAt)).orderBy(client.name);
  return { policy: loadPolicy(), lastChange, retention: { defaultDays: chatPolicy().retentionDays, clients } };
}

/** The editor's save: validate, merge, bump the version, record who changed what. */
export async function updatePolicy(raw: unknown, by: { userId: string }): Promise<{ policy: Policy; changes: PolicyChange[] }> {
  const parsed = policyPatch.safeParse(raw);
  if (!parsed.success) throw new PolicyError(`הערכים לא תקינים: ${parsed.error.issues.map((i) => `${i.path.join(".")} — ${i.message}`).join("; ")}`);
  const patch = parsed.data;
  const current = loadPolicy();
  // A capability nothing calls is a statement, not a policy — the editor changes values, never the list.
  for (const key of Object.keys(patch.capabilities ?? {})) {
    if (!(key in current.capabilities)) throw new PolicyError(`אין יכולת בשם "${key}" — אפשר לשנות ערכים של יכולות קיימות בלבד`);
  }
  for (const [key, t] of Object.entries(patch.tiers ?? {})) {
    if (t?.model && !(t.model in { ...current.prices, ...(patch.prices ?? {}) })) throw new PolicyError(`למודל "${t.model}" אין מחיר בטבלת המחירים — הוסיפו אותו קודם (${key})`);
  }
  const changes: PolicyChange[] = [];
  diff("", current as unknown as Json, patch as Json, changes);
  if (!changes.length) return { policy: current, changes };
  const next = merge(current as unknown as Json, patch as Json) as unknown as Policy;
  const saved = savePolicy(next);
  await appendEvent({
    clientId: await internalClientId(), workitemId: null, source: "manual", type: "policy.changed",
    actor: { kind: "user", userId: by.userId, identityType: "interactive" },
    payload: { fromVersion: current.version, toVersion: saved.version, changes },
  });
  return { policy: saved, changes };
}

/** A client's own retention period (§9.10) — `null` returns it to the policy's default. Recorded on that client. */
export async function setClientRetention(clientId: string, days: number | null, by: { userId: string }): Promise<{ clientId: string; days: number | null }> {
  if (days != null && (!Number.isInteger(days) || days < 1 || days > 3650)) throw new PolicyError("תקופת השמירה היא מספר ימים שלם בין 1 ל-3650");
  const [c] = await db.select({ id: client.id, days: client.chatRetentionDays }).from(client).where(eq(client.id, clientId)).limit(1);
  if (!c) throw new PolicyError("הלקוח לא נמצא");
  if (c.days === days) return { clientId, days };
  await withoutTenant((tx) => tx.update(client).set({ chatRetentionDays: days }).where(eq(client.id, clientId)));
  const version = loadPolicy().version;
  await appendEvent({
    clientId, workitemId: null, source: "manual", type: "policy.changed",
    actor: { kind: "user", userId: by.userId, identityType: "interactive" },
    payload: { fromVersion: version, toVersion: version, changes: [{ path: "chatRetentionDays", from: c.days, to: days }] },
  });
  return { clientId, days };
}
