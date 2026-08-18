import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { updateWorkItem } from "@/domain/work-item/commands";
import { getWorkItem } from "@/domain/work-item/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function GET(_request: Request, routeCtx: RouteContext<"/api/work-items/[id]">) {
  const { id } = await routeCtx.params;
  try {
    const ctx = await requireAuthContext();
    const workItem = await getWorkItem(ctx, id);
    if (!workItem) return NextResponse.json({ error: "Work item not found" }, { status: 404 });
    return NextResponse.json(workItem);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function PATCH(request: Request, routeCtx: RouteContext<"/api/work-items/[id]">) {
  const { id } = await routeCtx.params;
  const body = await request.json();

  try {
    const ctx = await requireAuthContext();
    const workItem = await updateWorkItem(ctx, id, body);
    return NextResponse.json(workItem);
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
