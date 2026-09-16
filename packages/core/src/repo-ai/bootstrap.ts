import { eq } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { repo, repoAiProfile } from "@dcc/db/schema";
import { ensureCheckout, git, runClaudeRaw } from "../ai-assist.ts";
import { appendRepoAiEvent } from "./events.ts";
import { scanRepoDir } from "./inventory.ts";
import { getApprovedDenyRules } from "./permissions.ts";

/**
 * P1 — Claude Repository initialization (`repository-ai-management`
 * §6.3, Appendix A.1). Investigated empirically this session: the
 * Claude Code CLI has no separate `init` subcommand — `/init` is a
 * built-in slash command that resolves the same way headlessly as
 * interactively. Verified live: `claude -p "/init" --permission-mode
 * acceptEdits --allowed-tools "Read,Grep,Glob,Write,Edit"` against a
 * throwaway repo created `CLAUDE.md` and exited 0, same mechanism as
 * every other write-mode call in this file (`runClaudeRaw`, not a new
 * one). `/init`'s own response is prose, not JSON — hence `runClaudeRaw`
 * (added this session), not `runClaudeJson`.
 *
 * Runs in the same DCC-owned cache checkout every write run uses
 * (`ensureCheckout` with `localPath: null`), on its own branch, and only
 * commits locally — never pushes, matching every other DCC-initiated
 * write (design non-negotiable: no direct write to `Default Branch`).
 */
export type BootstrapResult =
  | { status: "COMPLETED"; branch: string; commit: string | null; filesChanged: string[]; summary: string }
  | { status: "SKIPPED_EXISTING_CONFIG"; reason: string }
  | { status: "FAILED"; reason: string };

export async function runRepoInit(repoId: string, by: { userId: string }, opts: { force?: boolean } = {}): Promise<BootstrapResult> {
  const [r] = await db.select().from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r) throw new Error("repo not found");
  if (!r.clientId) throw new Error("ניהול AI זמין רק ל-repository ששייך ללקוח יחיד");
  const clientId = r.clientId;

  // Step 3 is locked behind step 2 (design discussion, 2026-09-16) —
  // enforced HERE, not only by the UI hiding the button, so the lock
  // holds even against a direct API call. `denyRules` (possibly []) must
  // have been explicitly approved first.
  const denyRules = await getApprovedDenyRules(clientId, repoId);
  if (denyRules === null) {
    return { status: "FAILED", reason: "שלב 2 (אישור הרשאות קריאה) עדיין לא הושלם — לא ניתן להריץ /init לפניו" };
  }

  const dir = await ensureCheckout({ ...r, localPath: null });
  if (!dir) return { status: "FAILED", reason: `לא הצלחתי להביא עותק של ${r.name}` };

  // never overwrite an existing setup automatically (§7.2) — the deterministic
  // scan is cheap and already tells us if there's anything to protect.
  const already = scanRepoDir(dir);
  const hasBase = already.some((c) => c.type === "base_configuration");
  if (hasBase && !opts.force) {
    // Existing config is a legitimate "step 3 done" outcome, not a stuck
    // state — there's nothing further for this step to do.
    await withTenant(clientId, (tx) =>
      tx.update(repoAiProfile).set({ bootstrapCompletedAt: new Date(), updatedAt: new Date() }).where(eq(repoAiProfile.repoId, repoId)),
    );
    await appendRepoAiEvent({ clientId, repoId, type: "init.skipped", payload: { reason: "existing CLAUDE.md" }, actorUserId: by.userId });
    return { status: "SKIPPED_EXISTING_CONFIG", reason: "כבר קיים CLAUDE.md — לא מריצים /init אוטומטית מעל תצורה קיימת" };
  }

  await git(["reset", "--hard"], dir);
  await git(["clean", "-fd"], dir);
  const base = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir)).out.replace(/^origin\//, "") || r.defaultBranch || "main";
  await git(["checkout", base], dir);
  await git(["pull", "--ff-only"], dir);
  const branch = `dcc-ai/init-${Date.now()}`;
  const made = await git(["checkout", "-b", branch], dir);
  if (made.code !== 0) return { status: "FAILED", reason: `לא הצלחתי ליצור branch: ${made.out.slice(0, 200)}` };

  let summary: string;
  try {
    const { text } = await runClaudeRaw(dir, "/init", { write: true, timeoutMs: 300_000, maxTurns: 20, denyRules });
    summary = text.trim() || "/init הסתיים";
  } catch (e) {
    return { status: "FAILED", reason: String((e as Error).message ?? e) };
  }

  await git(["add", "-A"], dir);
  const stat = await git(["diff", "--cached", "--name-only"], dir);
  const filesChanged = stat.out.split("\n").map((s) => s.trim()).filter(Boolean);
  let commit: string | null = null;
  if (filesChanged.length > 0) {
    const msg = `DCC: repository AI bootstrap (/init)\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
    const c = await git(["-c", "user.name=DCC", "-c", "user.email=dcc@local", "commit", "-m", msg], dir);
    if (c.code === 0) commit = (await git(["rev-parse", "--short", "HEAD"], dir)).out.trim();
  }

  await withTenant(clientId, (tx) =>
    tx.update(repoAiProfile).set({ bootstrapCompletedAt: new Date(), updatedAt: new Date() }).where(eq(repoAiProfile.repoId, repoId)),
  );
  await appendRepoAiEvent({
    clientId, repoId, type: "init.completed",
    payload: { branch, commit, filesChanged, summary },
    actorUserId: by.userId,
  });

  return { status: "COMPLETED", branch, commit, filesChanged, summary };
}
