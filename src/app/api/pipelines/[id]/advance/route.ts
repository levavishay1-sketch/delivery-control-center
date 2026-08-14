import { NextResponse } from "next/server";
import { getDraftableCurrentStage } from "@/domain/pipeline/queries";
import { draftStage } from "@/domain/pipeline/commands";

/** Runs the AI executor against the pipeline's current stage. */
export async function POST(_req: Request, ctx: RouteContext<"/api/pipelines/[id]/advance">) {
  const { id } = await ctx.params;
  const { pipeline, stage } = await getDraftableCurrentStage(id);

  if (!pipeline) {
    return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
  }

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
