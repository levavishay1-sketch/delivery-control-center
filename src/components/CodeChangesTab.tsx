"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

const STATE_COLOR: Record<string, string> = {
  MERGED: "text-violet-600 dark:text-violet-400",
  OPEN: "text-emerald-600 dark:text-emerald-400",
  CLOSED: "opacity-60",
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
        <p className="text-sm opacity-60">No pull requests linked yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {evidence.map((pr) => (
            <div key={pr.evidenceId} className="rounded border border-black/10 dark:border-white/10 p-3 text-sm">
              <div className="flex items-center justify-between">
                <a href={pr.url} target="_blank" rel="noreferrer" className="font-medium underline">
                  #{pr.number} {pr.title}
                </a>
                {canManage && (
                  <button onClick={() => unlink(pr.evidenceId)} disabled={pending} className="text-xs opacity-60 hover:opacity-100 disabled:opacity-30">
                    Unlink
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs">
                <span className={STATE_COLOR[pr.state] ?? "opacity-60"}>{pr.state}</span>
                <span className="opacity-60"> · CI {ciStatus(pr.testRuns)}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      {canManage && candidatePullRequests.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-xs"
          >
            {candidatePullRequests.map((pr) => (
              <option key={pr.id} value={pr.id}>
                #{pr.number} {pr.title}
              </option>
            ))}
          </select>
          <button onClick={link} disabled={pending} className="rounded bg-foreground px-2 py-1 text-xs text-background disabled:opacity-40">
            {pending ? "Linking…" : "Link pull request"}
          </button>
        </div>
      )}
      {canManage && candidatePullRequests.length === 0 && evidence.length === 0 && (
        <p className="text-xs opacity-50">No pull requests available to link yet — link a repository in project settings first.</p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
