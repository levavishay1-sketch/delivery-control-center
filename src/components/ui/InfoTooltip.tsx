"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * Accessible disclosure for explaining a non-obvious concept (a config field, a status
 * determination, a budget rule) — click/Enter/Space pins it open, hover opens it
 * transiently for discoverability, Escape/click-outside/mouse-leave-without-a-pin closes
 * it. Never hover-only: a `role="tooltip"` + CSS `:hover` pair (the HTML mock's own
 * `.info:hover::after` pattern) has no keyboard or touch path, which is exactly what the
 * design-system spec's "reachable without a mouse" requirement rules out.
 */
export function InfoTooltip({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const panelId = useId();

  function close() {
    setOpen(false);
    setPinned(false);
  }

  return (
    <span className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          const next = !open;
          setOpen(next);
          setPinned(next);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          if (!pinned) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) close();
        }}
        className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />
          <div
            id={panelId}
            className="animate-fade-up absolute start-0 top-full z-50 mt-1.5 w-64 rounded-card border border-border-hairline bg-surface p-3 text-start shadow-(--shadow-floating)"
          >
            <p className="text-xs font-semibold">{label}</p>
            <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{children}</div>
          </div>
        </>
      )}
    </span>
  );
}
