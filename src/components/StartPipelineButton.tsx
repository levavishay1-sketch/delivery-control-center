"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * onStarted, if given (e.g. the Quick View drawer, whose data isn't a Server Component), is
 * called instead of router.refresh(). `compact` renders a smaller inline variant for list rows.
 */
export function StartPipelineButton({
  workItemId,
  onStarted,
  compact,
}: {
  workItemId: string;
  onStarted?: () => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/work-items/${workItemId}/pipeline`, { method: "POST" });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to start pipeline");
      return;
    }
    if (onStarted) onStarted();
    else router.refresh();
  }

  return (
    <div className={compact ? "flex items-center gap-1" : "flex flex-col gap-1"}>
      <button
        onClick={start}
        disabled={pending}
        className={
          compact
            ? "rounded border border-black/15 dark:border-white/20 px-2 py-0.5 text-xs font-medium hover:bg-black/[.03] dark:hover:bg-white/[.04] disabled:opacity-50"
            : "rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
        }
      >
        {pending ? "Starting…" : "Start SDD"}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
