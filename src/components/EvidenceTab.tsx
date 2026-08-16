"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/FormField";

interface CompletionPolicy {
  satisfied: boolean;
  missing?: string[];
}

/**
 * Shows a work item's completion-policy state in plain language (evidence-driven-completion
 * spec's Evidence tab), and — for a write-capable role, when unsatisfied — the exception-approval
 * action.
 */
export function EvidenceTab({
  workItemId,
  policy,
  hasException,
  canManage,
}: {
  workItemId: string;
  policy: CompletionPolicy;
  hasException: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch(`/api/work-items/${workItemId}/completion-exception`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to approve exception");
      return;
    }
    setReason("");
    router.refresh();
  }

  if (policy.satisfied) {
    return (
      <p className="text-sm text-status-healthy">
        {hasException
          ? "Completion exception approved — this work item can be completed without further evidence."
          : "Completion policy satisfied — a merged pull request with passing tests is linked."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-card border border-status-warning/30 bg-status-warning-bg p-3 text-sm">
        <p className="font-medium text-status-warning">Completion policy not yet satisfied</p>
        <ul className="mt-1 list-disc pl-4 text-xs text-neutral-600 dark:text-neutral-300">
          {(policy.missing ?? []).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      {canManage && (
        <div className="flex flex-col gap-2">
          <label htmlFor="exception-reason" className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Approve a completion exception
          </label>
          <Textarea
            id="exception-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason this work item can complete without qualifying evidence"
            rows={2}
          />
          <Button variant="primary" size="sm" onClick={approve} disabled={pending} className="self-start">
            {pending ? "Approving…" : "Approve exception"}
          </Button>
          {error && <p className="text-xs text-status-critical">{error}</p>}
        </div>
      )}
    </div>
  );
}
