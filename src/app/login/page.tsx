import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;

  async function authenticate(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", { ...Object.fromEntries(formData), redirectTo: "/" });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect("/login?error=1");
      }
      throw err;
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 pt-12">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <form action={authenticate} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs opacity-70">Email</label>
          <input
            name="email"
            type="email"
            required
            className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs opacity-70">Password</label>
          <input
            name="password"
            type="password"
            required
            className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background"
        >
          Sign in
        </button>
        {error && <p className="text-xs text-red-500">Invalid email or password.</p>}
      </form>
    </div>
  );
}
