"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RemoveDependencyButton({ dependencyId, onRemoved }: { dependencyId: string; onRemoved?: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/dependencies/${dependencyId}`, { method: "DELETE" });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to remove");
      return;
    }
    if (onRemoved) onRemoved();
    else router.refresh();
  }

  return (
    <span className="flex flex-col items-end gap-0.5">
      <button onClick={remove} disabled={pending} className="text-xs text-red-500 underline disabled:opacity-50">
        {pending ? "Removing…" : "Remove"}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  );
}
