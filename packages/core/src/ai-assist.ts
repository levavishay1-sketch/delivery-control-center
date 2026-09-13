import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { appendEvent, db, withTenant } from "@dcc/db";
import { eventLog, flowRun, gap, repo, task, taskDependency, workitem } from "@dcc/db/schema";
import { ADO_LADDER, MAX_TASK_DEPTH, adoTypeForLevel } from "./ado-map.ts";
import { adoSend } from "./ado-http.ts";
import { activeAdoConnection } from "./ado-sync.ts";
import { materializeTasksToAdo } from "./task-ado-sync.ts";
import { syncTaskStateAfterCheckChange } from "./tasks.ts";
import { inheritedChecksForBug } from "./bugs.ts";
import { getPromptByKey, renderPrompt } from "./prompts.ts";
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

type FlowKind = "assess" | "breakdown" | "implement" | "retro";

const buffers = new Map<string, { lines: string[]; kind: FlowKind; workitemId: string; taskId?: string }>();

function pushLine(runId: string | undefined, line: string) {
  if (!runId) return;
  const b = buffers.get(runId);
  if (!b) return;
  b.lines.push(line);
  if (b.lines.length > 4000) b.lines.splice(0, b.lines.length - 4000);
}

/* ── live control over a running claude process: stop it, or hand it
 * more text while it's still working (architecture: user-in-the-loop on a
 * background run, not just a spectator). Only runs started with a runId
 * (assess/breakdown/implement) are steerable — composeClientLetter and
 * other one-shot calls are unaffected. */
type SteerableProc = { child: import("node:child_process").ChildProcessWithoutNullStreams; stdinOpen: boolean; stoppedByUser: boolean };
const runningProcs = new Map<string, SteerableProc>();

/** Kill the whole process tree, not just the shell wrapper — `shell:true` on
 *  Windows otherwise leaves the real `claude` process orphaned and running. */
function killTree(pid: number) {
  // Windows: CLAUDE_VIA_SHELL means `pid` is cmd.exe's PID, not claude's —
  // only taskkill's /T (tree) actually reaches the real process.
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
  else process.kill(pid, "SIGKILL");
}

/** Stop a live run. Returns false if it already finished or was never steerable. */
export function stopFlowRun(runId: string): boolean {
  const p = runningProcs.get(runId);
  if (!p || !p.child.pid) return false;
  p.stoppedByUser = true;
  killTree(p.child.pid);
  return true;
}

/** Hand a live run more text — it does not interrupt the current step, but
 *  Claude sees it and factors it in as it continues (architecture: this is
 *  addition, not redirection — there is no way to un-say what already ran). */
export function sendRunMessage(runId: string, text: string): boolean {
  const p = runningProcs.get(runId);
  if (!p || !p.stdinOpen) return false;
  p.child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n");
  pushLine(runId, `🗣 הוספת מלל: ${text}`);
  return true;
}

export type FlowRunView = {
  id: string;
  kind: string;
  /** "rolled_back" — an implement run whose code was later undone by
   *  `rollbackTask`. The transcript/result stay (history), but nothing
   *  should treat it as a live, current result any more.
   *  "stopped" — the user killed it via stopFlowRun(); not a failure. */
  state: "running" | "done" | "error" | "rolled_back" | "stopped";
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
export async function startFlowRun(input: {
  clientId: string; workitemId: string; kind: FlowKind; by: Dev; taskId?: string;
  /** assess-only: how the user wants the readiness check to run. */
  assessOpts?: { promptKey?: string; customEmphasis?: string; model?: string };
}): Promise<{ runId: string; alreadyRunning: boolean }> {
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
        ? await runAssess({ ...input, runId, ...input.assessOpts })
        : input.kind === "implement"
          ? await runImplement({ ...input, taskId: input.taskId!, runId })
          : input.kind === "retro"
            ? await runRetro({ ...input, runId })
            : await runBreakdown({ ...input, runId });
      await db.update(flowRun).set({
        state: "done", result: result as unknown as Record<string, unknown>,
        log: buffers.get(runId)?.lines ?? [], finishedAt: new Date(),
      }).where(eq(flowRun.id, runId));
    } catch (e) {
      const stopped = (e as Error).message === "STOPPED_BY_USER";
      pushLine(runId, stopped ? "⏹ נעצר לבקשתך" : `✕ שגיאה: ${(e as Error).message}`);
      await db.update(flowRun).set({
        state: stopped ? "stopped" : "error", error: stopped ? null : (e as Error).message,
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

/** What one `claude -p` call actually cost — pulled from the CLI's own
 *  final `{"type":"result",...}` line (`total_cost_usd`/`usage`/
 *  `duration_ms`/`num_turns`), never a separately-computed estimate.
 *  Note: this repo runs `claude -p` under the user's own logged-in
 *  session (architecture note above), not a metered API key — the CLI
 *  still reports `total_cost_usd` as an informational API-equivalent
 *  estimate either way, which is exactly what cost-tracking wants. */
export type RunMeta = {
  model: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  numTurns: number | null;
};

/** Run `claude -p` in `cwd` (prompt via stdin), expect a single JSON object back. */
async function runClaudeJson<T>(
  cwd: string,
  prompt: string,
  opts: { timeoutMs?: number; maxTurns?: number; runId?: string; write?: boolean; model?: string; onMeta?: (meta: RunMeta) => void } = {},
): Promise<T> {
  // prompt goes on stdin so there is nothing to shell-escape; args are all plain.
  // Read-only by default (plan mode). `write` is only for implementation runs,
  // and those work on an isolated clone — never the user's own checkout.
  // A run tracked by runId also opens for INPUT as stream-json: that is what
  // lets stopFlowRun()/sendRunMessage() reach it while it's still working.
  const steerable = !!opts.runId;
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
  if (steerable) args.push("--input-format", "stream-json");
  if (opts.model) args.push("--model", opts.model);
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd, env: process.env, windowsHide: true, shell: CLAUDE_VIA_SHELL });
    const proc: SteerableProc | null = steerable ? { child, stdinOpen: true, stoppedByUser: false } : null;
    if (proc) runningProcs.set(opts.runId!, proc);
    let out = "";
    let err = "";
    let buf = "";
    const closeStdin = () => { if (proc?.stdinOpen) { proc.stdinOpen = false; child.stdin.end(); } };
    const killer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`claude timed out after ${(opts.timeoutMs ?? 240000) / 1000}s`)); }, opts.timeoutMs ?? 240000);
    child.stdout.on("data", (d) => {
      out += d;
      if (!opts.runId) return;
      buf += d;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const ln of parts) {
        const trimmed = ln.trim();
        const desc = describeEvent(trimmed);
        if (desc) for (const s of desc.split("\n")) pushLine(opts.runId, s);
        // the agentic run is done once its final result comes through — let
        // the process wrap up and exit rather than hold stdin open forever.
        if (trimmed.includes('"type":"result"')) closeStdin();
      }
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(killer); if (proc) runningProcs.delete(opts.runId!); reject(new Error(`cannot run "${CLAUDE_BIN}" — האם claude מותקן ומחובר? (${e.message})`)); });
    child.on("close", (code) => {
      clearTimeout(killer);
      if (proc) runningProcs.delete(opts.runId!);
      if (proc?.stoppedByUser) return reject(new Error("STOPPED_BY_USER"));
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 400)}`));
      resolve(out);
    });
    if (steerable) child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } }) + "\n");
    else { child.stdin.write(prompt); child.stdin.end(); }
  });

  // stream-json → many NDJSON lines; the assistant's answer is the last
  // {"type":"result","result":"…"} line — which also carries cost/usage.
  let text = raw.trim();
  const resultLine = raw.split("\n").reverse().find((l) => l.includes('"type":"result"'));
  try {
    const env = JSON.parse((resultLine ?? text).trim()) as {
      result?: string; total_cost_usd?: number; duration_ms?: number; num_turns?: number;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (typeof env.result === "string") text = env.result;
    opts.onMeta?.({
      model: opts.model ?? null,
      costUsd: typeof env.total_cost_usd === "number" ? env.total_cost_usd : null,
      inputTokens: env.usage?.input_tokens ?? null,
      outputTokens: env.usage?.output_tokens ?? null,
      durationMs: typeof env.duration_ms === "number" ? env.duration_ms : null,
      numTurns: typeof env.num_turns === "number" ? env.num_turns : null,
    });
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

/** Writes one `claude -p` call's cost/usage as its own `claude.session`
 *  event — the payload type already existed (built for the interactive
 *  SessionEnd hook, `capture.ts`) but was never populated with real
 *  numbers; this is the first writer that actually has them, from
 *  DCC's own headless runs (assess/breakdown/implement/check). Every
 *  call is its own record, on purpose — two runs on the same task are
 *  two separate cost events, never merged (design notes,
 *  `run-cost-tracking`). Best-effort: a cost record failing to write
 *  must never fail the run it's describing. */
async function recordRunCost(input: { clientId: string; workitemId: string; by: Dev; kind: string; label: string; meta: RunMeta }) {
  try {
    await appendEvent({
      clientId: input.clientId, workitemId: input.workitemId, source: "claude_session", type: "claude.session",
      actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: `dcc:${input.kind}` },
      payload: {
        sessionId: `dcc-${input.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        summary: input.label,
        model: input.meta.model ?? undefined,
        tokensIn: input.meta.inputTokens ?? undefined,
        tokensOut: input.meta.outputTokens ?? undefined,
        costUsd: input.meta.costUsd ?? undefined,
        durationMs: input.meta.durationMs ?? undefined,
        numTurns: input.meta.numTurns ?? undefined,
      },
    });
  } catch { /* best-effort — never block the run it describes */ }
}

export type RequirementCostSummary = {
  totalUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  runCount: number;
  /** by the `dcc:<kind>` triggeredBy tag (assess/breakdown/implement/check) */
  byKind: Record<string, { count: number; usd: number }>;
};

/**
 * A requirement's cumulative Claude cost — every `claude.session` event
 * ever recorded against it, summed. Deliberately never filtered by
 * whether the task/check that triggered a run still exists, is still
 * approved, or is still active: a task opened, worked on, and later
 * dropped/deactivated already cost what it cost, and that cost stays in
 * the requirement's total (design notes, `run-cost-tracking`) — a
 * re-breakdown adds new records on top, it never resets this.
 */
