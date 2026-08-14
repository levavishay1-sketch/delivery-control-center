import type { Role } from "@/generated/prisma/client";

export interface AuthContext {
  userId: string;
  /** Display name for audit trails/approvals — the user's name if set, otherwise their email. */
  displayName: string;
  isOrgAdmin: boolean;
  memberships: { clientId: string; role: Role }[];
}
