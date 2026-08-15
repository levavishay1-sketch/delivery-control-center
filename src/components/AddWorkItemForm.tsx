"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AddWorkItemForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch("/api/work-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title, description }),
    });
    setPending(false);
    if (res.ok) {
      setTitle("");
      setDescription("");
      setOpen(false);
      router.refresh();
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm underline opacity-70 hover:opacity-100">
        + Add work item
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded border border-black/10 dark:border-white/15 p-3">
      <input
        required
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Work item title"
        className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
        rows={2}
        className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create work item"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm opacity-70 hover:opacity-100">
          Cancel
        </button>
      </div>
    </form>
  );
}
