"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { InfoTooltip } from "@/components/ui/InfoTooltip";

/** Deactivates or reactivates a client (Slice 12: two symmetric commands over the same `active` flag, not a one-way door). Render only for a caller already known to be an org admin. */
export function ClientActivationControl({ clientId, active }: { clientId: string; active: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/clients/${clientId}/${active ? "deactivate" : "reactivate"}`, { method: "POST" });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to update client status");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant={active ? "destructive" : "primary"} size="sm" onClick={toggle} disabled={pending}>
        {pending ? "…" : active ? "Deactivate" : "Reactivate"}
      </Button>
      <InfoTooltip label={active ? "What deactivating does" : "What reactivating does"}>
        {active
          ? "Hides this client's projects from the Dashboard and Attention Center. All historical data — projects, work items, audit trail, cost records — is preserved, and it can be reactivated at any time."
          : "Restores this client's projects to the Dashboard and Attention Center."}
      </InfoTooltip>
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}
