"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, Input, Select } from "@/components/ui/FormField";

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
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Create a client before adding a project (see <code>npm run db:seed</code> for a default one).
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 rounded-card border border-border-hairline bg-surface p-4">
      <FormField label="Client" htmlFor="add-project-client">
        <Select id="add-project-client" aria-label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Project name" htmlFor="add-project-name" required>
        <Input
          id="add-project-name"
          aria-label="Project name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Delivery Control Center"
        />
      </FormField>
      <FormField label="Key" htmlFor="add-project-key" required>
        <Input
          id="add-project-key"
          aria-label="Key"
          required
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          placeholder="DCC"
          className="w-24"
        />
      </FormField>
      <FormField label="Integration" htmlFor="add-project-integration">
        <Select
          id="add-project-integration"
          value={integrationType}
          onChange={(e) => setIntegrationType(e.target.value as "MANUAL" | "JIRA")}
        >
          <option value="MANUAL">Manual</option>
          <option value="JIRA">Jira</option>
        </Select>
      </FormField>
      {integrationType === "JIRA" && (
        <div className="flex w-full flex-wrap gap-3 rounded-md border border-border-hairline bg-surface-muted p-3">
          <FormField label="Jira base URL" htmlFor="add-project-jira-url" required>
            <Input
              id="add-project-jira-url"
              required
              value={jiraBaseUrl}
              onChange={(e) => setJiraBaseUrl(e.target.value)}
              placeholder="https://your-org.atlassian.net"
            />
          </FormField>
          <FormField label="Jira email" htmlFor="add-project-jira-email" required>
            <Input
              id="add-project-jira-email"
              required
              type="email"
              value={jiraEmail}
              onChange={(e) => setJiraEmail(e.target.value)}
            />
          </FormField>
          <FormField label="Jira API token" htmlFor="add-project-jira-token" required>
            <Input
              id="add-project-jira-token"
              required
              type="password"
              value={jiraApiToken}
              onChange={(e) => setJiraApiToken(e.target.value)}
            />
          </FormField>
          <FormField label="Jira project key" htmlFor="add-project-jira-key" required>
            <Input
              id="add-project-jira-key"
              required
              value={jiraProjectKey}
              onChange={(e) => setJiraProjectKey(e.target.value.toUpperCase())}
              placeholder="PROJ"
              className="w-28"
            />
          </FormField>
        </div>
      )}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Adding…" : "Add project"}
      </Button>
      {error && <p className="w-full text-xs text-status-critical">{error}</p>}
    </form>
  );
}
