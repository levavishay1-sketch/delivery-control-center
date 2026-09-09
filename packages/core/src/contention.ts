import { inArray, sql } from "drizzle-orm";
import { withTenant, appendEvent } from "@dcc/db";
import { repo, review, workitem, workitemFileTouch } from "@dcc/db/schema";
import { regenerateBrief } from "./brief/generate.ts";

/**
 * The active-edit map and the Reviewer flow (architecture §7, §9).
 * Overlap is a warning, not a gate. The Reviewer is a hat before human
 * approval, not instead of it.
 */

export async function recordTouches(input: {
  clientId: string;
  workitemId: string;
  repoName: string;
  branch?: string;
  paths: string[];
  kind?: "declared" | "branch";
}) {
  return withTenant(input.clientId, async (tx) => {
    const [r] = await tx.select({ id: repo.id }).from(repo).where(sql`${repo.name} = ${input.repoName}`).limit(1);
    if (!r) throw new Error(`repo ${input.repoName} not found`);

    for (const path of input.paths) {
      await tx
        .insert(workitemFileTouch)
        .values({
          clientId: input.clientId,
          workitemId: input.workitemId,
          repoId: r.id,
          path,
          branch: input.branch ?? null,
          kind: input.kind ?? "declared",
        })
        .onConflictDoUpdate({
          target: [workitemFileTouch.workitemId, workitemFileTouch.repoId, workitemFileTouch.path],
          set: { lastTouchedAt: new Date(), branch: input.branch ?? null, kind: input.kind ?? "declared", releasedAt: null },
        });
    }

    // What does this overlap with?
    const overlaps = await tx
      .select({
        path: workitemFileTouch.path,
        otherWorkitem: workitemFileTouch.workitemId,
        otherKey: workitem.key,
        otherTitle: workitem.title,
        otherBranch: workitemFileTouch.branch,
      })
      .from(workitemFileTouch)
      .innerJoin(workitem, sql`${workitem.id} = ${workitemFileTouch.workitemId}`)
      .where(
        sql`${workitemFileTouch.repoId} = ${r.id}
          and ${inArray(workitemFileTouch.path, input.paths)}
          and ${workitemFileTouch.workitemId} <> ${input.workitemId}
          and ${workitemFileTouch.releasedAt} is null`,
      );

    return { repoId: r.id, overlaps };
  });
}

export async function releaseTouches(clientId: string, workitemId: string) {
  return withTenant(clientId, (tx) =>
    tx
      .update(workitemFileTouch)
      .set({ releasedAt: new Date() })
      .where(sql`${workitemFileTouch.workitemId} = ${workitemId} and ${workitemFileTouch.releasedAt} is null`),
  );
}

/** repo contention view: path → the active WorkItems touching it. */
export async function contentionFor(clientId: string, repoName: string) {
  return withTenant(clientId, async (tx) => {
    const [r] = await tx.select({ id: repo.id }).from(repo).where(sql`${repo.name} = ${repoName}`).limit(1);
    if (!r) throw new Error(`repo ${repoName} not found`);

    const rows = await tx
      .select({
        path: workitemFileTouch.path,
        workitemId: workitemFileTouch.workitemId,
        key: workitem.key,
        title: workitem.title,
        branch: workitemFileTouch.branch,
        kind: workitemFileTouch.kind,
      })
      .from(workitemFileTouch)
      .innerJoin(workitem, sql`${workitem.id} = ${workitemFileTouch.workitemId}`)
      .where(sql`${workitemFileTouch.repoId} = ${r.id} and ${workitemFileTouch.releasedAt} is null`)
      .orderBy(workitemFileTouch.path);

    const byPath = new Map<string, typeof rows>();
    for (const row of rows) (byPath.get(row.path) ?? byPath.set(row.path, []).get(row.path)!).push(row);

    return [...byPath.entries()].map(([path, items]) => ({
      path,
      contended: items.length > 1,
      workitems: items.map((i) => ({ id: i.workitemId, key: i.key, title: i.title, branch: i.branch, kind: i.kind })),
    }));
  });
}

export async function recordReview(input: {
  clientId: string;
  workitemId: string;
  by: { userId: string };
  prRef?: string;
  verdict: "pass" | "changes_requested";
  findings: { file: string; line?: number; severity: "info" | "warn" | "block"; note: string }[];
  overlapFocus?: string[];
}) {
  return withTenant(input.clientId, async (tx) => {
    const [row] = await tx
      .insert(review)
      .values({
        clientId: input.clientId,
        workitemId: input.workitemId,
        prRef: input.prRef ?? null,
        verdict: input.verdict,
        findings: input.findings,
        overlapFocus: input.overlapFocus ?? [],
        byUserId: input.by.userId,
      })
      .returning();

    const blocks = input.findings.filter((f) => f.severity === "block").length;
    await appendEvent({
      clientId: input.clientId,
      workitemId: input.workitemId,
      source: "claude_session",
      type: "review.completed",
      actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "agent:reviewer" },
      links: [
        { rel: "task", ref: row!.id },
        ...(input.prRef ? [{ rel: "pull_request" as const, ref: input.prRef }] : []),
      ],
      payload: {
        verdict: input.verdict,
        findingCount: input.findings.length,
        blockingCount: blocks,
        overlapFocus: input.overlapFocus ?? [],
      },
    });

    await regenerateBrief(input.clientId, input.workitemId);
    return row!;
  });
}