export async function requirementCostSummary(clientId: string, workitemId: string): Promise<RequirementCostSummary> {
  const rows = await withTenant(clientId, (tx) =>
    tx.select({ payload: eventLog.payload, actor: eventLog.actor })
      .from(eventLog)
      .where(and(eq(eventLog.workitemId, workitemId), eq(eventLog.type, "claude.session"), isNull(eventLog.supersedes))),
  );
  const byKind: Record<string, { count: number; usd: number }> = {};
  let totalUsd = 0, totalInputTokens = 0, totalOutputTokens = 0;
  for (const r of rows) {
    const p = r.payload as { costUsd?: number; tokensIn?: number; tokensOut?: number };
    const usd = typeof p.costUsd === "number" ? p.costUsd : 0;
    totalUsd += usd;
    totalInputTokens += p.tokensIn ?? 0;
    totalOutputTokens += p.tokensOut ?? 0;
    const triggeredBy = (r.actor as { triggeredBy?: string }).triggeredBy ?? "";
    const kind = triggeredBy.replace(/^dcc:/, "") || "other";
    const bucket = (byKind[kind] ??= { count: 0, usd: 0 });
    bucket.count++;
    bucket.usd += usd;
  }
  return { totalUsd, totalInputTokens, totalOutputTokens, runCount: rows.length, byKind };
}

export type CostDetailRow = {
  id: string; occurredAt: string; kind: string; label: string; model: string | null;
  costUsd: number; inputTokens: number; outputTokens: number; durationMs: number | null; numTurns: number | null;
};

/**
 * Every individual AI run behind a requirement's total cost — one row per
 * `claude.session` event, newest first. `requirementCostSummary` answers
 * "how much in total"; this answers "on what, exactly" (a real gap a user
 * hit live: the total tile had nothing behind it to explain what it was
 * made of — design notes, cost-visibility).
 */
export async function requirementCostDetail(clientId: string, workitemId: string): Promise<CostDetailRow[]> {
  const rows = await withTenant(clientId, (tx) =>
    tx.select({ id: eventLog.id, occurredAt: eventLog.occurredAt, payload: eventLog.payload, actor: eventLog.actor })
      .from(eventLog)
      .where(and(eq(eventLog.workitemId, workitemId), eq(eventLog.type, "claude.session"), isNull(eventLog.supersedes)))
      .orderBy(desc(eventLog.occurredAt)),
  );
  return rows.map((r) => {
    const p = r.payload as { summary?: string; model?: string; costUsd?: number; tokensIn?: number; tokensOut?: number; durationMs?: number; numTurns?: number };
    const triggeredBy = (r.actor as { triggeredBy?: string }).triggeredBy ?? "";
    return {
      id: r.id, occurredAt: new Date(r.occurredAt).toISOString(), kind: triggeredBy.replace(/^dcc:/, "") || "other",
      label: p.summary ?? "", model: p.model ?? null,
      costUsd: p.costUsd ?? 0, inputTokens: p.tokensIn ?? 0, outputTokens: p.tokensOut ?? 0,
      durationMs: p.durationMs ?? null, numTurns: p.numTurns ?? null,
    };
  });
}

/* ── retro: end-of-requirement improvement recommendations ──────────
 *
 * Runs once a requirement is done — analyzes its full event timeline,
 * cumulative cost (`requirementCostSummary`), and decision history
 * (`decision.made` events, `decision-history`) to produce concrete,
 * requirement-specific recommendations, never generic advice (design
 * notes, `requirement-retro-recommendations`). Deliberately read-only —
 * no repo checkout, no code changes — this is a report action.
 */

export type RetroResult = {
  summary: string;
  tokenSavings: string[];
  timeSavings: string[];
  unnecessaryActions: string[];
  reworkCausingDecisions: string[];
  breakdownFeedback: string[];
  emphasize: string[];
};

async function loadRequirementEvents(clientId: string, workitemId: string) {
  return withTenant(clientId, (tx) =>
    tx.select({ type: eventLog.type, occurredAt: eventLog.occurredAt, payload: eventLog.payload, actor: eventLog.actor })
      .from(eventLog)
      .where(and(eq(eventLog.workitemId, workitemId), isNull(eventLog.supersedes)))
      .orderBy(eventLog.occurredAt),
  );
}

/** One compact line per event — enough for the model to reconstruct what
 *  happened and when, without dumping full JSON payloads at it. */
function describeTimelineEvent(e: { type: string; occurredAt: Date; payload: unknown; actor: unknown }): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const when = new Date(e.occurredAt).toISOString().slice(0, 16).replace("T", " ");
  const bits =
    e.type === "decision.made" ? `trigger=${p.trigger} — ${p.reason}` :
    e.type === "claude.session" ? `${p.summary ?? ""} · model=${p.model ?? "?"} · $${typeof p.costUsd === "number" ? p.costUsd.toFixed(3) : "?"} · in=${p.tokensIn ?? "?"} out=${p.tokensOut ?? "?"}` :
    e.type === "note.added" ? String(p.body ?? "").slice(0, 200) :
    e.type === "gap.proposed" ? `gap: ${p.description ?? p.question ?? ""}` :
    e.type === "task.progressed" ? `${p.from ?? "?"} → ${p.to ?? "?"}` :
    JSON.stringify(p).slice(0, 200);
  return `[${when}] ${e.type}: ${bits}`;
}

async function buildRetroPrompt(input: { clientId: string; workitemId: string }) {
  const { wi } = await loadRequirementText(input.clientId, input.workitemId);
  const events = await loadRequirementEvents(input.clientId, input.workitemId);
  const cost = await requirementCostSummary(input.clientId, input.workitemId);
  const decisions = events.filter((e) => e.type === "decision.made");

  const costText = [
    `Total AI cost: $${cost.totalUsd.toFixed(2)} across ${cost.runCount} run(s), ${cost.totalInputTokens} input / ${cost.totalOutputTokens} output tokens.`,
    ...Object.entries(cost.byKind).map(([kind, b]) => `  - ${kind}: ${b.count} run(s), $${b.usd.toFixed(2)}`),
  ].join("\n");

  const decisionsText = decisions.length
    ? decisions.map((d) => describeTimelineEvent(d)).join("\n")
    : "(none recorded — no re-breakdowns, overrides, or reopenings on this requirement)";

  const timelineText = events.map(describeTimelineEvent).join("\n");

  const prompt = [
    "You are reviewing a completed software requirement for a delivery team, to produce a retrospective.",
    "The goal is to LEARN from what actually happened on THIS requirement — every recommendation must be",
    "grounded in a specific event, decision, or cost figure below. Never give generic process advice that",
    "could apply to any requirement.",
    "",
    `REQUIREMENT: ${wi.title}`,
    "",
    "COST SUMMARY:",
    costText,
    "",
    "DECISION HISTORY (re-breakdowns, overrides, reopenings, and why):",
    decisionsText,
    "",
    "FULL EVENT TIMELINE:",
    timelineText,
    "",
    "Produce recommendations in these categories — each entry is one short, SPECIFIC, actionable sentence",
    "tied to something that actually happened above (cite the event/decision/cost it's based on). Leave a",
    "category as an empty array if the timeline genuinely gives no grounds for it — never pad with filler.",
    "  tokenSavings — where AI tokens were spent that didn't need to be",
    "  timeSavings — where elapsed time could have been shorter",
    "  unnecessaryActions — actions/runs that turned out not to matter",
    "  reworkCausingDecisions — decisions (from DECISION HISTORY) that caused rework, and what to do differently",
    "  breakdownFeedback — how the task breakdown itself could have been better shaped",
    "  emphasize — things that went well and are worth repeating next time",
    "Also write a 2-4 sentence `summary` of the requirement's overall efficiency.",
    "IMPORTANT: write every string value IN HEBREW.",
    "",
    'Respond with ONLY this JSON object, no prose:',
    '{"summary": string, "tokenSavings": string[], "timeSavings": string[], "unnecessaryActions": string[], "reworkCausingDecisions": string[], "breakdownFeedback": string[], "emphasize": string[]}',
  ].join("\n");

  return { prompt, wi };
}

async function runRetro(input: { clientId: string; workitemId: string; by: Dev; runId?: string }): Promise<RetroResult> {
  pushLine(input.runId, "אוסף timeline, עלויות והיסטוריית החלטות…");
  const { prompt } = await buildRetroPrompt(input);
  pushLine(input.runId, "מנתח ומכין המלצות…");

  let retroMeta: RunMeta | undefined;
  const raw = await runClaudeJson<Partial<RetroResult>>(
    process.cwd(), prompt, { timeoutMs: 300000, maxTurns: 4, runId: input.runId, onMeta: (m) => { retroMeta = m; } },
  );
  if (retroMeta) await recordRunCost({ clientId: input.clientId, workitemId: input.workitemId, by: input.by, kind: "retro", label: "המלצות לשיפור", meta: retroMeta });

  const lines = (v: unknown): string[] => Array.isArray(v) ? v.filter(Boolean).map(String) : [];
  return {
    summary: raw.summary ?? "",
    tokenSavings: lines(raw.tokenSavings),
    timeSavings: lines(raw.timeSavings),
    unnecessaryActions: lines(raw.unnecessaryActions),
    reworkCausingDecisions: lines(raw.reworkCausingDecisions),
    breakdownFeedback: lines(raw.breakdownFeedback),
    emphasize: lines(raw.emphasize),
  };
}

/** The latest retro run for a requirement — deliberately its OWN lookup,
 *  filtered to `kind = "retro"`, rather than reusing `getFlowRunView`'s
 *  "latest run of any kind": retro can be kicked off long after
 *  assess/breakdown/implement are done, and must never be mistaken for
 *  one of those in a screen that's still polling the generic flow-run
 *  endpoint (design notes, `requirement-retro-recommendations`). */
