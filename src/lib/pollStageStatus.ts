const POLL_INTERVAL_MS = 2000;
/** Safety cap so a stuck poll loop can't run forever client-side; the job runtime's own retry/backoff (and eventual FAILED-terminal state) is what actually bounds how long drafting takes. */
const MAX_POLLS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls a stage's status while it's AI_DRAFTING — drafting is job-backed
 * (Task Group 5), so nothing else tells the client when it finishes.
 * Shared by DraftButton and ClarifyPanel, both of which can trigger a
 * stage entering AI_DRAFTING and need to know when it leaves.
 */
export async function pollUntilDraftingFinishes(stageId: string): Promise<void> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`/api/stages/${stageId}`);
    if (!res.ok) return;
    const stage = (await res.json()) as { status: string };
    if (stage.status !== "AI_DRAFTING") return;
  }
}
