export type Locale = "en" | "he";

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALES: Record<Locale, { label: string; dir: "ltr" | "rtl" }> = {
  en: { label: "English", dir: "ltr" },
  he: { label: "עברית", dir: "rtl" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && value in LOCALES;
}
