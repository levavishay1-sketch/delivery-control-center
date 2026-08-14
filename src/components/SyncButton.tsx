"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setMessage(null);
    const res = await fetch(`/api/projects/${projectId}/sync`, { method: "POST" });
    const data = await res.json();
    setPending(false);
    setMessage(res.ok ? `Synced ${data.synced} (${data.newPipelines} new)` : data.error);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={onClick} disabled={pending} className="text-sm underline opacity-70 hover:opacity-100 disabled:opacity-40">
        {pending ? "Syncing…" : "Sync"}
      </button>
      {message && <span className="text-xs opacity-60">{message}</span>}
    </span>
  );
}
