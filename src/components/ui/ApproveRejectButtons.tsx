import { Button } from "@/components/ui/Button";

/**
 * The shared approve/reject button pair (design-system spec's "Duplicate
 * status and action components are consolidated" requirement) — used by
 * `ApprovalGate` (stage/Constitution gates) and `DecisionActions`
 * (decision approve/reject), which previously hand-rolled this same pair
 * independently. Purely controlled/presentational: the caller owns the
 * pending/error state, since each context surfaces errors differently
 * (`ApprovalGate` also gates an adjacent comment field).
 */
export function ApproveRejectButtons({
  onApprove,
  onReject,
  pending,
}: {
  onApprove: () => void;
  onReject: () => void;
  pending: "approve" | "reject" | null;
}) {
  return (
    <div className="flex gap-2">
      <Button variant="primary" size="sm" onClick={onApprove} disabled={pending !== null}>
        {pending === "approve" ? "Approving…" : "Approve"}
      </Button>
      <Button variant="destructive" size="sm" onClick={onReject} disabled={pending !== null}>
        {pending === "reject" ? "Rejecting…" : "Reject"}
      </Button>
    </div>
  );
}
