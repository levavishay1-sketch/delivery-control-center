import { NextResponse } from "next/server";
import { configureConnector } from "@/domain/connector/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Configures a project's connector (type + connection config). WRITE_ROLES-gated inside configureConnector. */
export async function POST(request: Request, routeCtx: RouteContext<"/api/projects/[id]/connector">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const body = await request.json();
    const connector = await configureConnector(ctx, id, body);
    return NextResponse.json({ id: connector.id, type: connector.type, status: connector.status });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
