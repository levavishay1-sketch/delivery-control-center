import { NextResponse } from "next/server";
import { syncProjectWorkItems } from "@/domain/work-item/commands";
import { NotFoundError } from "@/domain/shared/errors";

export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/sync">) {
  const { id } = await ctx.params;

  try {
    const result = await syncProjectWorkItems(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
