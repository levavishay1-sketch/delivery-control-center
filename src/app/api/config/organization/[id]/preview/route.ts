import { NextResponse } from "next/server";
import { previewBudgetImpact } from "@/domain/config/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { requireOrgAdmin } from "@/domain/shared/authz";
import { DomainError } from "@/domain/shared/errors";

/** Previews how many clients/projects would see their effective AI budget change if this organization's budget were changed. Org-admin-gated. */
export async function POST(_req: Request, routeCtx: RouteContext<"/api/config/organization/[id]/preview">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    requireOrgAdmin(ctx);
    const preview = await previewBudgetImpact("ORGANIZATION", id);
    return NextResponse.json(preview);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
