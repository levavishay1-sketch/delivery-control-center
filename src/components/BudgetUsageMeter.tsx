"use client";

import { Meter } from "@/components/ui/Meter";
import { useT } from "@/lib/i18n/LocaleProvider";
import { formatMessage } from "@/lib/i18n/format";

/**
 * Wraps `Meter` with the budget-usage-severity color mapping (design.md
 * decision 5): healthy below 70%, warning 70-99%, critical at/over 100% —
 * reusing the existing status scale rather than a new color decision.
 * Renders nothing when there's no budget limit set, per the dashboard
 * delta spec's explicit "no meter implying a 0%-or-undefined usage" rule.
 */
export function BudgetUsageMeter({ effectiveBudgetUsd, aiCostUsd }: { effectiveBudgetUsd: number | null; aiCostUsd: number }) {
  const t = useT();
  if (effectiveBudgetUsd === null || effectiveBudgetUsd <= 0) return null;

  const percent = Math.round((aiCostUsd / effectiveBudgetUsd) * 100);
  const color =
    percent >= 100
      ? "var(--color-status-critical)"
      : percent >= 70
        ? "var(--color-status-warning)"
        : "var(--color-status-healthy)";

  return (
    <div className="flex items-center gap-3">
      <Meter value={percent} color={color} label={`${percent}%`} size={64} strokeWidth={7} />
      <span className="text-xs text-neutral-500 dark:text-neutral-400">
        {formatMessage(t.dashboard.budgetUsed, { percent })}
      </span>
    </div>
  );
}
