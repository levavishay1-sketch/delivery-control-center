import { NextResponse } from "next/server";
import { getEffectiveBudget, listConfigHistory } from "@/domain/config/queries";
import { getProjectByIdForUser } from "@/domain/project/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError, NotFoundError } from "@/domain/shared/errors";

/** A project's effective AI budget and change history. Readable by anyone with read access to the project's client. */
export async function GET(_req: Request, routeCtx: RouteContext<"/api/config/projects/[id]">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const project = await getProjectByIdForUser(ctx, id);
    if (!project) throw new NotFoundError("Project not found");
    const [effective, history] = await Promise.all([getEffectiveBudget("PROJECT", id), listConfigHistory("PROJECT", id)]);
    return NextResponse.json({
      effective,
      history: history.map((h) => ({
        id: h.id,
        oldValueUsd: h.oldValueUsd?.toString() ?? null,
        newValueUsd: h.newValueUsd?.toString() ?? null,
        changedByUser: { name: h.changedByUser.name, email: h.changedByUser.email },
        createdAt: h.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
