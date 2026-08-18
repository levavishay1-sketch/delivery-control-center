"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

export interface TaskDraft {
  id: string;
  title: string;
  description: string | null;
  materializedWorkItem: { id: string; title: string } | null;
}

/** A TASKS stage's drafted tasks, with a "Materialize Selected" action once the stage is approved (DONE). */
export function TaskDraftsPanel({ stageId, drafts, canManage }: { stageId: string; drafts: TaskDraft[]; canManage: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (drafts.length === 0) {
    return <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">No task drafts for this run.</p>;
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function materialize() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/stages/${stageId}/task-drafts/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskDraftIds: Array.from(selected) }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to materialize task drafts");
      return;
    }
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="mt-3 flex flex-col gap-2" aria-label="Task drafts">
      <ul className="flex flex-col gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
        {drafts.map((d) => (
          <li key={d.id} className="flex items-start gap-2">
            {d.materializedWorkItem ? (
              <span className="mt-0.5 text-status-healthy">✓</span>
            ) : canManage ? (
              <input
                type="checkbox"
                className="mt-0.5"
                checked={selected.has(d.id)}
                onChange={() => toggle(d.id)}
                aria-label={`Select "${d.title}" for materialization`}
              />
            ) : (
              <span className="mt-0.5 text-neutral-400">–</span>
            )}
            <div>
              <p className="font-medium text-foreground">{d.title}</p>
              {d.description && <p className="text-neutral-500 dark:text-neutral-400">{d.description}</p>}
              {d.materializedWorkItem && (
                <Link href={`/work-items/${d.materializedWorkItem.id}/360`} className="text-accent hover:underline">
                  View Work Item →
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="flex flex-col items-start gap-1">
          <Button variant="primary" size="sm" onClick={materialize} disabled={pending || selected.size === 0}>
            {pending ? "Materializing…" : `Materialize Selected (${selected.size})`}
          </Button>
          {error && <p className="text-xs text-status-critical">{error}</p>}
        </div>
      )}
    </div>
  );
}
