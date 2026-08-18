import { NextResponse } from "next/server";
import { previewBudgetImpact } from "@/domain/config/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import { DomainError } from "@/domain/shared/errors";

/** Previews how many of this client's projects would see their effective AI budget change if the client's budget were changed. WRITE_ROLES-gated. */
export async function POST(_req: Request, routeCtx: RouteContext<"/api/config/clients/[id]/preview">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    requireClientRole(ctx, id, WRITE_ROLES);
    const preview = await previewBudgetImpact("CLIENT", id);
    return NextResponse.json(preview);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
