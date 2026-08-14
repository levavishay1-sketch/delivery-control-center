import { NextResponse } from "next/server";
import { resolveBlocker } from "@/domain/blocker/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function POST(request: Request, context: RouteContext<"/api/blockers/[id]/resolve">) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const blocker = await resolveBlocker(ctx, id);
    return NextResponse.json({ blocker }, { status: 200 });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
