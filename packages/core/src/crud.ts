import { and, eq, sql } from "drizzle-orm";
import { appendEvent, db, withTenant, withoutTenant } from "@dcc/db";
import {
  blocker,
  client,
  clientBudget,
  clientRepo,
  gap,
  repo,
  serviceConnection,
  task,
  workitem,
  workitemDependency,
  workitemRepo,
} from "@dcc/db/schema";
import { regenerateBrief } from "./brief/generate.ts";
import { normaliseAdoUrl } from "./ado-url.ts";
import { recordDecision } from "./decisions.ts";

/**
 * Edit + delete for every first-class entity. The one thing that is
 * deliberately NOT editable or deletable is the event_log / timeline
 * (decision 01, append-only) — a "correction" there is a new event that
 * supersedes the old one (see recordNote's `corrects`).
 */

type By = { userId: string };

/* ── client ─────────────────────────────────────────────────────────── */

export async function updateClient(input: {
  clientId: string;
  name?: string;
  connectorType?: "manual" | "ado" | "github" | "jira" | "dcc";
  adoProjectRef?: string | null;
}) {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.connectorType !== undefined) patch.connectorType = input.connectorType;
  if (input.adoProjectRef !== undefined) patch.adoProjectRef = input.adoProjectRef;
  if (Object.keys(patch).length === 0) return { updated: false };
  await db.update(client).set(patch).where(eq(client.id, input.clientId));
  return { updated: true };
}

