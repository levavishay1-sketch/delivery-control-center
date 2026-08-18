"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useT } from "@/lib/i18n/LocaleProvider";

interface SearchResults {
  workItems: { id: string; title: string; type: string; status: string; project: { name: string } }[];
  projects: { id: string; name: string; key: string }[];
}

const EMPTY: SearchResults = { workItems: [], projects: [] };

/**
 * Global command palette: Ctrl+K/Cmd+K from any authenticated page. Mounted
 * once in RootLayout, alongside QuickViewDrawer — command-palette delta
 * spec's "opens via a keyboard shortcut from any page" requirement.
 */
export function CommandPalette() {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ignore stale results once the query is cleared, rather than resetting `results` via an
  // effect (avoids a synchronous setState-in-effect call for what render can derive directly).
  const effectiveResults = query.trim() ? results : EMPTY;
  const flatResults = [...effectiveResults.workItems.map((w) => ({ kind: "workItem" as const, item: w })), ...effectiveResults.projects.map((p) => ({ kind: "project" as const, item: p }))];

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults(EMPTY);
    setActiveIndex(0);
  }, []);

  function select(entry: (typeof flatResults)[number]) {
    close();
    if (entry.kind === "workItem") {
      router.push(`/work-items/${entry.item.id}/360`);
    } else {
      router.push(`/#project-${entry.item.id}`);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setTimeout(() => {
        setQuery("");
        setResults(EMPTY);
      }, 0);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!cancelled && res.ok) {
        setResults(await res.json());
        setActiveIndex(0);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = flatResults[activeIndex];
      if (entry) select(entry);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-(--backdrop-floating)" onClick={close} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.commandPalette.placeholder}
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-card border border-border-hairline bg-surface shadow-(--shadow-floating)"
      >
        <div className="flex items-center gap-2 border-b border-border-hairline px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-neutral-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t.commandPalette.placeholder}
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>

        {query.trim() && flatResults.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">{t.commandPalette.noResults}</p>
        )}

        {effectiveResults.workItems.length > 0 && (
          <div className="border-b border-border-hairline py-2">
            <p className="px-4 py-1 text-2xs font-semibold uppercase tracking-wide text-neutral-400">{t.commandPalette.workItemsGroup}</p>
            {effectiveResults.workItems.map((w, i) => {
              const globalIndex = i;
              return (
                <button
                  key={w.id}
                  onClick={() => select({ kind: "workItem", item: w })}
                  className={`flex w-full flex-col items-start gap-0.5 px-4 py-2 text-start text-sm ${
                    activeIndex === globalIndex ? "bg-surface-muted" : "hover:bg-surface-muted"
                  }`}
                >
                  <span>{w.title}</span>
                  <span className="text-xs text-neutral-400">{w.project.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {effectiveResults.projects.length > 0 && (
          <div className="py-2">
            <p className="px-4 py-1 text-2xs font-semibold uppercase tracking-wide text-neutral-400">{t.commandPalette.projectsGroup}</p>
            {effectiveResults.projects.map((p, i) => {
              const globalIndex = effectiveResults.workItems.length + i;
              return (
                <button
                  key={p.id}
                  onClick={() => select({ kind: "project", item: p })}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-start text-sm ${
                    activeIndex === globalIndex ? "bg-surface-muted" : "hover:bg-surface-muted"
                  }`}
                >
                  <span>{p.name}</span>
                  <span className="text-xs text-neutral-400">({p.key})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
