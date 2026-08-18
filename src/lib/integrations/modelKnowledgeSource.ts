import { z } from "zod";

export const MODEL_KNOWLEDGE_SOURCE_URL = "https://platform.claude.com/docs/en/about-claude/models/overview";

/**
 * Fetches the official Claude model documentation page's raw HTML. Slice 20's source and cadence
 * come from the user's own verbatim instruction (see the change's proposal.md Roadmap Source).
 * Throws on a non-2xx response — the job runtime's existing retry/backoff handles a transient
 * failure the same way `github.ts`'s adapters already do.
 */
export async function fetchModelSnapshotSource(): Promise<string> {
  const res = await fetch(MODEL_KNOWLEDGE_SOURCE_URL);
  if (!res.ok) {
    throw new Error(`Model knowledge source fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export interface ExtractedModelFact {
  modelId: string;
  pricingText?: string;
  contextWindowText?: string;
}

const extractedModelFactSchema = z
  .object({
    modelId: z.string().min(1),
    pricingText: z.string().optional(),
    contextWindowText: z.string().optional(),
  })
  .refine((fact) => Boolean(fact.pricingText || fact.contextWindowText), {
    message: "A model entry needs at least one recognizable pricing or context-window fact",
  });

const MODEL_ID_PATTERN = /claude-[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/gi;
const PRICING_PATTERN = /\$\s?\d+(?:\.\d+)?\s*(?:\/|per)\s*(?:1M|1\s*million|million)\s*tokens/gi;
const CONTEXT_WINDOW_PATTERN = /\d+(?:\.\d+)?\s*[KkMm]\s*(?:token[s]?\s*)?context(?:\s*window)?/gi;

// How far around a model-id occurrence to look for a pricing/context-window fact — wide enough to
// catch a fact in the same table row/paragraph, narrow enough not to attribute an unrelated
// model's figures to this one.
const NEARBY_WINDOW_CHARS = 400;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findNearbyMatch(text: string, index: number, pattern: RegExp): string | undefined {
  const start = Math.max(0, index - NEARBY_WINDOW_CHARS);
  const end = Math.min(text.length, index + NEARBY_WINDOW_CHARS);
  return text.slice(start, end).match(pattern)?.[0];
}

/**
 * Scans plain text (HTML tags stripped) for recognizable model-id/pricing/context-window
 * patterns, per design.md Decision 2 — never depends on the source page's exact wire structure,
 * so a redesign of that page degrades this to fewer/no extracted models rather than a hard crash.
 * A candidate model id is kept only if at least one nearby pricing or context-window fact is also
 * found, matching the "failed extraction never presents fabricated data" spec requirement at the
 * per-model level, not just the whole-snapshot level.
 */
export function extractModelFacts(rawHtml: string): ExtractedModelFact[] {
  const text = stripHtml(rawHtml);
  const found = new Map<string, ExtractedModelFact>();

  for (const match of text.matchAll(MODEL_ID_PATTERN)) {
    const modelId = match[0].toLowerCase();
    if (found.has(modelId)) continue;

    const index = match.index ?? 0;
    const pricingText = findNearbyMatch(text, index, PRICING_PATTERN);
    const contextWindowText = findNearbyMatch(text, index, CONTEXT_WINDOW_PATTERN);

    const parsed = extractedModelFactSchema.safeParse({ modelId, pricingText, contextWindowText });
    if (parsed.success) found.set(modelId, parsed.data);
  }

  return Array.from(found.values());
}
