import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { previewAssignmentCascade } from "@/domain/project/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Previews a proposed Project default-executor change (body: { executorType, executorId? }) — no writes. WRITE_ROLES-gated inside previewAssignmentCascade. */
export async function POST(request: Request, routeCtx: RouteContext<"/api/projects/[id]/default-executor/preview">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const body = await request.json();
    const preview = await previewAssignmentCascade(ctx, id, body);
    return NextResponse.json(preview);
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
