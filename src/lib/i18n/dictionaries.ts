import type { Locale } from "@/lib/i18n/locales";
import { en, type Translations } from "@/lib/i18n/en";
import { he } from "@/lib/i18n/he";

const DICTIONARIES: Record<Locale, Translations> = { en, he };

export function getDictionary(locale: Locale): Translations {
  return DICTIONARIES[locale];
}
