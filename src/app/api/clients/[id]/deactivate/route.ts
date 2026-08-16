import { NextResponse } from "next/server";
import { deactivateClient } from "@/domain/client/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Deactivates a client without deleting its data. Org-admin gated inside deactivateClient. */
export async function POST(_req: Request, routeCtx: RouteContext<"/api/clients/[id]/deactivate">) {
  const { id } = await routeCtx.params;
  try {
    const ctx = await requireAuthContext();
    const client = await deactivateClient(ctx, id);
    return NextResponse.json(client);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
