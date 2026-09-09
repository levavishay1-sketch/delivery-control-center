import Fastify from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, dbKind, withTenant, timeline, unassigned } from "@dcc/db";
import { client, repo, users, workitem } from "@dcc/db/schema";
import {
  addAdoConnection,
  answerBlocker,
  auditTrail,
  blockersFor,
  briefFor,
  checkAdoConnection,
  clientDetail,
  contentionFor,
  dashboard,
  deleteConnection,
  linkRepoToClient,
  listAdoProjects,
  listInitiatives,
  listConnections,
  listRepos,
  listAlerts,
  listAllWorkItems,
  listBudgets,
  listClients,
  flowFor,
  linkWorkItems,
  progressTask,
  recordReview,
  recordTouches,
  releaseTouches,
  proposeGap,
  proposeTasks,
  raiseBlocker,
  recordRouting,
  route,
  type Capability,
  recordGitActivity,
  recordNote,
  recordSession,
  resolveWorkItem,
  setupClient,
  tasksFor,
  verifyGap,
  updateClient,
  deleteClient,
  archiveClient,
  updateRequirement,
  deleteRequirement,
  linkRepoToRequirement,
  unlinkRepoFromRequirement,
  reposForRequirement,
  updateRepo,
  deleteRepo,
  unlinkClientRepo,
  updateGap,
  deleteGap,
  updateBlocker,
  deleteBlocker,
  updateTask,
  deleteTask,
  deleteDependency,
  updateConnection,
  syncRequirementToAdo,
  trySyncNewRequirement,
  syncAllToAdo,
  deleteAdoForRequirement,
  adoWorkItemUrl,
  importAdoCsv,
  pullFromAdo,
  pullOneFromAdo,
  attachmentsFor,
  addAttachment,
} from "@dcc/core";
import { blocker, gap } from "@dcc/db/schema";
import { AuthError, NotFound, actingUser, locateWorkItem } from "./context.ts";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 40 * 1024 * 1024 });

// tolerate an empty body on requests that still send `content-type: application/json`
// (browsers do this on DELETE) — hand the route an empty object instead of 400ing.
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
  const s = (body as string).trim();
  if (!s) return done(null, {});
  try { done(null, JSON.parse(s)); } catch (e) { done(e as Error, undefined); }
});

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof AuthError) return reply.code(401).send({ error: err.message });
  if (err instanceof NotFound) return reply.code(404).send({ error: err.message });
  if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues });
  const e = err as { statusCode?: number; message?: string };
  if (typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
  app.log.error(err);
  return reply.code(500).send({ error: "internal" });
});

app.get("/health", async () => ({ ok: true }));

/* ── dashboard + audit ───────────────────────────────────────────── */

app.get("/dashboard", async (req) => {
  const dev = await actingUser(req);
  return dashboard(dev.id);
});

app.get("/clients", async () => ({ clients: await listClients() }));
app.get("/clients/:id", async (req) => clientDetail((req.params as { id: string }).id));
app.get("/repos", async () => ({ repos: await listRepos() }));
app.get("/connections", async () => ({ connections: await listConnections() }));

app.patch("/clients/:id", async (req) => {
  await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({
    name: z.string().min(1).optional(),
    connectorType: z.enum(["manual", "ado", "github", "jira", "dcc"]).optional(),
    adoProjectRef: z.string().nullable().optional(),
  }).parse(req.body);
  return updateClient({ clientId: id, ...b });
});

app.delete("/clients/:id", async (req, reply) => {
  await actingUser(req);
  const { id } = req.params as { id: string };
  const q = req.query as { mode?: string };
  if (q.mode === "archive") return archiveClient(id, true);
  return reply.send(await deleteClient(id));
});

app.patch("/repos/:id", async (req) => {
  await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ name: z.string().min(1).optional(), adoRepoRef: z.string().nullable().optional(), defaultBranch: z.string().optional() }).parse(req.body);
  return updateRepo({ repoId: id, ...b });
});

