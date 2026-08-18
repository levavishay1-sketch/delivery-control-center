import { NextResponse } from "next/server";
import { z } from "zod";
import { isLocale } from "@/lib/i18n/locales";
import { LOCALE_COOKIE } from "@/lib/i18n/server";

const bodySchema = z.object({ locale: z.string() });

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success || !isLocale(parsed.data.locale)) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }
  const res = NextResponse.json({ locale: parsed.data.locale });
  res.cookies.set(LOCALE_COOKIE, parsed.data.locale, {
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