export async function getRetroRunView(workitemId: string): Promise<FlowRunView | null> {
  for (const [id, b] of buffers) {
    if (b.workitemId === workitemId && !b.taskId && b.kind === "retro") {
      return { id, kind: b.kind, state: "running", lines: b.lines, result: null, error: null, startedAt: null, finishedAt: null };
    }
  }
  const [row] = await db.select().from(flowRun)
    .where(and(eq(flowRun.workitemId, workitemId), isNull(flowRun.taskId), eq(flowRun.kind, "retro")))
    .orderBy(desc(flowRun.startedAt)).limit(1);
  return row ? viewOf(row) : null;
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

/**
 * Shaped for a human reader, not for density: short bullets instead of
 * paragraphs, and every gap is an answerable QUESTION with who-can-answer
 * on it. The shape is enforced by the shared output-contract template.
 */
export type AssessGap = {
  question: string;
  why: string;
  kind: "business" | "technical" | "missing_info" | "new_scope";
  whoAnswers: "client" | "team";
  options: string[];
  impactIfWrong: string;
  blocking: boolean;
  confidence: number;
};
export type AssessResult = {
  title: string;
  summary: string;
  /** 2-5 one-line bullets: what actually changes. */
  whatChanges: string[];
  baked: boolean;
  /** 2-4 one-line bullets, one reason each — never a paragraph. */
  rationale: string[];
  gaps: AssessGap[];
  repoUsed: string | null;
};

/** The default readiness prompt, used when the caller doesn't pick a tier. */
const DEFAULT_ASSESS_PROMPT_KEY = "assess.readiness.standard";
/** Output shape shared by every readiness tier — appended to whichever runs. */
const ASSESS_CONTRACT_KEY = "assess.shared.output_contract";

/**
 * Builds the actual prompt for one readiness-check tier — shared by the
 * real run and the no-op preview (so "what will be sent" is never a lie).
 * `promptHe` is the hand-authored Hebrew translation for the preview
 * modal only; it is never sent to Claude.
 */
async function buildAssessPrompt(input: {
  clientId: string; workitemId: string; promptKey: string; customEmphasis?: string; model?: string;
}): Promise<{ prompt: string; promptHe: string | null; model: string | undefined; cwd: string | null; repoName: string | null; templateTitle: string }> {
  const { wi, notes } = await loadRequirementText(input.clientId, input.workitemId);
  const r = await firstRepo(input.clientId, input.workitemId);
  const cwd = r ? await ensureCheckout(r) : null;
  const reqText = [`Title: ${wi.title}`, ...notes.map((n) => `[${n.source}] ${n.body}`)].join("\n\n");
  const tmpl = await getPromptByKey(input.promptKey);

  const varsEn: Record<string, string> = {
    REPO_CONTEXT: cwd
      ? `You are in the repository this work would touch (${r?.name}). Read whatever code you need to judge feasibility.`
      : "There is no code checkout available; judge from the text alone.",
    REQUIREMENT: reqText,
  };
  const varsHe: Record<string, string> = {
    REPO_CONTEXT: cwd
      ? `אתה בתוך ה-repository שהעבודה הזו נוגעת בו (${r?.name}). קרא כל קוד שדרוש כדי לשפוט ישימות.`
      : "אין עותק קוד זמין; שפוט מהטקסט בלבד.",
    REQUIREMENT: reqText,
  };
  if (input.promptKey === "assess.readiness.custom") {
    const emphasis = input.customEmphasis?.trim() || "(none specified)";
    varsEn.CUSTOM_EMPHASIS = emphasis;
    varsHe.CUSTOM_EMPHASIS = input.customEmphasis?.trim() || "(לא צוין)";
  }

  // The output SHAPE is authored once, shared by every tier — so fixing
  // how an answer reads fixes it everywhere instead of in five places.
  const contract = await getPromptByKey(ASSESS_CONTRACT_KEY);
  const join = (focus: string, shape: string | null | undefined) => (shape ? `${focus}\n\n${shape}` : focus);

  const prompt = join(
    tmpl ? renderPrompt(tmpl.body, varsEn) : [
      // fallback if the template row is somehow missing — never hard-fail the flow over it
      "You are assessing a software requirement for a delivery team. The requirement text is in Hebrew.",
      varsEn.REPO_CONTEXT, "", "REQUIREMENT:", varsEn.REQUIREMENT,
    ].join("\n"),
    contract?.body,
  );
  const promptHe = tmpl?.bodyHe ? join(renderPrompt(tmpl.bodyHe, varsHe), contract?.bodyHe) : null;
  const model = input.model || tmpl?.defaultModel || undefined;

  return { prompt, promptHe, model, cwd, repoName: r?.name ?? null, templateTitle: tmpl?.title ?? input.promptKey };
}

/** Render (never run) the prompt for one tier — powers the preview modal. */
export async function previewAssessPrompt(input: { clientId: string; workitemId: string; promptKey: string; customEmphasis?: string }) {
  const built = await buildAssessPrompt(input);
  return { prompt: built.prompt, promptHe: built.promptHe, model: built.model ?? null, templateTitle: built.templateTitle };
}

async function runAssess(input: { clientId: string; workitemId: string; by: Dev; runId?: string; promptKey?: string; customEmphasis?: string; model?: string }): Promise<AssessResult> {
  pushLine(input.runId, "מכין עותק עבודה של ה-repo…");
  const built = await buildAssessPrompt({
    clientId: input.clientId, workitemId: input.workitemId,
    promptKey: input.promptKey ?? DEFAULT_ASSESS_PROMPT_KEY, customEmphasis: input.customEmphasis, model: input.model,
  });
  pushLine(input.runId, built.cwd ? `קורא את ה-repo ${built.repoName} · ${built.templateTitle}` : `אין עותק repo — מעריך מהטקסט בלבד · ${built.templateTitle}`);

  let assessMeta: RunMeta | undefined;
  const raw = await runClaudeJson<Partial<AssessResult> & { rationale?: string | string[]; whatChanges?: string | string[] }>(
    built.cwd ?? process.cwd(), built.prompt, { timeoutMs: 600000, runId: input.runId, model: built.model, onMeta: (m) => { assessMeta = m; } },
  );
  if (assessMeta) await recordRunCost({ clientId: input.clientId, workitemId: input.workitemId, by: input.by, kind: "assess", label: "בחינת בשלות הדרישה", meta: assessMeta });
  pushLine(input.runId, "כותב סיכום ופערים…");

  // The contract asks for bullet arrays; a model can still hand back one
  // string. Normalise rather than render a paragraph the user has to fight.
  const lines = (v: string | string[] | undefined): string[] =>
    Array.isArray(v) ? v.filter(Boolean).map((s) => String(s).trim())
      : typeof v === "string" ? v.split("\n").map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean)
      : [];

  const gaps: AssessGap[] = (raw.gaps ?? []).filter((g) => g && (g.question || (g as { description?: string }).description)).map((g) => ({
    question: g.question ?? (g as { description?: string }).description ?? "",
    why: g.why ?? "",
    kind: g.kind ?? "missing_info",
    whoAnswers: g.whoAnswers === "client" ? "client" : "team",
    options: Array.isArray(g.options) ? g.options.filter(Boolean).map(String) : [],
    impactIfWrong: g.impactIfWrong ?? "",
    blocking: !!g.blocking,
    confidence: Math.min(1, Math.max(0, Number(g.confidence) || 0.7)),
  }));

  const res: Omit<AssessResult, "repoUsed"> = {
    title: raw.title ?? "",
    summary: raw.summary ?? "",
    whatChanges: lines(raw.whatChanges),
    // Ground truth over the model's self-report: a prompt rule asks for
    // this already, but a bad response can still claim baked with open
    // questions attached. The reader sees one badge and one gap count —
    // they must never contradict each other.
    baked: !!raw.baked && gaps.length === 0,
    rationale: lines(raw.rationale),
    gaps,
  };

  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "claude_session", type: "note.added",
    actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "dcc:assess" },
    payload: {
      body: [
        `סיכום Claude: ${res.title}`,
        res.summary,
        ...(res.whatChanges.length ? ["", "מה משתנה:", ...res.whatChanges.map((l) => `• ${l}`)] : []),
        "",
        res.baked ? "הערכה: אפויה — מוכנה לפירוק" : "הערכה: לא אפויה — יש שאלות פתוחות",
        ...res.rationale.map((l) => `• ${l}`),
      ].join("\n"),
    },
  });
  for (const g of res.gaps) {
    await proposeGap({
      clientId: input.clientId, workitemId: input.workitemId, by: input.by,
      description: g.question, blocking: g.blocking, confidence: g.confidence, mode: "delegated",
      why: g.why, kind: g.kind, whoAnswers: g.whoAnswers, options: g.options, impactIfWrong: g.impactIfWrong,
    });
  }
  await withTenant(input.clientId, (tx) =>
    tx.update(workitem).set({ phase: "shaping", updatedAt: new Date() }).where(eq(workitem.id, input.workitemId)),
  );
  await regenerateBrief(input.clientId, input.workitemId);

  return { ...res, repoUsed: built.repoName };
}

/* ── 1b. the letter to the requester ───────────────────────────────── */

export type ClientLetter = {
  subject: string; body: string; gapCount: number;
  /** This specific composition's own cost — surfaced right away so it
   *  reads as "an AI call, not a free rephrase" (a real gap a user hit
   *  live: this call was invisible in both the per-run and cumulative
   *  cost). Null only if the CLI's result line didn't carry usage. */
  costUsd: number | null; inputTokens: number | null; outputTokens: number | null;
};

/**
 * Turns the open gaps into a message the REQUESTER can actually read — no
 * code, no jargon, questions numbered, options offered. We compose it and
 * the user sends it themselves (there is no channel to the client from
 * here, and pretending otherwise would be worse than useless).
 * Runs on the cheap model: this is rephrasing, not analysis.
 *
 * Saved as its own `client_letter.composed` event (not just returned) so
 * a person who navigates away before copying it doesn't have to pay for
 * another run to get the same text back — see `getLastClientLetter`.
 * Also recorded as a `claude.session` cost event like every other run,
 * so it shows up in `requirementCostSummary` instead of silently not
 * counting toward the requirement's AI spend.
 */