app.delete("/repos/:id", async (req) => {
  await actingUser(req);
  return deleteRepo((req.params as { id: string }).id);
});

app.post("/clients/:id/repos", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ repoId: z.string().uuid().optional(), name: z.string().optional(), gitUrl: z.string().optional(), adoRepoRef: z.string().optional() }).parse(req.body);
  const r = await linkRepoToClient({ clientId: id, ...b, by: { userId: dev.id } });
  return reply.code(201).send(r);
});

app.delete("/clients/:cid/repos/:repoId", async (req) => {
  await actingUser(req);
  const { cid, repoId } = req.params as { cid: string; repoId: string };
  return unlinkClientRepo(cid, repoId);
});

// import work items from an Azure DevOps / TFS CSV export
app.post("/clients/:id/import/ado-csv", async (req) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ csv: z.string().min(10) }).parse(req.body);
  return importAdoCsv({ clientId: id, csv: b.csv, by: { userId: dev.id } });
});

// push every not-yet-linked requirement into the connected ADO project
app.post("/clients/:id/sync-all-to-ado", async (req) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  return syncAllToAdo(id, { userId: dev.id });
});

// pull the connected ADO project INTO DCC (TFS is the mirror):
// new → created, changed → updated, gone → deleted, + attachments
app.post("/clients/:id/sync-from-ado", async (req) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  return pullFromAdo(id, { userId: dev.id });
});

// live-discover the ADO projects a PAT can see, for the connect form's picker
app.post("/connections/ado/projects", async (req) => {
  await actingUser(req);
  const b = z.object({ orgUrl: z.string().url(), pat: z.string().min(10) }).parse(req.body);
  return listAdoProjects(b);
});

app.post("/clients/:id/connections/ado", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ orgUrl: z.string().url(), project: z.string().optional(), pat: z.string().min(10) }).parse(req.body);
  const out = await addAdoConnection({ clientId: id, ...b, by: { userId: dev.id } });
  return reply.code(201).send({ id: out.id, check: out.check });
});

app.patch("/clients/:cid/connections/:id", async (req) => {
  await actingUser(req);
  const { cid, id } = req.params as { cid: string; id: string };
  const b = z.object({ orgUrl: z.string().optional(), project: z.string().optional(), pat: z.string().optional() }).parse(req.body);
  return updateConnection({ clientId: cid, connectionId: id, ...b });
});

app.post("/clients/:cid/connections/:id/check", async (req) => {
  await actingUser(req);
  const { cid, id } = req.params as { cid: string; id: string };
  return checkAdoConnection(cid, id);
});

app.delete("/clients/:cid/connections/:id", async (req) => {
  await actingUser(req);
  const { cid, id } = req.params as { cid: string; id: string };
  return deleteConnection(cid, id);
});

app.get("/list/workitems", async () => ({ items: await listAllWorkItems() }));
app.get("/list/initiatives", async () => ({ initiatives: await listInitiatives() }));
app.get("/list/budgets", async () => ({ budgets: await listBudgets() }));
app.get("/list/alerts", async (req) => ({ alerts: await listAlerts((await actingUser(req)).id) }));

app.get("/audit", async (req) => {
  const q = req.query as Record<string, string>;
  return auditTrail({
    actorKind: q.actorKind as "user" | "delegated" | "system" | undefined,
    type: q.type,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    page: q.page ? Number(q.page) : 1,
  });
});

/** Dev-only: list every WorkItem (works because dev PGlite runs as
 *  superuser, so RLS is bypassed). 404 on a real Postgres. */
app.get("/dev/workitems", async (_req, reply) => {
  if (dbKind !== "pglite") return reply.code(404).send({ error: "dev only" });
  return db
    .select({ id: workitem.id, key: workitem.key, title: workitem.title, phase: workitem.phase })
    .from(workitem)
    .orderBy(sql`${workitem.createdAt} desc`);
});

