import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export async function GET() {
  const projects = await db.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { workItems: true } } },
  });
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

  const project = await db.project.create({
    data: {
      name,
      key,
      integrationType: integrationType ?? "MANUAL",
      integrationConfig: integrationConfig as Prisma.InputJsonValue | undefined,
    },
  });

  return NextResponse.json(project, { status: 201 });
}
