"use client";

import { createContext, useContext, useMemo } from "react";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Translations } from "@/lib/i18n/en";

interface LocaleContextValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  t: Translations;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Mounted once in RootLayout with the server-read initial locale (see
 * src/lib/i18n/server.ts), so every client component in the tree — including
 * ones nested inside Server Component pages, like OverviewTab rendered from
 * the 360° Record page — can read the active locale via context without a
 * second round trip.
 */
export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir: LOCALES[locale].dir, t: getDictionary(locale) }),
    [locale]
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale/useT must be used within a LocaleProvider");
  return ctx;
}

export function useLocale(): { locale: Locale; dir: "ltr" | "rtl" } {
  const { locale, dir } = useLocaleContext();
  return { locale, dir };
}

/** Returns the active locale's translation dictionary — accessed via plain property paths, e.g. `t.dashboard.heading`. */
export function useT(): Translations {
  return useLocaleContext().t;
}