/* ── capture: the hooks POST here ──────────────────────────────────── */

const captureBody = z.object({
  workitemKey: z.string().optional(),
  workitemId: z.string().uuid().optional(),
  branch: z.string().optional(),
  clientId: z.string().uuid().optional(),
  occurredAt: z.coerce.date().optional(),
  kind: z.enum(["session", "git", "note"]),
  session: z
    .object({
      sessionId: z.string(),
      transcriptPath: z.string().optional(),
      summary: z.string(),
      model: z.string().optional(),
      tokensIn: z.number().int().optional(),
      tokensOut: z.number().int().optional(),
      costUsd: z.number().optional(),
    })
    .optional(),
  git: z
    .object({
      repo: z.string(),
      branch: z.string(),
      kind: z.enum(["commit", "push", "branch_created", "pull_request"]),
      count: z.number().int().optional(),
      prNumber: z.number().int().optional(),
      shas: z.array(z.string()).optional(),
    })
    .optional(),
  note: z.object({ body: z.string(), source: z.enum(["manual", "email", "slack", "phone", "meeting"]).optional(), corrects: z.string().uuid().optional() }).optional(),
});

app.post("/events", async (req, reply) => {
  const dev = await actingUser(req);
  const b = captureBody.parse(req.body);

  // Resolve the WorkItem. No confident match → unassigned (null), never guessed.
  let wi: { id: string; clientId: string } | null = null;
  if (b.workitemId || b.workitemKey) {
    wi = await locateWorkItem({ id: b.workitemId, key: b.workitemKey });
  } else if (b.clientId && b.branch) {
    const r = await resolveWorkItem({ clientId: b.clientId, branch: b.branch });
    wi = r ? { id: r.id, clientId: r.clientId } : null;
  }

  const clientId = wi?.clientId ?? b.clientId;
  if (!clientId) return reply.code(422).send({ error: "cannot determine client; pass clientId or a resolvable workitem" });

  const common = { clientId, workitemId: wi?.id ?? null, dev: { userId: dev.id }, occurredAt: b.occurredAt };

  let ev;
  if (b.kind === "session") {
    if (!b.session) return reply.code(400).send({ error: "session body required" });
    ev = await recordSession({ ...common, session: b.session });
  } else if (b.kind === "git") {
    if (!b.git) return reply.code(400).send({ error: "git body required" });
    ev = await recordGitActivity({ ...common, git: b.git });
  } else {
    if (!b.note) return reply.code(400).send({ error: "note body required" });
    ev = await recordNote({ ...common, body: b.note.body, source: b.note.source, corrects: b.note.corrects });
  }
  return reply.code(201).send({ eventId: ev?.id, workitemId: wi?.id ?? null, assigned: !!wi });
});

/* ── reads ────────────────────────────────────────────────────────── */

app.get("/workitems/:id/timeline", async (req) => {
  const { id } = req.params as { id: string };
  const wi = await locateWorkItem({ id });
  return { workitem: wi, events: await timeline(wi.clientId, wi.id) };
});

app.get("/workitems/:id/brief", async (req, reply) => {
  const { id } = req.params as { id: string };
  const wi = await locateWorkItem({ id });
  reply.type("text/markdown");
  return briefFor(wi.clientId, wi.id);
});

/** Hook helper: which WorkItem does this client + branch map to? */
app.get("/resolve", async (req, reply) => {
  const q = z.object({ clientId: z.string().uuid(), branch: z.string().optional(), key: z.string().optional() }).parse(req.query);
  const r = await resolveWorkItem({ clientId: q.clientId, branch: q.branch, key: q.key });
  if (!r) return reply.code(404).send({ error: "no match" });
  return { workitemId: r.id, key: r.key, title: r.title };
});

