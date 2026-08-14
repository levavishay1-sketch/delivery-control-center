"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ClientOption {
  id: string;
  name: string;
}

export function AddProjectForm({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [integrationType, setIntegrationType] = useState<"MANUAL" | "JIRA">("MANUAL");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const integrationConfig =
      integrationType === "JIRA"
        ? { baseUrl: jiraBaseUrl, email: jiraEmail, apiToken: jiraApiToken, projectKey: jiraProjectKey }
        : undefined;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, name, key, integrationType, integrationConfig }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to create project");
      return;
    }
    setName("");
    setKey("");
    setJiraBaseUrl("");
    setJiraEmail("");
    setJiraApiToken("");
    setJiraProjectKey("");
    router.refresh();
  }

  if (clients.length === 0) {
    return (
      <p className="text-sm opacity-60">
        Create a client before adding a project (see <code>npm run db:seed</code> for a default one).
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 dark:border-white/15 p-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs opacity-70">Client</label>
        <select
          aria-label="Client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs opacity-70">Project name</label>
        <input
          aria-label="Project name"
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
          aria-label="Key"
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
      {integrationType === "JIRA" && (
        <div className="flex w-full flex-wrap gap-3 rounded border border-black/10 dark:border-white/10 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs opacity-70">Jira base URL</label>
            <input
              required
              value={jiraBaseUrl}
              onChange={(e) => setJiraBaseUrl(e.target.value)}
              placeholder="https://your-org.atlassian.net"
              className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs opacity-70">Jira email</label>
            <input
              required
              type="email"
              value={jiraEmail}
              onChange={(e) => setJiraEmail(e.target.value)}
              className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs opacity-70">Jira API token</label>
            <input
              required
              type="password"
              value={jiraApiToken}
              onChange={(e) => setJiraApiToken(e.target.value)}
              className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs opacity-70">Jira project key</label>
            <input
              required
              value={jiraProjectKey}
              onChange={(e) => setJiraProjectKey(e.target.value.toUpperCase())}
              placeholder="PROJ"
              className="w-28 rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
            />
          </div>
        </div>
      )}
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
