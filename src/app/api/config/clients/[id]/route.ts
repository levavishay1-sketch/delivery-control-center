import { NextResponse } from "next/server";
import { getEffectiveBudget, listConfigHistory } from "@/domain/config/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";
import { DomainError } from "@/domain/shared/errors";

/** A client's effective AI budget and change history. Readable by any member of the client (ALL_ROLES). */
export async function GET(_req: Request, routeCtx: RouteContext<"/api/config/clients/[id]">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    requireClientRole(ctx, id, ALL_ROLES);
    const [effective, history] = await Promise.all([getEffectiveBudget("CLIENT", id), listConfigHistory("CLIENT", id)]);
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
