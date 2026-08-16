"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, Input, Select } from "@/components/ui/FormField";

interface OrganizationOption {
  id: string;
  name: string;
}

export function AddClientForm({ organizations }: { organizations: OrganizationOption[] }) {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, name, slug }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to create client");
      return;
    }
    setName("");
    setSlug("");
    router.refresh();
  }

  if (organizations.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        No organization available to create a client under.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 rounded-card border border-border-hairline bg-surface p-4">
      {organizations.length > 1 && (
        <FormField label="Organization" htmlFor="add-client-org">
          <Select id="add-client-org" aria-label="Organization" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <FormField label="Client name" htmlFor="add-client-name" required>
        <Input
          id="add-client-name"
          aria-label="Client name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Corp"
        />
      </FormField>
      <FormField label="Slug" htmlFor="add-client-slug" required>
        <Input
          id="add-client-slug"
          aria-label="Slug"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder="acme-corp"
          className="w-40"
        />
      </FormField>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Adding…" : "Add client"}
      </Button>
      {error && <p className="w-full text-xs text-status-critical">{error}</p>}
    </form>
  );
}
