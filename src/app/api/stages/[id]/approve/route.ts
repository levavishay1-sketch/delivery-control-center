import { NextResponse } from "next/server";
import { approveStage } from "@/domain/pipeline/commands";

export async function POST(request: Request, ctx: RouteContext<"/api/stages/[id]/approve">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const { approverName, comment } = body as { approverName?: string; comment?: string };

  if (!approverName) {
    return NextResponse.json({ error: "approverName is required" }, { status: 400 });
  }

  try {
    const pipeline = await approveStage(id, approverName, comment);
    return NextResponse.json(pipeline);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
