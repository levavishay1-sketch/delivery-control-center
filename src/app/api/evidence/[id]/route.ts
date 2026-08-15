import { NextResponse } from "next/server";
import { unlinkEvidence } from "@/domain/evidence/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Unlinks a pull request from a work item. WRITE_ROLES-gated inside unlinkEvidence. */
export async function DELETE(_req: Request, routeCtx: RouteContext<"/api/evidence/[id]">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    await unlinkEvidence(ctx, id);
    return NextResponse.json({ unlinked: true });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
