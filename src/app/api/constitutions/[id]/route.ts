import { NextResponse } from "next/server";
import { getConstitutionStatus } from "@/domain/constitution/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError, NotFoundError } from "@/domain/shared/errors";

/** Lightweight status poll — used by ConstitutionDraftButton while a Constitution is AI_DRAFTING. */
export async function GET(_req: Request, routeCtx: RouteContext<"/api/constitutions/[id]">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const constitution = await getConstitutionStatus(ctx, id);
    if (!constitution) throw new NotFoundError("Constitution not found");
    return NextResponse.json({ id: constitution.id, status: constitution.status });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