export async function composeClientLetter(input: { clientId: string; workitemId: string; by: Dev; gapIds?: string[] }): Promise<ClientLetter> {
  const { wi, notes } = await loadRequirementText(input.clientId, input.workitemId);
  const allOpen = await withTenant(input.clientId, (tx) =>
    tx.select().from(gap)
      .where(and(eq(gap.workitemId, input.workitemId), sql`${gap.state} in ('proposed','verified')`))
      .orderBy(desc(gap.blocking), gap.createdAt),
  );
  // The caller picks which open gaps go out — not every gap belongs in
  // front of the client (some are ours to decide). No selection given
  // falls back to "all open", so an old caller keeps working.
  const open = input.gapIds ? allOpen.filter((g) => input.gapIds!.includes(g.id)) : allOpen;
  if (open.length === 0) throw new Error(input.gapIds ? "לא נבחר אף פער" : "אין פערים פתוחים — אין מה לשלוח");

  const gapsText = open.map((g, i) => [
    `${i + 1}. ${g.description}`,
    g.why ? `   רקע: ${g.why}` : "",
    (g.options as string[])?.length ? `   אפשרויות: ${(g.options as string[]).join(" / ")}` : "",
    `   ${g.whoAnswers === "client" ? "החלטה של מבקש הדרישה" : "החלטה שלנו — הוזכר רק אם רלוונטי לו"}`,
  ].filter(Boolean).join("\n")).join("\n\n");

  const tmpl = await getPromptByKey("gaps.client_letter");
  const vars = {
    REQUIREMENT_TITLE: wi.title,
    REQUIREMENT_TEXT: notes.map((n) => n.body).join("\n\n").slice(0, 4000),
    GAPS: gapsText,
  };
  const prompt = tmpl
    ? renderPrompt(tmpl.body, vars)
    : `Write a short Hebrew business message asking these questions, no code or jargon:\n${gapsText}\n\nRespond with ONLY {"subject": string, "body": string}`;

  let letterMeta: RunMeta | undefined;
  const res = await runClaudeJson<{ subject?: string; body?: string }>(process.cwd(), prompt, {
    timeoutMs: 180_000, maxTurns: 3, model: tmpl?.defaultModel || "haiku", onMeta: (m) => { letterMeta = m; },
  });
  if (letterMeta) await recordRunCost({ clientId: input.clientId, workitemId: input.workitemId, by: input.by, kind: "gap_letter", label: "ניסוח מכתב ללקוח", meta: letterMeta });

  const subject = res.subject ?? `שאלות פתוחות — ${wi.title}`;
  const body = res.body ?? "";
  const costUsd = letterMeta?.costUsd ?? null, inputTokens = letterMeta?.inputTokens ?? null, outputTokens = letterMeta?.outputTokens ?? null;
  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "claude_session", type: "client_letter.composed",
    actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "dcc:gap_letter" },
    payload: {
      subject, body, gapCount: open.length, gapIds: open.map((g) => g.id),
      costUsd: costUsd ?? undefined, inputTokens: inputTokens ?? undefined, outputTokens: outputTokens ?? undefined, model: letterMeta?.model ?? undefined,
    },
  });

  return { subject, body, gapCount: open.length, costUsd, inputTokens, outputTokens };
}

export type ClientLetterHistoryItem = {
  id: string; subject: string; body: string; gapCount: number; composedAt: string;
  costUsd: number | null; inputTokens: number | null; outputTokens: number | null; model: string | null;
};

/** Every letter ever composed for this requirement, newest first — read
 *  back from `client_letter.composed` events rather than kept in memory,
 *  so none of them are lost by navigating away before copying one (a
 *  real gap a user hit live). Never regenerates anything. */
export async function getRecentClientLetters(clientId: string, workitemId: string, limit = 20): Promise<ClientLetterHistoryItem[]> {
  const rows = await withTenant(clientId, (tx) =>
    tx.select({ id: eventLog.id, payload: eventLog.payload, occurredAt: eventLog.occurredAt })
      .from(eventLog)
      .where(and(eq(eventLog.workitemId, workitemId), eq(eventLog.type, "client_letter.composed"), isNull(eventLog.supersedes)))
      .orderBy(desc(eventLog.occurredAt)).limit(limit),
  );
  return rows.map((row) => {
    const p = row.payload as { subject: string; body: string; gapCount: number; costUsd?: number; inputTokens?: number; outputTokens?: number; model?: string };
    return {
      id: row.id, subject: p.subject, body: p.body, gapCount: p.gapCount, composedAt: new Date(row.occurredAt).toISOString(),
      costUsd: p.costUsd ?? null, inputTokens: p.inputTokens ?? null, outputTokens: p.outputTokens ?? null, model: p.model ?? null,
    };
  });
}

/* ── 2. breakdown: propose tasks + dependencies ────────────────────── */

export type BreakdownResult = {
  /** How deep the proposed tree is — picks the TFS ladder rungs. */
  depth: number;
  tasks: {
    id: string; seq: number; kind: "task" | "check"; intent: string; appetite: string;
    affectedPaths: string[]; compiledComponents: string[]; dependsOnSeq: number[];
    parentSeq: number | null; level: number; adoType: string | null; prompt: string | null;
  }[];
};

/** Builds the exact breakdown prompt — shared by the real run and the
 *  "what will be sent" preview, so they can never drift apart. Does a real
 *  checkout (same as the run) rather than guessing from repo existence,
 *  because a preview that lies about whether code context is available
 *  isn't a preview. */
async function buildBreakdownPrompt(input: { clientId: string; workitemId: string; runId?: string }) {
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
    "Rules: each LEAF is one focused, reviewable unit. Give every node an appetite (small | standard | large). On leaves, list the files it will most likely touch (`affectedPaths`). `dependsOnSeq` lists seq numbers that must finish first (ordering between siblings) — it is NOT the hierarchy.",
    "",
    "`compiledComponents` — on leaves, the projects that actually need to be",
    "rebuilt and redeployed because of this change. This is a FUNCTION-LEVEL",
    "call-graph analysis, NOT a project-reference walk — a project (especially",
    "a shared BL project) can hold many unrelated functions, so \"the project",
    "this file lives in\" is almost never the right answer on its own, and",
    "\"every project that references that project\" is even further wrong —",
    "it drags in every root caller of every OTHER function in that project too,",
    "most of which this change never touches.",
    "Do this instead:",
    "  1. Identify the SPECIFIC function(s) you expect to change, not just the",
    "     file.",
    "  2. Find every function that CALLS the changed function (grep/read, this",
    "     repo's actual call sites — not a guess).",
    "  3. Walk UP the call chain from there: callers of callers, repeatedly.",
    "  4. Stop at ROOT callers / entry points — a plugin's registered execute",
    "     method, a WebJob's entry point, a controller action, or whatever",
    "     \"the top of the chain\" means in this repo's architecture.",
    "  5. `compiledComponents` is the set of projects that CONTAIN those root",
    "     callers — not the project the changed function itself lives in,",
    "     unless a root caller happens to live there too.",
    "There can be multiple independent root callers reaching the same changed",
    "function — list every project that contains one.",
    "Worked example: changing function X, where the real call chain is",
    "  X → function B → function C → function D → EntryPoint",
    "means the project containing EntryPoint is what belongs in",
    "`compiledComponents` — not just \"the project X's own file lives in\".",
    "This is about what COMPILES this change in (build-time impact), not code",
    "that merely calls the file at runtime in some unrelated way — that's a",
    "different question, answered separately after implementation. If you",
    "cannot determine this from the repository (e.g. no checkout), leave it an",
    "empty array — never guess.",
    "",
    "`kind` — classify EVERY node as one of:",
    '  "task"  — real implementation work. Becomes its own tracked work item.',
    '  "check" — verification, regression testing, or documentation needed',
    "            before the PARENT task can be called done — it does not",
    "            change product code on its own. A check is always a LEAF",
    "            (never has children of its own) and its parentSeq MUST point",
    "            at a \"task\" node. Prefer \"check\" whenever a node's job is to",
    "            confirm/validate/document something the parent task already",
    "            did, rather than to make its own code change.",
    "",
    "`prompt` — the MOST IMPORTANT field. It is the exact instruction another",
    "Claude will be handed, alone, to carry out this node (implement it, if",
    "\"task\"; verify/test/document it, if \"check\"). It must stand on its own:",
    "no reference to this conversation, no \"as discussed\". Name the files,",
    "functions and symbols involved, say exactly what to do, what must NOT",
    "change, and how to tell it worked. Write it as a direct instruction,",
    "3-10 sentences.",
    "",
    "IMPORTANT: write each node's \"intent\" and \"prompt\" IN HEBREW (code identifiers and file paths stay English). appetite stays one of small|standard|large.",
    "",
    'Respond with ONLY this JSON array, no prose:',
    '[{"seq": number, "parentSeq": number|null, "kind": "task"|"check", "intent": string, "prompt": string, "appetite": "small"|"standard"|"large", "affectedPaths": string[], "compiledComponents": string[], "dependsOnSeq": number[]}]',
  ].join("\n");
  // The instructions Claude gets (format, task/check rules, JSON schema)
  // always run in English — only the requirement text itself is Hebrew.
  // promptHe surfaces exactly that content, for reading, never a separate
  // translation that could drift from what's actually sent.
  const promptHe = [
    "Claude יפרק את הדרישה הבאה למשימות עבודה, כולל תלויות והיררכיה:",
    "",
    reqText,
    "",
    "(ההוראות המדויקות ל-Claude — פורמט, סיווג task/check, כללי כתיבה — תמיד רצות באנגלית; זה תוכן הדרישה עצמו, לנוחות קריאה.)",
  ].join("\n");
  return { prompt, promptHe, cwd, repoName: r?.name ?? null };
}

export async function previewBreakdownPrompt(input: { clientId: string; workitemId: string }): Promise<{ prompt: string; promptHe: string; repoName: string | null }> {
  const { prompt, promptHe, repoName } = await buildBreakdownPrompt(input);
  return { prompt, promptHe, repoName };
}

