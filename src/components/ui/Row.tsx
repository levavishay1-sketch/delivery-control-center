import type { ReactNode } from "react";

/**
 * Flat-elevation list-row primitive for collections of similar, comparable
 * items (Attention Center feed, audit trail, work-item lists). Distinct
 * from card treatment, which is reserved for dissimilar items being
 * browsed (e.g. project tiles) — see design-system spec.
 */
export function RowList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex flex-col divide-y divide-border-hairline rounded-lg border border-border-hairline bg-surface ${className}`}
    >
      {children}
    </div>
  );
}

export function Row({
  children,
  href,
  className = "",
  columns,
}: {
  children: ReactNode;
  href?: string;
  className?: string;
  /** CSS `grid-template-columns` value. When set, the row lays out its
   * children as aligned grid columns instead of a single flex line — for
   * collections with multiple comparable fields per item (e.g. an audit
   * feed's actor/action/project/time), per design-system spec's
   * column-grid row requirement. Grid item order follows the ambient
   * `direction`, so RTL mirrors for free — no separate handling needed. */
  columns?: string;
}) {
  const layout = columns ? "grid items-center" : "flex items-center";
  const content = (
    <div
      className={`${layout} gap-3 px-4 py-3 text-start ${className}`}
      style={columns ? { gridTemplateColumns: columns } : undefined}
    >
      {children}
    </div>
  );
  if (href) {
    return (
      <a href={href} className="block hover:bg-surface-muted transition-colors">
        {content}
      </a>
    );
  }
  return content;
}

/** Optional column-header row for a `RowList` using `Row`'s `columns` mode. */
export function RowListHeader({ columns, children, className = "" }: { columns: string; children: ReactNode; className?: string }) {
  return (
    <div
      className={`grid items-center gap-3 border-b border-border-hairline bg-surface-muted px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-neutral-500 text-start dark:text-neutral-400 ${className}`}
      style={{ gridTemplateColumns: columns }}
    >
      {children}
    </div>
  );
}

export function RowEmpty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">{children}</div>;
}

export function RowLoading() {
  return (
    <div className="flex flex-col divide-y divide-border-hairline">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse px-4 py-3">
          <div className="h-3.5 w-2/3 rounded bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}

export function RowError({ message }: { message: string }) {
  return (
    <div className="px-4 py-6 text-center text-sm text-status-critical">{message}</div>
  );
}
