import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@dcc/db";
import { marketplaceSource } from "@dcc/db/schema";
import type { FoundSource, RememberedSource, Trust, TrustChecks } from "./marketplace-sources.ts";

/**
 * The memory of ready-made components: a source found for one repository is
 * remembered and offered to the next repository with the same stack, and
 * re-checked weekly. The search, the trust grading and the card are in
 * `marketplace-sources.ts`; this file is the only part that touches the
 * database.
 */

export * from "./marketplace-sources.ts";

/* ── the memory ───────────────────────────────────────────────────── */

/** Sources already known for any of these tags — what the next repository with the same stack gets without a search. */
export async function rememberedFor(tags: readonly string[]): Promise<RememberedSource[]> {
  if (!tags.length) return [];
  const rows = await db.select().from(marketplaceSource).orderBy(desc(marketplaceSource.usedInRepos), desc(marketplaceSource.lastCheckedAt));
  return rows.filter((r) => (r.tags as string[]).some((t) => tags.includes(t)));
}

export async function rememberSource(s: FoundSource, trust: Trust, checks: TrustChecks, foundBy: "model" | "catalog" | "person" = "model"): Promise<RememberedSource> {
  const [existing] = await db.select().from(marketplaceSource).where(and(eq(marketplaceSource.kind, s.kind), eq(marketplaceSource.url, s.url))).limit(1);
  if (existing) {
    const changed = existing.toolCount !== s.toolCount && s.toolCount !== null;
    const tags = [...new Set([...(existing.tags as string[]), ...s.tags])];
    const [row] = await db.update(marketplaceSource).set({ tags, trust, trustChecks: checks, toolCount: s.toolCount ?? existing.toolCount, lastCheckedAt: new Date(), ...(changed ? { changedAt: new Date() } : {}) }).where(eq(marketplaceSource.id, existing.id)).returning();
    return row!;
  }
  const [row] = await db.insert(marketplaceSource).values({
    kind: s.kind, name: s.name, url: s.url, publisher: s.publisher, description: s.description, tags: s.tags, trust, trustChecks: checks,
    toolCount: s.toolCount, contextTokens: s.toolCount != null ? s.toolCount * 700 : null, foundBy,
  }).returning();
  return row!;
}

export const countSourceUse = (id: string) => db.update(marketplaceSource).set({ usedInRepos: sql`${marketplaceSource.usedInRepos} + 1` }).where(eq(marketplaceSource.id, id));

