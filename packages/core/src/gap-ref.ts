/** A gap still waiting for a decision. */
export const OPEN_GAP_STATES = ["proposed", "verified"] as const;
export const isOpenGapState = (state: string) => (OPEN_GAP_STATES as readonly string[]).includes(state);

/**
 * The short reference a conversation uses for a gap: the first 8 characters
 * of its id. A model copies 8 characters reliably, a 36-character id less
 * so; within one requirement's handful of gaps they do not collide in
 * practice, and a reference that matches two is refused rather than guessed.
 */
export const gapRef = (id: string) => id.slice(0, 8);
