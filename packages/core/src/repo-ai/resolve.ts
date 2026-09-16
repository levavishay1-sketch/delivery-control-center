import { eq } from "drizzle-orm";
import { withTenant } from "@dcc/db";
import { repoAiProfile } from "@dcc/db/schema";
import { getRepoKnowledge, type KnowledgeSections } from "./knowledge.ts";
import { repoInventoryView } from "./inventory.ts";

/**
 * The Repository Execution Profile Resolver (`repository-ai-management`
 * §11.2), scoped down to what's actually built this pass: knowledge +
 * component awareness, no MANDATORY/CONDITIONAL/ON_DEMAND activation
 * engine yet (that depends on the Recommendation/Adoption governance
 * loop this pass deliberately kept lightweight — see the implementation
 * report). What this DOES give every Task execution: the repo's
 * accumulated knowledge and a list of what AI tooling already exists in
 * it, so a run doesn't start from zero and doesn't propose adding a
 * Skill/MCP that's already there.
 *
 * Called additively from `buildAssessPrompt`/`buildBreakdownPrompt`/
 * `buildImplementPrompt` (prepends one more section to prompts that
 * already exist) and from `hooks/session-start.mjs` (prints alongside
 * the existing Context Brief) — never a required input; every caller
 * degrades to "nothing to add" when the repo isn't under AI management.
 */
export type ResolvedRepoAiProfile = {
  managed: boolean;
  knowledgeSummary: string | null;
  componentSummary: string | null;
};

export async function resolveRepoAiProfile(clientId: string, repoId: string): Promise<ResolvedRepoAiProfile> {
  const [profile] = await withTenant(clientId, (tx) => tx.select().from(repoAiProfile).where(eq(repoAiProfile.repoId, repoId)).limit(1));
  if (!profile || profile.state === "NOT_MANAGED") return { managed: false, knowledgeSummary: null, componentSummary: null };

  const knowledge = await getRepoKnowledge(clientId, repoId);
  let knowledgeSummary: string | null = null;
  if (knowledge) {
    const s = knowledge.sections as KnowledgeSections;
    knowledgeSummary = [
      s.overview ? `סקירה: ${s.overview}` : "",
      s.architecture ? `ארכיטקטורה: ${s.architecture}` : "",
      s.risks ? `סיכונים/לא ידוע: ${s.risks}` : "",
    ].filter(Boolean).join("\n\n");
  }

  const grouped = await repoInventoryView(clientId, repoId);
  const componentSummary = grouped.length
    ? grouped.map((g) => `${g.type}: ${g.items.map((i) => i.title).join(", ")}`).join(" · ")
    : null;

  return { managed: true, knowledgeSummary, componentSummary };
}

/** One prompt-ready block, or "" when there's nothing to add — callers
 *  just prepend this to their existing prompt string unconditionally. */
export function renderRepoAiProfileBlock(p: ResolvedRepoAiProfile): string {
  if (!p.managed || (!p.knowledgeSummary && !p.componentSummary)) return "";
  return [
    "REPOSITORY KNOWLEDGE (accumulated by DCC — use it instead of rediscovering the repo from scratch; verify anything load-bearing rather than trusting it blindly):",
    p.knowledgeSummary ?? "",
    p.componentSummary ? `\nAI tooling already present in this repo (do not propose adding something already here): ${p.componentSummary}` : "",
    "",
  ].filter(Boolean).join("\n");
}
