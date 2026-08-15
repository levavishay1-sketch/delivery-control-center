"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
    <div className="flex flex-col gap-1">
      <button
        onClick={resolve}
        disabled={pending}
        className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Resolving…" : "Resolve Blocker"}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
