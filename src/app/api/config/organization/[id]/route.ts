import { NextResponse } from "next/server";
import { getEffectiveBudget, listConfigHistory } from "@/domain/config/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { requireOrgAdmin } from "@/domain/shared/authz";
import { DomainError } from "@/domain/shared/errors";

/** An organization's effective AI budget and change history. Org-admin-gated — Organizations have no other read-access concept in this app yet. */
export async function GET(_req: Request, routeCtx: RouteContext<"/api/config/organization/[id]">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    requireOrgAdmin(ctx);
    const [effective, history] = await Promise.all([getEffectiveBudget("ORGANIZATION", id), listConfigHistory("ORGANIZATION", id)]);
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
