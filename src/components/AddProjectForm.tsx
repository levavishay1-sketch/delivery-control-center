"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AddProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [integrationType, setIntegrationType] = useState<"MANUAL" | "JIRA">("MANUAL");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, key, integrationType }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to create project");
      return;
    }
    setName("");
    setKey("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 dark:border-white/15 p-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs opacity-70">Project name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Delivery Control Center"
          className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs opacity-70">Key</label>
        <input
          required
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          placeholder="DCC"
          className="w-24 rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs opacity-70">Integration</label>
        <select
          value={integrationType}
          onChange={(e) => setIntegrationType(e.target.value as "MANUAL" | "JIRA")}
          className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
        >
          <option value="MANUAL">Manual</option>
          <option value="JIRA">Jira</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add project"}
      </button>
      {error && <p className="w-full text-xs text-red-500">{error}</p>}
    </form>
  );
}
