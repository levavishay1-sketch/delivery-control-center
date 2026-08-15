"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Sets or clears a client's or project's AI spending limit. WRITE_ROLES-gated server-side; render this only for a caller already known to have write access. */
export function BudgetForm({ scope, id, currentBudgetUsd }: { scope: "client" | "project"; id: string; currentBudgetUsd: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(currentBudgetUsd ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(budgetUsd: number | null) {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/${scope}s/${id}/ai-budget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetUsd }),
    });
    const data = await res.json();
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to update budget");
      return;
    }
    router.refresh();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = value.trim() === "" ? null : Number(value);
        submit(parsed === null || Number.isNaN(parsed) ? null : parsed);
      }}
      className="flex items-center gap-2"
    >
      <label className="text-xs opacity-60" htmlFor={`ai-budget-${scope}-${id}`}>
        AI budget ($)
      </label>
      <input
        id={`ai-budget-${scope}-${id}`}
        type="number"
        min="0"
        step="0.0001"
        placeholder="No limit"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-24 rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-xs"
      />
      <button type="submit" disabled={pending} className="text-xs underline opacity-70 hover:opacity-100 disabled:opacity-40">
        {pending ? "Saving…" : "Save"}
      </button>
      {currentBudgetUsd && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setValue("");
            submit(null);
          }}
          className="text-xs underline opacity-50 hover:opacity-100 disabled:opacity-40"
        >
          Clear
        </button>
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </form>
  );
}
