import { Fragment, type ReactNode } from "react";
import { effortLabel, fmtInt, fmtUsd, modelLabel } from "./labels.ts";

/**
 * The one way cost is shown anywhere in DCC (claude-in-dcc §6.7):
 * model · effort · tokens · cost, always in that order. An answer the
 * system gave with no model shows the zero-cost variant, so "free" is as
 * visible as "paid". Every number it shows is a ledger row or a sum of them.
 */
export function CostLine({ model, effort, inputTokens, outputTokens, cacheReadTokens, costUsd, source = "model", note, size }: {
  model?: string | null;
  effort?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  costUsd: number;
  /** `system` = answered from the screen's glossary or facts, no call at all. */
  source?: "model" | "system";
  /** A short trailing remark ("7 קריאות", "מהמילון של המסך"). */
  note?: string;
  size?: "sm" | "md";
}) {
  const cls = `cost-line${source === "system" ? " free" : ""}${size === "md" ? " md" : ""}`;
  if (source === "system") {
    return <span className={cls}><span className="usd">$0.000</span><span className="sep">·</span>{note ?? "מהמערכת, בלי מודל"}</span>;
  }
  const parts: ReactNode[] = [];
  if (model) parts.push(<b key="m">{modelLabel(model)}</b>);
  if (effort) parts.push(<span key="e">מאמץ {effortLabel(effort)}</span>);
  if (inputTokens != null || outputTokens != null) {
    parts.push(
      <span key="t" className="tok" title={cacheReadTokens ? `${fmtInt(cacheReadTokens)} טוקנים נקראו מהמטמון` : undefined}>
        {fmtInt(inputTokens ?? 0)} ↑ {fmtInt(outputTokens ?? 0)} ↓
      </span>,
    );
  }
  parts.push(<span key="u" className="usd">{fmtUsd(costUsd)}</span>);
  if (note) parts.push(<span key="n">{note}</span>);
  return (
    <span className={cls}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sep">·</span>}
          {p}
        </Fragment>
      ))}
    </span>
  );
}
