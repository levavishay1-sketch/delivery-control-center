import { describe, expect, it } from "vitest";
import { POST } from "./route";
import { LOCALE_COOKIE } from "@/lib/i18n/server";

function request(body: unknown) {
  return new Request("http://localhost/api/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/locale", () => {
  it("rejects a value outside Locale", async () => {
    const res = await POST(request({ locale: "fr" }));
    expect(res.status).toBe(400);
  });

  it("rejects a missing locale field", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(400);
  });

  it("sets the cookie for a valid locale", async () => {
    const res = await POST(request({ locale: "he" }));
    expect(res.status).toBe(200);
    const cookie = res.cookies.get(LOCALE_COOKIE);
    expect(cookie?.value).toBe("he");
  });
});
