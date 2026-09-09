import Fastify from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, dbKind, withTenant, timeline, unassigned } from "@dcc/db";
import { client, project, projectRepo, repo, users, workitem } from "@dcc/db/schema";
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
  linkRepoToClient,
  listConnections,
  listRepos,
  listAlerts,
  listAllProjects,
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
} from "@dcc/core";
import { blocker, gap } from "@dcc/db/schema";
import { AuthError, NotFound, actingUser, locateProject, locateWorkItem } from "./context.ts";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof AuthError) return reply.code(401).send({ error: err.message });
  if (err instanceof NotFound) return reply.code(404).send({ error: err.message });
  if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues });
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

app.post("/clients/:id/repos", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ repoId: z.string().uuid().optional(), name: z.string().optional(), gitUrl: z.string().optional(), adoRepoRef: z.string().optional() }).parse(req.body);
  const r = await linkRepoToClient({ clientId: id, ...b, by: { userId: dev.id } });
  return reply.code(201).send(r);
});

app.post("/clients/:id/connections/ado", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ orgUrl: z.string().url(), project: z.string().min(1), pat: z.string().min(10) }).parse(req.body);
  const out = await addAdoConnection({ clientId: id, ...b, by: { userId: dev.id } });
  return reply.code(201).send({ id: out.id, check: out.check });
});

app.post("/clients/:cid/connections/:id/check", async (req) => {
  await actingUser(req);
  const { cid, id } = req.params as { cid: string; id: string };
  return checkAdoConnection(cid, id);
});

app.get("/list/workitems", async () => ({ items: await listAllWorkItems() }));
app.get("/list/projects", async () => ({ projects: await listAllProjects() }));
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
  note: z.object({ body: z.string(), source: z.enum(["manual", "email", "slack", "phone", "meeting"]).optional() }).optional(),
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
    ev = await recordNote({ ...common, body: b.note.body, source: b.note.source });
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
app.get("/workitems/:id", async (req) => {
  const { id } = req.params as { id: string };
  const wi = await locateWorkItem({ id });
  const t = await tasksFor(wi.clientId, id);
  return withTenant(wi.clientId, async (tx) => {
    const [full] = await tx.select().from(workitem).where(sql`${workitem.id} = ${id}`).limit(1);
    return {
      workitem: { ...wi, ...full },
      gaps: await tx.select().from(gap).where(sql`${gap.workitemId} = ${id}`).orderBy(sql`${gap.blocking} desc, ${gap.createdAt}`),
      blockers: await tx.select().from(blocker).where(sql`${blocker.workitemId} = ${id}`).orderBy(sql`${blocker.createdAt} desc`),
      tasks: t.tasks,
      taskDependencies: t.dependencies,
      events: await timeline(wi.clientId, id),
    };
  });
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
      projectId: z.string().uuid().optional(),
      ownerId: z.string().uuid().optional(),
      clientId: z.string().uuid(),
    })
    .parse(req.body);
  return verifyGap({ gapId: id, by: { userId: dev.id }, ...b });
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

app.get("/projects/:id/flow", async (req) => {
  const p = await locateProject((req.params as { id: string }).id);
  return flowFor(p.clientId, p.id);
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

app.post("/admin/setup-client", async (req, reply) => {
  const dev = await actingUser(req);
  const b = z
    .object({
      clientName: z.string(),
      projectName: z.string(),
      repo: z
        .object({
          name: z.string(),
          gitUrl: z.string().optional(),
          adoRepoRef: z.string().optional(),
          orgShared: z.boolean().optional(),
        })
        .optional(),
      firstWorkItem: z
        .object({ key: z.string(), title: z.string(), level: z.enum(["epic", "feature", "story", "task"]).optional() })
        .optional(),
    })
    .parse(req.body);
  const result = await setupClient({ ...b, actorEmail: dev.email });
  return reply.code(201).send(result);
});

/* ── admin ────────────────────────────────────────────────────────── */

app.post("/workitems", async (req, reply) => {
  const dev = await actingUser(req);
  const b = z
    .object({
      projectId: z.string().uuid(),
      ownerId: z.string().uuid().optional(),
      key: z.string().optional(),
      title: z.string(),
      level: z.enum(["epic", "feature", "story", "task"]).optional(),
      kind: z.enum(["project", "task", "bug", "change"]).optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      risk: z.enum(["low", "medium", "high"]).optional(),
      executor: z.enum(["human", "ai", "mixed"]).optional(),
      dueInDays: z.number().int().optional(),
      budgetUsd: z.number().optional(),
      linkedAdoId: z.number().int().optional(),
    })
    .parse(req.body);
  const p = await locateProject(b.projectId);
  const [wi] = await withTenant(p.clientId, (tx) =>
    tx
      .insert(workitem)
      .values({
        clientId: p.clientId,
        projectId: b.projectId,
        ownerId: b.ownerId ?? dev.id,
        key: b.key ?? null,
        title: b.title,
        level: b.level ?? "story",
        kind: b.kind ?? "task",
        priority: b.priority ?? "medium",
        risk: b.risk ?? "low",
        executor: b.executor ?? "human",
        budgetUsd: b.budgetUsd != null ? String(b.budgetUsd) : null,
        dueDate: b.dueInDays != null ? new Date(Date.now() + b.dueInDays * 864e5) : null,
        linkedAdoId: b.linkedAdoId ?? null,
      })
      .returning(),
  );
  return reply.code(201).send(wi);
});

app.delete("/workitems/:id", async (req, reply) => {
  await actingUser(req);
  const { id } = req.params as { id: string };
  const wi = await locateWorkItem({ id });
  // event_log rows for this item lose their workitem_id (on delete: set null),
  // landing in the unassigned bucket — history is never destroyed.
  await withTenant(wi.clientId, (tx) => tx.delete(workitem).where(sql`${workitem.id} = ${id}`));
  return reply.code(204).send();
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

app.post("/projects/:id/repos", async (req, reply) => {
  const dev = await actingUser(req);
  const { id } = req.params as { id: string };
  const b = z.object({ repoId: z.string().uuid() }).parse(req.body);
  const p = await locateProject(id);
  await withTenant(p.clientId, (tx) =>
    tx.insert(projectRepo).values({ clientId: p.clientId, projectId: id, repoId: b.repoId, addedBy: dev.id }),
  );
  return reply.code(201).send({ linked: true });
});

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001);
  app.listen({ port, host: "0.0.0.0" }).then(() => app.log.info(`dcc-api on :${port}`));
}

export { app, db, client, project, repo, users };
