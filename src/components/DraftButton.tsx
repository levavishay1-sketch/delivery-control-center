"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const POLL_INTERVAL_MS = 2000;
/** Safety cap so a stuck poll loop can't run forever client-side; the job runtime's own retry/backoff (and eventual FAILED-terminal state) is what actually bounds how long drafting takes. */
const MAX_POLLS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls the stage's status while it's AI_DRAFTING (drafting is job-backed — see Task Group 5). */
async function pollUntilDraftingFinishes(stageId: string): Promise<void> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`/api/stages/${stageId}`);
    if (!res.ok) return;
    const stage = (await res.json()) as { status: string };
    if (stage.status !== "AI_DRAFTING") return;
  }
}

export function DraftButton({ pipelineId, label }: { pipelineId: string; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/pipelines/${pipelineId}/advance`, { method: "POST" });
    if (!res.ok) {
      setPending(false);
      setError((await res.json()).error ?? "Failed to draft stage");
      return;
    }
    const stage = (await res.json()) as { id: string };
    await pollUntilDraftingFinishes(stage.id);
    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
      >
        {pending ? "Drafting…" : label}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
