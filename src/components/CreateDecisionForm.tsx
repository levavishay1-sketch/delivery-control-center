"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/FormField";

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
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Create Decision
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-md border border-border-hairline bg-surface p-3">
      <Input
        required
        autoFocus
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Question (what needs to be decided?)"
        aria-label="Question"
      />
      <Input
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (why is this decision needed?)"
        aria-label="Reason"
      />
      <Input
        required
        value={impact}
        onChange={(e) => setImpact(e.target.value)}
        placeholder="Impact (consequence of the decision)"
        aria-label="Impact"
      />
      <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="Deadline" />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create Decision"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </form>
  );
}
