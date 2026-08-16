"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertCircle, LayoutDashboard, ScrollText, Settings } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { Locale } from "@/lib/i18n/locales";
import type { Translations } from "@/lib/i18n/en";

interface NavRailProps {
  configHref: string | null;
  t: Translations;
  locale: Locale;
}

const BASE_ITEM_CLASS = "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors";
const INACTIVE_ITEM_CLASS = "text-neutral-500 hover:bg-surface-muted hover:text-foreground dark:text-neutral-400";
const ACTIVE_ITEM_CLASS = "text-white";

/**
 * Persistent icon+label rail — the product's small, stable set of
 * top-level destinations, reachable at all times during a session.
 * `border-e` (not `border-r`): the rail's own content-facing edge is
 * always its inline-end edge, whichever physical side that resolves to
 * under the active locale's direction (see design.md decision 3).
 * `"use client"` (Slice 9): active-route detection needs the current
 * pathname, which a Server Component layout doesn't reliably receive in
 * the App Router — it already received all its data as props, so this
 * adds no new data-fetching dependency (design.md decision 7).
 * Deviation from tasks.md's literal list ("Pipelines," "Configuration"):
 * there is no global pipelines index route (only /pipelines/[id] detail),
 * so it's omitted rather than inventing a new route in a UI-only slice;
 * Configuration links to the user's organization (org-admin only), since
 * that's the only Configuration destination that exists (Slice 6).
 */
export function NavRail({ configHref, t, locale }: NavRailProps) {
  const pathname = usePathname();

  function itemClass(active: boolean) {
    return `${BASE_ITEM_CLASS} ${active ? ACTIVE_ITEM_CLASS : INACTIVE_ITEM_CLASS}`;
  }

  function itemStyle(active: boolean) {
    return active ? { backgroundImage: "var(--gradient-accent)" } : undefined;
  }

  const isDashboard = pathname === "/";
  const isAttention = pathname.startsWith("/attention");
  const isAudit = pathname.startsWith("/audit");
  const isConfig = !!configHref && pathname.startsWith(configHref);

  return (
    <nav aria-label="Primary" className="flex w-14 flex-col gap-1 border-e border-border-hairline p-2 sm:w-56">
      <Link href="/" className={itemClass(isDashboard)} style={itemStyle(isDashboard)} aria-label={t.nav.dashboard} aria-current={isDashboard ? "page" : undefined}>
        <LayoutDashboard className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">{t.nav.dashboard}</span>
      </Link>
      <Link href="/attention" className={itemClass(isAttention)} style={itemStyle(isAttention)} aria-label={t.nav.attentionCenter} aria-current={isAttention ? "page" : undefined}>
        <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">{t.nav.attentionCenter}</span>
      </Link>
      <Link href="/audit" className={itemClass(isAudit)} style={itemStyle(isAudit)} aria-label={t.nav.auditTrail} aria-current={isAudit ? "page" : undefined}>
        <ScrollText className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">{t.nav.auditTrail}</span>
      </Link>
      {configHref && (
        <Link href={configHref} className={itemClass(isConfig)} style={itemStyle(isConfig)} aria-label={t.nav.configuration} aria-current={isConfig ? "page" : undefined}>
          <Settings className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{t.nav.configuration}</span>
        </Link>
      )}
      <div className="mt-auto">
        <LanguageSwitcher locale={locale} label={t.nav.language} />
      </div>
    </nav>
  );
}
