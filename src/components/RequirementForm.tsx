"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, Input, Select, Textarea } from "@/components/ui/FormField";
import { InfoTooltip } from "@/components/ui/InfoTooltip";

interface ProjectOption {
  id: string;
  name: string;
}

const TYPE_OPTIONS = ["TASK", "PROJECT", "BUG", "CHANGE"] as const;

/** Creates a Requirement for a client — standalone, or linked to one of its existing Projects. */
export function RequirementForm({ clientId, projects }: { clientId: string; projects: ProjectOption[] }) {
  const router = useRouter();
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]>("TASK");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, type, title, description: description || undefined, projectId: projectId || undefined }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to create Requirement");
      return;
    }
    setTitle("");
    setDescription("");
    setProjectId("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 rounded-card border border-border-hairline bg-surface p-4">
      <FormField label="Type" htmlFor="add-requirement-type">
        <Select
          id="add-requirement-type"
          aria-label="Type"
          value={type}
          onChange={(e) => setType(e.target.value as (typeof TYPE_OPTIONS)[number])}
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Title" htmlFor="add-requirement-title" required className="min-w-48 flex-1">
        <Input
          id="add-requirement-title"
          aria-label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Improve onboarding flow"
        />
      </FormField>
      <div className="flex items-center gap-1.5">
        <FormField label="Project (optional)" htmlFor="add-requirement-project">
          <Select
            id="add-requirement-project"
            aria-label="Project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={projects.length === 0}
          >
            <option value="">Standalone</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </FormField>
        <InfoTooltip label="About standalone vs. linked Requirements">
          A standalone Requirement has no Project yet — starting SDD on it creates one. Linking it
          to an existing Project uses that Project instead.
        </InfoTooltip>
      </div>
      <FormField label="Description (optional)" htmlFor="add-requirement-description" className="w-full">
        <Textarea
          id="add-requirement-description"
          aria-label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </FormField>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Adding…" : "Add Requirement"}
      </Button>
      {error && <p className="w-full text-xs text-status-critical">{error}</p>}
    </form>
  );
}
