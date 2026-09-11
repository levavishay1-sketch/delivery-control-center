import { eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { promptTemplate } from "@dcc/db/schema";

/**
 * The system's own prompt library (org-shared, no RLS — see the schema
 * comment). Every DCC-driven Claude call should pull its instructions
 * from here by `key` instead of an inline string, so what Claude is
 * actually told is visible and editable from the Prompts screen without
 * a code change.
 */

export type PromptTemplateRow = typeof promptTemplate.$inferSelect;

export async function listPrompts(): Promise<PromptTemplateRow[]> {
  return db.select().from(promptTemplate).orderBy(promptTemplate.title);
}

export async function getPromptByKey(key: string): Promise<PromptTemplateRow | null> {
  const [row] = await db.select().from(promptTemplate).where(eq(promptTemplate.key, key)).limit(1);
  return row ?? null;
}

export async function updatePrompt(input: { id: string; title?: string; description?: string | null; body?: string; defaultModel?: string | null; by: { userId: string } }): Promise<{ updated: boolean }> {
  const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: input.by.userId };
  if (input.title !== undefined) set.title = input.title;
  if (input.description !== undefined) set.description = input.description;
  if (input.body !== undefined) set.body = input.body;
  if (input.defaultModel !== undefined) set.defaultModel = input.defaultModel;
  await db.update(promptTemplate).set(set).where(eq(promptTemplate.id, input.id));
  return { updated: true };
}

/** Fill `{{KEY}}` tokens in a template body. Unmatched tokens are left as-is
 *  (visible, not silently swallowed — makes a missing variable obvious). */
export function renderPrompt(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? vars[k]! : m));
}
