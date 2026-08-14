import { NextResponse } from "next/server";
import { getDraftableCurrentStage } from "@/domain/pipeline/queries";
import { draftStage } from "@/domain/pipeline/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Runs the AI executor against the pipeline's current stage. */
export async function POST(_req: Request, routeCtx: RouteContext<"/api/pipelines/[id]/advance">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const { pipeline, stage } = await getDraftableCurrentStage(ctx, id);

    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    if (!stage) {
      return NextResponse.json(
        { error: `Current stage ${pipeline.currentStage} is not in a draftable state.` },
        { status: 409 }
      );
    }

    const updated = await draftStage(ctx, stage.id);
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
