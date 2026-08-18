import { NextResponse } from "next/server";
import { runRepositoryDiscovery } from "@/domain/repository-discovery/commands";
import { listRepositoryDiscoveries } from "@/domain/repository-discovery/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { BudgetExceededError, DomainError } from "@/domain/shared/errors";

export async function POST(_req: Request, routeCtx: RouteContext<"/api/repositories/[id]/discovery">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const discovery = await runRepositoryDiscovery(ctx, id);
    return NextResponse.json(discovery);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json(
        { error: err.message, budgetExceeded: { scope: err.scope, clientId: err.clientId, projectId: err.projectId, organizationId: err.organizationId } },
        { status: err.status }
      );
    }
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function GET(_req: Request, routeCtx: RouteContext<"/api/repositories/[id]/discovery">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const discoveries = await listRepositoryDiscoveries(ctx, id);
    return NextResponse.json(discoveries);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
