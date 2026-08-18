import { NextResponse } from "next/server";
import { declineRequirement } from "@/domain/requirement/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Declines an open Requirement. Refused once it has left OPEN status. */
export async function POST(_req: Request, routeCtx: RouteContext<"/api/requirements/[id]/decline">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const requirement = await declineRequirement(ctx, id);
    return NextResponse.json(requirement);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
