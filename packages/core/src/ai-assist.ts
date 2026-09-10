import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { appendEvent, db, withTenant } from "@dcc/db";
import { flowRun, repo, task, taskDependency, workitem } from "@dcc/db/schema";
import { ADO_LADDER, MAX_TASK_DEPTH, adoTypeForLevel } from "./ado-map.ts";
import { regenerateBrief } from "./brief/generate.ts";
import { proposeGap } from "./gaps.ts";

/**
 * The AI-assisted steps of the flow. These run through the LOCAL `claude`
 * CLI — the user's own logged-in session (no API key). DCC spawns it
 * headless (`claude -p … --output-format json`) with the repo as cwd so
 * Claude can actually read the code, then parses the JSON it returns.
 */

// On Windows a global npm install exposes claude.cmd; Node ≥20 refuses to
// spawn a .cmd without shell:true (EINVAL), so we run it through the shell and
// keep every arg space-free (comma-separated --allowed-tools) to avoid quoting.
const CLAUDE_BIN = process.env.DCC_CLAUDE_BIN || (process.platform === "win32" ? "claude.cmd" : "claude");
const CLAUDE_VIA_SHELL = process.platform === "win32";
const REPO_CACHE = path.join(os.tmpdir(), "dcc-repos");

/* ── flow runs: durable background jobs for the local `claude` CLI ──
 *
 * A run is kicked off detached — the HTTP request returns immediately and
 * the work keeps going. The activity transcript lives in an in-memory
 * buffer while the run is active (so a poll during the 3-5 min spawn
 * never touches the DB) and is written to `flow_run` once at the end, so
 * the user can leave the screen and come back to everything Claude did.
 */

type FlowKind = "assess" | "breakdown" | "implement";

const buffers = new Map<string, { lines: string[]; kind: FlowKind; workitemId: string; taskId?: string }>();

function pushLine(runId: string | undefined, line: string) {
  if (!runId) return;
  const b = buffers.get(runId);
  if (!b) return;
  b.lines.push(line);
  if (b.lines.length > 4000) b.lines.splice(0, b.lines.length - 4000);
}

