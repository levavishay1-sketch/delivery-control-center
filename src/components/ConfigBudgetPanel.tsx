"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Scope = "ORGANIZATION" | "CLIENT" | "PROJECT";

const API_SEGMENT: Record<Scope, string> = {
  ORGANIZATION: "organization",
  CLIENT: "clients",
  PROJECT: "projects",
};

const SCOPE_LABEL: Record<Scope, string> = {
  ORGANIZATION: "organization",
  CLIENT: "client",
  PROJECT: "project",
};

interface EffectiveBudget {
  value: string | null;
  sourceScope: Scope | null;
  isOverride: boolean;
}

interface BudgetImpactPreview {
  affectedClients: number;
  affectedProjects: number;
}

/**
 * Shows a scope's effective AI budget (value + inherited-or-override source), an editable
 * value field, and a Reset-to-inherited action. Organization/Client scopes preview cascade
 * impact before saving (design.md decision 3); Project scope saves directly, no preview
 * (design.md decision 4). WRITE_ROLES/org-admin-gated server-side; render this only for a
 * caller already known to have write access.
 */
export function ConfigBudgetPanel({ scope, id, effective }: { scope: Scope; id: string; effective: EffectiveBudget }) {
  const router = useRouter();
  const [value, setValue] = useState(effective.isOverride ? (effective.value ?? "") : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ budgetUsd: number | null; impact: BudgetImpactPreview } | null>(null);

  const base = `/api/config/${API_SEGMENT[scope]}/${id}`;
  const hasPreview = scope !== "PROJECT";

  function parseValue(): number | null {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }

  async function save(budgetUsd: number | null) {
    setPending(true);
    setError(null);
    const res = await fetch(`${base}/budget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetUsd }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to update budget");
      return;
    }
    setPreview(null);
    router.refresh();
  }

  async function requestChange(budgetUsd: number | null) {
    if (!hasPreview) {
      await save(budgetUsd);
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch(`${base}/preview`, { method: "POST" });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to preview impact");
      return;
    }
    const impact: BudgetImpactPreview = await res.json();
    setPreview({ budgetUsd, impact });
  }

  if (preview) {
    const { budgetUsd, impact } = preview;
    const nothingAffected = impact.affectedClients === 0 && impact.affectedProjects === 0;
    return (
      <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
        <p className="font-medium text-amber-600 dark:text-amber-400">
          {budgetUsd === null ? `Reset the ${SCOPE_LABEL[scope]} budget to inherited` : `Set the ${SCOPE_LABEL[scope]} budget to $${budgetUsd}`}
        </p>
        <p className="mt-1 opacity-70">
          {nothingAffected
            ? "No clients or projects currently inherit this scope's value — nothing else is affected."
            : `Affects ${impact.affectedClients} client${impact.affectedClients === 1 ? "" : "s"} and ${impact.affectedProjects} project${impact.affectedProjects === 1 ? "" : "s"} with no override of their own.`}
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setPreview(null)}
            disabled={pending}
            className="rounded border border-black/15 dark:border-white/20 px-2 py-1 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save(budgetUsd)}
            disabled={pending}
            className="rounded bg-foreground px-2 py-1 text-background disabled:opacity-40"
          >
            {pending ? "…" : "Confirm"}
          </button>
        </div>
        {error && <p className="mt-1 text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        requestChange(parseValue());
      }}
      className="flex flex-wrap items-center gap-2 text-xs"
    >
      <span className="opacity-60">Effective budget:</span>
      <span className="font-mono">{effective.value ? `$${effective.value}` : "No limit"}</span>
      {effective.sourceScope && (
        <span className="opacity-50">({effective.isOverride ? "own override" : `inherited from ${SCOPE_LABEL[effective.sourceScope]}`})</span>
      )}
      <label className="ml-2 opacity-60" htmlFor={`config-budget-${scope}-${id}`}>
        Set ($)
      </label>
      <input
        id={`config-budget-${scope}-${id}`}
        type="number"
        min="0"
        step="0.0001"
        placeholder="No limit"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-24 rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1"
      />
      <button type="submit" disabled={pending} className="underline opacity-70 hover:opacity-100 disabled:opacity-40">
        {pending ? "…" : hasPreview ? "Preview" : "Save"}
      </button>
      {effective.isOverride && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setValue("");
            requestChange(null);
          }}
          className="underline opacity-50 hover:opacity-100 disabled:opacity-40"
        >
          Reset to inherited
        </button>
      )}
      {error && <span className="text-red-500">{error}</span>}
    </form>
  );
}
