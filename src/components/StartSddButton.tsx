"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

/** Triggers SDD Activation for an open Requirement. Render only for a caller already known to have write access. */
export function StartSddButton({ requirementId }: { requirementId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/requirements/${requirementId}/start-sdd`, { method: "POST" });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to start SDD");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="primary" size="sm" onClick={run} disabled={pending}>
        {pending ? "Starting…" : "Start SDD"}
      </Button>
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}