export type FlowRunView = {
  id: string;
  kind: string;
  state: "running" | "done" | "error";
  lines: string[];
  result: unknown;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

function viewOf(row: typeof flowRun.$inferSelect): FlowRunView {
  return {
    id: row.id, kind: row.kind, state: row.state as FlowRunView["state"],
    lines: (row.log ?? []) as string[], result: row.result ?? null, error: row.error,
    startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
    finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
  };
}

/** The latest run for a requirement — from the live buffer if one is
 *  active (no DB hit during the spawn), otherwise the persisted row. */
export async function getFlowRunView(workitemId: string): Promise<FlowRunView | null> {
  for (const [id, b] of buffers) {
    if (b.workitemId === workitemId && !b.taskId) {
      return { id, kind: b.kind, state: "running", lines: b.lines, result: null, error: null, startedAt: null, finishedAt: null };
    }
  }
  const [row] = await db.select().from(flowRun)
    .where(and(eq(flowRun.workitemId, workitemId), isNull(flowRun.taskId)))
    .orderBy(desc(flowRun.startedAt)).limit(1);
  return row ? viewOf(row) : null;
}

/** The latest implementation run for one task. */
export async function getTaskRunView(taskId: string): Promise<FlowRunView | null> {
  for (const [id, b] of buffers) {
    if (b.taskId === taskId) {
      return { id, kind: b.kind, state: "running", lines: b.lines, result: null, error: null, startedAt: null, finishedAt: null };
    }
  }
  const [row] = await db.select().from(flowRun).where(eq(flowRun.taskId, taskId)).orderBy(desc(flowRun.startedAt)).limit(1);
  return row ? viewOf(row) : null;
}

/** Kick off assess/breakdown/implement in the background. Returns at once. */
export async function startFlowRun(input: { clientId: string; workitemId: string; kind: FlowKind; by: Dev; taskId?: string }): Promise<{ runId: string; alreadyRunning: boolean }> {
  for (const [id, b] of buffers) {
    if (input.taskId ? b.taskId === input.taskId : b.workitemId === input.workitemId && !b.taskId) {
      return { runId: id, alreadyRunning: true };
    }
  }

  const [row] = await db.insert(flowRun).values({
    clientId: input.clientId, workitemId: input.workitemId, taskId: input.taskId ?? null, kind: input.kind,
    state: "running", startedBy: input.by.userId, log: [],
  }).returning();
  const runId = row!.id;
  buffers.set(runId, { lines: [], kind: input.kind, workitemId: input.workitemId, ...(input.taskId ? { taskId: input.taskId } : {}) });

  void (async () => {
    try {
      const result = input.kind === "assess"
        ? await runAssess({ ...input, runId })
        : input.kind === "implement"
          ? await runImplement({ ...input, taskId: input.taskId!, runId })
          : await runBreakdown({ ...input, runId });
      await db.update(flowRun).set({
        state: "done", result: result as unknown as Record<string, unknown>,
        log: buffers.get(runId)?.lines ?? [], finishedAt: new Date(),
      }).where(eq(flowRun.id, runId));
    } catch (e) {
      pushLine(runId, `✕ שגיאה: ${(e as Error).message}`);
      await db.update(flowRun).set({
        state: "error", error: (e as Error).message,
        log: buffers.get(runId)?.lines ?? [], finishedAt: new Date(),
      }).where(eq(flowRun.id, runId)).catch(() => {});
    } finally {
      setTimeout(() => buffers.delete(runId), 20_000);
    }
  })();

  return { runId, alreadyRunning: false };
}

/** Turn one stream-json line into a readable transcript line, or null to skip. */
function describeEvent(line: string): string | null {
  let e: Record<string, unknown>;
  try { e = JSON.parse(line); } catch { return null; }
  if (e.type === "assistant" && e.message && typeof e.message === "object") {
    const content = (e.message as { content?: unknown[] }).content ?? [];
    const bits: string[] = [];
    for (const c of content as Record<string, unknown>[]) {
      if (c.type === "text" && typeof c.text === "string" && c.text.trim()) {
        const t = c.text.trim();
        // the final answer is the raw JSON payload — don't dump it into the log
        if (/^[[{]/.test(t) && /["}\]]$/.test(t)) continue;
        bits.push(`💭 ${t.replace(/\s+/g, " ").slice(0, 600)}`);
      } else if (c.type === "tool_use") {
        const inp = (c.input ?? {}) as Record<string, unknown>;
        const raw = String(inp.file_path ?? inp.path ?? inp.pattern ?? inp.query ?? inp.command ?? "");
        // strip the repo-cache prefix so paths read as repo-relative
        const arg = raw.replace(/^.*[/\\]dcc-repos[/\\][0-9a-f-]+[/\\]/i, "").replace(/\\/g, "/");
        bits.push(`🔧 ${String(c.name)} ${arg.slice(0, 160)}`.trim());
      }
    }
    return bits.join("\n") || null;
  }
  if (e.type === "result") {
    const cost = typeof e.total_cost_usd === "number" ? ` · $${(e.total_cost_usd as number).toFixed(3)}` : "";
    const turns = typeof e.num_turns === "number" ? `${e.num_turns} צעדים` : "";
    return `✓ Claude סיים${turns ? ` (${turns}${cost})` : ""}`;
  }
  return null;
}

/** Run `claude -p` in `cwd` (prompt via stdin), expect a single JSON object back. */
async function runClaudeJson<T>(
  cwd: string,
  prompt: string,
  opts: { timeoutMs?: number; maxTurns?: number; runId?: string; write?: boolean } = {},
): Promise<T> {
  // prompt goes on stdin so there is nothing to shell-escape; args are all plain.
  // Read-only by default (plan mode). `write` is only for implementation runs,
  // and those work on an isolated clone — never the user's own checkout.
  const args = opts.write
    ? [
        "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
        "--allowed-tools", "Read,Grep,Glob,Edit,Write,Bash",
        "--max-turns", String(opts.maxTurns ?? 80),
      ]
    : [
        "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "plan",
        "--allowed-tools", "Read,Grep,Glob",
        "--max-turns", String(opts.maxTurns ?? 40),
      ];
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd, env: process.env, windowsHide: true, shell: CLAUDE_VIA_SHELL });
    let out = "";
    let err = "";
    let buf = "";
    const killer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`claude timed out after ${(opts.timeoutMs ?? 240000) / 1000}s`)); }, opts.timeoutMs ?? 240000);
    child.stdout.on("data", (d) => {
      out += d;
      if (!opts.runId) return;
      buf += d;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const ln of parts) {
        const desc = describeEvent(ln.trim());
        if (desc) for (const s of desc.split("\n")) pushLine(opts.runId, s);
      }
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(killer); reject(new Error(`cannot run "${CLAUDE_BIN}" — האם claude מותקן ומחובר? (${e.message})`)); });
    child.on("close", (code) => {
      clearTimeout(killer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 400)}`));
      resolve(out);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });

  // stream-json → many NDJSON lines; the assistant's answer is the last
  // {"type":"result","result":"…"} line.
  let text = raw.trim();
  const resultLine = raw.split("\n").reverse().find((l) => l.includes('"type":"result"'));
  try {
    const env = JSON.parse((resultLine ?? text).trim()) as { result?: string };
    if (typeof env.result === "string") text = env.result;
  } catch { /* fall back to raw */ }

  // pull the JSON object/array out of whatever the model wrapped it in
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text];
  const jsonText = (m[1] ?? text).trim();
  const start = jsonText.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in claude output: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(jsonText.slice(start)) as T;
  } catch (e) {
    throw new Error(`could not parse claude JSON (${(e as Error).message}): ${jsonText.slice(0, 300)}`);
  }
}

/** Local working copy for the repo — clone or pull. Returns null if we can't get one. */
async function ensureCheckout(r: { id: string; name: string; localPath: string | null; adoRepoRef: string | null }): Promise<string | null> {
  if (r.localPath && existsSync(r.localPath)) return r.localPath;
  const gitUrl = r.adoRepoRef && /^(https?:\/\/|git@)/.test(r.adoRepoRef) ? r.adoRepoRef : null;
  if (!gitUrl) return r.localPath ?? null;
  mkdirSync(REPO_CACHE, { recursive: true });
  const dir = path.join(REPO_CACHE, r.id);
  const run = (args: string[], c?: string) =>
    new Promise<number>((res) => {
      const p = spawn("git", args, { cwd: c, windowsHide: true, shell: process.platform === "win32" });
      p.on("close", (code) => res(code ?? 1));
      p.on("error", () => res(1));
    });
  if (existsSync(path.join(dir, ".git"))) {
    await run(["pull", "--ff-only"], dir);
  } else {
    const code = await run(["clone", "--depth", "80", gitUrl, dir]);
    if (code !== 0) return null;
  }
  return dir;
}

type Dev = { userId: string };

async function loadRequirementText(clientId: string, workitemId: string) {
  return withTenant(clientId, async (tx) => {
    const [wi] = await tx.select().from(workitem).where(eq(workitem.id, workitemId)).limit(1);
    if (!wi) throw new Error("requirement not found");
    const notes = await tx.execute<{ body: string; source: string; occurred_at: Date }>(
      sql`select payload->>'body' as body, source, occurred_at from event_log
          where workitem_id = ${workitemId} and type = 'note.added' and supersedes is null
          order by occurred_at asc limit 40`,
    );
    return { wi, notes: ((notes.rows ?? notes) as { body: string; source: string }[]).filter((n) => n.body) };
  });
}

async function firstRepo(clientId: string, workitemId: string) {
  return withTenant(clientId, async (tx) => {
    const linked = await tx
      .select({ id: repo.id, name: repo.name, localPath: repo.localPath, adoRepoRef: repo.adoRepoRef })
      .from(sql`workitem_repo wr`).innerJoin(repo, sql`${repo.id} = wr.repo_id`)
      .where(sql`wr.workitem_id = ${workitemId}`).limit(1);
    if (linked[0]) return linked[0];
    const cr = await tx
      .select({ id: repo.id, name: repo.name, localPath: repo.localPath, adoRepoRef: repo.adoRepoRef })
      .from(sql`client_repo cr`).innerJoin(repo, sql`${repo.id} = cr.repo_id`)
      .where(sql`cr.client_id = ${clientId}`).limit(1);
    return cr[0] ?? null;
  });
}

/* ── 1. assess: translate + is it baked? ───────────────────────────── */

export type AssessResult = {
  title: string;
  summary: string;
  baked: boolean;
  rationale: string;
  gaps: { description: string; blocking: boolean; confidence: number }[];
  repoUsed: string | null;
};

async function runAssess(input: { clientId: string; workitemId: string; by: Dev; runId?: string }): Promise<AssessResult> {
  pushLine(input.runId, "מכין עותק עבודה של ה-repo…");
  const { wi, notes } = await loadRequirementText(input.clientId, input.workitemId);
  const r = await firstRepo(input.clientId, input.workitemId);
  const cwd = r ? await ensureCheckout(r) : null;
  pushLine(input.runId, cwd ? `קורא את ה-repo ${r?.name}` : "אין עותק repo — מעריך מהטקסט בלבד");

  const reqText = [`Title: ${wi.title}`, ...notes.map((n) => `[${n.source}] ${n.body}`)].join("\n\n");
  const prompt = [
    "You are assessing a software requirement for a delivery team. The requirement text is in Hebrew.",
    cwd ? `You are in the repository this work would touch (${r?.name}). Read whatever code you need to judge feasibility.` : "There is no code checkout available; judge from the text alone.",
    "",
    "REQUIREMENT:",
    reqText,
    "",
    "Do this:",
    "1. Restate the requirement clearly (a short title + a 2-5 sentence summary). You may name code symbols / file paths in English, but everything else must be Hebrew.",
    "2. Decide if it is specified well enough to start implementing ('baked'), or if there are gaps / ambiguities / missing decisions that a person must resolve first.",
    "3. List the gaps (empty if baked). Mark each as blocking (must be answered before any code) or not.",
    "",
    "IMPORTANT: write title, summary, rationale and every gap description IN HEBREW. Reason in English internally if it helps, but the JSON string values must be Hebrew (code identifiers and paths may stay in English).",
    "",
    'Respond with ONLY this JSON, no prose, no markdown fence:',
    '{"title": string, "summary": string, "baked": boolean, "rationale": string, "gaps": [{"description": string, "blocking": boolean, "confidence": number}]}',
  ].join("\n");

  const res = await runClaudeJson<Omit<AssessResult, "repoUsed">>(cwd ?? process.cwd(), prompt, { timeoutMs: 300000, runId: input.runId });
  pushLine(input.runId, "כותב סיכום ופערים…");

  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "claude_session", type: "note.added",
    actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "dcc:assess" },
    payload: { body: `סיכום Claude:\n**${res.title}**\n${res.summary}\n\nהערכה: ${res.baked ? "אפוי — מוכן לפירוק" : "לא אפוי — צריך אינטראקציה"}\n${res.rationale}` },
  });
  const gaps = (res.gaps ?? []).filter((g) => g && g.description);
  for (const g of gaps) {
    await proposeGap({
      clientId: input.clientId, workitemId: input.workitemId, by: input.by,
      description: g.description, blocking: !!g.blocking,
      confidence: Math.min(1, Math.max(0, Number(g.confidence) || 0.7)),
      mode: "delegated",
    });
  }
  await withTenant(input.clientId, (tx) =>
    tx.update(workitem).set({ phase: "shaping", updatedAt: new Date() }).where(eq(workitem.id, input.workitemId)),
  );
  await regenerateBrief(input.clientId, input.workitemId);

  return { ...res, gaps, repoUsed: r?.name ?? null };
}

/* ── 2. breakdown: propose tasks + dependencies ────────────────────── */

export type BreakdownResult = {
  /** How deep the proposed tree is — picks the TFS ladder rungs. */
  depth: number;
  tasks: {
    id: string; seq: number; intent: string; appetite: string;
    affectedPaths: string[]; dependsOnSeq: number[];
    parentSeq: number | null; level: number; adoType: string; prompt: string | null;
  }[];
};

async function runBreakdown(input: { clientId: string; workitemId: string; by: Dev; runId?: string }): Promise<BreakdownResult> {
  pushLine(input.runId, "מכין עותק עבודה של ה-repo…");
  const { wi, notes } = await loadRequirementText(input.clientId, input.workitemId);
  const r = await firstRepo(input.clientId, input.workitemId);
  const cwd = r ? await ensureCheckout(r) : null;
  pushLine(input.runId, cwd ? `קורא את ה-repo ${r?.name}` : "אין עותק repo");

  const reqText = [`Title: ${wi.title}`, ...notes.map((n) => n.body)].join("\n\n");
  const prompt = [
    "Break this software requirement into a concrete implementation task list for the team.",
    cwd ? `You are in the repository (${r?.name}) — read the code to make the tasks specific and correctly ordered.` : "No code checkout available.",
    "",
    "REQUIREMENT (may be Hebrew):",
    reqText,
    "",
    "Produce a HIERARCHY, not a flat list. `parentSeq` is the seq of the parent node, or null for a top-level node.",
    "Choose the depth by how much structure the work genuinely has — do not pad it:",
    "  depth 1 — a handful of sibling tasks, no grouping needed",
    "  depth 2 — a few deliverables, each with its own tasks",
    "  depth 3 — several deliverables that group under themes",
    "  depth 4 — only for very large, multi-theme work",
    "Leaves are the actual units of work. Max depth 4, 3-20 nodes total.",
    "",
    "Rules: each LEAF is one focused, reviewable unit. Give every node an appetite (small | standard | large). On leaves, list the files it will most likely touch. `dependsOnSeq` lists seq numbers that must finish first (ordering between siblings) — it is NOT the hierarchy.",
    "",
    "`prompt` — the MOST IMPORTANT field. It is the exact instruction another",
    "Claude will be handed, alone, to implement this node. It must stand on its",
    "own: no reference to this conversation, no \"as discussed\". Name the files,",
    "functions and symbols to change, say what the change is, what must NOT",
    "change, and how to tell it worked. For a parent node whose children do the",
    "work, the prompt describes the integration/verification the parent owns.",
    "Write it as a direct instruction, 3-10 sentences.",
    "",
    "IMPORTANT: write each node's \"intent\" and \"prompt\" IN HEBREW (code identifiers and file paths stay English). appetite stays one of small|standard|large.",
    "",
    'Respond with ONLY this JSON array, no prose:',
    '[{"seq": number, "parentSeq": number|null, "intent": string, "prompt": string, "appetite": "small"|"standard"|"large", "affectedPaths": string[], "dependsOnSeq": number[]}]',
  ].join("\n");

  const proposed = await runClaudeJson<
    { seq: number; parentSeq?: number | null; intent: string; prompt?: string; appetite: string; affectedPaths?: string[]; dependsOnSeq?: number[] }[]
  >(cwd ?? process.cwd(), prompt, { timeoutMs: 300000, runId: input.runId });
  pushLine(input.runId, "בונה את היררכיית המשימות…");

  // resolve the tree: level per node, then the depth that picks TFS types
  const bySeq = new Map(proposed.map((p) => [p.seq, p]));
  const levelOf = (seq: number, seen = new Set<number>()): number => {
    const p = bySeq.get(seq);
    const parent = p?.parentSeq;
    if (parent == null || parent === seq || seen.has(seq) || !bySeq.has(parent)) return 0;
    seen.add(seq);
    return levelOf(parent, seen) + 1;
  };
  const levels = new Map(proposed.map((p) => [p.seq, Math.min(levelOf(p.seq), MAX_TASK_DEPTH - 1)]));
  const depth = Math.min(Math.max(...[...levels.values(), 0]) + 1, MAX_TASK_DEPTH);
  pushLine(input.runId, `עומק ${depth} → ${ADO_LADDER.slice(MAX_TASK_DEPTH - depth).join(" › ")}`);

  const out = await withTenant(input.clientId, async (tx) => {
    // Re-running a breakdown REPLACES the previous proposal — otherwise
    // seq numbers collide and stale nodes pile up in the tree. Anything a
    // person wrote, or that already exists in TFS, is left alone.
    const dropped = await tx.delete(task).where(
      sql`${task.workitemId} = ${input.workitemId} and ${task.origin} = 'ai' and ${task.linkedAdoId} is null`,
    ).returning({ id: task.id });
    if (dropped.length) pushLine(input.runId, `מחליף ${dropped.length} משימות מהצעה קודמת`);

    const seqToId = new Map<number, string>();
    const rows: BreakdownResult["tasks"] = [];
    // parents first so parent_task_id can be set on the way down
    const ordered = [...proposed].sort((a, b) => (levels.get(a.seq) ?? 0) - (levels.get(b.seq) ?? 0));
    for (const p of ordered) {
      const appetite = ["small", "standard", "large"].includes(p.appetite) ? p.appetite : "standard";
      const level = levels.get(p.seq) ?? 0;
      const adoType = adoTypeForLevel(level, depth);
      const parentId = p.parentSeq != null ? seqToId.get(p.parentSeq) ?? null : null;
      const [t] = await tx.insert(task).values({
        clientId: input.clientId, workitemId: input.workitemId, seq: p.seq,
        intent: p.intent, appetite: appetite as "small" | "standard" | "large",
        origin: "ai", state: "pending", affectedPaths: p.affectedPaths ?? [],
        parentTaskId: parentId, adoType, prompt: p.prompt?.trim() || null,
      }).returning();
      seqToId.set(p.seq, t!.id);
      rows.push({
        id: t!.id, seq: p.seq, intent: p.intent, appetite,
        affectedPaths: p.affectedPaths ?? [], dependsOnSeq: p.dependsOnSeq ?? [],
        parentSeq: p.parentSeq ?? null, level, adoType, prompt: p.prompt?.trim() ?? null,
      });
    }
    for (const p of proposed) {
      for (const dep of p.dependsOnSeq ?? []) {
        const from = seqToId.get(p.seq);
        const to = seqToId.get(dep);
        if (from && to && from !== to) {
          await tx.insert(taskDependency).values({ clientId: input.clientId, taskId: from, dependsOnTaskId: to, reason: "AI breakdown" }).onConflictDoNothing();
        }
      }
    }
    if (rows.length > 0) {
      const appetites = rows.map((r) => r.appetite);
      const appetite = (appetites.includes("large") ? "large" : appetites.includes("standard") ? "standard" : "small") as "small" | "standard" | "large";
      await appendEvent({
        clientId: input.clientId, workitemId: input.workitemId, source: "claude_session", type: "tasks.proposed",
        actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "skill:task-breakdown" },
        payload: { taskCount: rows.length, dependencyCount: proposed.reduce((n, p) => n + (p.dependsOnSeq?.length ?? 0), 0), appetite },
      });
    }
    rows.sort((a, b) => a.seq - b.seq);
    return { depth, tasks: rows };
  });
  await regenerateBrief(input.clientId, input.workitemId);
  return out;
}

/* ── 3. implement one task ────────────────────────────────────────── */

export type ImplementResult = {
  branch: string;
  dir: string;
  repoName: string | null;
  summary: string;
  filesChanged: string[];
  commit: string | null;
  testsRun: string | null;
  followUps: string[];
};

/** Run a git command in `cwd`; resolves { code, out }.
 *  git.exe is a real executable (not a .cmd shim like npm/claude), so it
 *  must run WITHOUT shell:true — Windows' cmd.exe re-splits a quoted
 *  argument at every space, which silently breaks any commit message
 *  with spaces (e.g. "t1: ..." becomes three separate pathspec args). */
function git(args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const p = spawn("git", args, { cwd, windowsHide: true });
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    p.on("close", (code) => res({ code: code ?? 1, out: out.trim() }));
    p.on("error", (e) => res({ code: 1, out: String(e) }));
  });
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

async function runImplement(input: { clientId: string; workitemId: string; taskId: string; by: Dev; runId?: string }): Promise<ImplementResult> {
  const { t, wi, notes } = await withTenant(input.clientId, async (tx) => {
    const [t] = await tx.select().from(task).where(eq(task.id, input.taskId)).limit(1);
    if (!t) throw new Error("task not found");
    const [wi] = await tx.select().from(workitem).where(eq(workitem.id, input.workitemId)).limit(1);
    const n = await tx.execute<{ body: string }>(
      sql`select payload->>'body' as body from event_log
          where workitem_id = ${input.workitemId} and type = 'note.added' and supersedes is null
          order by occurred_at asc limit 20`,
    );
    return { t, wi, notes: ((n.rows ?? n) as { body: string }[]).filter((x) => x.body) };
  });

  const r = await firstRepo(input.clientId, input.workitemId);
  if (!r) throw new Error("אין repository מקושר לדרישה — אי אפשר לפתח בלי קוד");
  pushLine(input.runId, `מכין עותק עבודה של ${r.name}…`);
  // Deliberately the CACHE clone, never r.localPath: an autonomous write
  // run must not touch the user's own working copy.
  const dir = await ensureCheckout({ ...r, localPath: null });
  if (!dir) throw new Error(`לא הצלחתי להביא עותק של ${r.name}`);

  const branch = `feature/${wi?.key ?? "REQ"}-t${t.seq}${slug(t.intent) ? `-${slug(t.intent)}` : ""}`;
  pushLine(input.runId, `branch: ${branch}`);

  // start from a clean, up-to-date base
  await git(["reset", "--hard"], dir);
  await git(["clean", "-fd"], dir);
  const base = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir)).out.replace(/^origin\//, "") || "main";
  await git(["checkout", base], dir);
  await git(["pull", "--ff-only"], dir);
  const made = await git(["checkout", "-b", branch], dir);
  if (made.code !== 0) await git(["checkout", branch], dir);

  const ctx = [
    `Requirement ${wi?.key ?? ""}: ${wi?.title ?? ""}`,
    ...notes.map((n) => n.body),
  ].join("\n\n").slice(0, 6000);

  // The task's own prompt is the instruction — written by the breakdown,
  // reviewed and possibly edited by the user before approval. It is what
  // runs, verbatim; `intent` is only the fallback for older tasks.
  const instruction = (t.prompt ?? "").trim() || t.intent;
  pushLine(input.runId, `הפרומט של המשימה:\n${instruction}`);

  const prompt = [
    "You are implementing ONE task in this repository. You are on a fresh branch; the working tree is clean.",
    "",
    "TASK — this is the instruction, follow it exactly:",
    instruction,
    (t.prompt ?? "").trim() && t.prompt!.trim() !== t.intent ? `\n(short title: ${t.intent})` : "",
    t.affectedPaths.length ? `\nFiles the breakdown expected to change: ${(t.affectedPaths as string[]).join(", ")}` : "",
    `Appetite: ${t.appetite}`,
    "",
    "CONTEXT — the requirement this task came from (Hebrew):",
    ctx,
    "",
    "Do this:",
    "1. Read the relevant code before changing anything. Match the surrounding style exactly.",
    "2. Make the change. Keep it to THIS task — do not refactor beyond it, do not touch unrelated files.",
    "3. If the repo has a build or tests you can run cheaply, run them and report what happened. Do not install dependencies.",
    "4. Do NOT commit, do NOT push, do NOT create branches — that is handled outside.",
    "",
    "IMPORTANT: write `summary` and `followUps` IN HEBREW (code identifiers and paths stay English).",
    "",
    "Respond with ONLY this JSON, no prose, no markdown fence:",
    '{"summary": string, "filesChanged": string[], "testsRun": string|null, "followUps": string[]}',
  ].filter(Boolean).join("\n");

  const res = await runClaudeJson<{ summary: string; filesChanged?: string[]; testsRun?: string | null; followUps?: string[] }>(
    dir, prompt, { timeoutMs: 900_000, runId: input.runId, write: true },
  );

  pushLine(input.runId, "מקומיט מקומית (בלי push)…");
  await git(["add", "-A"], dir);
  const stat = await git(["diff", "--cached", "--name-only"], dir);
  const changed = stat.out.split("\n").map((s) => s.trim()).filter(Boolean);
  let commit: string | null = null;
  if (changed.length > 0) {
    const msg = `${wi?.key ?? "REQ"} t${t.seq}: ${t.intent.slice(0, 90)}\n\nDCC task ${t.id}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
    const c = await git(["-c", "user.name=DCC", "-c", "user.email=dcc@local", "commit", "-m", msg], dir);
    if (c.code === 0) commit = (await git(["rev-parse", "--short", "HEAD"], dir)).out;
    pushLine(input.runId, commit ? `✓ commit ${commit} · ${changed.length} קבצים` : `commit נכשל: ${c.out.slice(0, 200)}`);
  } else {
    pushLine(input.runId, "לא השתנו קבצים");
  }

  await withTenant(input.clientId, (tx) =>
    tx.update(task).set({ state: changed.length > 0 ? "in_progress" : t.state, updatedAt: new Date() }).where(eq(task.id, input.taskId)),
  );
  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "claude_session", type: "note.added",
    actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "dcc:implement" },
    links: [{ rel: "task", ref: input.taskId }],
    payload: {
      body: `🛠 Claude פיתח משימה #${t.seq}: ${t.intent.slice(0, 70)}\nbranch ${branch}${commit ? ` · commit ${commit}` : " · ללא שינויים"}\n\n${res.summary}`,
    },
  });
  await regenerateBrief(input.clientId, input.workitemId);

  return {
    branch, dir, repoName: r.name, summary: res.summary,
    filesChanged: changed.length ? changed : res.filesChanged ?? [],
    commit, testsRun: res.testsRun ?? null, followUps: res.followUps ?? [],
  };
}

