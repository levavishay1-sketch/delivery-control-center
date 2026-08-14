import { NextResponse } from "next/server";
import { listProjectsWithCounts } from "@/domain/project/queries";
import { createProject } from "@/domain/project/commands";

export async function GET() {
  const projects = await listProjectsWithCounts();
  return NextResponse.json(projects);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { name, key, integrationType, integrationConfig } = body as {
    name: string;
    key: string;
    integrationType?: "MANUAL" | "JIRA" | "AZURE_DEVOPS";
    integrationConfig?: Record<string, unknown>;
  };

  if (!name || !key) {
    return NextResponse.json({ error: "name and key are required" }, { status: 400 });
  }

  const project = await createProject({ name, key, integrationType, integrationConfig });
  return NextResponse.json(project, { status: 201 });
}
