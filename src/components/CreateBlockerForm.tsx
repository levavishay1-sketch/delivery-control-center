"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Member {
  id: string;
  name: string | null;
  email: string;
}

export function CreateBlockerForm({
  workItemId,
  members,
  defaultOwnerId,
  onCreated,
}: {
  workItemId: string;
  members: Member[];
  defaultOwnerId: string;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [requiredAction, setRequiredAction] = useState("");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [impact, setImpact] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/blockers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockingItemId: workItemId, reason, requiredAction, ownerId, impact: impact || undefined }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to create blocker");
      return;
    }
    setOpen(false);
    setReason("");
    setRequiredAction("");
    setImpact("");
    if (onCreated) onCreated();
    else router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded border border-black/15 dark:border-white/20 px-3 py-1.5 text-sm hover:bg-black/[.03] dark:hover:bg-white/[.04]">
        Create Blocker
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded border border-black/10 dark:border-white/15 p-3">
      <input
        required
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (why is this blocked?)"
        className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
      />
      <input
        required
        value={requiredAction}
        onChange={(e) => setRequiredAction(e.target.value)}
        placeholder="Required action (what needs to happen?)"
        className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
      />
      <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm">
        {members.map((m) => (
          <option key={m.id} value={m.id}>{m.name ?? m.email}</option>
        ))}
      </select>
      <input
        value={impact}
        onChange={(e) => setImpact(e.target.value)}
        placeholder="Impact (optional)"
        className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Creating…" : "Create Blocker"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm opacity-70 hover:opacity-100">
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