async function runBreakdown(input: { clientId: string; workitemId: string; by: Dev; runId?: string }): Promise<BreakdownResult> {
  const { prompt, cwd } = await buildBreakdownPrompt(input);
  let breakdownMeta: RunMeta | undefined;
  const proposed = await runClaudeJson<
    { seq: number; parentSeq?: number | null; kind?: string; intent: string; prompt?: string; appetite: string; affectedPaths?: string[]; compiledComponents?: string[]; dependsOnSeq?: number[] }[]
  >(cwd ?? process.cwd(), prompt, { timeoutMs: 600000, runId: input.runId, onMeta: (m) => { breakdownMeta = m; } });
  if (breakdownMeta) await recordRunCost({ clientId: input.clientId, workitemId: input.workitemId, by: input.by, kind: "breakdown", label: "פירוק למשימות", meta: breakdownMeta });
  pushLine(input.runId, "בונה את היררכיית המשימות…");

  // resolve the tree: level per node, then the depth that picks TFS types.
  // A "check" is always a leaf — if the model gave one children anyway,
  // it must really be work (a check can't be a parent), so promote it.
  const bySeq = new Map(proposed.map((p) => [p.seq, p]));
  const hasChildren = new Set(proposed.filter((p) => p.parentSeq != null).map((p) => p.parentSeq));
  const kindOf = (seq: number): "task" | "check" =>
    hasChildren.has(seq) ? "task" : bySeq.get(seq)?.kind === "check" ? "check" : "task";
  const levelOf = (seq: number, seen = new Set<number>()): number => {
    const p = bySeq.get(seq);
    const parent = p?.parentSeq;
    if (parent == null || parent === seq || seen.has(seq) || !bySeq.has(parent)) return 0;
    seen.add(seq);
    return levelOf(parent, seen) + 1;
  };
  const levels = new Map(proposed.map((p) => [p.seq, Math.min(levelOf(p.seq), MAX_TASK_DEPTH - 1)]));
  // depth (→ the TFS ladder) is driven only by "task" nodes — a check never
  // gets a rung of its own and never stretches the ladder.
  const depth = Math.min(
    Math.max(0, ...proposed.filter((p) => kindOf(p.seq) === "task").map((p) => levels.get(p.seq) ?? 0)) + 1,
    MAX_TASK_DEPTH,
  );
  const checkCount = proposed.filter((p) => kindOf(p.seq) === "check").length;
  pushLine(input.runId, `עומק ${depth} → ${ADO_LADDER.slice(MAX_TASK_DEPTH - depth).join(" › ")}${checkCount ? ` · ${checkCount} בדיקות (לא ב-TFS בנפרד)` : ""}`);

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
      const kind = kindOf(p.seq);
      const adoType = kind === "task" ? adoTypeForLevel(level, depth) : null;
      const parentId = p.parentSeq != null ? seqToId.get(p.parentSeq) ?? null : null;
      const [t] = await tx.insert(task).values({
        clientId: input.clientId, workitemId: input.workitemId, seq: p.seq, kind,
        intent: p.intent, appetite: appetite as "small" | "standard" | "large",
        origin: "ai", state: "pending", affectedPaths: p.affectedPaths ?? [],
        compiledComponents: p.compiledComponents ?? [],
        parentTaskId: parentId, adoType, prompt: p.prompt?.trim() || null,
      }).returning();
      seqToId.set(p.seq, t!.id);
      rows.push({
        id: t!.id, seq: p.seq, kind, intent: p.intent, appetite,
        affectedPaths: p.affectedPaths ?? [], compiledComponents: p.compiledComponents ?? [], dependsOnSeq: p.dependsOnSeq ?? [],
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
    // A Bug's breakdown inherits the check tasks already on whatever
    // task(s) it's linked to — the same verification burden, not a blank
    // slate (decided 2026-09-12, `bug-change-request-lifecycle`; a
    // Change Request does NOT get this, it's a fresh category). Attached
    // under the bug's own first top-level "task" node — the main fix.
    const [wiRow] = await tx.select({ type: workitem.type }).from(workitem).where(eq(workitem.id, input.workitemId)).limit(1);
    if (wiRow?.type === "bug" && rows.length > 0) {
      const inherited = await inheritedChecksForBug(input.clientId, input.workitemId);
      const rootTask = rows.filter((r) => r.kind === "task" && r.level === 0).sort((a, b) => a.seq - b.seq)[0];
      if (inherited.length > 0 && rootTask) {
        let nextSeq = Math.max(...rows.map((r) => r.seq)) + 1;
        for (const c of inherited) {
          const [t] = await tx.insert(task).values({
            clientId: input.clientId, workitemId: input.workitemId, seq: nextSeq, kind: "check",
            intent: `${c.intent} (ירושה מבדיקות המשימה המקושרת)`, appetite: "small",
            origin: "human", state: "pending", parentTaskId: rootTask.id, adoType: null, prompt: c.prompt,
          }).returning();
          rows.push({
            id: t!.id, seq: nextSeq, kind: "check", intent: t!.intent, appetite: "small",
            affectedPaths: [], compiledComponents: [], dependsOnSeq: [], parentSeq: rootTask.seq, level: rootTask.level + 1,
            adoType: null, prompt: c.prompt,
          });
          nextSeq++;
        }
        pushLine(input.runId, `ירש ${inherited.length} בדיקות מהמשימה המקושרת`);
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
  /**
   * For each changed file, other files/components in the repo that
   * reference it (import it, call it, register it as a plugin, etc.) —
   * so a shared BL class used by 5 plugins surfaces those 5 as "must be
   * packaged together for a test deploy", not just the file itself.
   */
  affectedConsumers: { path: string; usedBy: string[]; reason: string }[];
  /** One entry per check bundled into this run, keyed by the same `seq`
   *  Claude was given — absent (not just empty) when the task had none. */
  checks?: { seq: number; passed: boolean; detail: string; likelyCause: "implementation" | "requirement_ambiguity" | null }[];
};

/** Run a git command in `cwd`; resolves { code, out }.
 *  git.exe is a real executable (not a .cmd shim like npm/claude), so it
 *  must run WITHOUT shell:true — Windows' cmd.exe re-splits a quoted
 *  argument at every space, which silently breaks any commit message
 *  with spaces (e.g. "t1: ..." becomes three separate pathspec args). */
function git(args: string[], cwd: string, opts?: { timeoutMs?: number }): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    // GIT_TERMINAL_PROMPT=0 stops git's own credential prompt from hanging
    // a headless spawn — but a credential HELPER (e.g. Git Credential
    // Manager) can still pop its own GUI/browser prompt that this process
    // can never answer, so network operations (push/fetch against a
    // remote with no cached credential) also get a hard timeout below.
    const p = spawn("git", args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let out = "";
    let done = false;
    const finish = (r: { code: number; out: string }) => { if (!done) { done = true; if (killer) clearTimeout(killer); res(r); } };
    const killer = opts?.timeoutMs
      ? setTimeout(() => {
          // A stuck push is usually a credential HELPER (e.g. Git Credential
          // Manager) that spawned its own child (a GUI/browser prompt) —
          // killing just the `git` PID leaves that orphaned and still
          // running. On Windows, taskkill /t kills the whole tree; p.kill()
          // is the fallback elsewhere.
          if (process.platform === "win32" && p.pid) spawn("taskkill", ["/pid", String(p.pid), "/t", "/f"], { windowsHide: true });
          else p.kill("SIGKILL");
          finish({ code: 1, out: `git ${args[0]} לא הגיב תוך ${Math.round(opts.timeoutMs! / 1000)}s — כנראה נדרש אימות אינטראקטיבי (credential manager) שלא זמין מכאן. בצע "git push" פעם אחת מהטרמינל שלך כדי שהפרטים יישמרו, ואז נסה שוב.` });
        }, opts.timeoutMs)
      : null;
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    p.on("close", (code) => finish({ code: code ?? 1, out: out.trim() }));
    p.on("error", (e) => finish({ code: 1, out: String(e) }));
  });
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Deterministic branch name for a task's implement run — same formula
 *  everywhere (`runImplement`, `rollbackTask`, the delete precheck) so
 *  nothing extra needs to be persisted to find a task's branch again. */
const taskBranchName = (reqKey: string | null | undefined, t: { seq: number; intent: string }) =>
  `feature/${reqKey ?? "REQ"}-t${t.seq}${slug(t.intent) ? `-${slug(t.intent)}` : ""}`;

/** How many commits a task's branch has beyond the repo's default branch —
 *  0 means "never implemented" or "implemented but produced no changes". */
async function taskCommitCount(dir: string, branch: string): Promise<number> {
  const exists = await git(["rev-parse", "--verify", "--quiet", branch], dir);
  if (exists.code !== 0) return 0;
  const base = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir)).out.replace(/^origin\//, "") || "main";
  const mergeBase = (await git(["merge-base", branch, `origin/${base}`], dir)).out;
  if (!mergeBase) return 0;
  const count = await git(["rev-list", "--count", `${mergeBase}..${branch}`], dir);
  return Number(count.out) || 0;
}

/** DB reads only, no git — the prompt's TEXT never depends on whether the
 *  checkout succeeds, so the preview doesn't need to touch a clone. Shared
 *  by the real run and the "what will be sent" preview.
 *
 *  A "task" row's checks are woven into the SAME prompt, each labeled by
 *  its `seq` — the ordinal already shown everywhere in the UI — so
 *  Claude's per-check verdicts can be routed back to the right row by a
 *  direct lookup, no fuzzy matching. A "check" row (verifying on its own,
 *  independent of its parent's run) gets read-only framing instead: it
 *  is never told it may change code, because it never gets Edit/Write
 *  tools to do so (see `runClaudeJson`'s `write` flag in `runImplement`). */
async function buildImplementPrompt(input: { clientId: string; workitemId: string; taskId: string }) {
  const { t, wi, notes, checks } = await withTenant(input.clientId, async (tx) => {
    const [t] = await tx.select().from(task).where(eq(task.id, input.taskId)).limit(1);
    if (!t) throw new Error("task not found");
    const [wi] = await tx.select().from(workitem).where(eq(workitem.id, input.workitemId)).limit(1);
    const n = await tx.execute<{ body: string }>(
      sql`select payload->>'body' as body from event_log
          where workitem_id = ${input.workitemId} and type = 'note.added' and supersedes is null
          order by occurred_at asc limit 20`,
    );
    const checks = t.kind === "check" ? [] : await tx.select({ seq: task.seq, intent: task.intent, prompt: task.prompt })
      .from(task)
      .where(and(eq(task.parentTaskId, t.id), eq(task.kind, "check"), eq(task.active, true), sql`${task.state} <> 'dropped'`))
      .orderBy(task.seq);
    return { t, wi, notes: ((n.rows ?? n) as { body: string }[]).filter((x) => x.body), checks };
  });

  const ctx = [
    `Requirement ${wi?.key ?? ""}: ${wi?.title ?? ""}`,
    ...notes.map((n) => n.body),
  ].join("\n\n").slice(0, 6000);

  // The task's own prompt is the instruction — written by the breakdown,
  // reviewed and possibly edited by the user before approval. It is what
  // runs, verbatim; `intent` is only the fallback for older tasks.
  const instruction = (t.prompt ?? "").trim() || t.intent;
  const isCheck = t.kind === "check";

  const checksBlock = checks.length
    ? [
        "",
        "CHECKS TO ALSO PERFORM once the change above is made — report pass/fail for EACH by its number, do not skip any:",
        ...checks.map((c) => `#${c.seq}: ${(c.prompt ?? "").trim() || c.intent}`),
      ].join("\n")
    : "";

  const prompt = [
    isCheck
      ? "You are VERIFYING one thing in this repository. You are read-only: do NOT edit, write, or create any file. You may read code and run commands (tests, a build) to check behavior."
      : "You are implementing ONE task in this repository. You are on a fresh branch; the working tree is clean.",
    "",
    isCheck ? "CHECK — this is what to verify, follow it exactly:" : "TASK — this is the instruction, follow it exactly:",
    instruction,
    (t.prompt ?? "").trim() && t.prompt!.trim() !== t.intent ? `\n(short title: ${t.intent})` : "",
    !isCheck && t.affectedPaths.length ? `\nFiles the breakdown expected to change: ${(t.affectedPaths as string[]).join(", ")}` : "",
    `Appetite: ${t.appetite}`,
    checksBlock,
    "",
    "CONTEXT — the requirement this task came from (Hebrew):",
    ctx,
    "",
    "Do this:",
    ...(isCheck ? [
      "1. Read the relevant code and/or run the relevant tests/build to determine whether the check's condition holds.",
      "2. Do NOT change anything — no edits, no new files, no commits. If you notice something that genuinely needs a code",
      "   change, that is NOT this run's job: report it in \"summary\" as a finding, do not act on it.",
    ] : [
      "1. Read the relevant code before changing anything. Match the surrounding style exactly.",
      "2. Make the change. Keep it to THIS task — do not refactor beyond it, do not touch unrelated files.",
      "3. If the repo has a build or tests you can run cheaply, run them and report what happened. Do not install dependencies.",
      "4. Do NOT commit, do NOT push, do NOT create branches — that is handled outside.",
      "5. Blast radius: for EACH file you changed, search the rest of the repository (grep/glob — do not guess) for other files that",
      "   import, call, extend, instantiate, or register it (e.g. other plugins that call a shared BL class, other webresources that",
      "   load a shared JS module, other configs that reference it). This tells the user what else must be packaged/retested together",
      "   with this change. If a changed file has no other consumers, omit it from this list — do not pad it with unrelated files.",
      ...(checks.length ? [`6. Perform each numbered check listed above and report its own pass/fail honestly — a check that wasn't really run is not a pass.`] : []),
    ]),
    "",
    "IMPORTANT: write `summary`, `followUps` and every `reason` IN HEBREW (code identifiers and paths stay English).",
    "",
    "Respond with ONLY this JSON, no prose, no markdown fence:",
    checks.length
      ? '{"summary": string, "filesChanged": string[], "testsRun": string|null, "followUps": string[], "affectedConsumers": [{"path": string, "usedBy": string[], "reason": string}], "checks": [{"seq": number, "passed": boolean, "detail": string, "likelyCause": "implementation"|"requirement_ambiguity"|null}]}'
      : '{"summary": string, "filesChanged": string[], "testsRun": string|null, "followUps": string[], "affectedConsumers": [{"path": string, "usedBy": string[], "reason": string}]}',
    checks.length ? '"checks" must have exactly one entry per numbered check above, same "seq". "likelyCause" only on a failure: "implementation" if the code is wrong, "requirement_ambiguity" if the expected behavior itself is unclear — that is a signal an earlier stage under-specified this, not something to guess past.' : "",
  ].filter(Boolean).join("\n");

  // Same reasoning as breakdown's promptHe: the technical instructions to
  // Claude (git rules, response schema) always run in English — this is
  // the actual task instruction + context that get embedded, for reading.
  const promptHe = [
    isCheck ? "Claude יאמת (read-only, בלי לשנות קוד) את הדבר הבא:" : "Claude יפתח את המשימה הבאה:",
    "",
    instruction,
    ...(checksBlock ? ["", "בדיקות שירוצו גם כן:", ...checks.map((c) => `#${c.seq}: ${(c.prompt ?? "").trim() || c.intent}`)] : []),
    "",
    "הקשר מהדרישה:",
    ctx,
    "",
    "(ההוראות הטכניות ל-Claude — מבנה git, פורמט התשובה — תמיד רצות באנגלית; זה התוכן בפועל, לנוחות קריאה.)",
  ].join("\n");

  return { prompt, promptHe, instruction, t, wi, hasChecks: checks.length > 0 };
}

export async function previewImplementPrompt(input: { clientId: string; workitemId: string; taskId: string }): Promise<{ prompt: string; promptHe: string; approved: boolean }> {
  const { prompt, promptHe, t } = await buildImplementPrompt(input);
  return { prompt, promptHe, approved: t.approvedAt != null };
}

async function runImplement(input: { clientId: string; workitemId: string; taskId: string; by: Dev; runId?: string }): Promise<ImplementResult> {
  const { prompt, instruction, t, wi, hasChecks } = await buildImplementPrompt(input);
  // Defense in depth — the API route already refuses this before a run is
  // even queued, but a run only ever does what this function lets it do.
  if (!t.approvedAt) throw new Error("המשימה טרם אושרה — אי אפשר לפתח לפני אישור.");
  const isCheck = t.kind === "check";

  const r = await firstRepo(input.clientId, input.workitemId);
  if (!r) throw new Error("אין repository מקושר לדרישה — אי אפשר לפתח בלי קוד");
  pushLine(input.runId, `מכין עותק עבודה של ${r.name}…`);
  // Deliberately the CACHE clone, never r.localPath: an autonomous write
  // run must not touch the user's own working copy.
  const dir = await ensureCheckout({ ...r, localPath: null });
  if (!dir) throw new Error(`לא הצלחתי להביא עותק של ${r.name}`);

  // A check run on its own verifies the PARENT task's branch — it has no
  // branch of its own to create, and creating one fresh from base would
  // mean it never sees the change it's supposed to be checking.
  let branchOwner = t;
  if (isCheck && t.parentTaskId) {
    const [parent] = await withTenant(input.clientId, (tx) => tx.select().from(task).where(eq(task.id, t.parentTaskId!)).limit(1));
    if (parent) branchOwner = parent;
  }
  const branch = taskBranchName(wi?.key, branchOwner);
  pushLine(input.runId, `branch: ${branch}`);

  await git(["reset", "--hard"], dir);
  await git(["clean", "-fd"], dir);
  if (isCheck) {
    const exists = await git(["rev-parse", "--verify", "--quiet", branch], dir);
    if (exists.code !== 0) throw new Error(`אין branch בשם ${branch} — המשימה שהבדיקה הזו שייכת לה עוד לא פותחה, אין מה לאמת`);
    await git(["checkout", branch], dir);
  } else {
    // start from a clean, up-to-date base
    const base = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir)).out.replace(/^origin\//, "") || "main";
    await git(["checkout", base], dir);
    await git(["pull", "--ff-only"], dir);
    const made = await git(["checkout", "-b", branch], dir);
    if (made.code !== 0) await git(["checkout", branch], dir);
  }

  pushLine(input.runId, `הפרומט של המשימה:\n${instruction}`);

  let implementMeta: RunMeta | undefined;
  const res = await runClaudeJson<{
    summary: string; filesChanged?: string[]; testsRun?: string | null; followUps?: string[];
    affectedConsumers?: { path: string; usedBy?: string[]; reason: string }[];
    checks?: { seq: number; passed: boolean; detail?: string; likelyCause?: string | null }[];
  }>(
    // Checks never get write tools — the moment one can edit code, "task"
    // vs "check" stops being an enforceable boundary (design notes).
    dir, prompt, { timeoutMs: 900_000, runId: input.runId, write: !isCheck, onMeta: (m) => { implementMeta = m; } },
  );
  if (implementMeta) {
    await recordRunCost({
      clientId: input.clientId, workitemId: input.workitemId, by: input.by,
      kind: isCheck ? "check" : "implement",
      label: `${isCheck ? "בדיקה" : "פיתוח משימה"} #${t.seq}: ${t.intent.slice(0, 60)}`,
      meta: implementMeta,
    });
  }

  let changed: string[] = [];
  let commit: string | null = null;
  if (!isCheck) {
    pushLine(input.runId, "מקומיט מקומית (בלי push)…");
    await git(["add", "-A"], dir);
    const stat = await git(["diff", "--cached", "--name-only"], dir);
    changed = stat.out.split("\n").map((s) => s.trim()).filter(Boolean);
    if (changed.length > 0) {
      const msg = `${wi?.key ?? "REQ"} t${t.seq}: ${t.intent.slice(0, 90)}\n\nDCC task ${t.id}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
      const c = await git(["-c", "user.name=DCC", "-c", "user.email=dcc@local", "commit", "-m", msg], dir);
      if (c.code === 0) commit = (await git(["rev-parse", "--short", "HEAD"], dir)).out;
      pushLine(input.runId, commit ? `✓ commit ${commit} · ${changed.length} קבצים` : `commit נכשל: ${c.out.slice(0, 200)}`);
    } else {
      pushLine(input.runId, "לא השתנו קבצים");
    }
  }

  // Route each check's verdict back to its own row by `seq` — the AI-
  // report path: checkResolvedBy stays untouched (null unless a human
  // had already overridden it), so the UI can always tell a factual
  // Claude result apart from a human decision (design notes).
  const checkResults = res.checks ?? [];
  if (checkResults.length) {
    await withTenant(input.clientId, async (tx) => {
      for (const cr of checkResults) {
        const [row] = await tx.select({ id: task.id }).from(task)
          .where(and(eq(task.parentTaskId, t.id), eq(task.kind, "check"), eq(task.seq, cr.seq))).limit(1);
        if (!row) continue;
        await tx.update(task).set({
          checkResult: cr.passed ? "passed" : "failed",
          ...(cr.passed ? { state: "done" as const } : {}),
          updatedAt: new Date(),
        }).where(eq(task.id, row.id));
        if (cr.detail) {
          await appendEvent({
            clientId: input.clientId, workitemId: input.workitemId, source: "claude_session", type: "note.added",
            actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "dcc:implement" },
            links: [{ rel: "task", ref: row.id }],
            payload: { body: `${cr.passed ? "✓" : "✕"} בדיקה #${cr.seq}: ${cr.detail}${cr.likelyCause === "requirement_ambiguity" ? "\n(נראה כמו עמימות בדרישה, לא באג — כדאי לבדוק שלבים מוקדמים)" : ""}` },
          });
        }
      }
    });
  }

  // Code that changed moves the task to in_progress first —
  // syncTaskStateAfterCheckChange (below) only ever escalates from there
  // to failed_checks or restores out of it; it has no opinion on a task
  // with no checks at all, or one that made no changes.
  if (!isCheck && changed.length > 0) {
    await withTenant(input.clientId, (tx) =>
      tx.update(task).set({ state: "in_progress", updatedAt: new Date() }).where(eq(task.id, input.taskId)),
    );
  }
  // Whether this run just wrote the parent's own bundled checks or was
  // itself an independent check re-run, the parent's state must reflect
  // whatever its checks now say — the one thing that used to only happen
  // on the bundled path (design notes, task-checks-polish). `attempted:
  // true` because a run just happened either way — an independent check
  // run only ever reaches this point once its parent branch already
  // exists, i.e. the parent was never still `pending`.
  const parentForSync = isCheck ? t.parentTaskId : input.taskId;
  if (parentForSync) await syncTaskStateAfterCheckChange(input.clientId, parentForSync, { attempted: true });
  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "claude_session", type: "note.added",
    actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "dcc:implement" },
    links: [{ rel: "task", ref: input.taskId }],
    payload: {
      body: isCheck
        ? `🔍 Claude אימת בדיקה #${t.seq}: ${t.intent.slice(0, 70)}\n\n${res.summary}`
        : `🛠 Claude פיתח משימה #${t.seq}: ${t.intent.slice(0, 70)}\nbranch ${branch}${commit ? ` · commit ${commit}` : " · ללא שינויים"}${hasChecks ? ` · ${checkResults.filter((c) => c.passed).length}/${checkResults.length} בדיקות עברו` : ""}\n\n${res.summary}`,
    },
  });
  await regenerateBrief(input.clientId, input.workitemId);

  return {
    branch, dir, repoName: r.name, summary: res.summary,
    filesChanged: changed.length ? changed : res.filesChanged ?? [],
    commit, testsRun: res.testsRun ?? null, followUps: res.followUps ?? [],
    affectedConsumers: (res.affectedConsumers ?? []).map((c) => ({ path: c.path, usedBy: c.usedBy ?? [], reason: c.reason })),
    ...(checkResults.length ? { checks: checkResults.map((c) => ({ seq: c.seq, passed: c.passed, detail: c.detail ?? "", likelyCause: (c.likelyCause === "implementation" || c.likelyCause === "requirement_ambiguity") ? c.likelyCause : null })) } : {}),
  };
}

