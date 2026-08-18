import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { materializeTaskDrafts } from "@/domain/task-decomposition/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/**
 * Materializes selected task drafts from an approved TASKS stage into real child WorkItems.
 * Refused unless the stage is TASKS and DONE (approved) — see materializeTaskDrafts.
 */
export async function POST(request: Request, routeCtx: RouteContext<"/api/stages/[id]/task-drafts/materialize">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const body = await request.json();
    const workItems = await materializeTaskDrafts(ctx, id, body);
    return NextResponse.json(workItems, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
