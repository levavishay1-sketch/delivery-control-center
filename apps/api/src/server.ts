import Fastify from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, withTenant, timeline, unassigned } from "@dcc/db";
import { client, project, projectRepo, repo, users, workitem } from "@dcc/db/schema";
import {
  briefFor,
  recordGitActivity,
  recordNote,
  recordSession,
  resolveWorkItem,
} from "@dcc/core";
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

/* ── admin ────────────────────────────────────────────────────────── */

app.post("/workitems", async (req, reply) => {
  await actingUser(req);
  const b = z
    .object({
      projectId: z.string().uuid(),
      ownerId: z.string().uuid(),
      key: z.string().optional(),
      title: z.string(),
      level: z.enum(["epic", "feature", "story", "task"]).optional(),
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
        ownerId: b.ownerId,
        key: b.key ?? null,
        title: b.title,
        level: b.level ?? "story",
        linkedAdoId: b.linkedAdoId ?? null,
      })
      .returning(),
  );
  return reply.code(201).send(wi);
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
