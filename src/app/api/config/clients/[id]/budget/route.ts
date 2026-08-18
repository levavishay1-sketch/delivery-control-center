import { NextResponse } from "next/server";
import { setBudget } from "@/domain/config/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Sets or clears (null) a client's AI budget. WRITE_ROLES-gated inside setBudget. Body: { budgetUsd: number | null }. */
export async function POST(request: Request, routeCtx: RouteContext<"/api/config/clients/[id]/budget">) {
  const { id } = await routeCtx.params;
  const body = await request.json();

  try {
    const ctx = await requireAuthContext();
    const change = await setBudget(ctx, "CLIENT", id, body.budgetUsd ?? null);
    return NextResponse.json({ id: change.id, newValueUsd: change.newValueUsd?.toString() ?? null });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
