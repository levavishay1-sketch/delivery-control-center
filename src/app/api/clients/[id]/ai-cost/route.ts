import { NextResponse } from "next/server";
import { getClientAiCost } from "@/domain/agent/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";
import { DomainError } from "@/domain/shared/errors";

/** Total AI drafting cost across every project under this client — read-only, any client role. */
export async function GET(request: Request, routeCtx: RouteContext<"/api/clients/[id]/ai-cost">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    requireClientRole(ctx, id, ALL_ROLES);
    const aiCost = await getClientAiCost(id);
    return NextResponse.json({ clientId: id, aiCost: aiCost.toString() });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
