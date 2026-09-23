import { eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { promptTemplate } from "@dcc/db/schema";
import { PROMPT_USES, contractProblems, renderPrompt } from "./prompt-contract.ts";
import { recommend, type Capability } from "./routing.ts";

/**
 * The system's own prompt library (org-shared, no RLS — see the schema
 * comment). Every instruction DCC sends to Claude is a row here, read at the
 * moment of the call — what the Prompts screen shows is what is sent, and an
 * edit there changes the next call without a code change. What the code
 * depends on in each one is declared in `prompt-contract.ts`.
 */

export { renderPrompt };

export type PromptTemplateRow = typeof promptTemplate.$inferSelect;

/** A row as the Prompts screen shows it: what runs it, and anything in it that would break its caller. */
export type PromptView = PromptTemplateRow & {
  use: {
    capability: string;
    /** The person picks the model per run (readiness tiers); otherwise the policy's model and effort below are what run it. */
    modelPerRun: boolean;
    policy: { model: string; tier: string; effort: string };
    vars: string[];
    optional: string[];
    keeps: string[];
    appendedTo: string | null;
  } | null;
  problems: string[];
};

export class PromptRefused extends Error {}

export async function listPrompts(): Promise<PromptView[]> {
  const rows = await db.select().from(promptTemplate).orderBy(promptTemplate.sortOrder, promptTemplate.title);
  return rows.map((r) => {
    const u = PROMPT_USES[r.key];
    return {
      ...r,
      use: u ? {
        capability: u.capability, modelPerRun: !!u.modelPerRun, policy: recommend(u.capability as Capability),
        vars: [...u.vars], optional: [...(u.optional ?? [])], keeps: [...u.keeps], appendedTo: u.appendedTo ?? null,
      } : null,
      problems: contractProblems(r.key, r.body),
    };
  });
}

export async function getPromptByKey(key: string): Promise<PromptTemplateRow | null> {
  const [row] = await db.select().from(promptTemplate).where(eq(promptTemplate.key, key)).limit(1);
  return row ?? null;
}

/** The row a call is built from. Missing is a real failure, said in words — never a hidden copy of the text in code that would drift from the screen. */
export async function requirePrompt(key: string): Promise<PromptTemplateRow> {
  const row = await getPromptByKey(key);
  if (!row) throw new Error(`הפרומפט "${key}" חסר במסך הפרומפטים — אי אפשר לבנות את הקריאה בלעדיו`);
  return row;
}

export async function updatePrompt(input: {
  id: string; title?: string; description?: string | null; body?: string; bodyHe?: string | null;
  defaultModel?: string | null; by: { userId: string };
}): Promise<{ updated: boolean }> {
  if (input.body !== undefined) {
    const [row] = await db.select({ key: promptTemplate.key }).from(promptTemplate).where(eq(promptTemplate.id, input.id)).limit(1);
    if (!row) throw new PromptRefused("הפרומפט לא נמצא");
    if (!input.body.trim()) throw new PromptRefused("גוף הפרומפט ריק — זה מה שנשלח לקלוד");
    const problems = contractProblems(row.key, input.body);
    if (problems.length) throw new PromptRefused(`לא נשמר — השינוי היה שובר את הקריאה:\n${problems.map((p) => `• ${p}`).join("\n")}`);
  }
  const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: input.by.userId };
  if (input.title !== undefined) set.title = input.title;
  if (input.description !== undefined) set.description = input.description;
  if (input.body !== undefined) set.body = input.body;
  if (input.bodyHe !== undefined) set.bodyHe = input.bodyHe;
  if (input.defaultModel !== undefined) set.defaultModel = input.defaultModel;
  await db.update(promptTemplate).set(set).where(eq(promptTemplate.id, input.id));
  return { updated: true };
}
