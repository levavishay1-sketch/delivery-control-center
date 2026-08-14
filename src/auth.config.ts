import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe subset of the auth config: no providers, no Prisma/Node
 * imports. Middleware runs on the Edge runtime, which can't load our
 * Prisma client (@prisma/adapter-pg uses the Node-only `pg` driver) — so
 * middleware.ts builds its own NextAuth instance from just this config,
 * while src/auth.ts (Node runtime — API routes, Server Components) adds
 * the real Credentials provider on top of it.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.isOrgAdmin = (user as { isOrgAdmin?: boolean }).isOrgAdmin ?? false;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.isOrgAdmin = token.isOrgAdmin as boolean;
      }
      return session;
    },
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
