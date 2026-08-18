"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, Input, Select } from "@/components/ui/FormField";

type ConnectorType = "MANUAL" | "JIRA" | "AZURE_DEVOPS" | "GITHUB";

/** Connection config field names per connector type — matches each adapter's resolveConfig. */
const CONFIG_FIELDS: Record<ConnectorType, { key: string; label: string; secret?: boolean }[]> = {
  MANUAL: [],
  JIRA: [
    { key: "baseUrl", label: "Base URL" },
    { key: "email", label: "Email" },
    { key: "apiToken", label: "API token", secret: true },
    { key: "projectKey", label: "Project key" },
  ],
  AZURE_DEVOPS: [
    { key: "orgUrl", label: "Organization URL" },
    { key: "project", label: "Project" },
    { key: "pat", label: "Personal access token", secret: true },
    { key: "webhookSecret", label: "Webhook secret (optional)", secret: true },
  ],
  GITHUB: [
    { key: "owner", label: "Repo owner" },
    { key: "repo", label: "Repo name" },
    { key: "token", label: "Access token", secret: true },
    { key: "webhookSecret", label: "Webhook secret (optional)", secret: true },
  ],
};

/** Configures a project's connector type and connection config. WRITE_ROLES-gated server-side; render this only for a caller already known to have write access. */
export function ConnectorConfigForm({ projectId, currentType }: { projectId: string; currentType: ConnectorType }) {
  const router = useRouter();
  const [type, setType] = useState<ConnectorType>(currentType);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(false);

    const res = await fetch(`/api/projects/${projectId}/connector`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, config: type === "MANUAL" ? null : config }),
    });
    const data = await res.json();
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to configure connector");
      return;
    }
    setSuccess(true);
    router.refresh();
  }

  const fields = CONFIG_FIELDS[type];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormField label="Type" htmlFor="connector-type" className="max-w-xs">
        <Select id="connector-type" value={type} onChange={(e) => setType(e.target.value as ConnectorType)}>
          <option value="MANUAL">Manual</option>
          <option value="JIRA">Jira</option>
          <option value="AZURE_DEVOPS">Azure DevOps</option>
          <option value="GITHUB">GitHub</option>
        </Select>
      </FormField>

      {fields.map((field) => (
        <FormField key={field.key} label={field.label} htmlFor={`connector-${field.key}`} className="max-w-xs">
          <Input
            id={`connector-${field.key}`}
            type={field.secret ? "password" : "text"}
            value={config[field.key] ?? ""}
            onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
          />
        </FormField>
      ))}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save connector"}
        </Button>
        {success && <span className="text-xs text-status-healthy">Saved</span>}
        {error && <span className="text-xs text-status-critical">{error}</span>}
      </div>
    </form>
  );
}