export type RollbackResult = { rolledBack: boolean; reason?: string; branch?: string; dir?: string; invalidatedRuns?: number };

/**
 * Undo everything `runImplement` did for one task, in its isolated clone.
 * The branch name is fully deterministic from task fields (see `runImplement`),
 * so nothing extra needs to be persisted to find it again. Rollback resets
 * that branch back to its merge-base with the repo's default branch — i.e.
 * discards every local commit DCC made for this task — and re-cleans the
 * tree. Nothing is pushed anywhere, so this only ever touches the DCC cache
 * clone, never the user's own working copy.
 */
export async function rollbackTask(input: { clientId: string; workitemId: string; taskId: string; by: Dev }): Promise<RollbackResult> {
  const t = await withTenant(input.clientId, async (tx) => {
    const [row] = await tx.select().from(task).where(eq(task.id, input.taskId)).limit(1);
    return row;
  });
  if (!t) throw new Error("משימה לא נמצאה");
  const wi = await withTenant(input.clientId, async (tx) => {
    const [row] = await tx.select({ key: workitem.key }).from(workitem).where(eq(workitem.id, input.workitemId)).limit(1);
    return row;
  });

  const r = await firstRepo(input.clientId, input.workitemId);
  if (!r) throw new Error("אין repository מקושר לדרישה");
  const dir = await ensureCheckout({ ...r, localPath: null });
  if (!dir) throw new Error(`לא הצלחתי להביא עותק של ${r.name}`);

  const branch = taskBranchName(wi?.key, t);
  const exists = await git(["rev-parse", "--verify", "--quiet", branch], dir);
  if (exists.code !== 0) return { rolledBack: false, reason: "המשימה עדיין לא פותחה — אין מה לבטל" };

  await git(["checkout", branch], dir);
  const base = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir)).out.replace(/^origin\//, "") || "main";
  await git(["fetch", "origin", base], dir);
  const mergeBase = (await git(["merge-base", "HEAD", `origin/${base}`], dir)).out;
  if (mergeBase) await git(["reset", "--hard", mergeBase], dir);
  await git(["clean", "-fd"], dir);

  await withTenant(input.clientId, (tx) =>
    tx.update(task).set({ state: t.state === "in_progress" ? "pending" : t.state, updatedAt: new Date() }).where(eq(task.id, input.taskId)),
  );

  // The task is meant to look exactly like it never ran — no live "here's
  // what Claude changed" card, no filesChanged, nothing. The record of
  // what happened stays (transcript + result), just no longer flagged as
  // a current, live outcome — every past "done" implement run for this
  // task is marked rolled_back instead. `regenerateBrief` reads task/event
  // state, not flow_run, so it doesn't need to know about this.
  const invalidated = await db.update(flowRun)
    .set({ state: "rolled_back" })
    .where(and(eq(flowRun.taskId, input.taskId), eq(flowRun.kind, "implement"), eq(flowRun.state, "done")))
    .returning({ id: flowRun.id });

  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "claude_session", type: "note.added",
    actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
    links: [{ rel: "task", ref: input.taskId }],
    payload: { body: `↩ שינויי הקוד של משימה #${t.seq} (${t.intent.slice(0, 60)}) בוטלו — ה-branch אופס לבסיס. המשימה נקייה כמו לפני שפותחה; מה שקרה נשאר בהיסטוריה.` },
  });
  await regenerateBrief(input.clientId, input.workitemId);

  return { rolledBack: true, branch, dir, invalidatedRuns: invalidated.length };
}

