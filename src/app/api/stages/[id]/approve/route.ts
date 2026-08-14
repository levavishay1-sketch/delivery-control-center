import { NextResponse } from "next/server";
import { approveStage } from "@/domain/pipeline/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function POST(request: Request, routeCtx: RouteContext<"/api/stages/[id]/approve">) {
  const { id } = await routeCtx.params;
  const body = await request.json().catch(() => ({}));
  const { comment } = body as { comment?: string };

  try {
    const ctx = await requireAuthContext();
    const pipeline = await approveStage(ctx, id, comment);
    return NextResponse.json(pipeline);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
