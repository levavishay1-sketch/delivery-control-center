import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createRequirement } from "@/domain/requirement/commands";
import { listRequirementsForClient } from "@/domain/requirement/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** A client's Requirements. Requires ?clientId=. */
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    const ctx = await requireAuthContext();
    const requirements = await listRequirementsForClient(ctx, clientId);
    return NextResponse.json(requirements);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/** Creates a Requirement — standalone, or linked to one of the client's existing Projects. */
export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const body = await request.json();
    const requirement = await createRequirement(ctx, body);
    return NextResponse.json(requirement, { status: 201 });
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
