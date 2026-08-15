"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Member {
  id: string;
  name: string | null;
  email: string;
}

export function EditWorkItemForm({
  workItemId,
  initial,
  members,
  onDone,
  onChanged,
}: {
  workItemId: string;
  initial: {
    title: string;
    description: string | null;
    risk: string;
    priority: string;
    ownerId: string | null;
    executorType: string;
    executorId: string | null;
    dueDate: string | null;
    progress: number;
  };
  members: Member[];
  onDone: () => void;
  /** If given (e.g. by the Quick View drawer, whose data isn't a Server Component), called after a save instead of the default router.refresh(). */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [risk, setRisk] = useState(initial.risk);
  const [priority, setPriority] = useState(initial.priority);
  const [ownerId, setOwnerId] = useState(initial.ownerId ?? "");
  const [executorType, setExecutorType] = useState(initial.executorType);
  const [executorId, setExecutorId] = useState(initial.executorId ?? "");
  const [dueDate, setDueDate] = useState(initial.dueDate ?? "");
  const [progress, setProgress] = useState(initial.progress);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch(`/api/work-items/${workItemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: description || undefined,
        risk,
        priority,
        ownerId: ownerId || undefined,
        executorType,
        executorId: executorId || undefined,
        dueDate: dueDate || null,
        progress,
      }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to save");
      return;
    }
    onDone();
    if (onChanged) onChanged();
    else router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-black/10 dark:border-white/15 p-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs opacity-70">Title</label>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs opacity-70">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs opacity-70">Risk</label>
          <select value={risk} onChange={(e) => setRisk(e.target.value)} className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm">
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs opacity-70">Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm">
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs opacity-70">Owner</label>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm">
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name ?? m.email}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs opacity-70">Executor type</label>
          <select value={executorType} onChange={(e) => setExecutorType(e.target.value)} className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm">
            {["UNASSIGNED", "HUMAN", "AI_AGENT", "HYBRID"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        {executorType === "HUMAN" && (
          <div className="flex flex-col gap-1">
            <label className="text-xs opacity-70">Executor</label>
            <select value={executorId} onChange={(e) => setExecutorId(e.target.value)} className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm">
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name ?? m.email}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs opacity-70">Due date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs opacity-70">Progress ({progress}%)</label>
          <input
            type="range"
            min={0}
            max={100}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50">
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={onDone} className="text-sm opacity-70 hover:opacity-100">
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
