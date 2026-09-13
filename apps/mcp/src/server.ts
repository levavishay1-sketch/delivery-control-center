import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, timeline, withTenant } from "@dcc/db";
import { blocker, gap, workitem } from "@dcc/db/schema";
import { attachmentsFor, listClients, reposForRequirement, requirementCostSummary, tasksFor } from "@dcc/core";

/**
 * DCC's MCP server — a thin, READ-ONLY transport adapter over
 * `packages/core`/`@dcc/db`, exactly the same relationship `apps/api`
 * already has to those packages (never a second copy of business
 * logic). Built following this session's own feasibility assessment
 * (`mcp-server-feasibility`): start read-only, no write tools until real
 * (Entra ID) auth replaces the REST API's current dev-shim auth — a
 * write tool needs a trustworthy caller identity to honor DCC's "every
 * AI action runs as a named real person" rule, and this server has no
 * such identity to offer yet. Read tools carry no such requirement: they
 * mirror the equivalent `GET` REST routes, which likewise don't require
 * a resolved acting user (see `apps/api/src/server.ts`'s `GET
 * /workitems/:id`).
 *
 * Runs over stdio — the transport an external Claude Code session
 * launches directly, matching the strongest use case identified in the
 * feasibility spike (a developer's own session reaching into DCC without
 * alt-tabbing to the web UI). NOT yet verified against a real MCP
 * client in this session (no interactive MCP-client harness was
 * available) — the tool schemas and `content` shape follow the
 * installed SDK's own type definitions (`@modelcontextprotocol/sdk`
 * 1.30.0, checked directly against `dist/esm/server/mcp.d.ts` rather
 * than assumed), but a first real run against Claude Code should be
 * the first thing anyone does with this before relying on it.
 */

const server = new McpServer({ name: "dcc", version: "0.1.0" });

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const errorText = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true as const });

server.registerTool(
  "list_clients",
  {
    title: "List DCC clients",
    description: "Every client (tenant) this DCC instance manages — id, name, connector type. Needed to get a clientId for the other tools.",
  },
  async () => {
    const clients = await listClients();
    return text(clients);
  },
);

server.registerTool(
  "search_requirements",
  {
    title: "Search requirements",
    description: "Search a client's requirements by title (case-insensitive substring). Returns id, key, title, type, phase — enough to pick one for get_requirement.",
    inputSchema: {
      clientId: z.string().uuid().describe("The client to search within — from list_clients"),
      query: z.string().describe("Substring to match against requirement titles"),
    },
  },
  async ({ clientId, query }) => {
    const rows = await withTenant(clientId, (tx) =>
      tx.select({ id: workitem.id, key: workitem.key, title: workitem.title, type: workitem.type, phase: workitem.phase, requirementType: workitem.requirementType })
        .from(workitem)
        .where(and(eq(workitem.clientId, clientId), sql`${workitem.title} ilike ${"%" + query + "%"}`))
        .orderBy(desc(workitem.updatedAt))
        .limit(25),
    );
    return text(rows);
  },
);

server.registerTool(
  "get_requirement",
  {
    title: "Get requirement detail",
    description: "Full detail for one requirement: fields, gaps, blockers, tasks, attachments, linked repos, and its full event timeline. Same data the DCC web UI's requirement page shows.",
    inputSchema: { id: z.string().uuid().describe("The requirement's id — from search_requirements") },
  },
  async ({ id }) => {
    const [wi] = await db.select().from(workitem).where(eq(workitem.id, id)).limit(1);
    if (!wi) return errorText(`no requirement with id ${id}`);
    const [t, attachments, repos, events] = await Promise.all([
      tasksFor(wi.clientId, id),
      attachmentsFor(wi.clientId, id),
      reposForRequirement(wi.clientId, id),
      timeline(wi.clientId, id),
    ]);
    const [gaps, blockers] = await withTenant(wi.clientId, (tx) => Promise.all([
      tx.select().from(gap).where(eq(gap.workitemId, id)).orderBy(desc(gap.blocking), gap.createdAt),
      tx.select().from(blocker).where(eq(blocker.workitemId, id)).orderBy(desc(blocker.createdAt)),
    ]));
    return text({ workitem: wi, tasks: t.tasks, taskDependencies: t.dependencies, gaps, blockers, attachments, repos, events });
  },
);

server.registerTool(
  "get_timeline",
  {
    title: "Get requirement timeline",
    description: "Just the append-only event log for one requirement — every note, decision, status change, AI run, in order. Use get_requirement instead if you also need current field values/tasks.",
    inputSchema: { id: z.string().uuid() },
  },
  async ({ id }) => {
    const [wi] = await db.select({ clientId: workitem.clientId }).from(workitem).where(eq(workitem.id, id)).limit(1);
    if (!wi) return errorText(`no requirement with id ${id}`);
    return text(await timeline(wi.clientId, id));
  },
);

server.registerTool(
  "get_cost_summary",
  {
    title: "Get requirement AI cost summary",
    description: "The requirement's cumulative AI cost: total USD, tokens, run count, broken down by what kind of run (assess/breakdown/implement/gap_letter/retro/...).",
    inputSchema: { id: z.string().uuid() },
  },
  async ({ id }) => {
    const [wi] = await db.select({ clientId: workitem.clientId }).from(workitem).where(eq(workitem.id, id)).limit(1);
    if (!wi) return errorText(`no requirement with id ${id}`);
    return text(await requirementCostSummary(wi.clientId, id));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
