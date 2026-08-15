import { NextResponse } from "next/server";
import { setProjectAiBudget } from "@/domain/project/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Sets or clears (body: { budgetUsd: number | null }) a project's AI spending limit — overrides its client's if set. WRITE_ROLES-gated inside setProjectAiBudget. */
export async function POST(request: Request, routeCtx: RouteContext<"/api/projects/[id]/ai-budget">) {
  const { id } = await routeCtx.params;
  const body = await request.json().catch(() => ({}));
  const { budgetUsd } = body as { budgetUsd?: number | null };

  try {
    const ctx = await requireAuthContext();
    const project = await setProjectAiBudget(ctx, id, budgetUsd ?? null);
    return NextResponse.json({ projectId: project.id, aiBudgetUsd: project.aiBudgetUsd?.toString() ?? null });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
