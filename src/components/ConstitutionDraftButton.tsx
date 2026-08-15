"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { pollUntilStatusLeaves } from "@/lib/pollStatus";

interface BudgetExceeded {
  scope: "client" | "project" | "organization";
  clientId: string;
  projectId: string;
  organizationId: string | null;
}

/** `canApprove` (WRITE_ROLES) controls whether a budget-exceeded refusal offers "Approve & retry" — computed server-side and passed down. */
export function ConstitutionDraftButton({ projectId, label, canApprove = false }: { projectId: string; label: string; canApprove?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetExceeded, setBudgetExceeded] = useState<BudgetExceeded | null>(null);

  async function draft() {
    setPending(true);
    setError(null);
    setBudgetExceeded(null);
    const res = await fetch(`/api/projects/${projectId}/constitution/draft`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      setPending(false);
      setError(data.error ?? "Failed to draft Constitution");
      if (data.budgetExceeded) setBudgetExceeded(data.budgetExceeded);
      return;
    }
    const constitution = (await res.json()) as { id: string };
    await pollUntilStatusLeaves(`/api/constitutions/${constitution.id}`, "AI_DRAFTING");
    setPending(false);
    router.refresh();
  }

  async function approveAndRetry() {
    if (!budgetExceeded) return;
    setPending(true);
    const path =
      budgetExceeded.scope === "project"
        ? `/api/projects/${budgetExceeded.projectId}`
        : budgetExceeded.scope === "organization"
          ? `/api/organizations/${budgetExceeded.organizationId}`
          : `/api/clients/${budgetExceeded.clientId}`;
    const res = await fetch(`${path}/budget-override`, { method: "POST" });
    if (!res.ok) {
      setPending(false);
      setError((await res.json()).error ?? "Failed to approve budget override");
      return;
    }
    await draft();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={draft}
          disabled={pending}
          className="rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "Drafting…" : label}
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
      {budgetExceeded && canApprove && (
        <button
          onClick={approveAndRetry}
          disabled={pending}
          className="self-start rounded border border-amber-500/40 px-3 py-1 text-xs text-amber-600 dark:text-amber-400 disabled:opacity-50"
        >
          Approve to continue & retry
        </button>
      )}
    </div>
  );
}
