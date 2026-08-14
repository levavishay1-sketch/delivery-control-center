import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Built from the Edge-safe authConfig only — never import "@/auth" here
// (it pulls in the Credentials provider, which pulls in Prisma, which
// doesn't run on the Edge runtime Proxy uses). Next.js 16 renamed
// "Middleware" to "Proxy"; same mechanism, new file/export name.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Everything except the login page, the auth API, and static assets
  // requires an authenticated session — enforced by authorized() above.
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
