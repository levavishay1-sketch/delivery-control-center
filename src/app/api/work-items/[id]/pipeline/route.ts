import { NextResponse } from "next/server";
import { startPipeline } from "@/domain/pipeline/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function POST(_req: Request, routeCtx: RouteContext<"/api/work-items/[id]/pipeline">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const pipeline = await startPipeline(ctx, id);
    return NextResponse.json(pipeline, { status: 201 });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
