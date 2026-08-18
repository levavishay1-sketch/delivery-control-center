import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { applyAssignmentCascade } from "@/domain/project/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Applies a Project default-executor change and cascades it (body: { executorType, executorId?, option }). WRITE_ROLES-gated inside applyAssignmentCascade. */
export async function POST(request: Request, routeCtx: RouteContext<"/api/projects/[id]/default-executor">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const body = await request.json();
    const { option, ...newExecutor } = body;
    const result = await applyAssignmentCascade(ctx, id, newExecutor, option);
    return NextResponse.json(result);
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
