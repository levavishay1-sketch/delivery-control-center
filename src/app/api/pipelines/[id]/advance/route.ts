import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { draftStage } from "@/lib/pipeline";

/** Runs the AI executor against the pipeline's current stage. */
export async function POST(_req: Request, ctx: RouteContext<"/api/pipelines/[id]/advance">) {
  const { id } = await ctx.params;
  const pipeline = await db.pipeline.findUnique({
    where: { id },
    include: { stages: { where: { status: { in: ["PENDING", "REJECTED"] } } } },
  });

  if (!pipeline) {
    return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
  }

  const stage = pipeline.stages.find((s) => s.type === pipeline.currentStage);
  if (!stage) {
    return NextResponse.json(
      { error: `Current stage ${pipeline.currentStage} is not in a draftable state.` },
      { status: 409 }
    );
  }

  try {
    const updated = await draftStage(stage.id);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
