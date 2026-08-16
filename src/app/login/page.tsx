import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/Button";
import { FormField, Input } from "@/components/ui/FormField";

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
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 py-16">
      <div className="flex flex-col items-center gap-2.5">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-[11px] text-sm font-bold text-white"
          style={{ backgroundImage: "var(--gradient-accent)" }}
          aria-hidden="true"
        >
          DC
        </span>
        <span className="text-sm font-semibold">Delivery Control Center</span>
      </div>

      <form action={authenticate} className="flex w-full flex-col gap-4 rounded-card border border-border-hairline bg-surface p-6">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <FormField label="Email" htmlFor="login-email" required>
          <Input id="login-email" name="email" type="email" required autoComplete="email" />
        </FormField>
        <FormField label="Password" htmlFor="login-password" required>
          <Input id="login-password" name="password" type="password" required autoComplete="current-password" />
        </FormField>
        <Button type="submit" variant="primary" className="w-full justify-center">
          Sign in
        </Button>
        {error && <p className="text-xs text-status-critical">Invalid email or password.</p>}
      </form>
    </div>
  );
}
