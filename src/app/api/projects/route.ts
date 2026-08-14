import { NextResponse } from "next/server";
import { listProjectsWithCounts } from "@/domain/project/queries";
import { createProject } from "@/domain/project/commands";

export async function GET() {
  const projects = await listProjectsWithCounts();
  return NextResponse.json(projects);
}

export async function POST(request: Request) {
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

  const project = await createProject({ clientId, name, key, integrationType, integrationConfig });
  return NextResponse.json(project, { status: 201 });
}