/** git@github.com:owner/repo.git or https://github.com/owner/repo.git → https://github.com/owner/repo */
function httpsRepoUrl(remote: string): string | null {
  const ssh = remote.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = remote.match(/^https?:\/\/([^/]+)\/(.+?)(\.git)?$/);
  if (https) return `https://${https[1]}/${https[2]}`;
  return null;
}

export type PushResult = { pushed: boolean; reason?: string; branch?: string; branchUrl?: string; compareUrl?: string };

/**
 * Push a task's branch to the repo's real remote — the one and only step
 * that was deliberately never automatic (`runImplement` only ever commits
 * locally). Explicit, per-task, so the user decides exactly when work
 * leaves the machine. Uses whatever git credentials are already set up
 * for that remote locally (same as the `pull` `ensureCheckout` already
 * does) — nothing new to authenticate.
 */
export async function pushTask(input: { clientId: string; workitemId: string; taskId: string; by: Dev }): Promise<PushResult> {
  const t = await withTenant(input.clientId, async (tx) => {
    const [row] = await tx.select().from(task).where(eq(task.id, input.taskId)).limit(1);
    return row;
  });
  if (!t) throw new Error("משימה לא נמצאה");
  const wi = await withTenant(input.clientId, async (tx) => {
    const [row] = await tx.select({ key: workitem.key }).from(workitem).where(eq(workitem.id, input.workitemId)).limit(1);
    return row;
  });

  const r = await firstRepo(input.clientId, input.workitemId);
  if (!r) throw new Error("אין repository מקושר לדרישה");
  const dir = await ensureCheckout({ ...r, localPath: null });
  if (!dir) throw new Error(`לא הצלחתי להביא עותק של ${r.name}`);

  const branch = taskBranchName(wi?.key, t);
  const commits = await taskCommitCount(dir, branch);
  if (commits === 0) return { pushed: false, reason: "אין קוד מומש על המשימה הזו — אין מה לדחוף" };

  await git(["checkout", branch], dir);
  const res = await git(["push", "-u", "origin", branch], dir, { timeoutMs: 25_000 });
  if (res.code !== 0) return { pushed: false, reason: `push נכשל: ${res.out.slice(0, 400)}` };

  const remote = (await git(["remote", "get-url", "origin"], dir)).out;
  const base = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir)).out.replace(/^origin\//, "") || "main";
  const httpsBase = httpsRepoUrl(remote);
  const branchUrl = httpsBase ? `${httpsBase}/tree/${encodeURIComponent(branch)}` : undefined;
  const compareUrl = httpsBase ? `${httpsBase}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1` : undefined;

  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "git", type: "note.added",
    actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
    links: [{ rel: "task", ref: input.taskId }],
    payload: { body: `⬆ הקוד של משימה #${t.seq} (${t.intent.slice(0, 60)}) נדחף ל-GitHub — branch ${branch}.` },
  });
  await regenerateBrief(input.clientId, input.workitemId);

  return { pushed: true, branch, branchUrl, compareUrl };
}

/* ── deleting a task: surgical, never a silent cascade ───────────────
 *
 * The DB itself now REFUSES to delete a task with children (see migration
 * 0018 — parent_task_id was ON DELETE CASCADE and could silently wipe an
 * already-approved, already-TFS-linked, already-implemented subtree with
 * zero warning). Everything below is the deliberate, explicit handling
 * that cascade used to skip: walk the subtree, see what's really at
 * stake (children, TFS links, implemented code, and — the sharp edge —
 * OTHER tasks that already implemented against the same files), and
 * require the caller to confirm each risk category by name before
 * anything is actually removed. */

export type TaskDeleteNode = {
  id: string; seq: number; intent: string; kind: "task" | "check"; state: string;
  linkedAdoId: number | null; adoUrl: string | null; approvedAt: string | null;
  commitCount: number; // >0 means real implemented code sits on this task's branch
};
export type TaskDeletePrecheck = {
  taskId: string;
  /** the task itself plus every descendant (recursive) — what would actually be removed */
  subtree: TaskDeleteNode[];
  /** other tasks under the SAME requirement, outside this subtree, whose declared or
   *  actually-changed files overlap what this subtree touches */
  coTouchedBy: { id: string; seq: number; intent: string; state: string; files: string[] }[];
  hasChildren: boolean;
  hasAdoLinks: boolean;
  hasImplementedCode: boolean;
  hasCoTouch: boolean;
  /** true only when none of the above hold — nothing to confirm, delete is a no-op-risk */
  safe: boolean;
};

export class DeleteNeedsConfirmation extends Error {
  precheck: TaskDeletePrecheck;
  constructor(message: string, precheck: TaskDeletePrecheck) {
    super(message);
    this.precheck = precheck;
  }
}

function fileSetOf(paths: string[] | null | undefined): Set<string> {
  return new Set((paths ?? []).filter(Boolean));
}

