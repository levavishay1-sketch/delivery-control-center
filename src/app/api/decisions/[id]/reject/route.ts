import { NextResponse } from "next/server";
import { rejectDecision } from "@/domain/decision/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const body = await request.json();
    const reason = body.reason as string | undefined;
    const decision = await rejectDecision(ctx, id, reason);
    return NextResponse.json({ decision }, { status: 200 });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
