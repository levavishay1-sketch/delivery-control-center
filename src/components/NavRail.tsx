import Link from "next/link";
import { AlertCircle, LayoutDashboard, ScrollText, Settings } from "lucide-react";

interface NavRailProps {
  configHref: string | null;
}

const ITEM_CLASS =
  "group flex items-center gap-3 rounded-md px-3 py-2 text-sm text-neutral-500 hover:bg-surface-muted hover:text-foreground dark:text-neutral-400";

/**
 * Persistent left icon+label rail — the product's small, stable set of
 * top-level destinations, reachable at all times during a session.
 * Deviation from tasks.md's literal list ("Pipelines," "Configuration"):
 * there is no global pipelines index route (only /pipelines/[id] detail),
 * so it's omitted rather than inventing a new route in a UI-only slice;
 * Configuration links to the user's organization (org-admin only), since
 * that's the only Configuration destination that exists (Slice 6).
 */
export function NavRail({ configHref }: NavRailProps) {
  return (
    <nav aria-label="Primary" className="flex w-14 flex-col gap-1 border-r border-border-hairline p-2 sm:w-56">
      <Link href="/" className={ITEM_CLASS} aria-label="Dashboard">
        <LayoutDashboard className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Dashboard</span>
      </Link>
      <Link href="/attention" className={ITEM_CLASS} aria-label="Attention Center">
        <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Attention Center</span>
      </Link>
      <Link href="/audit" className={ITEM_CLASS} aria-label="Audit Trail">
        <ScrollText className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Audit Trail</span>
      </Link>
      {configHref && (
        <Link href={configHref} className={ITEM_CLASS} aria-label="Configuration">
          <Settings className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Configuration</span>
        </Link>
      )}
    </nav>
  );
}
