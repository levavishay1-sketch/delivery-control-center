"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** onDecided, if given (e.g. the Quick View drawer, whose data isn't a Server Component), is called instead of router.refresh(). */
export function DecisionActions({ decisionId, onDecided }: { decisionId: string; onDecided?: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setPending(decision);
    setError(null);
    const res = await fetch(`/api/decisions/${decisionId}/${decision}`, { method: "POST" });
    setPending(null);
    if (!res.ok) {
      setError((await res.json()).error ?? `Failed to ${decision}`);
      return;
    }
    if (onDecided) onDecided();
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <button
          onClick={() => decide("approve")}
          disabled={pending !== null}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          onClick={() => decide("reject")}
          disabled={pending !== null}
          className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
