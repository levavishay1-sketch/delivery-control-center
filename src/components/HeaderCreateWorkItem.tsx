"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useT } from "@/lib/i18n/LocaleProvider";

/**
 * Persistent header-level CTA for work-item creation (dashboard delta
 * spec's "persistent primary action" requirement) — reaches creation
 * without first scrolling to a specific project's own section, by
 * including project selection in the same small popover rather than
 * requiring the project's section to already be open.
 */
export function HeaderCreateWorkItem({ projects }: { projects: { id: string; name: string; key: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setPending(true);
    const res = await fetch("/api/work-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title }),
    });
    setPending(false);
    if (res.ok) {
      setTitle("");
      setOpen(false);
      router.refresh();
    }
  }

  if (projects.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-white"
        style={{ backgroundImage: "var(--gradient-accent)" }}
      >
        <Plus className="h-4 w-4" />
        {t.dashboard.newWorkItem}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <form
            onSubmit={onSubmit}
            className="absolute end-0 top-full z-50 mt-2 flex w-72 flex-col gap-2 rounded-card border border-border-hairline bg-surface p-3 shadow-(--shadow-floating)"
          >
            <label className="text-xs text-neutral-500 dark:text-neutral-400">
              {t.dashboard.newWorkItemProjectLabel}
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-1 w-full rounded-md border border-border-hairline bg-transparent px-2 py-1.5 text-sm"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
            </label>
            <input
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.dashboard.newWorkItemTitlePlaceholder}
              className="rounded-md border border-border-hairline bg-transparent px-2 py-1.5 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending || !projectId}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundImage: "var(--gradient-accent)" }}
              >
                {t.dashboard.newWorkItemSubmit}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border-hairline px-3 py-1.5 text-sm hover:bg-surface-muted"
              >
                {t.dashboard.newWorkItemCancel}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
