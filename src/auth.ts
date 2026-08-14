import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { getUserByEmail } from "@/domain/user/queries";
import { verifyPassword } from "@/domain/shared/password";
import { authConfig } from "@/auth.config";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // No adapter: Credentials + JWT sessions don't call adapter methods, and
  // wiring PrismaAdapter now would risk a type mismatch between our
  // custom-output PrismaClient and the adapter's @prisma/client-typed
  // signature for zero functional benefit. Add it when a real OAuth
  // provider is introduced. See openspec/changes/slice-0-tenancy-and-identity/design.md.
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const user = await getUserByEmail(parsed.data.email);
        if (!user?.passwordHash) return null;

        const valid = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name, isOrgAdmin: user.isOrgAdmin };
      },
    }),
  ],
});
