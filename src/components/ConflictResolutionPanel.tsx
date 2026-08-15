"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface OpenConflict {
  id: string;
  field: string;
  currentValue: string;
  incomingValue: string;
  workItem: { id: string; title: string };
}

/** Lists a project's open sync conflicts with "Keep manual"/"Accept incoming" resolution actions. WRITE_ROLES-gated server-side; render this only for a caller already known to have write access. */
export function ConflictResolutionPanel({ conflicts }: { conflicts: OpenConflict[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(conflictId: string, resolution: "KEPT_MANUAL" | "ACCEPTED_INCOMING") {
    setPendingId(conflictId);
    setError(null);
    const res = await fetch(`/api/conflicts/${conflictId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution }),
    });
    setPendingId(null);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to resolve conflict");
      return;
    }
    router.refresh();
  }

  if (conflicts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {conflicts.map((conflict) => (
        <div key={conflict.id} className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <p className="font-medium text-amber-600 dark:text-amber-400">
            &ldquo;{conflict.workItem.title}&rdquo; — {conflict.field}
          </p>
          <p className="mt-1 opacity-70">
            Current (manual): <span className="font-mono">{conflict.currentValue}</span>
          </p>
          <p className="opacity-70">
            Incoming (sync): <span className="font-mono">{conflict.incomingValue}</span>
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => resolve(conflict.id, "KEPT_MANUAL")}
              disabled={pendingId !== null}
              className="rounded border border-black/15 dark:border-white/20 px-2 py-1 disabled:opacity-40"
            >
              {pendingId === conflict.id ? "…" : "Keep manual"}
            </button>
            <button
              onClick={() => resolve(conflict.id, "ACCEPTED_INCOMING")}
              disabled={pendingId !== null}
              className="rounded bg-foreground px-2 py-1 text-background disabled:opacity-40"
            >
              {pendingId === conflict.id ? "…" : "Accept incoming"}
            </button>
          </div>
        </div>
      ))}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
