"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/FormField";

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
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Create Blocker
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-md border border-border-hairline bg-surface p-3">
      <Input
        required
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (why is this blocked?)"
        aria-label="Reason"
      />
      <Input
        required
        value={requiredAction}
        onChange={(e) => setRequiredAction(e.target.value)}
        placeholder="Required action (what needs to happen?)"
        aria-label="Required action"
      />
      <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} aria-label="Owner">
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name ?? m.email}
          </option>
        ))}
      </Select>
      <Input value={impact} onChange={(e) => setImpact(e.target.value)} placeholder="Impact (optional)" aria-label="Impact" />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create Blocker"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </form>
  );
}
