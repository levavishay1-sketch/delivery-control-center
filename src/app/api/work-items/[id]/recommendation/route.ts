import { NextResponse } from "next/server";
import { recommendExecutor } from "@/domain/recommendation/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** An AI-vs-developer executor recommendation for a WorkItem (Slice 17). Read-only — ALL_ROLES-gated inside recommendExecutor. */
export async function GET(request: Request, routeCtx: RouteContext<"/api/work-items/[id]/recommendation">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const recommendation = await recommendExecutor(ctx, id);
    return NextResponse.json(recommendation);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
