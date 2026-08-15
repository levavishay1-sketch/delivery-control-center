"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs">
        <span className="opacity-60">Type</span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ConnectorType)}
          className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-xs"
        >
          <option value="MANUAL">Manual</option>
          <option value="JIRA">Jira</option>
          <option value="AZURE_DEVOPS">Azure DevOps</option>
          <option value="GITHUB">GitHub</option>
        </select>
      </label>

      {fields.map((field) => (
        <label key={field.key} className="flex items-center gap-2 text-xs">
          <span className="w-40 opacity-60">{field.label}</span>
          <input
            type={field.secret ? "password" : "text"}
            value={config[field.key] ?? ""}
            onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
            className="w-56 rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-xs"
          />
        </label>
      ))}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save connector"}
        </button>
        {success && <span className="text-xs text-green-600 dark:text-green-400">Saved</span>}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </form>
  );
}