app.get("/clients/:clientId/inbox", async (req) => {
  const { clientId } = req.params as { clientId: string };
  return { events: await unassigned(clientId) };
});

/** Full WorkItem detail for the UI: header + gaps + blockers + timeline. */
app.get("/workitems/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const verifyAdo = (req.query as { verifyAdo?: string }).verifyAdo === "1";
  const dev = verifyAdo ? await actingUser(req) : { id: "" };
  const wi = await locateWorkItem({ id });
  const t = await tasksFor(wi.clientId, id);
  return withTenant(wi.clientId, async (tx) => {
    const [full] = await tx.select().from(workitem).where(sql`${workitem.id} = ${id}`).limit(1);

    // on an explicit check: reconcile this one item against TFS (fields +
    // attachments; TFS wins). If it was deleted there, mirror that here.
    if (verifyAdo && full?.linkedAdoId) {
      const r = await pullOneFromAdo(wi.clientId, id, { userId: dev.id });
      if (r === "gone") {
        await deleteRequirement(wi.clientId, id);
        return reply.code(410).send({ error: "deleted in TFS" });
      }
    }
    let adoUrl: string | null = null;
    if (full?.linkedAdoId) {
      // prefer the URL ADO itself returned (format varies by version); fall back to the modern shape
      const [ev] = await tx.select({ p: sql<Record<string, unknown>>`payload` }).from(sql`event_log`)
        .where(sql`workitem_id = ${id} and type = 'ado.synced' and payload ? 'url'`)
        .orderBy(sql`occurred_at desc`).limit(1);
      adoUrl = (ev?.p?.url as string | undefined) ?? null;
      if (!adoUrl) {
        const [conn] = await tx.select({ config: sql<Record<string, string>>`config` }).from(sql`service_connection`).where(sql`client_id = ${wi.clientId} and kind = 'ado' and revoked_at is null`).limit(1);
        const cfg = conn?.config as Record<string, string> | undefined;
        if (cfg?.orgUrl && cfg?.project) adoUrl = adoWorkItemUrl(cfg.orgUrl, cfg.project, full.linkedAdoId);
      }
    }
    return {
      workitem: { ...wi, ...full },
      adoUrl,
      attachments: await attachmentsFor(wi.clientId, id),
      repos: await reposForRequirement(wi.clientId, id),
      gaps: await tx.select().from(gap).where(sql`${gap.workitemId} = ${id}`).orderBy(sql`${gap.blocking} desc, ${gap.createdAt}`),
      blockers: await tx.select().from(blocker).where(sql`${blocker.workitemId} = ${id}`).orderBy(sql`${blocker.createdAt} desc`),
      tasks: t.tasks,
      taskDependencies: t.dependencies,
      events: await timeline(wi.clientId, id),
    };
  });
});

/* ── requirement edit + repo links ─────────────────────────────────── */

app.patch("/workitems/:id", async (req) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({
    title: z.string().min(1).optional(),
    type: WITYPE.optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    risk: z.enum(["low", "medium", "high"]).optional(),
    executor: z.enum(["human", "ai", "mixed"]).optional(),
    phase: z.enum(["intake", "shaping", "building", "review", "done", "archived"]).optional(),
    budgetUsd: z.union([z.number(), z.string(), z.null()]).optional(),
    dueDate: z.string().nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
    adoAreaPath: z.string().nullable().optional(),
    key: z.string().nullable().optional(),
  }).parse(req.body);
  const wi = await locateWorkItem({ id });
  const updated = await updateRequirement({ clientId: wi.clientId, id, by: { userId: dev.id }, patch: b });
  // mirror the change into ADO when linked (best effort)
  let ado;
  if (updated.linkedAdoId) ado = await trySyncNewRequirement(wi.clientId, id, { userId: dev.id });
  return { ...updated, ado };
});

