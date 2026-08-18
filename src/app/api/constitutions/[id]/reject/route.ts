import { NextResponse } from "next/server";
import { rejectConstitution } from "@/domain/constitution/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function POST(request: Request, routeCtx: RouteContext<"/api/constitutions/[id]/reject">) {
  const { id } = await routeCtx.params;
  const body = await request.json().catch(() => ({}));
  const { comment } = body as { comment?: string };

  try {
    const ctx = await requireAuthContext();
    const constitution = await rejectConstitution(ctx, id, comment);
    return NextResponse.json(constitution);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
