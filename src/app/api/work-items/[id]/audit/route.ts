import { NextResponse } from "next/server";
import { getWorkItemAuditEvents } from "@/domain/audit/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function GET(request: Request, routeCtx: RouteContext<"/api/work-items/[id]/audit">) {
  const { id } = await routeCtx.params;
  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get("page") ?? "1") || 1;

  try {
    const ctx = await requireAuthContext();
    const result = await getWorkItemAuditEvents(ctx, id, page, 20);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
