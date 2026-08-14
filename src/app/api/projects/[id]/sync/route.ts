import { NextResponse } from "next/server";
import { syncProjectWorkItems } from "@/domain/work-item/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function POST(_req: Request, routeCtx: RouteContext<"/api/projects/[id]/sync">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const result = await syncProjectWorkItems(ctx, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
