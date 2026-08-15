"use client";

import { useId, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";

export interface TabDef {
  id: string;
  label: string;
  content: React.ReactNode;
}

/**
 * Accessible tabs: role="tablist", arrow-key navigation between tabs, Tab
 * into panel content. Arrow-key direction follows logical reading order —
 * ArrowRight advances to the next tab under LTR, but under RTL the visual
 * "next" direction is to the left, so the two keys swap (see the modified
 * delivery-record-360 spec's RTL keyboard-navigation requirement).
 */
export function WorkItemTabs({ tabs, initialTabId }: { tabs: TabDef[]; initialTabId?: string }) {
  const [activeId, setActiveId] = useState(initialTabId ?? tabs[0]?.id);
  const baseId = useId();
  const { dir } = useLocale();

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const forwardKey = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const nextIndex = e.key === forwardKey ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    setActiveId(next.id);
    document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label="Work item detail" className="flex gap-1 overflow-x-auto border-b border-border-hairline">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${baseId}-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={activeId === tab.id}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={activeId === tab.id ? 0 : -1}
            onClick={() => setActiveId(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              activeId === tab.id
                ? "border-accent text-accent"
                : "border-transparent text-neutral-500 hover:text-foreground dark:text-neutral-400"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${baseId}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={activeId !== tab.id}
          className="py-4"
        >
          {activeId === tab.id && tab.content}
        </div>
      ))}
    </div>
  );
}
