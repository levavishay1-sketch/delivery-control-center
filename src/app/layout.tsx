import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { auth, signOut } from "@/auth";
import { QuickViewDrawer } from "@/components/QuickViewDrawer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Delivery Control Center",
  description: "Transparent, gated, audited software delivery.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-black/10 dark:border-white/15">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
            <Link href="/" className="font-semibold">
              Delivery Control Center
            </Link>
            <Link href="/" className="text-sm opacity-70 hover:opacity-100">
              Projects
            </Link>
            <Link href="/attention" className="text-sm opacity-70 hover:opacity-100">
              Attention Center
            </Link>
            <Link href="/audit" className="text-sm opacity-70 hover:opacity-100">
              Audit Trail
            </Link>
            {session?.user && (
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
                className="ml-auto flex items-center gap-3"
              >
                <span className="text-xs opacity-60">{session.user.email}</span>
                <button type="submit" className="text-sm opacity-70 hover:opacity-100 underline">
                  Sign out
                </button>
              </form>
            )}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
        {session?.user && (
          <Suspense fallback={null}>
            <QuickViewDrawer />
          </Suspense>
        )}
      </body>
    </html>
  );
}
