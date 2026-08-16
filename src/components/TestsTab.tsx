import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";

interface TestRunSummary {
  id: string;
  name: string;
  status: string;
}

interface PullRequestWithTests {
  id: string;
  number: number;
  title: string;
  testRuns: TestRunSummary[];
}

const STATUS_TONES: Record<string, StatusTone> = {
  PASSED: "healthy",
  FAILED: "critical",
  PENDING: "inactive",
};

/** Lists test runs for a work item's linked pull requests (engineering-evidence spec's Tests tab). */
export function TestsTab({ pullRequests }: { pullRequests: PullRequestWithTests[] }) {
  const withTests = pullRequests.filter((pr) => pr.testRuns.length > 0);

  if (withTests.length === 0) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">No test runs recorded yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {withTests.map((pr) => (
        <div key={pr.id} className="rounded-card border border-border-hairline bg-surface p-3 text-sm">
          <p className="font-medium">
            #{pr.number} {pr.title}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {pr.testRuns.map((run) => (
              <StatusBadge key={run.id} tone={STATUS_TONES[run.status] ?? "inactive"} label={run.status} reason={run.name} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
