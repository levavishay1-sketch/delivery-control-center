import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { addDependency } from "@/domain/dependency/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const body = await request.json();
    const dependency = await addDependency(ctx, body);
    return NextResponse.json({ dependency }, { status: 201 });
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
