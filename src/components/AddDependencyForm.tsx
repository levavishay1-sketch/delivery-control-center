"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/FormField";

interface ProjectItem {
  id: string;
  title: string;
}

export function AddDependencyForm({
  workItemId,
  candidates,
  onAdded,
}: {
  workItemId: string;
  candidates: ProjectItem[];
  onAdded?: () => void;
}) {
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
    if (onAdded) onAdded();
    else router.refresh();
  }

  if (candidates.length === 0) return null;

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        + Add Dependency
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-md border border-border-hairline bg-surface p-3">
      <Select value={dependsOnWorkItemId} onChange={(e) => setDependsOnWorkItemId(e.target.value)} aria-label="Depends on">
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </Select>
      <Input
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for the dependency"
        aria-label="Reason"
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add Dependency"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </form>
  );
}
