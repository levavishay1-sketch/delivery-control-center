"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { pollUntilStatusLeaves } from "@/lib/pollStatus";

interface BudgetExceeded {
  scope: "client" | "project" | "organization";
  clientId: string;
  projectId: string;
  organizationId: string | null;
}

type DraftTarget = { kind: "stage"; stageId: string } | { kind: "constitution"; projectId: string };

/**
 * Draft-trigger button — merged from the formerly-identical
 * `DraftButton`/`ConstitutionDraftButton` (design-system spec's "Duplicate
 * status and action components are consolidated" requirement),
 * parameterized by a `target` discriminated union instead of duplicated
 * per entity type.
 *
 * `target` is plain serializable data (not a callback) on purpose: a
 * first pass parameterized this by a `resolvePollPath(res)` function prop,
 * which crashed at runtime — "Functions cannot be passed directly to
 * Client Components unless ... marked with 'use server'". A stage already
 * knows the id to poll; drafting a Constitution creates a *new* one whose
 * id only exists in the draft response body, so that resolution has to
 * happen inside this Client Component itself, not be handed in from the
 * Server Component page that renders it.
 *
 * `canApprove` (WRITE_ROLES) controls whether a budget-exceeded refusal
 * offers "Approve & retry" — computed server-side and passed down, same
 * pattern as this page's other role-gated UI.
 */
export function DraftButton({
  target,
  label,
  canApprove = false,
}: {
  target: DraftTarget;
  label: string;
  canApprove?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetExceeded, setBudgetExceeded] = useState<BudgetExceeded | null>(null);

  async function draft() {
    setPending(true);
    setError(null);
    setBudgetExceeded(null);
    const draftPath =
      target.kind === "stage" ? `/api/stages/${target.stageId}/draft` : `/api/projects/${target.projectId}/constitution/draft`;
    const res = await fetch(draftPath, { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      setPending(false);
      setError(data.error ?? "Failed to draft");
      if (data.budgetExceeded) setBudgetExceeded(data.budgetExceeded);
      return;
    }
    const pollPath =
      target.kind === "stage" ? `/api/stages/${target.stageId}` : `/api/constitutions/${((await res.json()) as { id: string }).id}`;
    await pollUntilStatusLeaves(pollPath, "AI_DRAFTING");
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
        <Button variant="primary" size="sm" onClick={draft} disabled={pending}>
          {pending ? "Drafting…" : label}
        </Button>
        {error && <span className="text-xs text-status-critical">{error}</span>}
      </div>
      {budgetExceeded && canApprove && (
        <Button variant="secondary" size="sm" onClick={approveAndRetry} disabled={pending} className="self-start">
          Approve to continue &amp; retry
        </Button>
      )}
    </div>
  );
}
