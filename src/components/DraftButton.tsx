"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { pollUntilDraftingFinishes } from "@/lib/pollStageStatus";

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
