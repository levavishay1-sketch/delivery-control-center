"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LOCALES, type Locale } from "@/lib/i18n/locales";

/**
 * Small "use client" island (per project convention): sets the locale
 * cookie via POST /api/locale, then router.refresh() so the server tree —
 * including RootLayout's <html lang/dir> — re-renders with the new locale.
 * Does not navigate away from the current page.
 */
export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function switchTo(next: Locale) {
    if (next === locale || pending) return;
    setPending(true);
    try {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-1 px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400">
      <span className="hidden sm:inline">{label}:</span>
      {(Object.keys(LOCALES) as Locale[]).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => switchTo(code)}
          disabled={pending}
          aria-pressed={code === locale}
          className={`rounded-md px-1.5 py-0.5 text-xs ${
            code === locale ? "bg-accent-muted text-accent" : "hover:bg-surface-muted hover:text-foreground"
          }`}
        >
          {LOCALES[code].label}
        </button>
      ))}
    </div>
  );
}
