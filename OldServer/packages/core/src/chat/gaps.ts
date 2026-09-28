import { eq } from "drizzle-orm";
import { withTenant } from "@dcc/db";
import { gap } from "@dcc/db/schema";
import { checkoutRepo, existingCheckout, firstRepo, loadRequirementText } from "../ai-assist.ts";
import { renderGapsContext } from "./gaps-prompt.ts";

/**
 * What a turn of the gaps conversation reads, taken fresh from the database
 * every turn — a gap closed a moment ago by the person's click is already
 * closed here — and where it runs: the repository's local copy when there is
 * one, so the model can check an answer against the code.
 */
export async function gapsContext(clientId: string, workitemId: string): Promise<{ text: string; repoDir: string | null }> {
  const { wi, notes, files } = await loadRequirementText(clientId, workitemId);
  const gaps = await withTenant(clientId, (tx) => tx.select().from(gap).where(eq(gap.workitemId, workitemId)).orderBy(gap.createdAt));
  const r = await firstRepo(clientId, workitemId);
  const repoDir = r ? existingCheckout(r) : null;
  // No local copy yet (a wiped cache): answer from the text now, and fetch it
  // in the background so the next turn has the code — never block a reply on a clone.
  if (r && !repoDir) void checkoutRepo(r).catch(() => {});
  const text = renderGapsContext({
    title: wi.title,
    requirementType: wi.requirementType,
    repo: r ? { name: r.name, available: !!repoDir } : null,
    notes,
    files,
    gaps: gaps.map((g) => ({
      id: g.id, description: g.description, why: g.why, impactIfWrong: g.impactIfWrong, options: (g.options ?? []) as string[],
      whoAnswers: g.whoAnswers, blocking: g.blocking, state: g.state, answer: g.answer,
    })),
  });
  return { text, repoDir };
}
