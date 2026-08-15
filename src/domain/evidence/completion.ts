import { db } from "@/lib/db";

export type CompletionPolicyResult = { satisfied: true } | { satisfied: false; missing: string[] };

/**
 * The fixed default completion policy (design.md decision 5, proposal.md scoping decision 2): a
 * work item qualifies for COMPLETED if it has at least one linked, merged pull request whose
 * latest test run passed, or an approved CompletionException exists for it instead.
 */
export async function checkCompletionPolicy(workItemId: string): Promise<CompletionPolicyResult> {
  const exception = await db.completionException.findFirst({ where: { workItemId } });
  if (exception) return { satisfied: true };

  const evidence = await db.evidence.findMany({
    where: { workItemId },
    include: { pullRequest: { include: { testRuns: { orderBy: { createdAt: "desc" }, take: 1 } } } },
  });

  if (evidence.length === 0) {
    return { satisfied: false, missing: ["no pull request linked"] };
  }

  const mergedWithPassingTests = evidence.find((e) => {
    if (!e.pullRequest.merged) return false;
    const latestTestRun = e.pullRequest.testRuns[0];
    return latestTestRun?.status === "PASSED";
  });
  if (mergedWithPassingTests) return { satisfied: true };

  const anyMerged = evidence.some((e) => e.pullRequest.merged);
  const missing: string[] = [];
  if (!anyMerged) missing.push("no linked pull request is merged");
  else missing.push("the merged pull request's latest test run did not pass");

  return { satisfied: false, missing };
}
