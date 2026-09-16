import { and, desc, eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { onboardingPromptTemplate } from "@dcc/db/schema";

/**
 * Prompt versioning for the onboarding pipeline (spec §27). A NEW table
 * (`onboarding_prompt_template`), not the existing `prompt_template` —
 * see the schema file's comment for why: a `claude_execution` row must
 * keep resolving to the exact text that ran even after someone edits the
 * prompt later, which the existing table's in-place `body` mutation
 * can't guarantee. Phase 1 registers zero rows here — both its own
 * stages are deterministic and never call Claude — this is
 * infrastructure Phase 2+ populates.
 */

export type OnboardingPromptTemplateRow = typeof onboardingPromptTemplate.$inferSelect;

/** The currently-active version for a prompt key, or null if none is active yet. */
export async function getActiveOnboardingPrompt(promptKey: string): Promise<OnboardingPromptTemplateRow | null> {
  const [row] = await db
    .select()
    .from(onboardingPromptTemplate)
    .where(and(eq(onboardingPromptTemplate.promptKey, promptKey), eq(onboardingPromptTemplate.active, true)))
    .limit(1);
  return row ?? null;
}

/** Registers a new immutable version of a prompt and marks it active,
 *  deactivating whatever was active before (the DB's own partial unique
 *  index — `active` where true — enforces "at most one active version
 *  per key" as a hard constraint, this just does the two-step flip). */
export async function registerPromptVersion(input: {
  promptKey: string; stage: string; title: string; body: string; defaultModel?: string; by: { userId: string };
}): Promise<OnboardingPromptTemplateRow> {
  const [last] = await db
    .select({ version: onboardingPromptTemplate.version })
    .from(onboardingPromptTemplate)
    .where(eq(onboardingPromptTemplate.promptKey, input.promptKey))
    .orderBy(desc(onboardingPromptTemplate.version))
    .limit(1);
  const nextVersion = (last?.version ?? 0) + 1;

  return db.transaction(async (tx) => {
    await tx.update(onboardingPromptTemplate).set({ active: false }).where(eq(onboardingPromptTemplate.promptKey, input.promptKey));
    const [row] = await tx.insert(onboardingPromptTemplate).values({
      promptKey: input.promptKey, version: nextVersion, stage: input.stage, title: input.title,
      body: input.body, defaultModel: input.defaultModel ?? null, active: true, createdBy: input.by.userId,
    }).returning();
    return row!;
  });
}