/** Delete a client. Refuses while it still has requirements — archive or clear first. */
export async function deleteClient(clientId: string) {
  const [wi] = await withTenant(clientId, (tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(workitem).where(eq(workitem.clientId, clientId)),
  );
  if ((wi?.n ?? 0) > 0) throw new Error(`client still has ${wi!.n} requirement(s) — delete or move them first`);
  await withTenant(clientId, async (tx) => {
    await tx.delete(clientRepo).where(eq(clientRepo.clientId, clientId));
    await tx.delete(serviceConnection).where(eq(serviceConnection.clientId, clientId));
    await tx.delete(clientBudget).where(eq(clientBudget.clientId, clientId));
  });
  await db.delete(client).where(eq(client.id, clientId));
  return { deleted: true };
}

export async function archiveClient(clientId: string, archived: boolean) {
  await db.update(client).set({ archivedAt: archived ? new Date() : null }).where(eq(client.id, clientId));
  return { archived };
}

/* ── requirement (workitem) ─────────────────────────────────────────── */

const REQ_FIELDS = ["title", "type", "requirementType", "priority", "risk", "executor", "budgetUsd", "dueDate", "parentId", "adoAreaPath", "phase", "key"] as const;
type ReqField = (typeof REQ_FIELDS)[number];

export async function updateRequirement(input: {
  clientId: string;
  id: string;
  by: By;
  patch: Partial<Record<ReqField, unknown>>;
  /** Why — required in spirit whenever this patch reopens a
   *  done/archived requirement (design notes, `decision-history`); the
   *  route enforces it, this just records it when given. */
  reopenReason?: string;
}) {
  return withTenant(input.clientId, async (tx) => {
    const [before] = await tx.select().from(workitem).where(eq(workitem.id, input.id)).limit(1);
    if (!before) throw new Error("requirement not found");

    if (input.patch.parentId && input.patch.parentId === input.id) throw new Error("a requirement cannot be its own parent");

    const set: Record<string, unknown> = { updatedAt: new Date() };
    const changed: string[] = [];
    for (const f of REQ_FIELDS) {
      if (!(f in input.patch)) continue;
      let v = input.patch[f];
      if (f === "budgetUsd") v = v == null || v === "" ? null : String(v);
      else if (f === "dueDate") v = v ? new Date(v as string) : null;
      else if (f === "parentId" || f === "adoAreaPath" || f === "key") v = v || null;
      const cur = (before as Record<string, unknown>)[f];
      const same = f === "dueDate"
        ? (cur == null && v == null) || (cur instanceof Date && v instanceof Date && cur.getTime() === v.getTime())
        : String(cur ?? "") === String(v ?? "");
      if (same) continue;
      set[f] = v;
      changed.push(f);
    }
    if (changed.length === 0) return before;

    const [after] = await tx.update(workitem).set(set).where(eq(workitem.id, input.id)).returning();
    await appendEvent({
      clientId: input.clientId,
      workitemId: input.id,
      source: "manual",
      type: "requirement.updated",
      actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
      payload: { summary: `עודכנו שדות: ${changed.join(", ")}`, fields: changed },
    });
    const wasClosed = before.phase === "done" || before.phase === "archived";
    const reopened = wasClosed && changed.includes("phase") && after!.phase !== "done" && after!.phase !== "archived";
    if (reopened && input.reopenReason?.trim()) {
      await recordDecision({
        clientId: input.clientId, workitemId: input.id, by: input.by,
        trigger: "requirement_reopened", reason: input.reopenReason,
      });
    }
    await regenerateBrief(input.clientId, input.id);
    return after!;
  });
}

/**
 * Delete a requirement. Children must be moved/deleted first (parent_id
 * is ON DELETE RESTRICT). event_log rows detach (workitem_id → NULL).
 */
export async function deleteRequirement(clientId: string, id: string) {
  return withTenant(clientId, async (tx) => {
    const [kid] = await tx.select({ n: sql<number>`count(*)::int` }).from(workitem).where(eq(workitem.parentId, id));
    if ((kid?.n ?? 0) > 0) throw new Error(`requirement has ${kid!.n} sub-requirement(s) — delete or move them first`);
    await tx.delete(workitem).where(eq(workitem.id, id));
    return { deleted: true };
  });
}

/* ── requirement ↔ repo ─────────────────────────────────────────────── */

/** Link a repo to a requirement. Manual by default ("declared"); the
 *  pipeline uses linkKind "auto" from branches / affected areas. */
export async function linkRepoToRequirement(input: {
  clientId: string; workitemId: string; repoId: string; by: By; linkKind?: "declared" | "auto";
}) {
  const [r] = await db.select().from(repo).where(eq(repo.id, input.repoId)).limit(1); // repo has no RLS
  if (!r) throw new Error("repo not found");
  return withTenant(input.clientId, async (tx) => {
    await tx
      .insert(workitemRepo)
      .values({ clientId: input.clientId, workitemId: input.workitemId, repoId: input.repoId, linkKind: input.linkKind ?? "declared", addedBy: input.by.userId })
      .onConflictDoNothing();
    // keep the client↔repo link in sync — a requirement's repo is the client's too
    await tx.insert(clientRepo).values({ clientId: input.clientId, repoId: input.repoId, addedBy: input.by.userId }).onConflictDoNothing();
    await appendEvent({
      clientId: input.clientId, workitemId: input.workitemId, source: "manual", type: "repo.linked",
      actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
      payload: { repoName: r.name, linkKind: input.linkKind ?? "declared" },
    });
    await regenerateBrief(input.clientId, input.workitemId);
    return { linked: true };
  });
}

export async function unlinkRepoFromRequirement(input: { clientId: string; workitemId: string; repoId: string; by: By }) {
  const [r] = await db.select().from(repo).where(eq(repo.id, input.repoId)).limit(1);
  return withTenant(input.clientId, async (tx) => {
    await tx.delete(workitemRepo).where(and(eq(workitemRepo.workitemId, input.workitemId), eq(workitemRepo.repoId, input.repoId)));
    await appendEvent({
      clientId: input.clientId, workitemId: input.workitemId, source: "manual", type: "repo.unlinked",
      actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
      payload: { repoName: r?.name ?? input.repoId },
    });
    await regenerateBrief(input.clientId, input.workitemId);
    return { unlinked: true };
  });
}

export async function reposForRequirement(clientId: string, workitemId: string) {
  return withTenant(clientId, (tx) =>
    tx
      .select({ id: repo.id, name: repo.name, adoRepoRef: repo.adoRepoRef, linkKind: workitemRepo.linkKind, addedAt: workitemRepo.addedAt })
      .from(workitemRepo)
      .innerJoin(repo, eq(repo.id, workitemRepo.repoId))
      .where(eq(workitemRepo.workitemId, workitemId))
      .orderBy(repo.name),
  );
}

/* ── repo ───────────────────────────────────────────────────────────── */

export async function updateRepo(input: { repoId: string; name?: string; adoRepoRef?: string | null; defaultBranch?: string; localPath?: string | null }) {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.adoRepoRef !== undefined) patch.adoRepoRef = input.adoRepoRef;
  if (input.defaultBranch !== undefined) patch.defaultBranch = input.defaultBranch;
  if (input.localPath !== undefined) patch.localPath = input.localPath || null;
  if (Object.keys(patch).length === 0) return { updated: false };
  await withoutTenant((tx) => tx.update(repo).set(patch).where(eq(repo.id, input.repoId)));
  return { updated: true };
}

/** Delete a repo everywhere (client_repo + workitem_repo cascade). */
export async function deleteRepo(repoId: string) {
  await withoutTenant((tx) => tx.delete(repo).where(eq(repo.id, repoId)));
  return { deleted: true };
}

