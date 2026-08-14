import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { updateBlocker } from "@/domain/blocker/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function PATCH(request: Request, context: RouteContext<"/api/blockers/[id]">) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const body = await request.json();
    const blocker = await updateBlocker(ctx, id, body);
    return NextResponse.json({ blocker }, { status: 200 });
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
