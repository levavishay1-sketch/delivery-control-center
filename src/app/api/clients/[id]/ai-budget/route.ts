import { NextResponse } from "next/server";
import { setClientAiBudget } from "@/domain/client/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Sets or clears (body: { budgetUsd: number | null }) a client's AI spending limit. WRITE_ROLES-gated inside setClientAiBudget. */
export async function POST(request: Request, routeCtx: RouteContext<"/api/clients/[id]/ai-budget">) {
  const { id } = await routeCtx.params;
  const body = await request.json().catch(() => ({}));
  const { budgetUsd } = body as { budgetUsd?: number | null };

  try {
    const ctx = await requireAuthContext();
    const client = await setClientAiBudget(ctx, id, budgetUsd ?? null);
    return NextResponse.json({ clientId: client.id, aiBudgetUsd: client.aiBudgetUsd?.toString() ?? null });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
