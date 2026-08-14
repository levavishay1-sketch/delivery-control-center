import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      isOrgAdmin: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    isOrgAdmin?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    isOrgAdmin?: boolean;
  }
}
