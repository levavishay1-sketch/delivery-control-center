"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApprovalGate({ stageId }: { stageId: string }) {
  const router = useRouter();
  const [approverName, setApproverName] = useState("");
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    if (!approverName.trim()) {
      setError("Approver name is required.");
      return;
    }
    setPending(decision);
    setError(null);
    const res = await fetch(`/api/stages/${stageId}/${decision}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approverName, comment: comment || undefined }),
    });
    setPending(null);
    if (!res.ok) {
      setError((await res.json()).error ?? `Failed to ${decision}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Awaiting gate approval</p>
      <input
        value={approverName}
        onChange={(e) => setApproverName(e.target.value)}
        placeholder="Your name"
        className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
      />
      <input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (optional)"
        className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
      />
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
