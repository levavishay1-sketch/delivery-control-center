import { describe, expect, it } from "vitest";
import { requireClientRole, requireOrgAdmin, WRITE_ROLES, ALL_ROLES } from "./authz";
import { ForbiddenError } from "./errors";
import type { AuthContext } from "./context";

const CLIENT_A = "client-a";
const CLIENT_B = "client-b";

function ctxWith(memberships: AuthContext["memberships"], isOrgAdmin = false): AuthContext {
  return { userId: "user-1", displayName: "Test User", isOrgAdmin, memberships };
}

describe("requireClientRole", () => {
  it("allows a user whose role is in the allowed list for that client", () => {
    const ctx = ctxWith([{ clientId: CLIENT_A, role: "TECH_LEAD" }]);
    expect(() => requireClientRole(ctx, CLIENT_A, WRITE_ROLES)).not.toThrow();
  });

  it("rejects a user whose role is not in the allowed list (e.g. VIEWER attempting a write)", () => {
    const ctx = ctxWith([{ clientId: CLIENT_A, role: "VIEWER" }]);
    expect(() => requireClientRole(ctx, CLIENT_A, WRITE_ROLES)).toThrow(ForbiddenError);
  });

  it("rejects a user with no membership on the target client at all", () => {
    const ctx = ctxWith([{ clientId: CLIENT_B, role: "MANAGER" }]);
    expect(() => requireClientRole(ctx, CLIENT_A, ALL_ROLES)).toThrow(ForbiddenError);
  });

  it("does not let a membership on a different client grant access", () => {
    const ctx = ctxWith([{ clientId: CLIENT_A, role: "VIEWER" }]);
    expect(() => requireClientRole(ctx, CLIENT_A, ALL_ROLES)).not.toThrow();
    expect(() => requireClientRole(ctx, CLIENT_B, ALL_ROLES)).toThrow(ForbiddenError);
  });

  it("lets an org admin through regardless of membership", () => {
    const ctx = ctxWith([], true);
    expect(() => requireClientRole(ctx, CLIENT_A, WRITE_ROLES)).not.toThrow();
  });
});

describe("requireOrgAdmin", () => {
  it("allows an org admin", () => {
    expect(() => requireOrgAdmin(ctxWith([], true))).not.toThrow();
  });

  it("rejects a non-admin, even with client memberships", () => {
    const ctx = ctxWith([{ clientId: CLIENT_A, role: "MANAGER" }], false);
    expect(() => requireOrgAdmin(ctx)).toThrow(ForbiddenError);
  });
});
