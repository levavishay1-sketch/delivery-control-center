import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { auth, signOut } from "@/auth";
import { QuickViewDrawer } from "@/components/QuickViewDrawer";
import { CommandPalette } from "@/components/CommandPalette";
import { NavRail } from "@/components/NavRail";
import { listOrganizations } from "@/domain/organization/queries";
import { LOCALES } from "@/lib/i18n/locales";
import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
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

async function handleSignOut() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  const organizations = session?.user?.isOrgAdmin ? await listOrganizations() : [];
  const configHref = organizations[0] ? `/organizations/${organizations[0].id}/config` : null;
  const locale = await getServerLocale();
  const t = getDictionary(locale);

  return (
    <html
      lang={locale}
      dir={LOCALES[locale].dir}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-surface-page">
        <LocaleProvider locale={locale}>
          <div className="flex flex-1">
            {session?.user && (
              <NavRail
                configHref={configHref}
                t={t}
                locale={locale}
                userEmail={session.user.email ?? ""}
                onSignOut={handleSignOut}
              />
            )}
            {/* The shell's white, rounded workspace container (design.md decision 6) — replaces the
                previous top header bar + edge-to-edge main content with a single contained surface
                inset from the sidebar/viewport, matching the reference's "designed product surface." */}
            <div className="flex-1 p-5 sm:p-6">
              <main className="min-h-[calc(100vh-2.5rem)] w-full rounded-shell border border-border-hairline bg-surface p-6 shadow-(--shadow-floating) sm:p-8">
                {children}
              </main>
            </div>
          </div>
          {session?.user && (
            <Suspense fallback={null}>
              <QuickViewDrawer />
            </Suspense>
          )}
          {session?.user && <CommandPalette />}
        </LocaleProvider>
      </body>
    </html>
  );
}
