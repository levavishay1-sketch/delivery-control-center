import { NextResponse } from "next/server";
import { draftConstitution } from "@/domain/constitution/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function POST(_req: Request, routeCtx: RouteContext<"/api/projects/[id]/constitution/draft">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const constitution = await draftConstitution(ctx, id);
    return NextResponse.json(constitution);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
