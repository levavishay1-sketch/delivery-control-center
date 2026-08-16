"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, Input, Select, Textarea } from "@/components/ui/FormField";

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
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-card border border-border-hairline bg-surface p-4">
      <FormField label="Title" htmlFor="edit-wi-title" required>
        <Input id="edit-wi-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </FormField>
      <FormField label="Description" htmlFor="edit-wi-description">
        <Textarea id="edit-wi-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Risk" htmlFor="edit-wi-risk">
          <Select id="edit-wi-risk" value={risk} onChange={(e) => setRisk(e.target.value)}>
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Priority" htmlFor="edit-wi-priority">
          <Select id="edit-wi-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Owner" htmlFor="edit-wi-owner">
          <Select id="edit-wi-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? m.email}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Executor type" htmlFor="edit-wi-executor-type">
          <Select id="edit-wi-executor-type" value={executorType} onChange={(e) => setExecutorType(e.target.value)}>
            {["UNASSIGNED", "HUMAN", "AI_AGENT", "HYBRID"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </FormField>
        {executorType === "HUMAN" && (
          <FormField label="Executor" htmlFor="edit-wi-executor">
            <Select id="edit-wi-executor" value={executorId} onChange={(e) => setExecutorId(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ?? m.email}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField label="Due date" htmlFor="edit-wi-due-date">
          <Input id="edit-wi-due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FormField>
        <FormField label={`Progress (${progress}%)`} htmlFor="edit-wi-progress">
          <input
            id="edit-wi-progress"
            type="range"
            min={0}
            max={100}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="accent-accent"
          />
        </FormField>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </form>
  );
}