app.post("/workitems/:id/repos", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({
    repoId: z.string().uuid().optional(),
    name: z.string().optional(), gitUrl: z.string().optional(),
    linkKind: z.enum(["declared", "auto"]).optional(),
  }).parse(req.body);
  const wi = await locateWorkItem({ id });
  let repoId = b.repoId;
  if (!repoId && b.name) {
    const r = await linkRepoToClient({ clientId: wi.clientId, name: b.name, gitUrl: b.gitUrl, by: { userId: dev.id } });
    repoId = r.id;
  }
  if (!repoId) return reply.code(400).send({ error: "repoId or name required" });
  const out = await linkRepoToRequirement({ clientId: wi.clientId, workitemId: id, repoId, by: { userId: dev.id }, linkKind: b.linkKind });
  return reply.code(201).send(out);
});

app.delete("/workitems/:id/repos/:repoId", async (req) => {
  const dev = await actingUser(req);
  const { id, repoId } = req.params as { id: string; repoId: string };
  const wi = await locateWorkItem({ id });
  return unlinkRepoFromRequirement({ clientId: wi.clientId, workitemId: id, repoId, by: { userId: dev.id } });
});

app.post("/workitems/:id/attachments", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ name: z.string().min(1), contentBase64: z.string().min(1) }).parse(req.body);
  const wi = await locateWorkItem({ id });
  const bytes = Buffer.from(b.contentBase64, "base64");
  if (bytes.length > 25 * 1024 * 1024) return reply.code(413).send({ error: "file too large (max 25MB)" });
  const out = await addAttachment({ clientId: wi.clientId, workitemId: id, name: b.name, bytes, by: { userId: dev.id } });
  return reply.code(201).send(out);
});

app.delete("/workitems/:id/depends-on/:depId", async (req) => {
  await actingUser(req);
  const { id, depId } = req.params as { id: string; depId: string };
  const wi = await locateWorkItem({ id });
  return deleteDependency(wi.clientId, id, depId);
});

app.get("/clients/:clientId/blockers", async (req) => {
  const dev = await actingUser(req);
  const { clientId } = req.params as { clientId: string };
  return { blockers: await blockersFor(clientId, dev.id) };
});

/* ── gaps ─────────────────────────────────────────────────────────── */

app.post("/workitems/:id/gaps", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z
    .object({
      description: z.string(),
      blocking: z.boolean(),
      confidence: z.number().min(0).max(1),
      mode: z.enum(["delegated", "interactive"]).default("delegated"),
    })
    .parse(req.body);
  const wi = await locateWorkItem({ id });
  const row = await proposeGap({ clientId: wi.clientId, workitemId: id, by: { userId: dev.id }, ...b });
  return reply.code(201).send(row);
});

app.post("/gaps/:id/verify", async (req) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z
    .object({
      outcome: z.enum(["verified", "dismissed", "spun_off"]),
      spunOffTitle: z.string().optional(),
      ownerId: z.string().uuid().optional(),
      clientId: z.string().uuid(),
    })
    .parse(req.body);
  return verifyGap({ gapId: id, by: { userId: dev.id }, ...b });
});

/* ── edit / delete: gaps, blockers, tasks ─────────────────────────── */

app.patch("/gaps/:id", async (req) => {
  await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ clientId: z.string().uuid(), description: z.string().optional(), blocking: z.boolean().optional() }).parse(req.body);
  return updateGap({ id, ...b });
});
app.delete("/gaps/:id", async (req) => {
  await actingUser(req);
  const b = z.object({ clientId: z.string().uuid() }).parse(req.body ?? {});
  return deleteGap(b.clientId, (req.params as { id: string }).id);
});

app.patch("/blockers/:id", async (req) => {
  await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ clientId: z.string().uuid(), question: z.string().optional(), questionType: z.string().optional() }).parse(req.body);
  return updateBlocker({ id, ...b });
});
app.delete("/blockers/:id", async (req) => {
  await actingUser(req);
  const b = z.object({ clientId: z.string().uuid() }).parse(req.body ?? {});
  return deleteBlocker(b.clientId, (req.params as { id: string }).id);
});

