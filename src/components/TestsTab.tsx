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

const STATUS_COLOR: Record<string, string> = {
  PASSED: "text-emerald-600 dark:text-emerald-400",
  FAILED: "text-red-600 dark:text-red-400",
  PENDING: "opacity-60",
};

/** Lists test runs for a work item's linked pull requests (engineering-evidence spec's Tests tab). */
export function TestsTab({ pullRequests }: { pullRequests: PullRequestWithTests[] }) {
  const withTests = pullRequests.filter((pr) => pr.testRuns.length > 0);

  if (withTests.length === 0) {
    return <p className="text-sm opacity-60">No test runs recorded yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {withTests.map((pr) => (
        <div key={pr.id} className="rounded border border-border-hairline p-3 text-sm">
          <p className="font-medium">
            #{pr.number} {pr.title}
          </p>
          <div className="mt-1 flex flex-col gap-1">
            {pr.testRuns.map((run) => (
              <p key={run.id} className="text-xs">
                <span className={STATUS_COLOR[run.status] ?? "opacity-60"}>{run.status}</span>
                <span className="opacity-60"> · {run.name}</span>
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
