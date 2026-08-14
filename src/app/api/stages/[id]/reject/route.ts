import { NextResponse } from "next/server";
import { rejectStage } from "@/lib/pipeline";

export async function POST(request: Request, ctx: RouteContext<"/api/stages/[id]/reject">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const { approverName, comment } = body as { approverName?: string; comment?: string };

  if (!approverName) {
    return NextResponse.json({ error: "approverName is required" }, { status: 400 });
  }

  try {
    const stage = await rejectStage(id, approverName, comment);
    return NextResponse.json(stage);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
