import { NextResponse } from "next/server";
import { approveCompletionException } from "@/domain/evidence/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Approves a completion exception for a work item. Body: { reason }. WRITE_ROLES-gated inside approveCompletionException. */
export async function POST(request: Request, routeCtx: RouteContext<"/api/work-items/[id]/completion-exception">) {
  const { id } = await routeCtx.params;
  const body = await request.json();
  const { reason } = body as { reason?: string };

  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  try {
    const ctx = await requireAuthContext();
    const exception = await approveCompletionException(ctx, id, reason);
    return NextResponse.json({ id: exception.id });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
