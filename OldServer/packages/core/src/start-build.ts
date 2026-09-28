import { and, eq, sql } from "drizzle-orm";
import { appendEvent, db, withTenant } from "@dcc/db";
import { blocker, clientRepo, gap, repo, workitem } from "@dcc/db/schema";
import { regenerateBrief } from "./brief/generate.ts";
import { syncRequirementToAdo } from "./ado-sync.ts";

/**
 * "I'm ready to build this." Assigns a stable key if the requirement
 * doesn't have one, moves it to `building`, and hands back everything a
 * Claude Code session needs to start: the branch name (the WI-nnn
 * convention the hooks resolve), the repo(s), and a warning if there
 * are still open blocking gaps / blockers.
 */

function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // latin words only; Hebrew drops out
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 40);
  return s || "";
}

export type StartBuildResult = {
  key: string;
  branch: string;
  repos: { name: string; adoRepoRef: string | null; defaultBranch: string }[];
  openBlockingGaps: number;
  openBlockers: number;
  startedWithOpenBlocker: boolean;
};

export async function startBuilding(input: { clientId: string; workitemId: string; by: { userId: string } }): Promise<StartBuildResult> {
  // next free WI-<n> — read BEFORE opening the tenant tx (PGlite is single-conn)
  const [mx] = ((await db.execute<{ n: number }>(
    sql`select coalesce(max((substring(key from 'WI-([0-9]+)'))::int), 1000) as n from workitem where key ~ '^WI-[0-9]+$'`,
  )).rows ?? []) as { n: number }[];
  const nextWi = (mx?.n ?? 1000) + 1;

  const out = await withTenant(input.clientId, async (tx) => {
    const [wi] = await tx.select().from(workitem).where(eq(workitem.id, input.workitemId)).limit(1);
    if (!wi) throw new Error("requirement not found");

    let key = wi.key;
    if (!key || !/^[A-Z]{2,5}-\d+$/.test(key)) {
      key = wi.linkedAdoId ? `WI-${wi.linkedAdoId}` : `WI-${nextWi}`;
      await tx.update(workitem).set({ key }).where(eq(workitem.id, input.workitemId));
    }

    const [gapAgg] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(gap)
      .where(and(eq(gap.workitemId, input.workitemId), sql`${gap.blocking} and ${gap.state} in ('proposed','verified')`));
    const [blkAgg] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(blocker)
      .where(and(eq(blocker.workitemId, input.workitemId), eq(blocker.state, "open")));
    const openBlockingGaps = gapAgg?.n ?? 0;
    const openBlockers = blkAgg?.n ?? 0;
    const startedWithOpenBlocker = openBlockingGaps + openBlockers > 0;

    let repos = await tx
      .select({ name: repo.name, adoRepoRef: repo.adoRepoRef, defaultBranch: repo.defaultBranch })
      .from(sql`workitem_repo wr`)
      .innerJoin(repo, sql`${repo.id} = wr.repo_id`)
      .where(sql`wr.workitem_id = ${input.workitemId}`);
    if (repos.length === 0) {
      repos = await tx
        .select({ name: repo.name, adoRepoRef: repo.adoRepoRef, defaultBranch: repo.defaultBranch })
        .from(clientRepo)
        .innerJoin(repo, eq(repo.id, clientRepo.repoId))
        .where(eq(clientRepo.clientId, input.clientId));
    }

    const slug = slugify(wi.title);
    const branch = slug ? `task/${key}-${slug}` : `task/${key}`;
    const moved = wi.phase === "intake" || wi.phase === "shaping";

    if (moved) {
      await tx.update(workitem).set({ phase: "building", startedWithOpenBlocker, updatedAt: new Date() }).where(eq(workitem.id, input.workitemId));
      await appendEvent({
        clientId: input.clientId, workitemId: input.workitemId, source: "manual", type: "status.changed",
        actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
        payload: { from: wi.phase, to: "building", viaAdo: false },
      });
    }
    return { key, branch, repos, openBlockingGaps, openBlockers, startedWithOpenBlocker, moved, linked: wi.linkedAdoId };
  });

  // outside the tx: brief + mirror the move to TFS (state → Active)
  if (out.moved) {
    await regenerateBrief(input.clientId, input.workitemId);
    if (out.linked) await syncRequirementToAdo({ clientId: input.clientId, workitemId: input.workitemId, by: input.by }).catch(() => {});
  }
  const { moved, linked, ...res } = out;
  void moved; void linked;
  return res;
}
