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
}: {
  children: ReactNode;
  href?: string;
  className?: string;
}) {
  const content = (
    <div className={`flex items-center gap-3 px-4 py-3 ${className}`}>{children}</div>
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
