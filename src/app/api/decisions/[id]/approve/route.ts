import { NextResponse } from "next/server";
import { approveDecision } from "@/domain/decision/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const decision = await approveDecision(ctx, id);
    return NextResponse.json({ decision }, { status: 200 });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
