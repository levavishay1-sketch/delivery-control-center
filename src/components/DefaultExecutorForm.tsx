"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, Select } from "@/components/ui/FormField";

interface Member {
  id: string;
  name: string | null;
  email: string;
}

interface CascadeItem {
  id: string;
  title: string;
  executorType: string;
  executorId: string | null;
}

interface Preview {
  affected: CascadeItem[];
  unaffected: CascadeItem[];
}

/** Preview→Confirm flow for changing a Project's default executor (Slice 19) — modeled UX-wise on Configuration Center's Preview→Confirm-impact pattern, not sharing its code. */
export function DefaultExecutorForm({
  projectId,
  current,
  members,
}: {
  projectId: string;
  current: { executorType: string; executorId: string | null };
  members: Member[];
}) {
  const router = useRouter();
  const [executorType, setExecutorType] = useState(current.executorType);
  const [executorId, setExecutorId] = useState(current.executorId ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPreview(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/default-executor/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executorType, executorId: executorId || undefined }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to preview");
      return;
    }
    setPreview(await res.json());
  }

  async function onConfirm(option: "INHERITED_ONLY" | "REASSIGN_ALL") {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/default-executor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executorType, executorId: executorId || undefined, option }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to apply");
      return;
    }
    setPreview(null);
    router.refresh();
  }

  if (preview) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-border-hairline bg-surface p-3">
        <p className="text-sm">
          Changing the default executor to <strong>{executorType}</strong>
          {executorId && ` (${members.find((m) => m.id === executorId)?.name ?? executorId})`}:
        </p>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Will move automatically ({preview.affected.length})
          </p>
          {preview.affected.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">None</p>
          ) : (
            <ul className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
              {preview.affected.map((i) => (
                <li key={i.id}>{i.title}</li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Has its own explicit assignment — untouched unless you choose to reassign ({preview.unaffected.length})
          </p>
          {preview.unaffected.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">None</p>
          ) : (
            <ul className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
              {preview.unaffected.map((i) => (
                <li key={i.id}>
                  {i.title} — currently {i.executorType}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => onConfirm("INHERITED_ONLY")}>
            Apply to unassigned only
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => onConfirm("REASSIGN_ALL")}>
            Reassign everyone
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => setPreview(null)}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-xs text-status-critical">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={onPreview} className="flex flex-col gap-3 rounded-md border border-border-hairline bg-surface p-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Default executor type" htmlFor="default-executor-type">
          <Select id="default-executor-type" value={executorType} onChange={(e) => setExecutorType(e.target.value)}>
            {["UNASSIGNED", "HUMAN", "AI_AGENT", "HYBRID"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </FormField>
        {executorType === "HUMAN" && (
          <FormField label="Default executor" htmlFor="default-executor">
            <Select id="default-executor" value={executorId} onChange={(e) => setExecutorId(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ?? m.email}
                </option>
              ))}
            </Select>
          </FormField>
        )}
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Loading…" : "Preview change"}
        </Button>
      </div>
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </form>
  );
}
