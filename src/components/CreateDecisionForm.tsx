"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateDecisionForm({ workItemId, onCreated }: { workItemId: string; onCreated?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState("");
  const [deadline, setDeadline] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workItemId, question, reason, impact, deadline: deadline || undefined }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to create decision");
      return;
    }
    setOpen(false);
    setQuestion("");
    setReason("");
    setImpact("");
    setDeadline("");
    if (onCreated) onCreated();
    else router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded border border-black/15 dark:border-white/20 px-3 py-1.5 text-sm hover:bg-black/[.03] dark:hover:bg-white/[.04]">
        Create Decision
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded border border-black/10 dark:border-white/15 p-3">
      <input
        required
        autoFocus
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Question (what needs to be decided?)"
        className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
      />
      <input
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (why is this decision needed?)"
        className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
      />
      <input
        required
        value={impact}
        onChange={(e) => setImpact(e.target.value)}
        placeholder="Impact (consequence of the decision)"
        className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
      />
      <input
        type="date"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
        className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Creating…" : "Create Decision"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm opacity-70 hover:opacity-100">
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
