import { sql } from "drizzle-orm";
import { withTenant } from "@dcc/db";
import { workitem } from "@dcc/db/schema";

/** `feature/WI-1284-tiered-discount` → `WI-1284`. Also bare `WI-1284`. */
export function keyFromBranch(branch: string): string | null {
  const m = branch.match(/(?:^|\/)([A-Z]{2,5}-\d+)(?:-|$)/);
  return m?.[1] ?? null;
}

export type ResolvedWorkItem = {
  id: string;
  key: string | null;
  clientId: string;
  parentId: string | null;
  title: string;
};

/**
 * Resolve the WorkItem a Claude Code session / git action belongs to.
 * Phase 0: from the branch name via the `WI-nnnn` convention. Returns
 * null when nothing matches — the caller then routes the event to the
 * unassigned bucket, never guesses.
 */
export async function resolveWorkItem(input: {
  clientId: string;
  branch?: string | undefined;
  key?: string | undefined;
}): Promise<ResolvedWorkItem | null> {
  const key = input.key ?? (input.branch ? keyFromBranch(input.branch) : null);
  if (!key) return null;

  const rows = await withTenant(input.clientId, (tx) =>
    tx
      .select({
        id: workitem.id,
        key: workitem.key,
        clientId: workitem.clientId,
        parentId: workitem.parentId,
        title: workitem.title,
      })
      .from(workitem)
      .where(sql`${workitem.key} = ${key}`)
      .limit(1),
  );
  return rows[0] ?? null;
}
