import { NextResponse } from "next/server";
import { requireAuthContext } from "@/domain/shared/session";
import { searchAccessible } from "@/domain/search/queries";
import { DomainError } from "@/domain/shared/errors";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const results = await searchAccessible(ctx, query);
    return NextResponse.json(results);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