app.patch("/tasks/:id", async (req) => {
  await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ clientId: z.string().uuid(), intent: z.string().optional(), appetite: z.enum(["small", "standard", "large"]).optional() }).parse(req.body);
  return updateTask({ id, ...b });
});
app.delete("/tasks/:id", async (req) => {
  await actingUser(req);
  const b = z.object({ clientId: z.string().uuid() }).parse(req.body ?? {});
  return deleteTask(b.clientId, (req.params as { id: string }).id);
});

/* ── contention map + reviewer ───────────────────────────────────── */

app.post("/workitems/:id/touches", async (req, reply) => {
  await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z
    .object({
      repo: z.string(),
      branch: z.string().optional(),
      paths: z.array(z.string()).min(1),
      kind: z.enum(["declared", "branch"]).optional(),
    })
    .parse(req.body);
  const wi = await locateWorkItem({ id });
  const out = await recordTouches({ clientId: wi.clientId, workitemId: id, repoName: b.repo, branch: b.branch, paths: b.paths, kind: b.kind });
  return reply.code(201).send({ repoId: out.repoId, overlaps: out.overlaps });
});

app.post("/workitems/:id/touches/release", async (req) => {
  await actingUser(req);
  const { id } = req.params as { id: string };
  const wi = await locateWorkItem({ id });
  await releaseTouches(wi.clientId, id);
  return { released: true };
});

app.get("/repos/:repo/contention", async (req, reply) => {
  const { repo: repoName } = req.params as { repo: string };
  const clientId = (req.query as { clientId?: string }).clientId;
  if (!clientId) return reply.code(400).send({ error: "clientId query param required" });
  return { contention: await contentionFor(clientId, decodeURIComponent(repoName)) };
});

app.post("/workitems/:id/review", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z
    .object({
      prRef: z.string().optional(),
      verdict: z.enum(["pass", "changes_requested"]),
      findings: z
        .array(z.object({ file: z.string(), line: z.number().int().optional(), severity: z.enum(["info", "warn", "block"]), note: z.string() }))
        .default([]),
      overlapFocus: z.array(z.string()).optional(),
    })
    .parse(req.body);
  const wi = await locateWorkItem({ id });
  const row = await recordReview({ clientId: wi.clientId, workitemId: id, by: { userId: dev.id }, ...b });
  return reply.code(201).send(row);
});

/* ── flow / dependencies ─────────────────────────────────────────── */

// Flow view rooted at one requirement (its subtree + dependency edges)
app.get("/requirements/:id/flow", async (req) => {
  const wi = await locateWorkItem({ id: (req.params as { id: string }).id });
  return flowFor(wi.clientId, wi.id);
});

app.post("/workitems/:id/depends-on", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z
    .object({
      dependsOnWorkitemId: z.string().uuid(),
      kind: z.enum(["predecessor", "parent", "related"]).optional(),
      reason: z.string().optional(),
    })
    .parse(req.body);
  const wi = await locateWorkItem({ id });
  await linkWorkItems({ clientId: wi.clientId, workitemId: id, by: { userId: dev.id }, ...b });
  return reply.code(201).send({ linked: true });
});

/* ── model routing ───────────────────────────────────────────────── */

app.post("/workitems/:id/route", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z
    .object({
      capability: z.enum(["brief", "matching", "narrative", "gap_detection", "decomposition", "review", "execution"]),
      signals: z
        .object({
          ambiguity: z.enum(["low", "medium", "high"]).optional(),
          breadth: z.number().int().optional(),
          reversible: z.boolean().optional(),
          openGaps: z.number().int().optional(),
          novelty: z.enum(["low", "medium", "high"]).optional(),
          recentEvents: z.number().int().optional(),
          mechanical: z.boolean().optional(),
        })
        .default({}),
      record: z.boolean().default(true),
    })
    .parse(req.body);
  const wi = await locateWorkItem({ id });
  const decision = route(b.capability as Capability, b.signals);
  if (b.record) {
    await recordRouting({ clientId: wi.clientId, workitemId: wi.id, by: { userId: dev.id }, decision });
  }
  return reply.code(200).send(decision);
});

