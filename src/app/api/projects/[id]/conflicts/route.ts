import { NextResponse } from "next/server";
import { listOpenConflicts } from "@/domain/connector/conflicts";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Every unresolved sync conflict for this project's work items — read-only, any client role (listOpenConflicts is ALL_ROLES-gated). */
export async function GET(_request: Request, routeCtx: RouteContext<"/api/projects/[id]/conflicts">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const conflicts = await listOpenConflicts(ctx, id);
    return NextResponse.json({ conflicts });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
