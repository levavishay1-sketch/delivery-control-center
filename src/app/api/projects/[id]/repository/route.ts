import { NextResponse } from "next/server";
import { linkRepository, unlinkRepository } from "@/domain/evidence/commands";
import { getRepositoryForProject } from "@/domain/evidence/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError, NotFoundError } from "@/domain/shared/errors";

/** Links a project's GitHub repository as its source of engineering evidence. WRITE_ROLES-gated inside linkRepository. */
export async function POST(_req: Request, routeCtx: RouteContext<"/api/projects/[id]/repository">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const repository = await linkRepository(ctx, id);
    return NextResponse.json({ id: repository.id, owner: repository.owner, name: repository.name });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/** Unlinks a project's repository. WRITE_ROLES-gated inside unlinkRepository. */
export async function DELETE(_req: Request, routeCtx: RouteContext<"/api/projects/[id]/repository">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const repository = await getRepositoryForProject(id);
    if (!repository) throw new NotFoundError("Repository not found");
    await unlinkRepository(ctx, repository.id);
    return NextResponse.json({ unlinked: true });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
