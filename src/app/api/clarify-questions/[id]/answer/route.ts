import { NextResponse } from "next/server";
import { z } from "zod";
import { answerClarifyQuestion } from "@/domain/clarify/commands";
import { requireAuthContext } from "@/domain/shared/session";
import { DomainError } from "@/domain/shared/errors";

const bodySchema = z.object({ answer: z.string().min(1) });

export async function POST(request: Request, routeCtx: RouteContext<"/api/clarify-questions/[id]/answer">) {
  const { id } = await routeCtx.params;

  try {
    const ctx = await requireAuthContext();
    const { answer } = bodySchema.parse(await request.json());
    const result = await answerClarifyQuestion(ctx, id, answer);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