/** Detach a repo from a client (leaves the repo row + other clients' links). */
export async function unlinkClientRepo(clientId: string, repoId: string) {
  await withTenant(clientId, (tx) => tx.delete(clientRepo).where(and(eq(clientRepo.clientId, clientId), eq(clientRepo.repoId, repoId))));
  return { unlinked: true };
}

/* ── gap / blocker / task / dependency ──────────────────────────────── */

export async function updateGap(input: { clientId: string; id: string; description?: string; blocking?: boolean }) {
  const patch: Record<string, unknown> = {};
  if (input.description !== undefined) patch.description = input.description;
  if (input.blocking !== undefined) patch.blocking = input.blocking;
  if (Object.keys(patch).length === 0) return { updated: false };
  const wi = await withTenant(input.clientId, async (tx) => {
    const [g] = await tx.update(gap).set(patch).where(eq(gap.id, input.id)).returning();
    return g?.workitemId;
  });
  if (wi) await regenerateBrief(input.clientId, wi);
  return { updated: true };
}

export async function deleteGap(clientId: string, id: string) {
  const wi = await withTenant(clientId, async (tx) => {
    const [g] = await tx.select({ w: gap.workitemId }).from(gap).where(eq(gap.id, id)).limit(1);
    await tx.delete(gap).where(eq(gap.id, id));
    return g?.w;
  });
  if (wi) await regenerateBrief(clientId, wi);
  return { deleted: true };
}

export async function updateBlocker(input: { clientId: string; id: string; question?: string; questionType?: string }) {
  const patch: Record<string, unknown> = {};
  if (input.question !== undefined) patch.question = input.question;
  if (input.questionType !== undefined) patch.questionType = input.questionType;
  if (Object.keys(patch).length === 0) return { updated: false };
  const wi = await withTenant(input.clientId, async (tx) => {
    const [b] = await tx.update(blocker).set(patch).where(eq(blocker.id, input.id)).returning();
    return b?.workitemId;
  });
  if (wi) await regenerateBrief(input.clientId, wi);
  return { updated: true };
}

export async function deleteBlocker(clientId: string, id: string) {
  const wi = await withTenant(clientId, async (tx) => {
    const [b] = await tx.select({ w: blocker.workitemId }).from(blocker).where(eq(blocker.id, id)).limit(1);
    await tx.delete(blocker).where(eq(blocker.id, id));
    return b?.w;
  });
  if (wi) await regenerateBrief(clientId, wi);
  return { deleted: true };
}

export async function updateTask(input: { clientId: string; id: string; intent?: string; appetite?: "small" | "standard" | "large" }) {
  const patch: Record<string, unknown> = {};
  if (input.intent !== undefined) patch.intent = input.intent;
  if (input.appetite !== undefined) patch.appetite = input.appetite;
  if (Object.keys(patch).length === 0) return { updated: false };
  const wi = await withTenant(input.clientId, async (tx) => {
    const [t] = await tx.update(task).set(patch).where(eq(task.id, input.id)).returning();
    return t?.workitemId;
  });
  if (wi) await regenerateBrief(input.clientId, wi);
  return { updated: true };
}

export async function deleteDependency(clientId: string, workitemId: string, dependsOnWorkitemId: string) {
  await withTenant(clientId, (tx) =>
    tx.delete(workitemDependency).where(and(eq(workitemDependency.workitemId, workitemId), eq(workitemDependency.dependsOnWorkitemId, dependsOnWorkitemId))),
  );
  await regenerateBrief(clientId, workitemId);
  return { deleted: true };
}

/* ── connection ─────────────────────────────────────────────────────── */

export async function updateConnection(input: {
  clientId: string; connectionId: string; orgUrl?: string; project?: string; pat?: string;
}) {
  return withTenant(input.clientId, async (tx) => {
    const [c] = await tx.select().from(serviceConnection).where(eq(serviceConnection.id, input.connectionId)).limit(1);
    if (!c) throw new Error("connection not found");
    const cfg = c.config as Record<string, string>;
    const merged = normaliseAdoUrl(input.orgUrl ?? cfg.orgUrl ?? "", input.project ?? cfg.project ?? "");
    const config: Record<string, string> = merged.project ? { orgUrl: merged.orgUrl, project: merged.project } : { orgUrl: merged.orgUrl };
    await tx
      .update(serviceConnection)
      .set({
        config,
        displayName: merged.project ? `Azure DevOps — ${merged.project}` : `Azure DevOps — ${merged.orgUrl.replace(/^https?:\/\//, "")}`,
        ...(input.pat ? { secretRef: input.pat } : {}),
      })
      .where(eq(serviceConnection.id, input.connectionId));
    return { updated: true };
  });
}
