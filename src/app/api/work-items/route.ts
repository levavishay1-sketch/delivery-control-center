import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createWorkItem } from "@/domain/work-item/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Adds a work item by hand (the "manual" integration path). Its pipeline is started separately via POST /api/work-items/[id]/pipeline. */
export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const body = await request.json();
    const { workItem } = await createWorkItem(ctx, body);
    return NextResponse.json({ workItem }, { status: 201 });
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
