import { NextResponse } from "next/server";
import { createWorkItem } from "@/domain/work-item/commands";

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

  const { workItem, pipeline } = await createWorkItem({ projectId, title, description });
  return NextResponse.json({ workItem, pipeline }, { status: 201 });
}
