import { NextResponse } from "next/server";
import { resolveConflict } from "@/domain/connector/conflicts";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Resolves a sync conflict — WRITE_ROLES-gated inside resolveConflict. Body: { resolution: "KEPT_MANUAL" | "ACCEPTED_INCOMING" }. */
export async function POST(request: Request, routeCtx: RouteContext<"/api/conflicts/[id]/resolve">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const body = await request.json();
    const resolved = await resolveConflict(ctx, id, body.resolution);
    return NextResponse.json({ id: resolved.id, resolvedAt: resolved.resolvedAt?.toISOString(), resolution: resolved.resolution });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
