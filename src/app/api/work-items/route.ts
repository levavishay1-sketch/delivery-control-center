import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createPipeline } from "@/lib/pipeline";

/** Adds a work item by hand (the "manual" integration path) and starts its pipeline. */
export async function POST(request: Request) {
  const body = await request.json();
  const { projectId, title, description } = body as {
    projectId: string;
    title: string;
    description?: string;
  };

  if (!projectId || !title) {
    return NextResponse.json({ error: "projectId and title are required" }, { status: 400 });
  }

  const workItem = await db.workItem.create({
    data: {
      projectId,
      source: "MANUAL",
      externalId: `manual-${Date.now()}`,
      title,
      description,
      status: "open",
    },
  });

  const pipeline = await createPipeline(workItem.id);

  return NextResponse.json({ workItem, pipeline }, { status: 201 });
}
