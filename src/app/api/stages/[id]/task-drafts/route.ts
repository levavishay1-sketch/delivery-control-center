import { NextResponse } from "next/server";
import { listTaskDraftsForStage } from "@/domain/task-decomposition/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** A TASKS stage's task drafts. */
export async function GET(_req: Request, routeCtx: RouteContext<"/api/stages/[id]/task-drafts">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const drafts = await listTaskDraftsForStage(ctx, id);
    return NextResponse.json(drafts);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
