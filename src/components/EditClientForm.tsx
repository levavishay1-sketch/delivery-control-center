"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, Input } from "@/components/ui/FormField";

export function EditClientForm({
  clientId,
  initialName,
  initialSlug,
}: {
  clientId: string;
  initialName: string;
  initialSlug: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slug }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to update client");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <FormField label="Client name" htmlFor="edit-client-name" required>
        <Input id="edit-client-name" aria-label="Client name" required value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <FormField label="Slug" htmlFor="edit-client-slug" required>
        <Input
          id="edit-client-slug"
          aria-label="Slug"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          className="w-40"
        />
      </FormField>
      <Button type="submit" variant="primary" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {saved && !pending && <span className="text-xs text-status-healthy">Saved</span>}
      {error && <p className="w-full text-xs text-status-critical">{error}</p>}
    </form>
  );
}
