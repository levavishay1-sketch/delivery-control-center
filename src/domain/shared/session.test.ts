import { describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "./errors";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { clientMembership: { findMany: vi.fn().mockResolvedValue([{ clientId: "client-a", role: "TECH_LEAD" }]) } },
}));

describe("requireAuthContext", () => {
  it("rejects an unauthenticated request (no session)", async () => {
    const { auth } = await import("@/auth");
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { requireAuthContext } = await import("./session");

    await expect(requireAuthContext()).rejects.toThrow(UnauthorizedError);
  });

  it("builds an AuthContext with memberships for a logged-in user", async () => {
    const { auth } = await import("@/auth");
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", name: "Test User", isOrgAdmin: false },
    });
    const { requireAuthContext } = await import("./session");

    const ctx = await requireAuthContext();
    expect(ctx).toEqual({
      userId: "user-1",
      displayName: "Test User",
      isOrgAdmin: false,
      memberships: [{ clientId: "client-a", role: "TECH_LEAD" }],
    });
  });
});
