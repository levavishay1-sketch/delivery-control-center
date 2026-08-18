"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

interface EstimateShape {
  costUsd: number;
  durationMinutes: number;
  sampleSize: number;
  matchLevel: "exact" | "type" | "global";
}

interface ExecutorRecommendation {
  recommended: "AI_AGENT" | "HUMAN";
  why: string;
  assumptions: string[];
  aiEstimate: EstimateShape | null;
}

interface ModelRecommendation {
  model: string;
  why: string;
  assumptions: string[];
  aiEstimate: EstimateShape | null;
  snapshotFetchedAt: string | null;
}

type CardProps =
  | { kind: "executor"; workItemId: string; onEditDeveloper: () => void }
  | { kind: "model"; workItemId: string };

/**
 * The shared AI Recommendation card shape (What/Why/Assumptions/Estimated time/Estimated cost/an
 * override action where one exists), with two instances today: AI-vs-developer executor choice
 * (Slice 17, has an override action) and AI model selection (Slice 20, confirm-only —
 * design.md Decision 5, no cross-model comparison/override in this slice). Self-fetching, matching
 * this codebase's established client-island pattern (e.g. QuickViewDrawer).
 */
export function AiRecommendationCard(props: CardProps) {
  const router = useRouter();
  const [data, setData] = useState<ExecutorRecommendation | ModelRecommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const fetchUrl =
    props.kind === "executor"
      ? `/api/work-items/${props.workItemId}/recommendation`
      : `/api/work-items/${props.workItemId}/recommendation/model`;

  useEffect(() => {
    let cancelled = false;
    fetch(fetchUrl)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load a recommendation.");
      });
    return () => {
      cancelled = true;
    };
  }, [fetchUrl]);

  async function assignToAi() {
    setAssigning(true);
    const res = await fetch(`/api/work-items/${props.workItemId}`, {
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
  if (!data) return null;

  const { why, assumptions, aiEstimate } = data;
  const verdictLabel =
    props.kind === "executor"
      ? (data as ExecutorRecommendation).recommended === "AI_AGENT"
        ? "AI"
        : "Developer"
      : (data as ModelRecommendation).model;
  const snapshotFetchedAt = props.kind === "model" ? (data as ModelRecommendation).snapshotFetchedAt : undefined;
  const freshnessLabel =
    props.kind === "model"
      ? snapshotFetchedAt
        ? `As of ${new Date(snapshotFetchedAt).toLocaleDateString()}`
        : "No knowledge snapshot yet — using built-in defaults"
      : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-hairline bg-surface-muted p-3" aria-label="AI recommendation">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Recommended: {verdictLabel}
        </p>
        {freshnessLabel && <p className="text-xs text-neutral-500 dark:text-neutral-400">{freshnessLabel}</p>}
      </div>
      <p className="text-sm text-foreground">{why}</p>
      {assumptions.length > 0 && (
        <ul className="list-inside list-disc text-xs text-neutral-500 dark:text-neutral-400">
          {assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}

      <div className="rounded-md border border-border-hairline bg-surface p-2 text-xs">
        <p className="font-medium text-foreground">{props.kind === "executor" ? "If you choose AI" : "Estimated AI execution"}</p>
        {aiEstimate ? (
          <p className="text-neutral-500 dark:text-neutral-400">
            Estimated cost: ${aiEstimate.costUsd.toFixed(2)} · Estimated time: {aiEstimate.durationMinutes.toFixed(0)} min
          </p>
        ) : (
          <p className="text-neutral-500 dark:text-neutral-400">No cost/time history available yet to estimate.</p>
        )}
        {props.kind === "executor" && (
          <>
            <p className="mt-2 font-medium text-foreground">If you choose a developer instead</p>
            <p className="text-neutral-500 dark:text-neutral-400">
              The AI estimate above no longer applies — developer effort isn&apos;t estimated by this system.
            </p>
          </>
        )}
      </div>

      {props.kind === "executor" && (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={assigning} onClick={assignToAi}>
            {assigning ? "Assigning…" : "Assign to AI"}
          </Button>
          <Button variant="secondary" size="sm" disabled={assigning} onClick={props.onEditDeveloper}>
            Assign to a developer
          </Button>
        </div>
      )}
    </div>
  );
}
