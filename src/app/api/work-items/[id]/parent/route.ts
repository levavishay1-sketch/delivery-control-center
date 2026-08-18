import { NextResponse } from "next/server";
import { addParentWorkItem } from "@/domain/work-item/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function PATCH(request: Request, routeCtx: RouteContext<"/api/work-items/[id]/parent">) {
  const { id } = await routeCtx.params;
  const body = await request.json();
  const { parentId } = body as { parentId?: string };

  if (!parentId) {
    return NextResponse.json({ error: "parentId is required" }, { status: 400 });
  }

  try {
    const ctx = await requireAuthContext();
    const workItem = await addParentWorkItem(ctx, id, parentId);
    return NextResponse.json(workItem);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
