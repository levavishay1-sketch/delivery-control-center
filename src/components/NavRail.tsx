"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertCircle, Building2, LayoutDashboard, LogOut, ScrollText, Settings } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { Locale } from "@/lib/i18n/locales";
import type { Translations } from "@/lib/i18n/en";

interface NavRailProps {
  configHref: string | null;
  t: Translations;
  locale: Locale;
  userEmail: string;
  onSignOut: () => void;
}

const BASE_ITEM_CLASS = "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors";
const INACTIVE_ITEM_CLASS = "text-sidebar-text hover:bg-sidebar-surface-hover hover:text-white";
const ACTIVE_ITEM_CLASS = "text-white shadow-[0_4px_14px_-4px_color-mix(in_srgb,var(--color-accent)_55%,transparent)]";

function initials(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[.\-_]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

/**
 * The application shell's persistent, branded sidebar (design-system spec,
 * amended Slice 10) — the product's small, stable set of top-level
 * destinations, plus account context, reachable at all times during a
 * session. Always expanded at a fixed comfortable width (Slice 9's
 * `w-14`/icon-only collapse is dropped per design.md decision 6); its
 * surface color is a shade of the same accent hue every primary action
 * already uses (design.md decision 1), not a new brand color.
 * `border-e` (not `border-r`): the rail's own content-facing edge is
 * always its inline-end edge, whichever physical side that resolves to
 * under the active locale's direction.
 * `"use client"` (Slice 9): active-route detection needs the current
 * pathname, which a Server Component layout doesn't reliably receive in
 * the App Router — it already received all its data as props, so this
 * adds no new data-fetching dependency (design.md decision 7).
 * `onSignOut` is a Server Action passed down from `RootLayout` (a Server
 * Component) — the sign-out form used to live in a separate top header
 * bar; that bar is removed per design.md decision 6, so the form moves
 * here instead, not dropped.
 * Deviation from tasks.md's literal list ("Pipelines," "Configuration"):
 * there is no global pipelines index route (only /pipelines/[id] detail),
 * so it's omitted rather than inventing a new route in a UI-only slice;
 * Configuration links to the user's organization (org-admin only), since
 * that's the only Configuration destination that exists (Slice 6).
 */
export function NavRail({ configHref, t, locale, userEmail, onSignOut }: NavRailProps) {
  const pathname = usePathname();

  function itemClass(active: boolean) {
    return `${BASE_ITEM_CLASS} ${active ? ACTIVE_ITEM_CLASS : INACTIVE_ITEM_CLASS}`;
  }

  function itemStyle(active: boolean) {
    return active ? { backgroundImage: "var(--gradient-accent)" } : undefined;
  }

  const isDashboard = pathname === "/";
  const isAttention = pathname.startsWith("/attention");
  const isClients = pathname.startsWith("/clients");
  const isAudit = pathname.startsWith("/audit");
  const isConfig = !!configHref && pathname.startsWith(configHref);

  return (
    <nav
      aria-label="Primary"
      className="flex w-60 shrink-0 flex-col gap-6 border-e border-border-hairline bg-sidebar-surface p-3.5"
    >
      <div className="flex items-center gap-2.5 px-1.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-xs font-bold text-white"
          style={{ backgroundImage: "var(--gradient-accent)" }}
          aria-hidden="true"
        >
          DC
        </span>
        <span className="text-sm font-semibold leading-tight text-white">
          Delivery Control
          <span className="block text-2xs font-normal text-sidebar-text">Center</span>
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <Link href="/" className={itemClass(isDashboard)} style={itemStyle(isDashboard)} aria-current={isDashboard ? "page" : undefined}>
          <LayoutDashboard className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          {t.nav.dashboard}
        </Link>
        <Link href="/attention" className={itemClass(isAttention)} style={itemStyle(isAttention)} aria-current={isAttention ? "page" : undefined}>
          <AlertCircle className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          {t.nav.attentionCenter}
        </Link>
        <Link href="/clients" className={itemClass(isClients)} style={itemStyle(isClients)} aria-current={isClients ? "page" : undefined}>
          <Building2 className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          {t.nav.clients}
        </Link>
        <Link href="/audit" className={itemClass(isAudit)} style={itemStyle(isAudit)} aria-current={isAudit ? "page" : undefined}>
          <ScrollText className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          {t.nav.auditTrail}
        </Link>
        {configHref && (
          <Link href={configHref} className={itemClass(isConfig)} style={itemStyle(isConfig)} aria-current={isConfig ? "page" : undefined}>
            <Settings className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            {t.nav.configuration}
          </Link>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <LanguageSwitcher locale={locale} label={t.nav.language} />
        <form action={onSignOut} className="flex items-center gap-2.5 border-t border-white/10 px-1.5 pt-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-surface-hover text-2xs font-semibold text-white">
            {initials(userEmail)}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-white">{userEmail}</span>
          <button
            type="submit"
            aria-label={t.nav.signOut}
            title={t.nav.signOut}
            className="shrink-0 rounded-md p-1.5 text-sidebar-text hover:bg-sidebar-surface-hover hover:text-white"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </nav>
  );
}
