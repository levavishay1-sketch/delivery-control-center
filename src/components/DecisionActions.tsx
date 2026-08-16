"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApproveRejectButtons } from "@/components/ui/ApproveRejectButtons";

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
      <ApproveRejectButtons onApprove={() => decide("approve")} onReject={() => decide("reject")} pending={pending} />
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}
