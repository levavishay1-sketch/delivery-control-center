import { NextResponse } from "next/server";
import { approveStage } from "@/domain/pipeline/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function POST(request: Request, routeCtx: RouteContext<"/api/stages/[id]/approve">) {
  const { id } = await routeCtx.params;
  const body = await request.json().catch(() => ({}));
  const { approverName, comment } = body as { approverName?: string; comment?: string };

  if (!approverName) {
    return NextResponse.json({ error: "approverName is required" }, { status: 400 });
  }

  try {
    const ctx = await requireAuthContext();
    const pipeline = await approveStage(ctx, id, approverName, comment);
    return NextResponse.json(pipeline);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
