import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { auth, signOut } from "@/auth";
import { QuickViewDrawer } from "@/components/QuickViewDrawer";
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
      <body className="min-h-full flex flex-col">
        <LocaleProvider locale={locale}>
          <div className="flex flex-1">
            {session?.user && <NavRail configHref={configHref} t={t} locale={locale} />}
            <div className="flex flex-1 flex-col">
              <header className="border-b border-border-hairline">
                <div className="flex items-center justify-between px-6 py-3">
                  <span className="text-sm font-semibold">Delivery Control Center</span>
                  {session?.user && (
                    <form
                      action={async () => {
                        "use server";
                        await signOut({ redirectTo: "/login" });
                      }}
                      className="flex items-center gap-3"
                    >
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">{session.user.email}</span>
                      <button
                        type="submit"
                        className="rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-surface-muted hover:text-foreground dark:text-neutral-400"
                      >
                        {t.nav.signOut}
                      </button>
                    </form>
                  )}
                </div>
              </header>
              <main className="w-full flex-1 px-6 py-8">{children}</main>
            </div>
          </div>
          {session?.user && (
            <Suspense fallback={null}>
              <QuickViewDrawer />
            </Suspense>
          )}
        </LocaleProvider>
      </body>
    </html>
  );
}
