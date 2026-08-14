import type { Role } from "@/generated/prisma/client";

export interface AuthContext {
  userId: string;
  isOrgAdmin: boolean;
  memberships: { clientId: string; role: Role }[];
}
