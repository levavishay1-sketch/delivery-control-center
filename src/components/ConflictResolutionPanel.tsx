"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

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
        <div key={conflict.id} className="rounded-card border border-status-warning/30 bg-status-warning-bg p-3 text-xs">
          <p className="font-medium text-status-warning">
            &ldquo;{conflict.workItem.title}&rdquo; — {conflict.field}
          </p>
          <p className="mt-1 text-neutral-600 dark:text-neutral-300">
            Current (manual): <span className="font-mono">{conflict.currentValue}</span>
          </p>
          <p className="text-neutral-600 dark:text-neutral-300">
            Incoming (sync): <span className="font-mono">{conflict.incomingValue}</span>
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => resolve(conflict.id, "KEPT_MANUAL")} disabled={pendingId !== null}>
              {pendingId === conflict.id ? "…" : "Keep manual"}
            </Button>
            <Button variant="primary" size="sm" onClick={() => resolve(conflict.id, "ACCEPTED_INCOMING")} disabled={pendingId !== null}>
              {pendingId === conflict.id ? "…" : "Accept incoming"}
            </Button>
          </div>
        </div>
      ))}
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}
