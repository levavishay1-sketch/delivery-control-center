const POLL_INTERVAL_MS = 2000;
/** Safety cap so a stuck poll loop can't run forever client-side; the job runtime's own retry/backoff (and eventual FAILED-terminal state) is what actually bounds how long drafting takes. */
const MAX_POLLS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls a `{ status }` JSON endpoint until its status is no longer `waitingStatus` — both Stage
 * and Constitution drafting are job-backed (Task Groups 5 and 3), so nothing else tells the
 * client when a draft finishes. Shared by DraftButton, ClarifyPanel, and ConstitutionDraftButton.
 */
export async function pollUntilStatusLeaves(url: string, waitingStatus: string): Promise<void> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(url);
    if (!res.ok) return;
    const body = (await res.json()) as { status: string };
    if (body.status !== waitingStatus) return;
  }
}