export async function precheckTaskDelete(clientId: string, workitemId: string, taskId: string): Promise<TaskDeletePrecheck> {
  const { all, wi } = await withTenant(clientId, async (tx) => {
    const all = await tx.select().from(task).where(eq(task.workitemId, workitemId));
    const [wi] = await tx.select({ key: workitem.key }).from(workitem).where(eq(workitem.id, workitemId)).limit(1);
    return { all, wi };
  });
  const byId = new Map(all.map((t) => [t.id, t]));
  const root = byId.get(taskId);
  if (!root) throw new Error("משימה לא נמצאה");

  const childrenOf = new Map<string, typeof all>();
  for (const t of all) {
    if (!t.parentTaskId) continue;
    (childrenOf.get(t.parentTaskId) ?? childrenOf.set(t.parentTaskId, []).get(t.parentTaskId)!).push(t);
  }
  const subtreeIds = new Set<string>();
  const queue = [taskId];
  while (queue.length) {
    const id = queue.shift()!;
    if (subtreeIds.has(id)) continue;
    subtreeIds.add(id);
    for (const c of childrenOf.get(id) ?? []) queue.push(c.id);
  }
  const subtreeRows = [...subtreeIds].map((id) => byId.get(id)!).filter(Boolean);

  // latest DONE implement run per task, for real (not just declared) touched files
  const runs = await db.select({ taskId: flowRun.taskId, result: flowRun.result, startedAt: flowRun.startedAt })
    .from(flowRun)
    .where(and(eq(flowRun.workitemId, workitemId), eq(flowRun.kind, "implement"), eq(flowRun.state, "done")))
    .orderBy(desc(flowRun.startedAt));
  const latestRunByTask = new Map<string, ImplementResult>();
  for (const r of runs) {
    if (!r.taskId || latestRunByTask.has(r.taskId)) continue;
    latestRunByTask.set(r.taskId, r.result as unknown as ImplementResult);
  }

  const r = await firstRepo(clientId, workitemId);
  const dir = r ? await ensureCheckout({ ...r, localPath: null }) : null;

  const commitCounts = new Map<string, number>();
  if (dir) {
    for (const t of subtreeRows) {
      commitCounts.set(t.id, await taskCommitCount(dir, taskBranchName(wi?.key, t)));
    }
  }

  const subtree: TaskDeleteNode[] = subtreeRows.map((t) => ({
    id: t.id, seq: t.seq, intent: t.intent, kind: (t.kind as "task" | "check") ?? "task", state: t.state,
    linkedAdoId: t.linkedAdoId, adoUrl: t.adoUrl, approvedAt: t.approvedAt ? t.approvedAt.toISOString() : null,
    commitCount: commitCounts.get(t.id) ?? 0,
  }));

  const subtreeFiles = new Set<string>();
  for (const t of subtreeRows) {
    for (const f of fileSetOf(t.affectedPaths as string[])) subtreeFiles.add(f);
    const run = latestRunByTask.get(t.id);
    if (run) for (const f of run.filesChanged ?? []) subtreeFiles.add(f);
  }

  const coTouchedBy: TaskDeletePrecheck["coTouchedBy"] = [];
  if (subtreeFiles.size > 0) {
    for (const t of all) {
      if (subtreeIds.has(t.id)) continue;
      const theirFiles = fileSetOf(t.affectedPaths as string[]);
      const run = latestRunByTask.get(t.id);
      if (run) for (const f of run.filesChanged ?? []) theirFiles.add(f);
      const overlap = [...theirFiles].filter((f) => subtreeFiles.has(f));
      if (overlap.length > 0) coTouchedBy.push({ id: t.id, seq: t.seq, intent: t.intent, state: t.state, files: overlap });
    }
  }

  const hasChildren = subtree.length > 1;
  const hasAdoLinks = subtree.some((n) => n.linkedAdoId);
  const hasImplementedCode = subtree.some((n) => n.commitCount > 0);
  const hasCoTouch = coTouchedBy.length > 0;

  return {
    taskId, subtree, coTouchedBy, hasChildren, hasAdoLinks, hasImplementedCode, hasCoTouch,
    safe: !hasChildren && !hasAdoLinks && !hasImplementedCode && !hasCoTouch,
  };
}

export type DeleteTaskOptions = {
  /** required if the precheck reports hasChildren */
  confirmSubtree?: boolean;
  /** required if the precheck reports hasAdoLinks — the TFS item(s) are
   *  NEVER auto-deleted (hard lesson from an earlier incident); a note is
   *  posted to each one instead, saying DCC no longer tracks it. */
  confirmAdoLinked?: boolean;
  /** required if the precheck reports hasCoTouch */
  confirmCoTouch?: boolean;
  /** if the precheck reports hasImplementedCode, EXACTLY ONE of these two
   *  is required: roll the code back first (clean), or explicitly accept
   *  that the commits are left dangling in the isolated clone (not lost —
   *  reachable by hash/reflog until a gc — but gone from DCC and from any
   *  normal branch listing). */
  rollbackImplemented?: boolean;
  confirmOrphanCode?: boolean;
};

export async function deleteTaskSurgical(input: { clientId: string; workitemId: string; taskId: string; by: Dev; opts?: DeleteTaskOptions }) {
  const pre = await precheckTaskDelete(input.clientId, input.workitemId, input.taskId);
  const opts = input.opts ?? {};
  const missing: string[] = [];
  if (pre.hasChildren && !opts.confirmSubtree) missing.push(`${pre.subtree.length - 1} תת-פריטים ימחקו איתה`);
  if (pre.hasAdoLinks && !opts.confirmAdoLinked) missing.push("חלק כבר קיים ב-TFS — לא יימחק שם, רק יתועד שהוסר מ-DCC");
  if (pre.hasCoTouch && !opts.confirmCoTouch) missing.push(`${pre.coTouchedBy.length} משימות אחרות כבר נגעו באותם קבצים`);
  if (pre.hasImplementedCode && !opts.rollbackImplemented && !opts.confirmOrphanCode) missing.push("יש קוד מומש שטרם בוטל — לבחור rollback או לאשר השארה כ-orphan");
  if (missing.length > 0) throw new DeleteNeedsConfirmation(`מחיקה חסומה: ${missing.join(" · ")}`, pre);

  // leaves-first deletion order, so the DB's own RESTRICT on parent_task_id
  // never fires — a child is always removed before its parent.
  const rows = await withTenant(input.clientId, (tx) =>
    tx.select({ id: task.id, parentTaskId: task.parentTaskId }).from(task).where(eq(task.workitemId, input.workitemId)),
  );
  const parentOf = new Map(rows.map((r) => [r.id, r.parentTaskId]));
  const remaining = new Map(pre.subtree.map((n) => [n.id, n]));
  const childrenCount = new Map(pre.subtree.map((n) => [n.id, 0]));
  for (const n of pre.subtree) {
    const p = parentOf.get(n.id);
    if (p && childrenCount.has(p)) childrenCount.set(p, (childrenCount.get(p) ?? 0) + 1);
  }
  const order: TaskDeleteNode[] = [];
  while (remaining.size > 0) {
    const leaf = [...remaining.values()].find((n) => (childrenCount.get(n.id) ?? 0) === 0);
    if (!leaf) { order.push(...remaining.values()); break; } // shouldn't happen; let the DB reject a bad case loudly
    order.push(leaf);
    remaining.delete(leaf.id);
    const p = parentOf.get(leaf.id);
    if (p && childrenCount.has(p)) childrenCount.set(p, (childrenCount.get(p) ?? 0) - 1);
  }

  const rolledBack: string[] = [];
  if (opts.rollbackImplemented) {
    for (const n of pre.subtree) {
      if (n.commitCount === 0) continue;
      await rollbackTask({ clientId: input.clientId, workitemId: input.workitemId, taskId: n.id, by: input.by });
      rolledBack.push(n.id);
    }
  }

  let adoNotesPosted = 0;
  const conn = pre.hasAdoLinks ? await activeAdoConnection(input.clientId) : null;
  if (conn) {
    const orgUrl = (conn.config.orgUrl ?? "").replace(/\/+$/, "");
    const project = conn.config.project ?? "";
    if (project) {
      const projBase = `${orgUrl}/${encodeURIComponent(project)}`;
      for (const n of pre.subtree) {
        if (!n.linkedAdoId) continue;
        const r = await adoSend({
          base: projBase, apiPath: `wit/workitems/${n.linkedAdoId}`, method: "PATCH",
          body: [{ op: "add", path: "/fields/System.History", value: `🗑 הוסר מ-DCC (לא נמחק כאן ב-TFS) — ע"י ${input.by.userId}.` }],
          pat: conn.secretRef,
        });
        if (r.ok) adoNotesPosted++;
      }
    }
  }

  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "manual", type: "note.added",
    actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
    links: [{ rel: "task", ref: input.taskId }],
    payload: {
      body: [
        `🗑 משימה #${pre.subtree.find((n) => n.id === input.taskId)?.seq ?? "?"} נמחקה (${pre.subtree.length} פריטים בסך הכל).`,
        rolledBack.length ? `בוטל קוד עבור ${rolledBack.length} מהם לפני המחיקה.` : "",
        adoNotesPosted ? `${adoNotesPosted} פריטי TFS תועדו כ"הוסר מ-DCC" (לא נמחקו שם).` : "",
      ].filter(Boolean).join("\n"),
    },
  });

  await withTenant(input.clientId, async (tx) => {
    for (const n of order) {
      await tx.delete(taskDependency).where(eq(taskDependency.taskId, n.id));
      await tx.delete(taskDependency).where(eq(taskDependency.dependsOnTaskId, n.id));
      await tx.delete(task).where(eq(task.id, n.id));
    }
  });
  await regenerateBrief(input.clientId, input.workitemId);

  return { deleted: true, subtreeDeleted: pre.subtree.length, adoNotesPosted, rolledBack };
}

/* ── 4. task approval ─────────────────────────────────────────────── */

/**
 * Approving a task approves its whole checklist in the same action, then
 * immediately tries to materialize to TFS — "מאושר, טרם הוקם ב-TFS" is
 * retired as a status because the two actions are no longer separable by
 * a person. Materialize failure (most commonly: no ADO connection yet)
 * does NOT fail the approval — it's reported back so the caller can show
 * it, and the existing manual "הקם ב-TFS" step still works as a retry.
 */
export async function approveTask(clientId: string, taskId: string, by: Dev, patch?: { intent?: string; appetite?: "small" | "standard" | "large"; prompt?: string }) {
  const now = new Date();
  const wi = await withTenant(clientId, async (tx) => {
    const set: Record<string, unknown> = { approvedAt: now, approvedBy: by.userId };
    if (patch?.intent) set.intent = patch.intent;
    if (patch?.appetite) set.appetite = patch.appetite;
    if (patch?.prompt !== undefined) set.prompt = patch.prompt.trim() || null;
    const [t] = await tx.update(task).set(set).where(eq(task.id, taskId)).returning();
    if (!t) return undefined;
    // cascade: every check directly under this task, approved in the same
    // stroke — a checklist is never approved piecemeal against its parent.
    await tx.update(task)
      .set({ approvedAt: now, approvedBy: by.userId })
      .where(and(eq(task.parentTaskId, taskId), eq(task.kind, "check"), isNull(task.approvedAt)));
    return t.workitemId;
  });
  if (!wi) return { approved: false as const };

  await regenerateBrief(clientId, wi);

  const conn = await activeAdoConnection(clientId);
  if (!conn) return { approved: true as const, materialized: null, materializeError: "אין חיבור Azure DevOps פעיל — האישור נשמר, אפשר להקים ב-TFS ידנית ברגע שיהיה חיבור." };
  try {
    const materialized = await materializeTasksToAdo({ clientId, workitemId: wi, by });
    return { approved: true as const, materialized, materializeError: undefined };
  } catch (e) {
    return { approved: true as const, materialized: null, materializeError: (e as Error).message };
  }
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
