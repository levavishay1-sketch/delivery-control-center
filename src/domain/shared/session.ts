import { auth } from "@/auth";
import { db } from "@/lib/db";
import { UnauthorizedError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";

/** Builds an AuthContext from the current Auth.js session. Throws UnauthorizedError if there is none. */
export async function requireAuthContext(): Promise<AuthContext> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError("Authentication required.");
  }

  const memberships = await db.clientMembership.findMany({
    where: { userId: session.user.id },
    select: { clientId: true, role: true },
  });

  return { userId: session.user.id, isOrgAdmin: session.user.isOrgAdmin, memberships };
}
