import { NextResponse } from "next/server";
import { updateClient } from "@/domain/client/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Updates a client's name and/or slug. Org-admin gated inside updateClient. */
export async function PATCH(request: Request, routeCtx: RouteContext<"/api/clients/[id]">) {
  const { id } = await routeCtx.params;
  try {
    const ctx = await requireAuthContext();
    const body = await request.json();
    const { name, slug } = body as { name?: string; slug?: string };
    const client = await updateClient(ctx, id, { name, slug });
    return NextResponse.json(client);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
