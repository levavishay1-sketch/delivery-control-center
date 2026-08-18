"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ComponentType } from "react";
import { IconBadge, type IconBadgeTone } from "@/components/ui/IconBadge";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { formatNumber } from "@/lib/i18n/format";

/**
 * IconBadge + a large number + a label, replacing the small `SummaryChip`
 * pills (dashboard/attention-center delta specs). The count-up animation and
 * entrance stagger respect `prefers-reduced-motion` explicitly, since it's a
 * JS rAF loop, not a CSS animation the centralized globals.css media query
 * already gates.
 */
export function StatTile({
  tone,
  icon,
  count,
  label,
  href,
  delayMs = 0,
  className = "",
}: {
  tone: IconBadgeTone;
  icon?: ComponentType<{ className?: string }>;
  count: number;
  label: string;
  href?: string;
  delayMs?: number;
  className?: string;
}) {
  const { locale } = useLocale();
  const [displayCount, setDisplayCount] = useState(count);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // duration 0 still routes the final value through the rAF-scheduled `tick` callback below
    // rather than calling setState synchronously in the effect body.
    const duration = prefersReduced ? 0 : 400;
    const start = performance.now();
    let raf: number;
    function tick(now: number) {
      const progress = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      setDisplayCount(Math.round(progress * count));
      if (progress < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  const inner = (
    <div
      className={`animate-fade-up hover-lift flex items-center gap-3 rounded-card border border-border-hairline bg-surface p-4 ${href ? "cursor-pointer" : ""} ${className}`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <IconBadge tone={tone} icon={icon} size="lg" />
      <div className="flex flex-col">
        <span className="text-2xl font-semibold tabular-nums">{formatNumber(displayCount, locale)}</span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{label}</span>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}
