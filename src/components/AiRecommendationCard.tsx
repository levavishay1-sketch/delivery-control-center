"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

interface Recommendation {
  recommended: "AI_AGENT" | "HUMAN";
  why: string;
  assumptions: string[];
  aiEstimate: { costUsd: number; durationMinutes: number; sampleSize: number; matchLevel: "exact" | "type" | "global" } | null;
}

/**
 * Slice 17 — the shared AI Recommendation card shape (What/Why/Assumptions/Estimated time/
 * Estimated cost/What happens under each alternative/a single override action). Self-fetching,
 * matching this codebase's established client-island pattern (e.g. QuickViewDrawer).
 */
export function AiRecommendationCard({
  workItemId,
  onEditDeveloper,
}: {
  workItemId: string;
  /** Opens the existing executor-picker flow (EditWorkItemForm's HUMAN case) instead of the card duplicating a user picker (design.md decision 6). */
  onEditDeveloper: () => void;
}) {
  const router = useRouter();
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/work-items/${workItemId}/recommendation`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        if (!cancelled) setRecommendation(data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load a recommendation.");
      });
    return () => {
      cancelled = true;
    };
  }, [workItemId]);

  async function assignToAi() {
    setAssigning(true);
    const res = await fetch(`/api/work-items/${workItemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executorType: "AI_AGENT" }),
    });
    setAssigning(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to assign");
      return;
    }
    router.refresh();
  }

  if (error) return null;
  if (!recommendation) return null;

  const { recommended, why, assumptions, aiEstimate } = recommendation;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-hairline bg-surface-muted p-3" aria-label="AI recommendation">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Recommended: {recommended === "AI_AGENT" ? "AI" : "Developer"}
      </p>
      <p className="text-sm text-foreground">{why}</p>
      {assumptions.length > 0 && (
        <ul className="list-inside list-disc text-xs text-neutral-500 dark:text-neutral-400">
          {assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}

      <div className="rounded-md border border-border-hairline bg-surface p-2 text-xs">
        <p className="font-medium text-foreground">If you choose AI</p>
        {aiEstimate ? (
          <p className="text-neutral-500 dark:text-neutral-400">
            Estimated cost: ${aiEstimate.costUsd.toFixed(2)} · Estimated time: {aiEstimate.durationMinutes.toFixed(0)} min
          </p>
        ) : (
          <p className="text-neutral-500 dark:text-neutral-400">No cost/time history available yet to estimate.</p>
        )}
        <p className="mt-2 font-medium text-foreground">If you choose a developer instead</p>
        <p className="text-neutral-500 dark:text-neutral-400">The AI estimate above no longer applies — developer effort isn&apos;t estimated by this system.</p>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={assigning} onClick={assignToAi}>
          {assigning ? "Assigning…" : "Assign to AI"}
        </Button>
        <Button variant="secondary" size="sm" disabled={assigning} onClick={onEditDeveloper}>
          Assign to a developer
        </Button>
      </div>
    </div>
  );
}
