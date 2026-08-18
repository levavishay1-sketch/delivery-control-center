import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { updateRequirement } from "@/domain/requirement/commands";
import { getRequirementById } from "@/domain/requirement/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function GET(_req: Request, routeCtx: RouteContext<"/api/requirements/[id]">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const requirement = await getRequirementById(ctx, id);
    return NextResponse.json(requirement);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/** Updates a Requirement's type/title/description. Refused once it has left OPEN status. */
export async function PATCH(request: Request, routeCtx: RouteContext<"/api/requirements/[id]">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const body = await request.json();
    const requirement = await updateRequirement(ctx, id, body);
    return NextResponse.json(requirement);
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
