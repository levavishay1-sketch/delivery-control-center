import { NextResponse } from "next/server";
import { reactivateClient } from "@/domain/client/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Reactivates a previously deactivated client. Org-admin gated inside reactivateClient. */
export async function POST(_req: Request, routeCtx: RouteContext<"/api/clients/[id]/reactivate">) {
  const { id } = await routeCtx.params;
  try {
    const ctx = await requireAuthContext();
    const client = await reactivateClient(ctx, id);
    return NextResponse.json(client);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
