"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ProjectItem {
  id: string;
  title: string;
}

export function AddDependencyForm({ workItemId, candidates }: { workItemId: string; candidates: ProjectItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dependsOnWorkItemId, setDependsOnWorkItemId] = useState(candidates[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/dependencies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workItemId, dependsOnWorkItemId, reason }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to add dependency");
      return;
    }
    setOpen(false);
    setReason("");
    router.refresh();
  }

  if (candidates.length === 0) return null;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded border border-black/15 dark:border-white/20 px-3 py-1.5 text-sm hover:bg-black/[.03] dark:hover:bg-white/[.04]">
        + Add Dependency
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded border border-black/10 dark:border-white/15 p-3">
      <select value={dependsOnWorkItemId} onChange={(e) => setDependsOnWorkItemId(e.target.value)} className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm">
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>{c.title}</option>
        ))}
      </select>
      <input
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for the dependency"
        className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50">
          {pending ? "Adding…" : "Add Dependency"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm opacity-70 hover:opacity-100">
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
