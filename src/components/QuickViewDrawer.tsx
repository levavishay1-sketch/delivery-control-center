"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { OverviewTab } from "@/components/OverviewTab";
import { DependenciesTab } from "@/components/DependenciesTab";
import { TimelineTab } from "@/components/TimelineTab";

type QuickViewData = Omit<React.ComponentProps<typeof OverviewTab>, "canEdit"> & {
  dependencies: { upstream: React.ComponentProps<typeof DependenciesTab>["upstream"]; downstream: React.ComponentProps<typeof DependenciesTab>["downstream"] };
  candidates: { id: string; title: string }[];
  timeline: { events: React.ComponentProps<typeof TimelineTab>["initialEvents"]; total: number };
  fullRecordHref: string;
};

/**
 * Global side drawer: mounted once in the root layout, triggered from anywhere by a
 * ?quickView=<workItemId> query param (see the "?view=quick" trigger in the Quick View
 * spec — unified onto one param name so a single component can own the read/fetch/close
 * cycle regardless of which page linked into it).
 */
export function QuickViewDrawer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workItemId = searchParams.get("quickView");

  const [data, setData] = useState<QuickViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("quickView");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  /** Re-fetches this item's data. Passed to child forms/buttons as onChanged/onResolved/etc. — the drawer's data
   * isn't a Server Component, so the router.refresh() those components use by default has nothing to refresh here. */
  const refetch = useCallback(async () => {
    if (!workItemId) return;
    try {
      const res = await fetch(`/api/work-items/${workItemId}/quick-view`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load work item");
      const json = await res.json();
      setData(json);
      setError(null);
      setRefreshCount((c) => c + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load work item");
    }
  }, [workItemId]);

  useEffect(() => {
    if (!workItemId) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/work-items/${workItemId}/quick-view`);
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load work item");
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load work item");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [workItemId]);

  useEffect(() => {
    if (!workItemId) return;
    closeButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workItemId]);

  if (!workItemId) return null;

  const current = data && data.workItem.id === workItemId ? data : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={close} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={current ? current.workItem.title : "Work item quick view"}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-black/10 bg-background p-4 shadow-xl dark:border-white/15 sm:w-[400px]"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">{current ? current.workItem.title : "Loading…"}</h2>
          <button ref={closeButtonRef} onClick={close} aria-label="Close" className="text-xl leading-none opacity-60 hover:opacity-100">
            ×
          </button>
        </div>

        {!current && !error && <p className="mt-4 text-sm opacity-60">Loading…</p>}
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

        {current && (
          <div className="mt-4 flex flex-col gap-6">
            <OverviewTab
              workItem={current.workItem}
              members={current.members}
              activeBlocker={current.activeBlocker}
              pendingDecision={current.pendingDecision}
              canEdit={current.canManage}
              canManage={current.canManage}
              isBlockerOwner={current.isBlockerOwner}
              parent={current.parent}
              childItems={current.childItems}
              aiCost={current.aiCost}
              stageCosts={current.stageCosts}
              now={current.now}
              onChanged={refetch}
            />

            <section>
              <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">Dependencies</h3>
              <div className="mt-2">
                <DependenciesTab
                  upstream={current.dependencies.upstream}
                  downstream={current.dependencies.downstream}
                  canManage={current.canManage}
                  workItemId={current.workItem.id}
                  candidates={current.candidates}
                  onChanged={refetch}
                />
              </div>
            </section>

            <section>
              <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">Timeline</h3>
              <div className="mt-2">
                <TimelineTab
                  key={refreshCount}
                  workItemId={current.workItem.id}
                  initialEvents={current.timeline.events}
                  initialTotal={current.timeline.total}
                />
              </div>
            </section>

            <Link href={current.fullRecordHref} className="text-sm underline opacity-70 hover:opacity-100">
              Open full 360° Record →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
