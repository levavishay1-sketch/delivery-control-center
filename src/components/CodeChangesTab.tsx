"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/FormField";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";

interface TestRunSummary {
  id: string;
  name: string;
  status: string;
}

interface EvidencePullRequest {
  evidenceId: string;
  id: string;
  number: number;
  title: string;
  state: string;
  merged: boolean;
  url: string;
  testRuns: TestRunSummary[];
}

interface CandidatePullRequest {
  id: string;
  number: number;
  title: string;
  state: string;
  merged: boolean;
  url: string;
}

const STATE_TONES: Record<string, StatusTone> = {
  MERGED: "ai",
  OPEN: "healthy",
  CLOSED: "inactive",
};

function ciStatus(testRuns: TestRunSummary[]): string {
  if (testRuns.length === 0) return "no checks";
  if (testRuns.some((t) => t.status === "FAILED")) return "failing";
  if (testRuns.every((t) => t.status === "PASSED")) return "passing";
  return "pending";
}

/**
 * Lists a work item's linked pull requests with CI status (engineering-evidence spec's Code &
 * Changes tab), with a link/unlink action for a write-capable role. Evidence is always manual —
 * this never infers a link from a branch name or title (see linkEvidence).
 */
export function CodeChangesTab({
  workItemId,
  evidence,
  candidatePullRequests,
  canManage,
}: {
  workItemId: string;
  evidence: EvidencePullRequest[];
  candidatePullRequests: CandidatePullRequest[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(candidatePullRequests[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    if (!selected) return;
    setPending(true);
    setError(null);
    const res = await fetch(`/api/work-items/${workItemId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pullRequestId: selected }),
    });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to link pull request");
      return;
    }
    router.refresh();
  }

  async function unlink(evidenceId: string) {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/evidence/${evidenceId}`, { method: "DELETE" });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to unlink pull request");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {evidence.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">No pull requests linked yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {evidence.map((pr) => (
            <div key={pr.evidenceId} className="rounded-card border border-border-hairline bg-surface p-3 text-sm">
              <div className="flex items-center justify-between">
                <a href={pr.url} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                  #{pr.number} {pr.title}
                </a>
                {canManage && (
                  <Button variant="secondary" size="sm" onClick={() => unlink(pr.evidenceId)} disabled={pending}>
                    Unlink
                  </Button>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge tone={STATE_TONES[pr.state] ?? "inactive"} label={pr.state} reason={`CI ${ciStatus(pr.testRuns)}`} />
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage && candidatePullRequests.length > 0 && (
        <div className="flex items-center gap-2">
          <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-auto" aria-label="Pull request to link">
            {candidatePullRequests.map((pr) => (
              <option key={pr.id} value={pr.id}>
                #{pr.number} {pr.title}
              </option>
            ))}
          </Select>
          <Button variant="primary" size="sm" onClick={link} disabled={pending}>
            {pending ? "Linking…" : "Link pull request"}
          </Button>
        </div>
      )}
      {canManage && candidatePullRequests.length === 0 && evidence.length === 0 && (
        <p className="text-xs text-neutral-400">No pull requests available to link yet — link a repository in project settings first.</p>
      )}
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}
