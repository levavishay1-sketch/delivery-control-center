import { db } from "@/lib/db";
import type { AuthContext } from "@/domain/shared/context";

const RESULT_LIMIT = 8;

/** clientIds ctx can access — undefined (no filter) for org admins. Same pattern as src/domain/attention/queries.ts. */
function accessibleClientIds(ctx: AuthContext): string[] | undefined {
  return ctx.isOrgAdmin ? undefined : ctx.memberships.map((m) => m.clientId);
}

/**
 * Bounded case-insensitive `contains` search across work items and projects
 * the requesting user can access — no full-text search infrastructure, no
 * search index, per design.md's Non-Goals. Feeds the command palette
 * (Ctrl+K).
 */
export async function searchAccessible(ctx: AuthContext, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return { workItems: [], projects: [] };

  const clientIds = accessibleClientIds(ctx);
  const projectScope = clientIds ? { clientId: { in: clientIds } } : undefined;

  const [workItems, projects] = await Promise.all([
    db.workItem.findMany({
      where: {
        title: { contains: trimmed, mode: "insensitive" },
        project: projectScope,
      },
      take: RESULT_LIMIT,
      select: { id: true, title: true, type: true, status: true, project: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.project.findMany({
      where: {
        OR: [{ name: { contains: trimmed, mode: "insensitive" } }, { key: { contains: trimmed, mode: "insensitive" } }],
        ...projectScope,
      },
      take: RESULT_LIMIT,
      select: { id: true, name: true, key: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return { workItems, projects };
}
