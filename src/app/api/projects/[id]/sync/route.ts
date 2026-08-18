import { NextResponse } from "next/server";
import { triggerSyncForProject } from "@/domain/connector/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function POST(_req: Request, routeCtx: RouteContext<"/api/projects/[id]/sync">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const job = await triggerSyncForProject(ctx, id);
    return NextResponse.json({ queued: true, jobId: job.id }, { status: 202 });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
