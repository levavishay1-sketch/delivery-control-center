"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

/** Triggers a Discovery run for a repository. Render only for a caller already known to have write access. */
export function RunDiscoveryButton({ repositoryId, hasExisting }: { repositoryId: string; hasExisting: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/repositories/${repositoryId}/discovery`, { method: "POST" });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to start Discovery");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="primary" size="sm" onClick={run} disabled={pending}>
        {pending ? "Starting…" : hasExisting ? "Run Discovery again" : "Run Discovery"}
      </Button>
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}
