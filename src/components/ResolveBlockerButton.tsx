"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

/** onResolved, if given (e.g. the Quick View drawer, whose data isn't a Server Component), is called instead of router.refresh(). */
export function ResolveBlockerButton({ blockerId, onResolved }: { blockerId: string; onResolved?: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/blockers/${blockerId}/resolve`, { method: "POST" });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to resolve");
      return;
    }
    if (onResolved) onResolved();
    else router.refresh();
  }

  return (
    <div className="flex w-fit flex-col gap-1 self-start">
      <Button variant="primary" size="sm" onClick={resolve} disabled={pending}>
        {pending ? "Resolving…" : "Resolve Blocker"}
      </Button>
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}
