import { NextResponse } from "next/server";
import { recommendModel } from "@/domain/model-snapshot/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** An AI model recommendation for a WorkItem whose executor is AI (Slice 20). Read-only — ALL_ROLES-gated inside recommendModel. */
export async function GET(request: Request, routeCtx: RouteContext<"/api/work-items/[id]/recommendation/model">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const recommendation = await recommendModel(ctx, id);
    return NextResponse.json(recommendation);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