/* ── tasks ────────────────────────────────────────────────────────── */

const taskInput = z.object({
  intent: z.string(),
  acceptance: z.array(z.object({ given: z.string(), when: z.string(), then: z.string() })).default([]),
  appetite: z.enum(["small", "standard", "large"]).optional(),
  dependsOn: z.array(z.number().int()).optional(),
  dependencyReason: z.string().optional(),
});

app.get("/workitems/:id/tasks", async (req) => {
  const { id } = req.params as { id: string };
  const wi = await locateWorkItem({ id });
  return tasksFor(wi.clientId, id);
});

app.post("/workitems/:id/tasks", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ tasks: z.array(taskInput).min(1), openspecChangeId: z.string().optional() }).parse(req.body);
  const wi = await locateWorkItem({ id });
  const out = await proposeTasks({ clientId: wi.clientId, workitemId: id, by: { userId: dev.id }, ...b });
  return reply.code(201).send(out);
});

app.post("/tasks/:id/progress", async (req) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z
    .object({
      to: z.enum(["pending", "in_progress", "blocked", "done", "dropped"]),
      mode: z.enum(["delegated", "interactive"]).default("interactive"),
      clientId: z.string().uuid(),
    })
    .parse(req.body);
  return progressTask({ taskId: id, by: { userId: dev.id }, to: b.to, mode: b.mode, clientId: b.clientId });
});

/* ── blockers ─────────────────────────────────────────────────────── */

app.post("/workitems/:id/blockers", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z
    .object({ questionType: z.string(), question: z.string(), taskId: z.string().uuid().optional() })
    .parse(req.body);
  const wi = await locateWorkItem({ id });
  const row = await raiseBlocker({ clientId: wi.clientId, workitemId: id, raisedBy: { userId: dev.id }, ...b });
  return reply.code(201).send(row);
});

app.post("/blockers/:id/answer", async (req) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ answer: z.string(), clientId: z.string().uuid() }).parse(req.body);
  return answerBlocker({ blockerId: id, answeredBy: { userId: dev.id }, answer: b.answer, clientId: b.clientId });
});

/* ── client onboarding ────────────────────────────────────────────── */

const WITYPE = z.enum(["epic", "feature", "story", "bug", "task", "spike"]);

app.post("/admin/setup-client", async (req, reply) => {
  const dev = await actingUser(req);
  const b = z
    .object({
      clientName: z.string(),
      repo: z
        .object({
          name: z.string(),
          gitUrl: z.string().optional(),
          adoRepoRef: z.string().optional(),
          orgShared: z.boolean().optional(),
        })
        .optional(),
      firstRequirement: z
        .object({ key: z.string().optional(), title: z.string(), type: WITYPE.optional() })
        .optional(),
    })
    .parse(req.body);
  const result = await setupClient({ ...b, actorEmail: dev.email });
  return reply.code(201).send(result);
});

/* ── requirements (WorkItems) ─────────────────────────────────────── */