/* ── 4. task approval ─────────────────────────────────────────────── */

export async function approveTask(clientId: string, taskId: string, by: Dev, patch?: { intent?: string; appetite?: "small" | "standard" | "large"; prompt?: string }) {
  const wi = await withTenant(clientId, async (tx) => {
    const set: Record<string, unknown> = { approvedAt: new Date(), approvedBy: by.userId };
    if (patch?.intent) set.intent = patch.intent;
    if (patch?.appetite) set.appetite = patch.appetite;
    if (patch?.prompt !== undefined) set.prompt = patch.prompt.trim() || null;
    const [t] = await tx.update(task).set(set).where(eq(task.id, taskId)).returning();
    return t?.workitemId;
  });
  if (wi) await regenerateBrief(clientId, wi);
  return { approved: true };
}

export async function rejectTask(clientId: string, taskId: string) {
  const wi = await withTenant(clientId, async (tx) => {
    const [t] = await tx.update(task).set({ state: "dropped" }).where(eq(task.id, taskId)).returning();
    return t?.workitemId;
  });
  if (wi) await regenerateBrief(clientId, wi);
  return { rejected: true };
}

export async function pendingApprovalCount(clientId: string, workitemId: string) {
  const [row] = await withTenant(clientId, (tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(task)
      .where(and(eq(task.workitemId, workitemId), eq(task.origin, "ai"), isNull(task.approvedAt), sql`${task.state} <> 'dropped'`)),
  );
  return row?.n ?? 0;
}
