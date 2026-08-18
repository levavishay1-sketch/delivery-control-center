import { NextResponse } from "next/server";
import { removeDependency } from "@/domain/dependency/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const dependency = await removeDependency(ctx, id);
    return NextResponse.json({ dependency }, { status: 200 });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