app.post("/workitems", async (req, reply) => {
  const dev = await actingUser(req);
  const b = z
    .object({
      clientId: z.string().uuid().optional(),
      parentId: z.string().uuid().optional(),
      ownerId: z.string().uuid().optional(),
      key: z.string().optional(),
      title: z.string(),
      type: WITYPE.optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      risk: z.enum(["low", "medium", "high"]).optional(),
      executor: z.enum(["human", "ai", "mixed"]).optional(),
      dueInDays: z.number().int().optional(),
      budgetUsd: z.number().optional(),
      linkedAdoId: z.number().int().optional(),
      adoAreaPath: z.string().optional(),
    })
    .parse(req.body);

  // client comes from the parent when nesting, else must be given
  let clientId = b.clientId;
  if (b.parentId) {
    const parent = await locateWorkItem({ id: b.parentId });
    clientId = parent.clientId;
  }
  if (!clientId) throw new NotFound("clientId or parentId is required");

  const [wi] = await withTenant(clientId, (tx) =>
    tx
      .insert(workitem)
      .values({
        clientId,
        parentId: b.parentId ?? null,
        ownerId: b.ownerId ?? dev.id,
        key: b.key ?? null,
        title: b.title,
        type: b.type ?? "story",
        priority: b.priority ?? "medium",
        risk: b.risk ?? "low",
        executor: b.executor ?? "human",
        budgetUsd: b.budgetUsd != null ? String(b.budgetUsd) : null,
        dueDate: b.dueInDays != null ? new Date(Date.now() + b.dueInDays * 864e5) : null,
        linkedAdoId: b.linkedAdoId ?? null,
        adoAreaPath: b.adoAreaPath ?? null,
      })
      .returning(),
  );
  // best-effort push to Azure DevOps when the client syncs there
  const ado = await trySyncNewRequirement(clientId, wi!.id, { userId: dev.id });
  return reply.code(201).send({ ...wi, ado });
});

app.post("/workitems/:id/ado-sync", async (req) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const wi = await locateWorkItem({ id });
  return syncRequirementToAdo({ clientId: wi.clientId, workitemId: id, by: { userId: dev.id } });
});

app.delete("/workitems/:id", async (req, reply) => {
  await actingUser(req);
  const { id } = req.params as { id: string };
  const q = req.query as { keepAdo?: string };
  const wi = await locateWorkItem({ id });
  // grab the ADO link before the row is gone
  const [full] = await withTenant(wi.clientId, (tx) => tx.select({ a: workitem.linkedAdoId }).from(workitem).where(sql`${workitem.id} = ${id}`).limit(1));
  // sub-requirements must be moved/deleted first; event_log rows detach
  // (workitem_id → NULL) so history is never destroyed.
  await deleteRequirement(wi.clientId, id);
  let ado;
  if (full?.a && q.keepAdo !== "1") ado = await deleteAdoForRequirement(wi.clientId, full.a);
  return reply.code(200).send({ deleted: true, ado });
});

app.post("/workitems/:id/ado-link", async (req) => {
  await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ linkedAdoId: z.number().int() }).parse(req.body);
  const wi = await locateWorkItem({ id });
  const [row] = await withTenant(wi.clientId, (tx) =>
    tx.update(workitem).set({ linkedAdoId: b.linkedAdoId, updatedAt: new Date() }).where(sql`${workitem.id} = ${id}`).returning(),
  );
  return row;
});


// Dev-only: a clean way to stop the server so PGlite flushes .pgdata.
// Windows can't deliver SIGINT to a background node process, and a hard
// kill mid-write can corrupt the embedded Postgres data dir.
if (dbKind === "pglite") {
  app.post("/admin/shutdown", async (_req, reply) => {
    await reply.send({ stopping: true });
    setTimeout(() => {
      app.close().then(() => import("@dcc/db").then((m) => m.closeDb())).finally(() => process.exit(0));
    }, 50);
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001);
  app.listen({ port, host: "0.0.0.0" }).then(() => app.log.info(`dcc-api on :${port}`));

  // Graceful shutdown — PGlite's embedded Postgres can leave .pgdata
  // un-openable if the process is killed mid-write, so always close it.
  let closing = false;
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const) {
    process.on(sig, () => {
      if (closing) return;
      closing = true;
      app.log.info(`${sig} — closing`);
      app
        .close()
        .then(() => import("@dcc/db").then((m) => m.closeDb()))
        .finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}

export { app, db, client, repo, users };
