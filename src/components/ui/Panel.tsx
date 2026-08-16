import type { CSSProperties, ReactNode } from "react";

/**
 * Flat-elevation grouped-detail container for on-page sections (Overview
 * tab, config panels). Never uses shadow — shadow is reserved for the
 * floating elevation level (drawers, dropdowns, modals).
 */
export function Panel({
  title,
  children,
  className = "",
  id,
  style,
  ...rest
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  id?: string;
  /** Escape hatch for a dynamic per-instance style (e.g. a project's identity-color accent border) that can't be a static Tailwind class. */
  style?: CSSProperties;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div id={id} style={style} className={`rounded-lg border border-border-hairline bg-surface p-4 ${className}`} {...rest}>
      {title && (
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

export function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-neutral-500 dark:text-neutral-400">{children}</p>;
}

export function PanelLoading() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-3.5 w-1/2 rounded bg-surface-muted" />
      <div className="h-3.5 w-2/3 rounded bg-surface-muted" />
    </div>
  );
}

export function PanelError({ message }: { message: string }) {
  return <p className="text-sm text-status-critical">{message}</p>;
}
