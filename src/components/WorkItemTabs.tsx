"use client";

import { useId, useState } from "react";

export interface TabDef {
  id: string;
  label: string;
  content: React.ReactNode;
}

/** Accessible tabs: role="tablist", arrow-key navigation between tabs, Tab into panel content. */
export function WorkItemTabs({ tabs, initialTabId }: { tabs: TabDef[]; initialTabId?: string }) {
  const [activeId, setActiveId] = useState(initialTabId ?? tabs[0]?.id);
  const baseId = useId();

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const nextIndex = e.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
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
