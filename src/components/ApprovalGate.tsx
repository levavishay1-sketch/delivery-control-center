"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApproveRejectButtons } from "@/components/ui/ApproveRejectButtons";
import { Input } from "@/components/ui/FormField";

/**
 * Approve/reject gate — merged from the formerly byte-for-byte-identical
 * `ApprovalGate`/`ConstitutionApprovalGate` (design-system spec's
 * "Duplicate status and action components are consolidated" requirement),
 * parameterized by `apiBasePath` instead of duplicated per entity type.
 */
export function ApprovalGate({ apiBasePath }: { apiBasePath: string }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setPending(decision);
    setError(null);
    const res = await fetch(`${apiBasePath}/${decision}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: comment || undefined }),
    });
    setPending(null);
    if (!res.ok) {
      setError((await res.json()).error ?? `Failed to ${decision}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-status-warning/30 bg-status-warning-bg p-3">
      <p className="text-xs font-medium text-status-warning">Awaiting gate approval</p>
      <Input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (optional)"
        aria-label="Approval comment"
      />
      <ApproveRejectButtons onApprove={() => decide("approve")} onReject={() => decide("reject")} pending={pending} />
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}
