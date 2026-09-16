import { git, resolveCommitIdentity } from "../ai-assist.ts";

/**
 * Phase 3's shared "commit whatever an onboarding stage just wrote"
 * helper. Mirrors `ai-assist.ts`'s `runImplement` — the CURRENT, correct
 * commit-identity pattern (`resolveCommitIdentity`, the acting user's
 * real name/email), not `repo-ai/bootstrap.ts`'s old hardcoded
 * `DCC <dcc@local>`. `-c core.longpaths=true` is set explicitly on every
 * call here since `ai-assist.ts`'s own `git()` doesn't set it (only
 * `workspace.ts`'s calls do, for the same reason: a deep checkout with
 * long paths fails on Windows without it — see that file's comment).
 *
 * No reusable commit wrapper existed anywhere before this (confirmed by
 * reading every export of `ai-assist.ts`) — every prior write-mode
 * caller (`runImplement`, the old `/init` flow) inlined its own
 * add+commit. This is that helper, generalized for repeated use across
 * Phase 3's three file-writing stages.
 */
const LONGPATHS = process.platform === "win32" ? ["-c", "core.longpaths=true"] : [];

export async function commitWorkspaceChanges(dir: string, userId: string, message: string): Promise<{ commitSha: string | null; filesChanged: string[] }> {
  await git([...LONGPATHS, "add", "-A"], dir);
  const staged = await git(["diff", "--cached", "--name-only"], dir);
  const filesChanged = staged.out.split("\n").map((s) => s.trim()).filter(Boolean);
  if (filesChanged.length === 0) return { commitSha: null, filesChanged: [] };

  const identity = await resolveCommitIdentity(userId);
  const fullMessage = `${message}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
  const c = await git([...LONGPATHS, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-m", fullMessage], dir);
  if (c.code !== 0) throw new Error(`commit נכשל: ${c.out.slice(0, 300)}`);
  const sha = await git(["rev-parse", "--short", "HEAD"], dir);
  return { commitSha: sha.out.trim(), filesChanged };
}
