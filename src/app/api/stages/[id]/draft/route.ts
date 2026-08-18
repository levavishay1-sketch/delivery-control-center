import { NextResponse } from "next/server";
import { draftStage } from "@/domain/pipeline/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { BudgetExceededError, DomainError } from "@/domain/shared/errors";

/**
 * Runs the AI executor against a specific stage — not necessarily the pipeline's current
 * stage: a stage a Critical Analyze finding names can be redrafted here too (Task Group 7.3).
 */
export async function POST(_req: Request, routeCtx: RouteContext<"/api/stages/[id]/draft">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const updated = await draftStage(ctx, id);
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json(
        { error: err.message, budgetExceeded: { scope: err.scope, clientId: err.clientId, projectId: err.projectId, organizationId: err.organizationId } },
        { status: err.status }
      );
    }
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
