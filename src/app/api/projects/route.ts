import { NextResponse } from "next/server";
import { listProjectsWithCounts } from "@/domain/project/queries";
import { createProject } from "@/domain/project/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

export async function GET() {
  try {
    const ctx = await requireAuthContext();
    const projects = await listProjectsWithCounts(ctx);
    return NextResponse.json(projects);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const body = await request.json();
    const { clientId, name, key, integrationType, integrationConfig } = body as {
      clientId: string;
      name: string;
      key: string;
      integrationType?: "MANUAL" | "JIRA" | "AZURE_DEVOPS";
      integrationConfig?: Record<string, unknown>;
    };

    if (!clientId || !name || !key) {
      return NextResponse.json({ error: "clientId, name and key are required" }, { status: 400 });
    }

    const project = await createProject(ctx, { clientId, name, key, integrationType, integrationConfig });
    return NextResponse.json(project, { status: 201 });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
