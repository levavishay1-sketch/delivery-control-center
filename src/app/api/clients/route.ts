import { NextResponse } from "next/server";
import { listClients } from "@/domain/client/queries";
import { createClient } from "@/domain/client/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function GET() {
  try {
    const ctx = await requireAuthContext();
    const clients = await listClients(ctx);
    return NextResponse.json(clients);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/** Creates a Client. Org-admin gated inside createClient. */
export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const body = await request.json();
    const { organizationId, name, slug } = body as { organizationId: string; name: string; slug: string };

    if (!organizationId || !name || !slug) {
      return NextResponse.json({ error: "organizationId, name and slug are required" }, { status: 400 });
    }

    const client = await createClient(ctx, { organizationId, name, slug });
    return NextResponse.json(client, { status: 201 });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
