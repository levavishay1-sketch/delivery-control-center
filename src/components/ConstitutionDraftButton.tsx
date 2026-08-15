"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { pollUntilStatusLeaves } from "@/lib/pollStatus";

export function ConstitutionDraftButton({ projectId, label }: { projectId: string; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/constitution/draft`, { method: "POST" });
    if (!res.ok) {
      setPending(false);
      setError((await res.json()).error ?? "Failed to draft Constitution");
      return;
    }
    const constitution = (await res.json()) as { id: string };
    await pollUntilStatusLeaves(`/api/constitutions/${constitution.id}`, "AI_DRAFTING");
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
