import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { updateWorkItemStatus } from "@/domain/work-item/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function PATCH(request: Request, routeCtx: RouteContext<"/api/work-items/[id]/status">) {
  const { id } = await routeCtx.params;
  const body = await request.json();
  const { status, reason } = body as { status?: string; reason?: string };

  if (!status) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }

  try {
    const ctx = await requireAuthContext();
    const workItem = await updateWorkItemStatus(ctx, id, status, reason);
    return NextResponse.json(workItem);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid status", details: err.issues }, { status: 400 });
    }
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
