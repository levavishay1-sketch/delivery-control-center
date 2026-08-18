"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

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
    setMessage(res.ok ? "Sync queued" : data.error);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={onClick} disabled={pending}>
        {pending ? "Syncing…" : "Sync"}
      </Button>
      {message && <span className="text-xs text-neutral-500 dark:text-neutral-400">{message}</span>}
    </span>
  );
}
