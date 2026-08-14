"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ResolveBlockerButton({ blockerId }: { blockerId: string }) {
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
    router.refresh();
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
