import { NextResponse } from "next/server";
import { listClients } from "@/domain/client/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function GET() {
  try {
    const ctx = await requireAuthContext();
    const clients = await listClients(ctx);
    return NextResponse.json(clients);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
