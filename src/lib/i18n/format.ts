import type { Locale } from "@/lib/i18n/locales";

/** Simple `{token}` substitution — no ICU MessageFormat, per design.md's "avoid unnecessary complexity." */
export function formatMessage(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

/**
 * Two-form (one/other) pluralization via the native `Intl.PluralRules`, with any
 * category other than "one" (e.g. Hebrew's "two"/"many") falling back to "other".
 * A simplification, not full CLDR-accurate Hebrew plural handling — flagged as a
 * known limitation in design.md's Risks section.
 */
export function pluralize(locale: Locale, count: number, forms: { one: string; other: string }, params?: Record<string, string | number>): string {
  const category = new Intl.PluralRules(locale).select(count);
  const template = category === "one" ? forms.one : forms.other;
  return formatMessage(template, { n: count, ...params });
}

export function formatDate(date: Date | string, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, options ?? { month: "short", day: "numeric", year: "numeric" }).format(d);
}

export function formatDateTime(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
