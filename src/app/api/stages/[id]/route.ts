import { NextResponse } from "next/server";
import { getStageStatus } from "@/domain/pipeline/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError, NotFoundError } from "@/domain/shared/errors";

/** Lightweight status poll — used by DraftButton while a stage is AI_DRAFTING. */
export async function GET(_req: Request, routeCtx: RouteContext<"/api/stages/[id]">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const stage = await getStageStatus(ctx, id);
    if (!stage) throw new NotFoundError("Stage not found");
    return NextResponse.json({ id: stage.id, status: stage.status });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
