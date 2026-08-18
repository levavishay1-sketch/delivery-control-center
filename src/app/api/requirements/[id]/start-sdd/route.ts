import { NextResponse } from "next/server";
import { startSddForRequirement } from "@/domain/requirement/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/**
 * Explicit SDD Activation: materializes a Project (if the Requirement is standalone) and a root
 * WorkItem, then moves the Requirement to SDD_ACTIVE. Does not start the WorkItem's Pipeline —
 * that stays the existing, separate, Constitution-gated action on the created WorkItem.
 */
export async function POST(_req: Request, routeCtx: RouteContext<"/api/requirements/[id]/start-sdd">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const requirement = await startSddForRequirement(ctx, id);
    return NextResponse.json(requirement);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
