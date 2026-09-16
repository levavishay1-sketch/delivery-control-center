/**
 * Extracts a single JSON value out of a Claude `text` response, for stage
 * handlers that need structured output. `ClaudeCodeRunner.run()` returns
 * only raw `text` (no parsed `json` field) — this is the onboarding-side
 * equivalent of `ai-assist.ts`'s inline `runClaudeJson` extraction logic,
 * duplicated (not cross-imported) so `repo-onboarding/` stays
 * self-contained, matching Phase 1's own precedent (e.g. the scanner's
 * junk-path detection is a deliberate duplicate of `repo-ai/permissions.ts`
 * rather than a shared import).
 */
export function extractClaudeJson<T>(text: string): T {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text];
  const jsonText = (m[1] ?? text).trim();
  const start = jsonText.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in claude output: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(jsonText.slice(start)) as T;
  } catch (e) {
    throw new Error(`could not parse claude JSON (${(e as Error).message}): ${jsonText.slice(0, 300)}`);
  }
}

/** Extracts the body of a single fenced code block from a Claude `text`
 *  response — for stages that need a large free-text document back (a
 *  drafted rule's Markdown body), not a small structured value.
 *  Deliberately NOT `extractClaudeJson<{content: string}>`: found live
 *  (scoped_rules_generate, 2026-09-16) — a multi-paragraph Markdown
 *  document containing an ordinary quoted phrase ("isn't processing")
 *  came back with that quote un-escaped inside the JSON string value,
 *  breaking `JSON.parse` partway through. Asking Claude to hand-escape
 *  arbitrary prose into a JSON string is inherently fragile; a fenced
 *  block needs no escaping at all, so this sidesteps the failure mode
 *  structurally rather than tightening the prompt and hoping. */
export function extractFencedBlock(text: string): string {
  const m = text.match(/```(?:[a-zA-Z]*)\s*\n?([\s\S]*?)```/);
  const body = (m?.[1] ?? text).trim();
  if (!body) throw new Error(`no content in claude output: ${text.slice(0, 300)}`);
  return body;
}
