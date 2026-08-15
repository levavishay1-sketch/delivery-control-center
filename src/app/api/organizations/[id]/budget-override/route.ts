import { NextResponse } from "next/server";
import { approveBudgetOverride } from "@/domain/agent/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

/** Approves a single-use grant to draft past this organization's exceeded AI budget. Org-admin-gated inside approveBudgetOverride. */
export async function POST(_request: Request, routeCtx: RouteContext<"/api/organizations/[id]/budget-override">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const override = await approveBudgetOverride(ctx, { organizationId: id });
    return NextResponse.json({ id: override.id, organizationId: override.organizationId, approvedAt: override.approvedAt.toISOString() });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
