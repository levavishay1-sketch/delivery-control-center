import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Built from the Edge-safe authConfig only — never import "@/auth" here
// (it pulls in the Credentials provider, which pulls in Prisma, which
// doesn't run on the Edge runtime Proxy uses). Next.js 16 renamed
// "Middleware" to "Proxy"; same mechanism, new file/export name.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Everything except the login page, the auth API, static assets, and connector webhook intake
  // requires an authenticated session — enforced by authorized() above. Webhook routes are
  // server-to-server (GitHub/Azure DevOps calling in) and authenticate via their own
  // signature/Basic-Auth verification inside the route handler, not a user session.
  matcher: ["/((?!login|api/auth|api/webhooks|_next/static|_next/image|favicon.ico).*)"],
};
