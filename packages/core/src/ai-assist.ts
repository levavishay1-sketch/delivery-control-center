import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { appendEvent, db, recordClaudeCall, usd, withTenant, withoutTenant, type CallEntityKind, type CallOutcome, type CallTrigger } from "@dcc/db";
import { attachment, claudeCall, flowRun, gap, repo, task, taskDependency, users, workitem } from "@dcc/db/schema";
import { route, type Capability, type RoutingDecision, type RoutingSignals } from "./routing.ts";
import { ADO_LADDER, MAX_TASK_DEPTH, adoTypeForLevel } from "./ado-map.ts";
import { adoSend } from "./ado-http.ts";
import { activeAdoConnection } from "./ado-sync.ts";
import { materializeTasksToAdo } from "./task-ado-sync.ts";
import { syncTaskStateAfterCheckChange } from "./tasks.ts";
import { inheritedChecksForBug } from "./bugs.ts";
import { renderPrompt, requirePrompt } from "./prompts.ts";
import { regenerateBrief } from "./brief/generate.ts";
import { proposeGap } from "./gaps.ts";
import { chooseBase, depLabel, type BasePlan, type DependencyFacts } from "./task-base.ts";
import { dependencyBlockers, taskStatus, type CheckKind, type RunPhase, type StatusFacts, type TaskStatus } from "./task-status.ts";
import { flowSteps, gainedDeps, type FlowBase, type FlowCycle, type FlowStep } from "./task-flow-steps.ts";

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
// `--tools ""` (no tools) loses its empty value in the Windows shell, which then leaves ALL tools on;
// a name that matches no tool leaves none (verified: the model reports no tools, input drops to ~0.8k tokens).
const NO_TOOLS = "NoTools";
// `os.homedir()`, not `os.tmpdir()` — found live: on this machine (and
// plausibly others), the `TEMP`/`TMP` env vars Windows hands Node resolve
// to the 8.3 short-name form of the profile directory (`C:\Users\
// AVISHA~1\...`), not the real long name (`C:\Users\AvishayLev\...`).
// Claude Code's own write-permission check treats a short-name path
// segment as suspicious and refuses to write even under `acceptEdits`
// (headless, so nothing can answer the resulting approval prompt) — a
// write-mode call silently "succeeds" (exit 0, Completed) while
// producing zero file changes, explaining in its text response that it
// couldn't get approval. `os.homedir()` reliably resolves to the long
// form on this same machine (confirmed live) and needs no other change.
const REPO_CACHE = path.join(os.homedir(), ".dcc-repos");

/* ── flow runs: durable background jobs for the local `claude` CLI ──
 *
 * A run is kicked off detached — the HTTP request returns immediately and
 * the work keeps going. The activity transcript lives in an in-memory
 * buffer while the run is active (so a poll during the 3-5 min spawn
 * never touches the DB) and is written to `flow_run` once at the end, so
 * the user can leave the screen and come back to everything Claude did.
 */

type FlowKind = "assess" | "breakdown" | "implement";

/** A run's live transcript. `finished` — its row is written; the buffer stays a little while only so a
 *  screen polling it gets the last lines, and must not be taken for a run still going. */
const buffers = new Map<string, { lines: string[]; kind: FlowKind; workitemId: string; taskId?: string; finished?: boolean; phase?: RunPhase }>();

/** Which step a development run is in — what the task status names while it runs. */
function setPhase(runId: string | undefined, phase: RunPhase) {
  const b = runId ? buffers.get(runId) : undefined;
  if (b) b.phase = phase;
}

/** The step a task's run is in right now, or null when none of its runs is going on. */
export function liveTaskPhase(taskId: string): RunPhase | null {
  for (const b of buffers.values()) if (b.taskId === taskId && !b.finished) return b.phase ?? "develop";
  return null;
}

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
 * (assess/breakdown/implement) are steerable — one-shot calls are
 * unaffected. */
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

/** Process shutdown: kill every live claude child, so a restart never
 *  leaves an orphaned call running (and spending) with nobody to collect
 *  its result. Returns how many were stopped. */
export function stopAllFlowRuns(): number {
  let n = 0;
  for (const [id, p] of runningProcs) {
    if (p.child.pid) { p.stoppedByUser = true; killTree(p.child.pid); n++; }
    runningProcs.delete(id);
  }
  return n;
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
  /** While it runs: develop | build | test. */
  phase?: RunPhase | null;
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
    if (b.workitemId === workitemId && !b.taskId && !b.finished) {
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
    if (b.taskId === taskId && !b.finished) {
      return { id, kind: b.kind, state: "running", lines: b.lines, result: null, error: null, startedAt: null, finishedAt: null, phase: b.phase ?? "develop" };
    }
  }
  const [row] = await db.select().from(flowRun).where(eq(flowRun.taskId, taskId)).orderBy(desc(flowRun.startedAt)).limit(1);
  return row ? viewOf(row) : null;
}

/**
 * A flow's live state (its process, its transcript buffer, `stopFlowRun`'s
 * ability to reach it) lives only in this process's memory — restarting the
 * API, for any reason, ends the child process but the `flow_run` row it
 * wrote stays `running` forever: `getFlowRunView` finds no buffer, falls
 * back to that row, and the screen is stuck on "מתחיל…" with an empty
 * transcript and a stop button `stopFlowRun` can never honour (real bug,
 * live, 2026-09-23 — a run survived several restarts already-marked
 * "running" with a real, but now-orphaned, git checkout behind it).
 * Same shape as `recoverOnboardingRuns` — call once, at startup.
 */
export async function recoverFlowRuns(): Promise<number> {
  const rows = await db.update(flowRun)
    .set({ state: "error", error: "ה-API הופעל מחדש באמצע ההרצה — לא ידוע אם היא הושלמה. הריצו שוב.", finishedAt: new Date() })
    .where(eq(flowRun.state, "running"))
    .returning({ id: flowRun.id });
  return rows.length;
}

/** Kick off assess/breakdown/implement in the background. Returns at once. */
export async function startFlowRun(input: {
  clientId: string; workitemId: string; kind: FlowKind; by: Dev; taskId?: string;
  /** assess-only: how the user wants the readiness check to run. */
  assessOpts?: { promptKey?: string; customEmphasis?: string; model?: string };
  /** Which door the person came through — the button, or a proposal in the chat. On the ledger row. */
  trigger?: CallTrigger;
}): Promise<{ runId: string; alreadyRunning: boolean }> {
  for (const [id, b] of buffers) {
    // A run that already finished is not "already running" — "run again" right after one (after a rollback, say) starts a new one.
    if (!b.finished && (input.taskId ? b.taskId === input.taskId : b.workitemId === input.workitemId && !b.taskId)) {
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
      const done = buffers.get(runId);
      if (done) done.finished = true;
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
  effort: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  durationMs: number | null;
  numTurns: number | null;
};

/**
 * Who, for whom and for what — REQUIRED on every call (claude-in-dcc §8):
 * a call without a declared capability does not compile. `runClaudeRaw`
 * routes the call by its capability and writes one ledger row for it.
 */
export type LedgerContext = {
  clientId: string;
  userId: string;
  capability: Capability;
  trigger: CallTrigger;
  entity?: { kind: CallEntityKind; id: string };
  workitemId?: string | null;
  screen?: string | null;
  label: string;
  conversationId?: string | null;
  messageId?: string | null;
  parentCallId?: string | null;
  signals?: RoutingSignals;
  /** What the CLI already reported for this resumed session (cumulative) — the row is the difference. */
  baseline?: { costUsd?: number; inputTokens?: number; outputTokens?: number };
  /** The input the caller expects (for a resumed session: the last call's), checked against the capability's cap before the call. */
  expectedInputTokens?: number;
  /** The model said it did not have what was asked — a candidate fact for the screen (§7.2). */
  unanswered?: (text: string) => boolean;
  meta?: Record<string, unknown>;
};

export type RunClaudeOpts = {
  ledger: LedgerContext;
  timeoutMs?: number; maxTurns?: number; runId?: string; write?: boolean; model?: string;
  /** Without write access, may still run commands (a build, tests) — the checks. `write` wins. */
  commands?: boolean;
  /** `--effort <level>` — reasoning effort, independent of `--model`. */
  effort?: string;
  onMeta?: (meta: RunMeta) => void;
  /** A lean, read-only call (see `runClaudeRaw`): the whole system prompt comes from a file. */
  lean?: {
    systemPromptFile: string;
    /** Comma-separated built-in tools; none by default. */
    tools?: string;
    /** Keep the conversation on disk under this id, and open it again with `resume`. */
    session?: { id: string; resume: boolean };
    /** Folders the tools may read besides the working directory. */
    addDirs?: string[];
  };
  /** Extra environment for the CLI process. */
  env?: Record<string, string>;
  /** `Read(...)` deny patterns — passed as `--settings {"permissions":{"deny":[...]}}`. */
  denyRules?: string[];
};

/** Run `claude -p` in `cwd` (prompt via stdin) and return the assistant's
 *  final text plus usage/cost metadata — no JSON parsing. This is the one
 *  place that actually spawns the CLI; `runClaudeJson` below is a thin
 *  JSON-parsing wrapper on top for every caller that wants structured
 *  output. */
const emptyMeta = (d: RoutingDecision): RunMeta => ({ model: d.model, effort: d.effort, costUsd: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, durationMs: null, numTurns: null });

/** The one writer of the ledger from a CLI call. Best-effort on purpose: a
 *  row failing to write must never fail the run it describes — it is logged
 *  loudly instead, because a missing row is a missing cost. */
async function recordCall(l: LedgerContext, d: RoutingDecision, startedAt: Date, r: { meta: RunMeta; outcome: CallOutcome; errorText?: string; text?: string }): Promise<string | null> {
  try {
    const row = await recordClaudeCall({
      clientId: l.clientId, userId: l.userId,
      entityKind: l.entity?.kind ?? (l.workitemId ? "workitem" : "none"), entityId: l.entity?.id ?? l.workitemId ?? null,
      workitemId: l.workitemId ?? null, screen: l.screen ?? null, capability: l.capability, trigger: l.trigger, label: l.label,
      conversationId: l.conversationId ?? null, messageId: l.messageId ?? null, parentCallId: l.parentCallId ?? null,
      startedAt, finishedAt: new Date(), durationMs: r.meta.durationMs ?? Math.max(0, Date.now() - startedAt.getTime()),
      modelRequested: d.model, modelUsed: r.meta.model ?? d.model, effort: d.effort, policyVersion: d.policyVersion, policyRule: d.rationale, numTurns: r.meta.numTurns,
      inputTokens: Math.max(0, (r.meta.inputTokens ?? 0) - (l.baseline?.inputTokens ?? 0)),
      cacheReadTokens: r.meta.cacheReadTokens ?? 0, cacheWriteTokens: r.meta.cacheWriteTokens ?? 0,
      outputTokens: Math.max(0, (r.meta.outputTokens ?? 0) - (l.baseline?.outputTokens ?? 0)),
      costUsd: Math.max(0, (r.meta.costUsd ?? 0) - (l.baseline?.costUsd ?? 0)), priceListVersion: d.policyVersion,
      outcome: r.outcome, errorText: r.errorText ?? null,
      unanswered: r.text != null && l.unanswered ? l.unanswered(r.text) : false,
      meta: l.meta ?? {},
    });
    return row.id;
  } catch (e) {
    console.error(`[ledger] a ${l.capability} call was NOT recorded:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export async function runClaudeRaw(cwd: string, prompt: string, opts: RunClaudeOpts): Promise<{ text: string; meta: RunMeta; callId: string | null; assistantText: string }> {
  // prompt goes on stdin so there is nothing to shell-escape; args are all plain.
  // Read-only by default. `write` is only for implementation runs, and those
  // work on an isolated clone — never the user's own checkout.
  // A run tracked by runId also opens for INPUT as stream-json: that is what
  // lets stopFlowRun()/sendRunMessage() reach it while it's still working.
  //
  // The read-only branch's actual safety comes entirely from `--allowed-
  // tools "Read,Grep,Glob"` — Write/Edit/Bash simply aren't callable,
  // regardless of `--permission-mode`. It used to also pass
  // `--permission-mode plan`, Claude Code's real INTERACTIVE plan-then-
  // approve workflow, which expects the model to eventually call an
  // `ExitPlanMode` tool to present its plan for human approval — a tool
  // that doesn't exist in headless `-p` mode. Found live (a read-only
  // analysis call): a `read_only_plan` call spun to 29
  // turns and its final text was just "`ExitPlanMode` isn't available...
  // so here is the finished analysis directly" — except that time it
  // DIDN'T re-emit the actual analysis, only a claim that it already had,
  // silently defeating `extractFencedBlock`'s JSON/fence extraction. Every
  // prior phase's `read_only_plan` calls hit the same latent confusion —
  // most self-corrected by working around the missing tool (wasting turns
  // in the process), one finally didn't. Since `--allowed-tools` already
  // provides the real restriction, `acceptEdits` — the same mode already
  // proven safe for the write branch — replaces `plan` here too; there is
  // nothing for it to "accept" since Write/Edit aren't in the allowed-tools
  // list, but it carries none of `plan` mode's ExitPlanMode expectation.
  const steerable = !!opts.runId;
  const args: string[] = opts.write
    ? [
        "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
        "--allowed-tools", "Read,Grep,Glob,Edit,Write,Bash",
        "--max-turns", String(opts.maxTurns ?? 80),
      ]
    : [
        "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
        "--allowed-tools", opts.commands ? "Read,Grep,Glob,Bash" : "Read,Grep,Glob",
        "--max-turns", String(opts.maxTurns ?? (opts.commands ? 80 : 40)),
      ];
  if (steerable) args.push("--input-format", "stream-json");
  // The policy decides model and effort for EVERY call (claude-in-dcc
  // §8.3); a person's explicit choice wins per field. What it decided, and
  // why, goes on the call's ledger row.
  const decision = route(opts.ledger.capability, opts.ledger.signals ?? {}, undefined, { model: opts.model, effort: opts.effort });
  args.push("--model", decision.model, "--effort", decision.effort);
  const startedAt = new Date();
  // A call whose input would pass the capability's cap is refused before it
  // costs anything — and recorded, because that is the sign the delta
  // discipline broke (claude-in-dcc §2.12).
  const expectedInput = opts.ledger.expectedInputTokens ?? Math.round(prompt.length / 3);
  if (decision.maxInputTokens && expectedInput > decision.maxInputTokens) {
    const why = `הקלט (~${expectedInput.toLocaleString("en-US")} טוקנים) עובר את התקרה של ${opts.ledger.capability} (${decision.maxInputTokens.toLocaleString("en-US")}) — השיחה צריכה להתגלגל להמשך`;
    await recordCall(opts.ledger, decision, startedAt, { meta: emptyMeta(decision), outcome: "refused", errorText: why });
    throw new Error(why);
  }
  // A lean call: the CLI's own system prompt, the user's skills/MCP servers and
  // memory are replaced by one small prompt file (measured: ~1.9k tokens in
  // instead of ~31k for a one-line request, so ~5x cheaper and faster). A file,
  // not the inline flag: `shell: true` on Windows splits on spaces.
  if (opts.lean) {
    const l = opts.lean;
    args.push("--system-prompt-file", l.systemPromptFile, "--tools", l.tools || NO_TOOLS, "--disable-slash-commands", "--strict-mcp-config", "--setting-sources", "local");
    if (l.session) args.push(l.session.resume ? "--resume" : "--session-id", l.session.id);
    else args.push("--no-session-persistence");
    for (const d of l.addDirs ?? []) args.push("--add-dir", d);
  }
  // `--settings` accepts either inline JSON or a file path (`claude --help`
  // confirms both) — a temp FILE is used here, not the inline JSON string
  // directly. Found live: on Windows, `claude.cmd` can only be spawned with
  // `shell: true` (see CLAUDE_VIA_SHELL below), which routes the whole
  // command through cmd.exe; cmd.exe's own argument-splitting mangles a
  // JSON string containing `{`/`}`/`"` badly enough that the CLI received
  // corrupted text and failed with "Invalid JSON provided to --settings" —
  // reproduced in isolation (a bare `runClaudeRaw` call with one deny rule,
  // no pipeline code involved) and confirmed the SAME JSON works perfectly
  // when the `claude` binary is invoked directly (no shell mangling). A
  // plain file path has no shell-special characters to mangle.
  let settingsFile: string | null = null;
  if (opts.denyRules?.length) {
    settingsFile = path.join(os.tmpdir(), `dcc-claude-settings-${randomUUID()}.json`);
    writeFileSync(settingsFile, JSON.stringify({ permissions: { deny: opts.denyRules } }));
    args.push("--settings", settingsFile);
  }
  let raw: string;
  try {
    raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd, env: opts.env ? { ...process.env, ...opts.env } : process.env, windowsHide: true, shell: CLAUDE_VIA_SHELL });
    const proc: SteerableProc | null = steerable ? { child, stdinOpen: true, stoppedByUser: false } : null;
    if (proc) runningProcs.set(opts.runId!, proc);
    let out = "";
    let err = "";
    let buf = "";
    const closeStdin = () => { if (proc?.stdinOpen) { proc.stdinOpen = false; child.stdin.end(); } };
    const killer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`claude timed out after ${(opts.timeoutMs ?? 240000) / 1000}s`)); }, opts.timeoutMs ?? 240000);
    child.stdout.on("data", (d) => {
      out += d;
      buf += d;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const ln of parts) {
        const trimmed = ln.trim();
        if (!opts.runId) continue;
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
      if (settingsFile) { try { unlinkSync(settingsFile); } catch { /* best-effort cleanup */ } }
      if (proc?.stoppedByUser) return reject(new Error("STOPPED_BY_USER"));
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 400)}`));
      resolve(out);
    });
    if (steerable) child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } }) + "\n");
    else { child.stdin.write(prompt); child.stdin.end(); }
    });
  } catch (e) {
    // A call that never answered still cost something to try, and is a
    // failure the control center must show (§9.6) — recorded, then rethrown.
    const msg = e instanceof Error ? e.message : String(e);
    const outcome: CallOutcome = msg === "STOPPED_BY_USER" ? "stopped" : /timed out/.test(msg) ? "timeout" : "error";
    await recordCall(opts.ledger, decision, startedAt, { meta: emptyMeta(decision), outcome, errorText: msg.slice(0, 500) });
    throw e;
  }

  // stream-json → many NDJSON lines; the assistant's answer is the last
  // {"type":"result","result":"…"} line — which also carries cost/usage.
  let text = raw.trim();
  const resultLine = raw.split("\n").reverse().find((l) => l.includes('"type":"result"'));
  let meta: RunMeta = emptyMeta(decision);
  try {
    const env = JSON.parse((resultLine ?? text).trim()) as {
      result?: string; total_cost_usd?: number; duration_ms?: number; num_turns?: number; is_error?: boolean; subtype?: string;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
      modelUsage?: Record<string, unknown>;
    };
    if (typeof env.result === "string") text = env.result;
    // The CLI reports a failed run (auth, budget, structured-output retries
    // exhausted) as a result line with is_error — the process still exits
    // 0, so surface it here rather than returning the error text as "the answer".
    if (env.is_error) throw new Error(`claude run failed (${env.subtype ?? "error"}): ${text.slice(0, 300)}`);
    // The CLI lists every model the run touched, its own small helper calls
    // included — the model that carried the run is the one that cost the most.
    const modelFromUsage = env.modelUsage
      ? Object.entries(env.modelUsage).map(([m, u]) => [m, Number((u as { costUSD?: number } | null)?.costUSD ?? 0)] as const).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      : null;
    meta = {
      model: modelFromUsage ?? decision.model,
      effort: decision.effort,
      costUsd: typeof env.total_cost_usd === "number" ? env.total_cost_usd : null,
      inputTokens: env.usage?.input_tokens ?? null,
      outputTokens: env.usage?.output_tokens ?? null,
      cacheReadTokens: env.usage?.cache_read_input_tokens ?? null,
      cacheWriteTokens: env.usage?.cache_creation_input_tokens ?? null,
      durationMs: typeof env.duration_ms === "number" ? env.duration_ms : null,
      numTurns: typeof env.num_turns === "number" ? env.num_turns : null,
    };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("claude run failed")) {
      await recordCall(opts.ledger, decision, startedAt, { meta, outcome: "error", errorText: e.message.slice(0, 500) });
      throw e;
    }
    /* fall back to raw text, meta stays all-null */
  }
  opts.onMeta?.(meta);
  const callId = await recordCall(opts.ledger, decision, startedAt, { meta, outcome: "ok", text });
  return { text, meta, callId, assistantText: assistantTexts(raw) };
}

/**
 * Everything the model wrote along the way, not only its last message. In a
 * run that reads files, `result` is just the text after the final tool call —
 * an explanation written before reading is not in it (seen live: a reply that
 * was only an action block, its reasoning lost).
 */
function assistantTexts(raw: string): string {
  const parts: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.includes('"type":"assistant"')) continue;
    try {
      const ev = JSON.parse(line) as { type?: string; message?: { content?: { type?: string; text?: string }[] } };
      if (ev.type !== "assistant") continue;
      for (const c of ev.message?.content ?? []) if (c.type === "text" && c.text?.trim()) parts.push(c.text.trim());
    } catch { /* not a JSON line */ }
  }
  return parts.join("\n\n");
}

/** Run `claude -p` in `cwd` (prompt via stdin), expect a single JSON object back. */
async function runClaudeJson<T>(cwd: string, prompt: string, opts: RunClaudeOpts): Promise<T> {
  const { text } = await runClaudeRaw(cwd, prompt, opts);
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

export type RequirementCostSummary = {
  totalUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  runCount: number;
  /** by capability (gap_detection / decomposition / execution / …) */
  byKind: Record<string, { count: number; usd: number }>;
};

/**
 * A requirement's cumulative Claude cost — every ledger row against it,
 * summed (claude-in-dcc §8.2: one place, one count). Deliberately never
 * filtered by whether the task/check that triggered a run still exists or
 * is still active: work that was later dropped already cost what it cost;
 * a re-breakdown adds rows on top, it never resets this.
 */
export async function requirementCostSummary(clientId: string, workitemId: string): Promise<RequirementCostSummary> {
  const rows = await withTenant(clientId, (tx) =>
    tx.select({ capability: claudeCall.capability, costUsd: claudeCall.costUsd, inputTokens: claudeCall.inputTokens, outputTokens: claudeCall.outputTokens })
      .from(claudeCall).where(eq(claudeCall.workitemId, workitemId)),
  );
  const byKind: Record<string, { count: number; usd: number }> = {};
  let totalUsd = 0, totalInputTokens = 0, totalOutputTokens = 0;
  for (const r of rows) {
    const cost = usd(r.costUsd);
    totalUsd += cost;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
    const bucket = (byKind[r.capability] ??= { count: 0, usd: 0 });
    bucket.count++;
    bucket.usd += cost;
  }
  return { totalUsd, totalInputTokens, totalOutputTokens, runCount: rows.length, byKind };
}

export type CostDetailRow = {
  id: string; occurredAt: string; kind: string; trigger: string; label: string; model: string | null; effort: string | null;
  costUsd: number; inputTokens: number; cacheReadTokens: number; outputTokens: number; durationMs: number | null; numTurns: number | null; outcome: string;
};

/** Every call behind a requirement's total — one ledger row each, newest
 *  first. `requirementCostSummary` answers "how much"; this answers "on
 *  what, exactly". Kept for the MCP server; the web reads the same rows
 *  through `callsForEntity`. */
export async function requirementCostDetail(clientId: string, workitemId: string): Promise<CostDetailRow[]> {
  const rows = await withTenant(clientId, (tx) =>
    tx.select().from(claudeCall).where(eq(claudeCall.workitemId, workitemId)).orderBy(desc(claudeCall.startedAt)),
  );
  return rows.map((r) => ({
    id: r.id, occurredAt: new Date(r.startedAt).toISOString(), kind: r.capability, trigger: r.trigger, label: r.label,
    model: r.modelUsed ?? r.modelRequested, effort: r.effort,
    costUsd: usd(r.costUsd), inputTokens: r.inputTokens, cacheReadTokens: r.cacheReadTokens, outputTokens: r.outputTokens,
    durationMs: r.durationMs, numTurns: r.numTurns, outcome: r.outcome,
  }));
}

/** Local working copy for the repo — clone or pull. Returns null if we can't get one.
 *  Exported for `repo-onboarding/*` —
 *  same cache-clone mechanism `runImplement` uses, not a second checkout system.
 *
 *  Real bug found live (2026-09-16): reusing an existing cache clone used
 *  to just `git pull --ff-only` on WHATEVER branch happened to be checked
 *  out — but `runRepoInit` leaves the clone on its own throwaway
 *  `dcc-ai/init-*` branch (no upstream), even when that run failed. Every
 *  subsequent sync then silently pulled nothing (no upstream to compare
 *  against) and kept re-scanning a snapshot frozen at whenever that
 *  branch was cut — confirmed against the real Altshuler Trade cache,
 *  still sitting on a dead branch from an earlier failed `/init` test.
 *  Fix: always reset to the actual default branch before pulling, not
 *  just pull blindly — same correctness as a fresh clone, without paying
 *  its full download cost every time. */
/** The local copy of a repository IF it is already there — never clones.
 *  Read-only callers (screens) use this; work that needs a copy uses `ensureCheckout`. */
export function existingCheckout(r: { id: string; localPath: string | null }): string | null {
  if (r.localPath && existsSync(r.localPath)) return r.localPath;
  const dir = path.join(REPO_CACHE, r.id);
  return existsSync(path.join(dir, ".git")) ? dir : null;
}

/**
 * What to say before touching the repo — checked BEFORE the fetch starts, so
 * a quick update on an already-present copy never reads as a from-scratch
 * download. "מכין עותק" unconditionally, every run, was confirmed live to
 * read as re-downloading the whole thing each time, even though an existing
 * copy only ever gets `reset`/`pull` (seconds, not the minutes a first clone
 * of a large repository can take here).
 */
function checkoutStartLine(r: { id: string; name: string; localPath: string | null }): string {
  return existingCheckout(r)
    ? `בודק אם יש עדכונים ל-${r.name}…`
    : `מוריד עותק של ${r.name} — בפעם הראשונה (או על רשת איטית) זה יכול לקחת כמה דקות…`;
}

/** One fetch per repository at a time: two callers (a second press, a retry
 *  after a restart) must wait for the copy being made, not start a second
 *  clone into the same directory. */
const checkouts = new Map<string, Promise<Checkout>>();

/** Why there is no working copy — a sentence for the person, never a silent null. */
export type Checkout = { dir: string | null; reason: string | null };

/** The line worth showing from a failed git run — prefer git's own "fatal:"/
 *  "error:" over a trailing hint line ("and retry with…"), which names no
 *  cause at all. */
function gitFailureDetail(out: string): string {
  const lines = out.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines.pop() ?? "ללא פירוט";
}

export function checkoutRepo(r: { id: string; name: string; localPath: string | null; adoRepoRef: string | null }): Promise<Checkout> {
  const running = checkouts.get(r.id);
  if (running) return running;
  const p = doCheckout(r).finally(() => checkouts.delete(r.id));
  checkouts.set(r.id, p);
  return p;
}

export function ensureCheckout(r: { id: string; name: string; localPath: string | null; adoRepoRef: string | null }): Promise<string | null> {
  return checkoutRepo(r).then((c) => c.dir);
}

/** A first clone of a big repo on a slow link is minutes, not seconds; an
 *  incremental update of one already here is not. Both are bounded — a git
 *  that never returns used to hang the request that asked for it. */
const CLONE_TIMEOUT_MS = 600_000;
const UPDATE_TIMEOUT_MS = 180_000;

async function doCheckout(r: { id: string; name: string; localPath: string | null; adoRepoRef: string | null }): Promise<Checkout> {
  if (r.localPath && existsSync(r.localPath)) return { dir: r.localPath, reason: null };
  const gitUrl = r.adoRepoRef && /^(https?:\/\/|git@)/.test(r.adoRepoRef) ? r.adoRepoRef : null;
  if (!gitUrl) {
    // A localPath that is not on disk is not a working copy. Saying so beats
    // handing a run a cwd that does not exist.
    return {
      dir: null,
      reason: r.localPath
        ? `התיקייה המקומית של ${r.name} לא נמצאה (${r.localPath}), ואין כתובת git להביא ממנה עותק.`
        : `ל-${r.name} אין כתובת git תקינה (${r.adoRepoRef ?? "ריק"}) ואין עותק מקומי.`,
    };
  }
  mkdirSync(REPO_CACHE, { recursive: true });
  const dir = path.join(REPO_CACHE, r.id);
  // A clone that was interrupted (the API restarted while it ran) leaves a
  // directory full of files with no HEAD. Reusing it fails in confusing ways
  // later, so it is thrown away and fetched again.
  if (existsSync(path.join(dir, ".git")) && (await git(["rev-parse", "--verify", "--quiet", "HEAD"], dir)).code !== 0) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (existsSync(path.join(dir, ".git"))) {
    await git(["reset", "--hard"], dir, { timeoutMs: UPDATE_TIMEOUT_MS });
    await git(["clean", "-fd"], dir, { timeoutMs: UPDATE_TIMEOUT_MS });
    const base = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir)).out.replace(/^origin\//, "") || "main";
    await git(["checkout", base], dir, { timeoutMs: UPDATE_TIMEOUT_MS });
    // An update that fails still leaves a usable (if older) copy — say so
    // rather than throwing the copy away over a flaky network.
    const pull = await git(["pull", "--ff-only"], dir, { timeoutMs: UPDATE_TIMEOUT_MS });
    return { dir, reason: pull.code === 0 ? null : `העותק המקומי של ${r.name} לא עודכן (${gitFailureDetail(pull.out)}) — נקרא כפי שהוא.` };
  }
  // Clone beside the target and move it into place only once it succeeded,
  // so a killed clone can never be mistaken for a usable copy.
  const tmp = `${dir}.partial-${randomUUID().slice(0, 8)}`;
  // Assess/breakdown/implement only ever read the CURRENT snapshot of the
  // code — not its history — so the first clone asks for just that (depth
  // 1). On a slow link, 80 commits' worth of blobs was the difference
  // between minutes and never; a caller that later wants real history can
  // `git fetch --deepen` this same cache.
  const cloned = await git(["clone", "--depth", "1", gitUrl, tmp], REPO_CACHE, { timeoutMs: CLONE_TIMEOUT_MS });
  if (cloned.code !== 0 || (await git(["rev-parse", "--verify", "--quiet", "HEAD"], tmp)).code !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    return { dir: null, reason: `הבאת ${r.name} מ-git נכשלה: ${gitFailureDetail(cloned.out)}` };
  }
  // A second request for the same repo (a retry, another requirement) that
  // arrived after this one's dedup slot had already been claimed and freed
  // can reach here in parallel. If that other attempt already finished, use
  // its result instead of overwriting a directory Windows may still have a
  // handle open on (real, seen live: a fresh rename EPERM'd for exactly
  // this reason) — and the wait for `tmp` was not wasted, `dir` is current.
  if (existsSync(path.join(dir, ".git")) && (await git(["rev-parse", "--verify", "--quiet", "HEAD"], dir)).code === 0) {
    rmSync(tmp, { recursive: true, force: true });
    return { dir, reason: null };
  }
  // Windows can hold a just-written directory briefly (antivirus, the
  // indexer) — retry past that instead of failing a otherwise-successful
  // clone over a lock that clears itself within a second or two.
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      renameSync(tmp, dir);
      return { dir, reason: null };
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((res) => setTimeout(res, 500 * attempt));
    }
  }
}

type Dev = { userId: string };

/** Looks up a real name/email for a git commit's `-c user.name=/user.email=`
 *  identity — replacing the generic `DCC <dcc@local>` constant that used to
 *  be hardcoded regardless of who actually triggered the run. Identity
 *  non-negotiable #2 ("always a real person behind every AI action")
 *  applies to the commit record itself, not just the DB's actor column.
 *  Falls back to the generic identity only if the user row is somehow gone
 *  by the time the commit runs — never throws, a commit must still succeed. */
export async function resolveCommitIdentity(userId: string): Promise<{ name: string; email: string }> {
  const [u] = await db.select({ displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return u ? { name: u.displayName, email: u.email } : { name: "DCC", email: "dcc@local" };
}

/** The requirement as every prompt reads it: the row, its notes, its attached files' text. */
export async function loadRequirementText(clientId: string, workitemId: string) {
  return withTenant(clientId, async (tx) => {
    const [wi] = await tx.select().from(workitem).where(eq(workitem.id, workitemId)).limit(1);
    if (!wi) throw new Error("requirement not found");
    const notes = await tx.execute<{ body: string; source: string; occurred_at: Date }>(
      sql`select payload->>'body' as body, source, occurred_at from event_log
          where workitem_id = ${workitemId} and type = 'note.added' and supersedes is null
          order by occurred_at asc limit 40`,
    );
    // The requirement is often mostly IN the attached spec. Sending the note
    // without it is what made Claude ask to be allowed to read a file that
    // was already attached.
    const files = await tx
      .select({ name: attachment.name, text: attachment.extractedText, err: attachment.extractError })
      .from(attachment)
      .where(eq(attachment.workitemId, workitemId))
      .orderBy(attachment.createdAt);
    return { wi, notes: ((notes.rows ?? notes) as { body: string; source: string }[]).filter((n) => n.body), files };
  });
}

/** The attached files, as the prompt carries them. */
function filesSection(files: { name: string; text: string | null; err: string | null }[], he: boolean): string {
  if (files.length === 0) return "";
  const parts = files.map((f) =>
    f.text
      ? `--- ${he ? "קובץ מצורף" : "ATTACHED FILE"}: ${f.name} ---\n${f.text}`
      : `--- ${he ? "קובץ מצורף" : "ATTACHED FILE"}: ${f.name} — ${he ? "לא ניתן לקרוא כטקסט" : "NOT READABLE AS TEXT"} (${f.err ?? "unknown"}) ---`,
  );
  return `\n\n${he ? "קבצים מצורפים לדרישה — הם חלק מהדרישה, לא רקע:" : "FILES ATTACHED TO THE REQUIREMENT — they are part of the requirement, not background:"}\n\n${parts.join("\n\n")}`;
}

/** A refusal meant for the person — the API shows its message, not a 500. */
export class RepoRequired extends Error {}

/**
 * The working copy, or a refusal — never a quiet downgrade.
 *
 * An assessment that never opened the code is a guess with a confident
 * voice. A development requirement therefore needs a repository, and a
 * repository that is linked must actually arrive; "אין עותק repo — מעריך
 * מהטקסט בלבד" used to hide a failed fetch behind an answer that read like
 * a real one. Research and testing requirements have no code to check
 * against, so they may still run on the text.
 */
async function requireCheckout(
  r: Awaited<ReturnType<typeof firstRepo>>,
  requirementType: string,
): Promise<{ cwd: string | null; repoName: string | null; staleWarning: string | null }> {
  if (!r) {
    if (requirementType !== "development") return { cwd: null, repoName: null, staleWarning: null };
    throw new RepoRequired(
      "לדרישת פיתוח אין repository מקושר, ובחינת בשלות בודקת את הקוד עצמו. קשרו repository לדרישה (או ללקוח) והריצו שוב.",
    );
  }
  const { dir, reason } = await checkoutRepo(r);
  if (!dir) {
    // A fetch that failed is worth retrying; a repo with no git address is not.
    const fetchFailed = !!r.adoRepoRef?.trim();
    throw new RepoRequired(
      `${reason ?? `לא הצלחנו להביא עותק של ${r.name}.`}\n\nבחינת בשלות חייבת לקרוא את הקוד, ולכן היא נעצרה כאן במקום לענות מהטקסט בלבד. ${
        fetchFailed
          ? "נסו שוב — הורדה ראשונה של repository גדול יכולה לקחת כמה דקות."
          : "הוסיפו ל-repository כתובת git במסך Repositories, והריצו שוב."
      }`,
    );
  }
  return { cwd: dir, repoName: r.name, staleWarning: reason };
}

export async function firstRepo(clientId: string, workitemId: string) {
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
  clientId: string; workitemId: string; promptKey: string; customEmphasis?: string; model?: string; runId?: string;
}): Promise<{
  prompt: string; promptHe: string | null; model: string | undefined; cwd: string | null;
  repoName: string | null; staleWarning: string | null; filesRead: number; templateTitle: string; currentTitle: string;
}> {
  const { wi, notes, files } = await loadRequirementText(input.clientId, input.workitemId);
  const r = await firstRepo(input.clientId, input.workitemId);
  if (r) pushLine(input.runId, checkoutStartLine(r));
  const { cwd, repoName, staleWarning } = await requireCheckout(r, wi.requirementType);
  const base = [`Title: ${wi.title}`, ...notes.map((n) => `[${n.source}] ${n.body}`)].join("\n\n");
  const tmpl = await requirePrompt(input.promptKey);

  const shared = { HAS_REPO: !!cwd, REPO_NAME: repoName ?? "" };
  const varsEn: Record<string, string | boolean> = { ...shared, REQUIREMENT: base + filesSection(files, false) };
  const varsHe: Record<string, string | boolean> = { ...shared, REQUIREMENT: base + filesSection(files, true) };
  if (input.promptKey === "assess.readiness.custom") {
    varsEn.CUSTOM_EMPHASIS = input.customEmphasis?.trim() || "(none specified)";
    varsHe.CUSTOM_EMPHASIS = input.customEmphasis?.trim() || "(לא צוין)";
  }

  // The output SHAPE is authored once, shared by every tier — so fixing
  // how an answer reads fixes it everywhere instead of in five places.
  const contract = await requirePrompt(ASSESS_CONTRACT_KEY);
  const join = (focus: string, shape: string | null | undefined) => (shape ? `${focus}\n\n${shape}` : focus);

  const prompt = join(renderPrompt(tmpl.body, varsEn), contract.body);
  const promptHe = tmpl.bodyHe ? join(renderPrompt(tmpl.bodyHe, varsHe), contract.bodyHe) : null;
  const model = input.model || tmpl.defaultModel || undefined;

  // Repository knowledge is not prepended here: an onboarded repo carries
  // it in its own CLAUDE.md / skills, which the `claude -p` run loads
  // natively from `cwd`.
  return { prompt, promptHe, model, cwd, repoName, staleWarning, filesRead: files.length, templateTitle: tmpl.title, currentTitle: wi.title };
}

/** Render (never run) the prompt for one tier — powers the preview modal. */
export async function previewAssessPrompt(input: { clientId: string; workitemId: string; promptKey: string; customEmphasis?: string }) {
  const built = await buildAssessPrompt(input);
  return { prompt: built.prompt, promptHe: built.promptHe, model: built.model ?? null, templateTitle: built.templateTitle };
}

async function runAssess(input: { clientId: string; workitemId: string; by: Dev; runId?: string; promptKey?: string; customEmphasis?: string; model?: string; trigger?: CallTrigger }): Promise<AssessResult> {
  const built = await buildAssessPrompt({
    clientId: input.clientId, workitemId: input.workitemId,
    promptKey: input.promptKey ?? DEFAULT_ASSESS_PROMPT_KEY, customEmphasis: input.customEmphasis, model: input.model, runId: input.runId,
  });
  if (built.staleWarning) pushLine(input.runId, `⚠ ${built.staleWarning}`);
  const filesLine = built.filesRead > 0 ? ` · ${built.filesRead} קבצים מצורפים` : "";
  pushLine(input.runId, built.cwd
    ? `קורא את ה-repo ${built.repoName}${filesLine} · ${built.templateTitle}`
    : `דרישת מחקר/בדיקות — מעריך מהטקסט${filesLine} · ${built.templateTitle}`);

  const raw = await runClaudeJson<Partial<AssessResult> & { rationale?: string | string[]; whatChanges?: string | string[] }>(
    built.cwd ?? process.cwd(), built.prompt, {
      timeoutMs: 600000, runId: input.runId, model: built.model,
      ledger: { clientId: input.clientId, userId: input.by.userId, capability: "gap_detection", trigger: input.trigger ?? "button", entity: { kind: "workitem", id: input.workitemId }, workitemId: input.workitemId, screen: "requirement", label: `בחינת בשלות הדרישה · ${built.templateTitle}` },
    },
  );
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
  // A title typed only to satisfy the required field ("כדגכ", "x", a copy
  // of the client name) carries no information — once Claude has actually
  // read the raw text and any attached spec, its title is strictly more
  // informative. A real title, however short, is never overwritten.
  const patch: { phase: "shaping"; updatedAt: Date; title?: string } = { phase: "shaping", updatedAt: new Date() };
  if (res.title.trim() && built.currentTitle.trim().length <= 6) patch.title = res.title.trim();
  await withTenant(input.clientId, (tx) =>
    tx.update(workitem).set(patch).where(eq(workitem.id, input.workitemId)),
  );
  await regenerateBrief(input.clientId, input.workitemId);

  return { ...res, repoUsed: built.repoName };
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
  const { wi, notes, files } = await loadRequirementText(input.clientId, input.workitemId);
  const r = await firstRepo(input.clientId, input.workitemId);
  if (r) pushLine(input.runId, checkoutStartLine(r));
  const { cwd, repoName, staleWarning } = await requireCheckout(r, wi.requirementType);
  if (staleWarning) pushLine(input.runId, `⚠ ${staleWarning}`);
  pushLine(input.runId, cwd ? `קורא את ה-repo ${repoName}` : "דרישת מחקר/בדיקות — מפרק מהטקסט");

  const reqText = [`Title: ${wi.title}`, ...notes.map((n) => n.body)].join("\n\n") + filesSection(files, false);
  const tmpl = await requirePrompt("breakdown.tasks");
  const vars = { HAS_REPO: !!cwd, REPO_NAME: repoName ?? "", REQUIREMENT: reqText };
  const prompt = renderPrompt(tmpl.body, vars);
  const promptHe = tmpl.bodyHe ? renderPrompt(tmpl.bodyHe, vars) : prompt;
  return { prompt, promptHe, cwd, repoName };
}

export async function previewBreakdownPrompt(input: { clientId: string; workitemId: string }): Promise<{ prompt: string; promptHe: string; repoName: string | null }> {
  const { prompt, promptHe, repoName } = await buildBreakdownPrompt(input);
  return { prompt, promptHe, repoName };
}

async function runBreakdown(input: { clientId: string; workitemId: string; by: Dev; runId?: string; trigger?: CallTrigger }): Promise<BreakdownResult> {
  const { prompt, cwd } = await buildBreakdownPrompt(input);
  const proposed = await runClaudeJson<
    { seq: number; parentSeq?: number | null; kind?: string; intent: string; prompt?: string; appetite: string; affectedPaths?: string[]; compiledComponents?: string[]; dependsOnSeq?: number[] }[]
  >(cwd ?? process.cwd(), prompt, {
    timeoutMs: 600000, runId: input.runId,
    ledger: { clientId: input.clientId, userId: input.by.userId, capability: "decomposition", trigger: input.trigger ?? "button", entity: { kind: "workitem", id: input.workitemId }, workitemId: input.workitemId, screen: "requirement", label: "פירוק למשימות" },
  });
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
  // Every task that is built itself gets the checks DCC requires, as part of the proposal — the person sees them before approving.
  let withChecks = 0;
  for (const row of out.tasks.filter((x) => x.kind === "task")) {
    if ((await ensureStandardChecks(input.clientId, row.id, REQUIRED_CHECKS, { quiet: true })).length) withChecks++;
  }
  if (withChecks) pushLine(input.runId, `נוספו בדיקות חובה (Build, בדיקות לפיתוח, רגרסיה) ל-${withChecks} משימות`);
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
  /** One entry per check this run verified — the build step, then the others — keyed by
   *  the same `seq` Claude was given; absent (not just empty) when none ran. */
  checks?: { seq: number; passed: boolean; detail: string; likelyCause: "implementation" | "requirement_ambiguity" | "dependency_missing" | "environment" | null; kind?: string | null }[];
  /** Checks that did not run because the build did not pass. */
  skipped?: number[];
  /** What the run was built on and without — how the task's steps tell a dependency coming in from a plain run again. */
  base?: FlowBase;
  /** Set later, on the run the task's branch was pushed from / the task was closed on. */
  pushedAt?: string;
  closedAt?: string;
};

/** Run a git command in `cwd`; resolves { code, out }.
 *  git.exe is a real executable (not a .cmd shim like npm/claude), so it
 *  must run WITHOUT shell:true — Windows' cmd.exe re-splits a quoted
 *  argument at every space, which silently breaks any commit message
 *  with spaces (e.g. "t1: ..." becomes three separate pathspec args). */
/** Exported for `repo-onboarding/*` — same reasoning as `ensureCheckout`. */
/** `env`: extra variables for this one call — `GIT_INDEX_FILE` lets plumbing build a tree
 *  in an index of its own, so nothing is staged in the working copy somebody may be using. */
export function git(args: string[], cwd: string, opts?: { timeoutMs?: number; env?: Record<string, string> }): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    // GIT_TERMINAL_PROMPT=0 stops git's own credential prompt from hanging
    // a headless spawn — but a credential HELPER (e.g. Git Credential
    // Manager) can still pop its own GUI/browser prompt that this process
    // can never answer, so network operations (push/fetch against a
    // remote with no cached credential) also get a hard timeout below.
    // core.longpaths: Windows' 260-char MAX_PATH kills a clone/checkout the
    // instant a repo has one deeply-nested path (a .NET obj/ build output,
    // seen for real on a live repo — 8000+ files in, "Filename too long").
    // A no-op on every other platform, so always on rather than sniffed.
    const p = spawn("git", ["-c", "core.longpaths=true", ...args], { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(opts?.env ?? {}) } });
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
export const taskBranchName = (reqKey: string | null | undefined, t: { seq: number; intent: string }) =>
  `task/${reqKey ?? "REQ"}-t${t.seq}${slug(t.intent) ? `-${slug(t.intent)}` : ""}`;

/** The repository's default branch in a clone, e.g. "main". */
async function defaultBranch(dir: string): Promise<string> {
  return (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir)).out.replace(/^origin\//, "") || "main";
}

/** Where a task's own work starts: the commit recorded when its branch was
 *  created (it may be another task's branch, not the default one) — or, for
 *  a branch made before that was recorded, where it leaves the default branch. */
async function taskBaseSha(dir: string, branch: string, t: { baseSha: string | null }): Promise<string | null> {
  if (t.baseSha && (await git(["merge-base", "--is-ancestor", t.baseSha, branch], dir)).code === 0) return t.baseSha;
  return (await git(["merge-base", branch, `origin/${await defaultBranch(dir)}`], dir)).out || null;
}

/** How many commits of its own a task's branch has — beyond what it was built
 *  on, never counting a dependency's work it started from. 0 means "never
 *  implemented" or "implemented but produced no changes". */
async function taskCommitCount(dir: string, branch: string, t: { baseSha: string | null }): Promise<number> {
  const exists = await git(["rev-parse", "--verify", "--quiet", branch], dir);
  if (exists.code !== 0) return 0;
  const from = await taskBaseSha(dir, branch, t);
  if (!from) return 0;
  const count = await git(["rev-list", "--count", `${from}..${branch}`], dir);
  return Number(count.out) || 0;
}

/* ── what a task's branch is built on (task-base.ts decides) ──────── */

type TaskRow = typeof task.$inferSelect;

/** The open tasks this one depends on, with what git knows about each. No clone = nothing developed yet. */
async function dependencyFacts(clientId: string, t: Pick<TaskRow, "id">, reqKey: string | null | undefined, dir: string | null): Promise<(DependencyFacts & { baseSha: string | null })[]> {
  const deps = await withTenant(clientId, (tx) => tx.select().from(task)
    .where(sql`${task.id} in (select depends_on_task_id from task_dependency where task_id = ${t.id}) and ${task.state} <> 'dropped' and ${task.active} = true and ${task.kind} = 'task'`)
    .orderBy(task.seq));
  const def = dir ? await defaultBranch(dir) : null;
  const out: (DependencyFacts & { baseSha: string | null })[] = [];
  for (const d of deps) {
    const branch = taskBranchName(reqKey, d);
    const own = dir ? await taskCommitCount(dir, branch, d) : 0;
    const merged = own > 0 && !!dir && (await git(["merge-base", "--is-ancestor", branch, `origin/${def}`], dir)).code === 0;
    out.push({ id: d.id, seq: d.seq, intent: d.intent, state: d.state, branch: own > 0 ? branch : null, merged, baseSha: d.baseSha });
  }
  return out;
}

/** What a branch created now would start from. */
async function planTaskBase(clientId: string, t: Pick<TaskRow, "id">, reqKey: string | null | undefined, dir: string | null): Promise<BasePlan> {
  const deps = await dependencyFacts(clientId, t, reqKey, dir);
  const holds = new Set<string>();
  const open = deps.filter((d) => d.branch && !d.merged);
  for (const a of open) for (const b of open) {
    if (a !== b && dir && (await git(["merge-base", "--is-ancestor", b.branch!, a.branch!], dir)).code === 0) holds.add(`${a.id}|${b.id}`);
  }
  return chooseBase(deps, (a, b) => holds.has(`${a.id}|${b.id}`));
}

export type TaskBuiltOn = {
  /** "built" — the branch exists with work of its own, and this is what it was built on; "planned" — what a first run would build on. */
  state: "built" | "planned";
  on: { id: string; seq: number; intent: string; branch: string } | null;
  missing: { id: string; seq: number; intent: string; state: string; why: "not_developed" | "parallel" | "not_in_base" }[];
  /** Built only: the task it is built on has gained commits since, which this branch does not have. */
  onMoved: boolean;
  /** Built only: of what it was built without, those whose work exists now — worth developing again. */
  nowAvailable: { id: string; seq: number; intent: string }[];
};

/**
 * What a task's branch is (or would be) built on — for the prompt, the task
 * screen and the preview, from the same facts the run decides by. Reads git in
 * the cache clone only; never clones and never checks anything out.
 */
export async function taskBuiltOn(clientId: string, taskId: string, dirHint?: string | null): Promise<TaskBuiltOn> {
  const [t] = await withTenant(clientId, (tx) => tx.select().from(task).where(eq(task.id, taskId)).limit(1));
  if (!t) throw new Error("משימה לא נמצאה");
  const [wi] = await withTenant(clientId, (tx) => tx.select({ key: workitem.key }).from(workitem).where(eq(workitem.id, t.workitemId)).limit(1));
  const r = await firstRepo(clientId, t.workitemId);
  const dir = dirHint !== undefined ? dirHint : r ? existingCheckout({ ...r, localPath: null }) : null;
  const branch = taskBranchName(wi?.key, t);
  const own = dir ? await taskCommitCount(dir, branch, t) : 0;

  if (own === 0) {
    const plan = await planTaskBase(clientId, t, wi?.key, dir);
    return {
      state: "planned",
      on: plan.on ? { id: plan.on.id, seq: plan.on.seq, intent: plan.on.intent, branch: plan.on.branch! } : null,
      missing: plan.missing.map((m) => ({ id: m.dep.id, seq: m.dep.seq, intent: m.dep.intent, state: m.dep.state, why: m.why })),
      onMoved: false, nowAvailable: [],
    };
  }

  const ids = [...(t.baseTaskId ? [t.baseTaskId] : []), ...(t.builtWithout as string[])];
  const rows = ids.length ? await withTenant(clientId, (tx) => tx.select().from(task).where(inArray(task.id, ids))) : [];
  const byId = new Map(rows.map((x) => [x.id, x]));
  const base = t.baseTaskId ? byId.get(t.baseTaskId) ?? null : null;
  let onMoved = false;
  if (base && dir && t.baseBranch && t.baseSha) {
    const tip = (await git(["rev-parse", "--verify", "--quiet", t.baseBranch], dir)).out;
    onMoved = !!tip && tip !== t.baseSha && (await git(["merge-base", "--is-ancestor", t.baseSha, tip], dir)).code === 0;
  }
  const without = (t.builtWithout as string[]).map((id) => byId.get(id)).filter((x): x is TaskRow => !!x && x.state !== "dropped");
  const nowAvailable: TaskBuiltOn["nowAvailable"] = [];
  for (const d of without) {
    const has = dir ? (await taskCommitCount(dir, taskBranchName(wi?.key, d), d)) > 0 : false;
    if (has || d.state === "done") nowAvailable.push({ id: d.id, seq: d.seq, intent: d.intent });
  }
  return {
    state: "built",
    on: base ? { id: base.id, seq: base.seq, intent: base.intent, branch: t.baseBranch ?? taskBranchName(wi?.key, base) } : null,
    missing: without.map((d) => ({ id: d.id, seq: d.seq, intent: d.intent, state: d.state, why: "not_in_base" as const })),
    onMoved, nowAvailable,
  };
}

/* ── a task's status (task-status.ts decides; this gathers the facts) ── */

/** The facts every task of a requirement's status is read from — one pass over the tasks, their runs and dependencies. */
async function statusFactsFor(clientId: string, workitemId: string): Promise<{ facts: Map<string, StatusFacts>; rows: TaskRow[] }> {
  const rows = await withTenant(clientId, (tx) => tx.select().from(task).where(eq(task.workitemId, workitemId)));
  const ids = rows.map((r) => r.id);
  const deps = ids.length ? await withTenant(clientId, (tx) => tx.select().from(taskDependency).where(inArray(taskDependency.taskId, ids))) : [];
  const runs = await db.select({ taskId: flowRun.taskId, state: flowRun.state, error: flowRun.error }).from(flowRun)
    .where(and(eq(flowRun.workitemId, workitemId), eq(flowRun.kind, "implement"))).orderBy(desc(flowRun.startedAt));
  const developed = new Set(runs.filter((r) => r.state === "done").map((r) => r.taskId));
  const lastRun = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (r.taskId && !lastRun.has(r.taskId)) lastRun.set(r.taskId, r);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const inPlay = (x: TaskRow | undefined): x is TaskRow => !!x && x.active && x.state !== "dropped";

  // Only a task built on another one needs git (did that one move since?) — read from the clone, never cloned.
  let dir: string | null | undefined;
  const clone = async () => {
    if (dir === undefined) { const r = await firstRepo(clientId, workitemId); dir = r ? existingCheckout({ ...r, localPath: null }) : null; }
    return dir;
  };

  const facts = new Map<string, StatusFacts>();
  for (const t of rows) {
    const last = lastRun.get(t.id);
    let running = liveTaskPhase(t.id);
    if (!running && t.kind === "check" && t.parentTaskId) {
      // A check is running when its task's run is at its step.
      const p = liveTaskPhase(t.parentTaskId);
      if ((p === "build" && t.checkKind === "build") || (p === "test" && t.checkKind !== "build")) running = p;
    }
    let onMoved: StatusFacts["onMoved"] = null;
    if (t.baseTaskId && t.baseBranch && t.baseSha && developed.has(t.id)) {
      const d = await clone();
      const tip = d ? (await git(["rev-parse", "--verify", "--quiet", t.baseBranch], d)).out : "";
      if (d && tip && tip !== t.baseSha && (await git(["merge-base", "--is-ancestor", t.baseSha, tip], d)).code === 0) onMoved = { seq: byId.get(t.baseTaskId)?.seq ?? 0 };
    }
    facts.set(t.id, {
      kind: t.kind, state: t.state, active: t.active, approved: !!t.approvedAt, inTfs: t.linkedAdoId != null, running,
      lastRunError: last?.state === "error" ? (last.error ?? "שגיאה") : null,
      developed: developed.has(t.id),
      checks: rows.filter((c) => c.parentTaskId === t.id && c.kind === "check" && c.state !== "dropped")
        .map((c) => ({ seq: c.seq, kind: c.checkKind, result: c.checkResult, cause: c.checkCause, active: c.active })),
      openDeps: deps.filter((d) => d.taskId === t.id).map((d) => byId.get(d.dependsOnTaskId))
        .filter((d): d is TaskRow => inPlay(d) && d.kind === "task" && d.state !== "done")
        .map((d) => ({ seq: d.seq, developed: developed.has(d.id) })),
      builtWithout: (t.builtWithout as string[]).map((id) => byId.get(id)).filter(inPlay)
        .map((d) => ({ seq: d.seq, available: developed.has(d.id) || d.state === "done" })),
      onMoved, checkResult: t.checkResult, checkCause: t.checkCause,
    });
  }
  return { facts, rows };
}

/** Every task of a requirement (and every check), by id: its status as a person reads it. */
export async function taskStatusesFor(clientId: string, workitemId: string): Promise<Record<string, TaskStatus>> {
  const { facts } = await statusFactsFor(clientId, workitemId);
  return Object.fromEntries([...facts].map(([id, f]) => [id, taskStatus(f)]));
}

/** One task's status, and its checks'. */
export async function taskStatusOf(clientId: string, taskId: string): Promise<{ status: TaskStatus; checks: Record<string, TaskStatus> }> {
  const [t] = await withTenant(clientId, (tx) => tx.select({ workitemId: task.workitemId }).from(task).where(eq(task.id, taskId)).limit(1));
  if (!t) throw new Error("משימה לא נמצאה");
  const { facts, rows } = await statusFactsFor(clientId, t.workitemId);
  const checks = rows.filter((c) => c.parentTaskId === taskId && c.kind === "check");
  return { status: taskStatus(facts.get(taskId)!), checks: Object.fromEntries(checks.map((c) => [c.id, taskStatus(facts.get(c.id)!)])) };
}

/**
 * The steps a task went through and the one it is at, from its development
 * runs (task-flow-steps.ts decides). A dependency waiting to come in is read
 * from the task's branch while it has code, and from what a run now would be
 * built on once that code was rolled back.
 */
export async function taskFlowOf(clientId: string, taskId: string): Promise<FlowStep[]> {
  const [t] = await withTenant(clientId, (tx) => tx.select().from(task).where(eq(task.id, taskId)).limit(1));
  if (!t || t.kind === "check") return [];
  const runs = await db.select({ state: flowRun.state, result: flowRun.result, startedAt: flowRun.startedAt }).from(flowRun)
    .where(and(eq(flowRun.taskId, taskId), eq(flowRun.kind, "implement"))).orderBy(flowRun.startedAt);
  const cycles: FlowCycle[] = runs.filter((r) => r.state !== "stopped").map((r) => {
    const res = r.result as Partial<ImplementResult> | null;
    const all = res?.checks ?? [];
    const after = all.filter((c) => c.kind !== "build");
    return {
      state: r.state as FlowCycle["state"], startedAt: r.startedAt.toISOString(), base: res?.base,
      buildVerified: all.some((c) => c.kind === "build"),
      buildFailed: all.some((c) => c.kind === "build" && !c.passed) || !!res?.skipped?.length,
      checks: {
        ran: after.length, passed: after.filter((c) => c.passed).length,
        failed: after.filter((c) => !c.passed && c.likelyCause !== "dependency_missing").length,
        waiting: after.filter((c) => !c.passed && c.likelyCause === "dependency_missing").length,
      },
      reviewed: !!(res?.pushedAt || res?.closedAt),
    };
  });

  let pendingDeps: number[] = [];
  const last = cycles.at(-1);
  if (last?.state === "done") {
    const f = (await statusFactsFor(clientId, t.workitemId)).facts.get(taskId);
    pendingDeps = [...(f?.builtWithout.filter((d) => d.available).map((d) => d.seq) ?? []), ...(f?.onMoved ? [f.onMoved.seq] : [])];
  } else if (last?.state === "rolled_back") {
    const lastBase = cycles.findLast((c) => c.base)?.base;
    if (lastBase) {
      const plan = await taskBuiltOn(clientId, taskId).catch(() => null);
      if (plan) pendingDeps = gainedDeps(lastBase, { on: plan.on ? { seq: plan.on.seq, sha: null } : null, without: plan.missing.map((m) => m.seq) });
    }
  }
  return flowSteps(cycles, { running: liveTaskPhase(taskId), closed: t.state === "done", pendingDeps: [...new Set(pendingDeps)] });
}

/** What keeps a task from being closed on the dependency side: its dependencies not done, work it was developed without, a base that moved. */
export async function taskDoneBlockers(clientId: string, taskId: string): Promise<string[]> {
  const [t] = await withTenant(clientId, (tx) => tx.select({ workitemId: task.workitemId, kind: task.kind }).from(task).where(eq(task.id, taskId)).limit(1));
  if (!t || t.kind === "check") return [];
  const { facts } = await statusFactsFor(clientId, t.workitemId);
  const f = facts.get(taskId);
  return f ? dependencyBlockers(f) : [];
}

/** The two prompt values that say what the branch holds and what it does not. */
const builtOnVars = (b: TaskBuiltOn) => ({
  BUILT_ON: b.on ? depLabel(b.on) : "",
  MISSING: b.missing.map(depLabel).join(", "),
});

/** The requirement a task came from, as the prompts carry it: its title and its notes, in order. */
async function requirementContext(clientId: string, workitemId: string) {
  return withTenant(clientId, async (tx) => {
    const [wi] = await tx.select().from(workitem).where(eq(workitem.id, workitemId)).limit(1);
    const n = await tx.execute<{ body: string }>(
      sql`select payload->>'body' as body from event_log
          where workitem_id = ${workitemId} and type = 'note.added' and supersedes is null
          order by occurred_at asc limit 20`,
    );
    const notes = ((n.rows ?? n) as { body: string }[]).filter((x) => x.body);
    return { wi, ctx: [`Requirement ${wi?.key ?? ""}: ${wi?.title ?? ""}`, ...notes.map((x) => x.body)].join("\n\n").slice(0, 6000) };
  });
}

/** DB reads (and, for a check, what its task changed in the clone) — the
 *  prompt's TEXT is the same for the real run and the preview. A task is told
 *  to write the code and the tests for it (implement.task); its checks run
 *  after it, separately (checks.run). A check run on its own is that one
 *  check, on its task's branch. */
async function buildImplementPrompt(input: { clientId: string; workitemId: string; taskId: string }, built?: TaskBuiltOn | null) {
  const [t] = await withTenant(input.clientId, (tx) => tx.select().from(task).where(eq(task.id, input.taskId)).limit(1));
  if (!t) throw new Error("task not found");
  // The task's own prompt is the instruction — written by the breakdown,
  // reviewed and possibly edited by the user before approval. It is what
  // runs, verbatim; `intent` is only the fallback for older tasks.
  const instruction = (t.prompt ?? "").trim() || t.intent;

  if (t.kind === "check") {
    const [owner] = t.parentTaskId ? await withTenant(input.clientId, (tx) => tx.select().from(task).where(eq(task.id, t.parentTaskId!)).limit(1)) : [];
    if (!owner) throw new Error("לבדיקה הזו אין משימה שהיא בודקת — אין מה לאמת");
    const r = await firstRepo(input.clientId, input.workitemId);
    const dir = r ? existingCheckout({ ...r, localPath: null }) : null;
    const b = built !== undefined ? built : await taskBuiltOn(input.clientId, owner.id, dir).catch(() => null);
    const c = await buildChecksPrompt(input.clientId, owner, [t], b, dir);
    return { prompt: c.prompt, promptHe: c.promptHe, instruction, t, wi: c.wi, hasChecks: false };
  }

  const { wi, ctx } = await requirementContext(input.clientId, input.workitemId);
  const tmpl = await requirePrompt("implement.task");
  const vars = {
    INSTRUCTION: instruction,
    SHORT_TITLE: (t.prompt ?? "").trim() && t.prompt!.trim() !== t.intent ? t.intent : "",
    AFFECTED_PATHS: (t.affectedPaths as string[]).join(", "),
    APPETITE: t.appetite,
    CONTEXT: ctx,
    // What the branch already holds of the work this task depends on, and what it does not.
    ...(built ? builtOnVars(built) : {}),
  };
  const prompt = renderPrompt(tmpl.body, vars);
  const promptHe = tmpl.bodyHe ? renderPrompt(tmpl.bodyHe, vars) : prompt;
  const [counted] = await withTenant(input.clientId, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(task)
    .where(and(eq(task.parentTaskId, t.id), eq(task.kind, "check"), eq(task.active, true), sql`${task.state} <> 'dropped'`)));
  return { prompt, promptHe, instruction, t, wi, hasChecks: (counted?.n ?? 0) > 0 };
}

/** A task's checks as one run without write access (checks.run): what the task
 *  did, what it changed, what its branch holds of its dependencies, and the
 *  checks numbered by their seq so each verdict comes back to its own row. */
async function buildChecksPrompt(clientId: string, owner: TaskRow, checks: TaskRow[], built: TaskBuiltOn | null, dir: string | null) {
  const { wi, ctx } = await requirementContext(clientId, owner.workitemId);
  const branch = taskBranchName(wi?.key, owner);
  let changed = "(not known here — read this branch's own commits)";
  if (dir && (await git(["rev-parse", "--verify", "--quiet", branch], dir)).code === 0) {
    const from = await taskBaseSha(dir, branch, owner);
    const files = from ? (await git(["diff", "--name-only", `${from}..${branch}`], dir)).out.split("\n").map((x) => x.trim()).filter(Boolean) : [];
    changed = files.length ? files.join(", ") : "(none — this task changed no files)";
  }
  const tmpl = await requirePrompt("checks.run");
  const vars = {
    INTENT: owner.intent, CHANGED_FILES: changed, CONTEXT: ctx,
    CHECKS: checks.map((c) => `#${c.seq}${c.checkKind ? ` [${c.checkKind}]` : ""}: ${(c.prompt ?? "").trim() || c.intent}`).join("\n"),
    ...(built ? builtOnVars(built) : {}),
  };
  const prompt = renderPrompt(tmpl.body, vars);
  return { prompt, promptHe: tmpl.bodyHe ? renderPrompt(tmpl.bodyHe, vars) : prompt, wi };
}

/* ── the checks DCC adds to every task ─────────────────────────────── */

/** How each check DCC adds is named on the task — its instruction is the matching `check.<kind>` prompt. */
export const STANDARD_CHECK_INTENT: Record<CheckKind, string> = {
  build: "Build לרכיבים המתקמפלים",
  tests: "בדיקות לפיתוח",
  regression: "בדיקות רגרסיה",
  e2e: "בדיקות E2E",
};
/** The ones every task gets; E2E is added on request. */
export const REQUIRED_CHECKS: CheckKind[] = ["build", "tests", "regression"];

/**
 * Add the checks DCC requires of a task that it does not have yet — each with
 * its own copy of the `check.<kind>` prompt, filled with the task's compiled
 * projects and files, editable on the task afterwards. Only a task that is
 * built itself: one with sub-tasks is a grouping node, and its sub-tasks are
 * the ones built and tested. Idempotent. Returns the names of what it added.
 */
export async function ensureStandardChecks(clientId: string, taskId: string, kinds: CheckKind[] = REQUIRED_CHECKS, opts?: { quiet?: boolean; by?: Dev }): Promise<string[]> {
  const [t] = await withTenant(clientId, (tx) => tx.select().from(task).where(eq(task.id, taskId)).limit(1));
  if (!t || t.kind !== "task" || t.state === "dropped") return [];
  const children = await withTenant(clientId, (tx) => tx.select().from(task).where(and(eq(task.parentTaskId, t.id), sql`${task.state} <> 'dropped'`)));
  if (children.some((c) => c.kind === "task")) return [];
  const have = new Set(children.filter((c) => c.kind === "check" && c.checkKind).map((c) => c.checkKind));
  const missing = kinds.filter((k) => !have.has(k));
  if (!missing.length) return [];

  const vars = { COMPILED: (t.compiledComponents as string[]).join(", "), PATHS: (t.affectedPaths as string[]).join(", "), INTENT: t.intent };
  const rows: { kind: CheckKind; prompt: string }[] = [];
  for (const k of missing) rows.push({ kind: k, prompt: renderPrompt((await requirePrompt(`check.${k}`)).body, vars).trim() });
  await withTenant(clientId, async (tx) => {
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`coalesce(max(${task.seq}), 0)::int` }).from(task).where(eq(task.workitemId, t.workitemId));
    let seq = n;
    for (const r of rows) {
      await tx.insert(task).values({
        clientId, workitemId: t.workitemId, seq: ++seq, kind: "check", checkKind: r.kind, intent: STANDARD_CHECK_INTENT[r.kind],
        appetite: "small", origin: t.origin, state: "pending", parentTaskId: t.id, prompt: r.prompt,
        approvedAt: t.approvedAt, approvedBy: t.approvedBy,
      });
    }
  });
  const names = missing.map((k) => STANDARD_CHECK_INTENT[k]);
  if (!opts?.quiet) {
    await appendEvent({
      clientId, workitemId: t.workitemId, source: "claude_session", type: "note.added",
      actor: opts?.by ? { kind: "user", userId: opts.by.userId, identityType: "interactive" } : { kind: "system", process: "dcc:standard-checks" },
      links: [{ rel: "task", ref: t.id }],
      payload: { body: `🧪 נוספו למשימה #${t.seq} בדיקות: ${names.join(", ")}` },
    });
  }
  return names;
}

/**
 * Tasks from before DCC added checks by itself get them — at startup, once:
 * an open task that has none of them (a grouping task is passed over by
 * ensureStandardChecks). Each gets a note saying so. After the first time
 * there is nothing to find, and this is one query.
 */
export async function backfillStandardChecks(): Promise<number> {
  const rows = await withoutTenant((tx) => tx.select({ id: task.id, clientId: task.clientId }).from(task).where(sql`${task.kind} = 'task' and ${task.active} = true and ${task.state} not in ('done', 'dropped')
      and not exists (select 1 from task c where c.parent_task_id = ${task.id} and c.check_kind is not null)`));
  let n = 0;
  for (const r of rows) if ((await ensureStandardChecks(r.clientId, r.id)).length) n++;
  return n;
}

/* ── the checks step: no write access, one verdict per check ──────── */

type CheckOutcome = NonNullable<ImplementResult["checks"]>[number];
const CHECK_CAUSES = ["implementation", "requirement_ambiguity", "dependency_missing", "environment"] as const;

/**
 * Run some of a task's checks as one call that may read and run commands but
 * not edit (checks.run), and write each verdict to its own row. A check that
 * needs work the branch does not have yet waits; one that could not run here
 * says so; one Claude did not report is left "not run". Whatever a check
 * changed in tracked files is put back — a check that changes code proves nothing.
 */
async function runChecksStep(input: { clientId: string; workitemId: string; by: Dev; runId?: string; trigger?: CallTrigger }, dir: string, owner: TaskRow, checks: TaskRow[], built: TaskBuiltOn | null): Promise<{ summary: string; checks: CheckOutcome[] }> {
  const { prompt } = await buildChecksPrompt(input.clientId, owner, checks, built, dir);
  const res = await runClaudeJson<{ summary?: string; checks?: { seq: number; passed: boolean; detail?: string; likelyCause?: string | null }[] }>(dir, prompt, {
    timeoutMs: 900_000, runId: input.runId, commands: true,
    ledger: {
      clientId: input.clientId, userId: input.by.userId, capability: "execution", trigger: input.trigger ?? "button",
      entity: { kind: "task", id: owner.id }, workitemId: input.workitemId, screen: "task",
      label: `בדיקות משימה #${owner.seq}: ${checks.map((c) => `#${c.seq}`).join(", ")}`,
      signals: { mechanical: true }, meta: { taskSeq: owner.seq, check: true },
    },
  });
  const dirty = (await git(["status", "--porcelain", "--untracked-files=no"], dir)).out.trim();
  if (dirty) {
    await git(["reset", "--hard"], dir);
    pushLine(input.runId, "⚠ בזמן הבדיקות השתנו קבצים במאגר — השינוי בוטל: בדיקה לא משנה קוד");
  }

  const reported = new Map((res.checks ?? []).map((c) => [Number(c.seq), c]));
  const outcomes: CheckOutcome[] = [];
  for (const c of checks) {
    const cr = reported.get(c.seq);
    const cause = cr && !cr.passed ? ((CHECK_CAUSES as readonly string[]).includes(cr.likelyCause ?? "") ? cr.likelyCause as (typeof CHECK_CAUSES)[number] : "implementation") : null;
    const result = !cr ? null : cr.passed ? "passed" : cause === "dependency_missing" ? "waiting" : "failed";
    await withTenant(input.clientId, (tx) => tx.update(task).set({
      checkResult: result, checkCause: cause, state: result === "passed" ? "done" : "pending", updatedAt: new Date(),
    }).where(eq(task.id, c.id)));
    const detail = cr ? (cr.detail ?? "") : "Claude לא דיווח על הבדיקה הזו — היא לא רצה";
    const mark = result === "passed" ? "✓" : result === "waiting" ? "⏸" : result === null ? "·" : "✕";
    const note = result === "waiting" ? " מחכה לתלות" : cause === "environment" ? " לא יכלה לרוץ כאן" : "";
    await appendEvent({
      clientId: input.clientId, workitemId: input.workitemId, source: "claude_session", type: "note.added",
      actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "dcc:implement" },
      links: [{ rel: "task", ref: c.id }],
      payload: { body: `${mark} בדיקה #${c.seq}${note}: ${detail}${cause === "requirement_ambiguity" ? "\n(נראה כמו עמימות בדרישה, לא באג — כדאי לבדוק שלבים מוקדמים)" : ""}` },
    });
    outcomes.push({ seq: c.seq, kind: c.checkKind, passed: result === "passed", detail, likelyCause: cause });
    pushLine(input.runId, `${mark} בדיקה #${c.seq} ${c.intent.slice(0, 50)}${note}`);
  }
  return { summary: res.summary ?? "", checks: outcomes };
}

/** A task's own checks that are in play, in order. */
const checksOf = (clientId: string, taskId: string) => withTenant(clientId, (tx) => tx.select().from(task)
  .where(and(eq(task.parentTaskId, taskId), eq(task.kind, "check"), eq(task.active, true), sql`${task.state} <> 'dropped'`)).orderBy(task.seq));

export async function previewImplementPrompt(input: { clientId: string; workitemId: string; taskId: string }): Promise<{ prompt: string; promptHe: string; approved: boolean }> {
  // The same facts a run would decide by, read from the clone as it is now — so the preview says what will be sent.
  const built = await taskBuiltOn(input.clientId, input.taskId).catch(() => null);
  const { prompt, promptHe, t } = await buildImplementPrompt(input, built);
  return { prompt, promptHe, approved: t.approvedAt != null };
}

async function runImplement(input: { clientId: string; workitemId: string; taskId: string; by: Dev; runId?: string; trigger?: CallTrigger }): Promise<ImplementResult> {
  const [t0] = await withTenant(input.clientId, (tx) => tx.select().from(task).where(eq(task.id, input.taskId)).limit(1));
  if (!t0) throw new Error("task not found");
  // Defense in depth — the API route already refuses this before a run is
  // even queued, but a run only ever does what this function lets it do.
  if (!t0.approvedAt) throw new Error("המשימה טרם אושרה — אי אפשר לפתח לפני אישור.");
  const [wi] = await withTenant(input.clientId, (tx) => tx.select({ key: workitem.key }).from(workitem).where(eq(workitem.id, input.workitemId)).limit(1));
  const t = t0;
  const isCheck = t.kind === "check";

  const r = await firstRepo(input.clientId, input.workitemId);
  if (!r) throw new Error("אין repository מקושר לדרישה — אי אפשר לפתח בלי קוד");
  // Deliberately the CACHE clone, never r.localPath: an autonomous write
  // run must not touch the user's own working copy — so the "already have
  // it?" check below must ask about that same cache clone, not r.localPath.
  pushLine(input.runId, checkoutStartLine({ ...r, localPath: null }));
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
  let built: TaskBuiltOn | null = null;
  let baseSha: string | null = t.baseSha;
  if (isCheck) {
    const exists = await git(["rev-parse", "--verify", "--quiet", branch], dir);
    if (exists.code !== 0) throw new Error(`אין branch בשם ${branch} — המשימה שהבדיקה הזו שייכת לה עוד לא פותחה, אין מה לאמת`);
    await git(["checkout", branch], dir);
  } else if ((await taskCommitCount(dir, branch, t)) > 0) {
    // Work of its own already there: continue on it, on what it was built on.
    await git(["checkout", branch], dir);
    built = await taskBuiltOn(input.clientId, input.taskId, dir);
  } else {
    // A first run, or one after a rollback: decide now what the branch starts
    // from — the one dependency whose work exists but is not in the default
    // branch yet, or the default branch (task-base.ts) — and record it.
    const def = await defaultBranch(dir);
    const plan = await planTaskBase(input.clientId, t, wi?.key, dir);
    const from = plan.on?.branch ?? def;
    baseSha = (await git(["rev-parse", from], dir)).out;
    await git(["checkout", "-B", branch, from], dir);
    await withTenant(input.clientId, (tx) => tx.update(task).set({
      baseTaskId: plan.on?.id ?? null, baseBranch: from, baseSha, builtWithout: plan.missing.map((m) => m.dep.id), updatedAt: new Date(),
    }).where(eq(task.id, t.id)));
    built = {
      state: "built", onMoved: false, nowAvailable: [],
      on: plan.on ? { id: plan.on.id, seq: plan.on.seq, intent: plan.on.intent, branch: from } : null,
      missing: plan.missing.map((m) => ({ id: m.dep.id, seq: m.dep.seq, intent: m.dep.intent, state: m.dep.state, why: m.why })),
    };
    if (plan.on) pushLine(input.runId, `בונה על גבי הענף של משימה #${plan.on.seq} — העבודה שלה עוד לא בענף הראשי, וקלוד יראה אותה`);
    if (plan.missing.length) pushLine(input.runId, `⚠ מפתח בלי ${plan.missing.map((m) => `#${m.dep.seq}`).join(", ")} — העבודה שלהן עוד לא קיימת בקוד. בדיקות שצריכות אותה יסומנו "מחכות לתלות"`);
  }

  if (isCheck) {
    // A check on its own: that one check, on its task's branch, with no write access.
    setPhase(input.runId, "test");
    const ownerBuilt = await taskBuiltOn(input.clientId, branchOwner.id, dir).catch(() => null);
    const step = await runChecksStep(input, dir, branchOwner, [t], ownerBuilt);
    await syncTaskStateAfterCheckChange(input.clientId, branchOwner.id, { attempted: true });
    await appendEvent({
      clientId: input.clientId, workitemId: input.workitemId, source: "claude_session", type: "note.added",
      actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "dcc:implement" },
      links: [{ rel: "task", ref: input.taskId }],
      payload: { body: `🔍 Claude אימת בדיקה #${t.seq}: ${t.intent.slice(0, 70)}\n\n${step.summary}` },
    });
    await regenerateBrief(input.clientId, input.workitemId);
    return { branch, dir, repoName: r.name, summary: step.summary, filesChanged: [], commit: null, testsRun: null, followUps: [], affectedConsumers: [], checks: step.checks };
  }

  // Kept on the run from the start, so a run that fails still says what it was built on.
  const base: FlowBase | undefined = built
    ? { on: built.on ? { seq: built.on.seq, sha: baseSha } : null, without: built.missing.map((m) => m.seq) }
    : undefined;
  if (base && input.runId) await db.update(flowRun).set({ result: { base } }).where(eq(flowRun.id, input.runId));

  // Every task is verified the same way — the checks DCC requires are there
  // before it runs; a task from before they existed gets them now.
  const added = await ensureStandardChecks(input.clientId, t.id, REQUIRED_CHECKS, { by: input.by });
  if (added.length) pushLine(input.runId, `נוספו למשימה בדיקות חובה: ${added.join(", ")}`);

  // 1 — development: the code, and the tests for it. The checks are not reported here.
  setPhase(input.runId, "develop");
  pushLine(input.runId, "שלב 1 מתוך 3 — פיתוח");
  const { prompt, instruction } = await buildImplementPrompt(input, built);
  pushLine(input.runId, `הפרומט של המשימה:\n${instruction}`);

  const res = await runClaudeJson<{
    summary: string; filesChanged?: string[]; testsRun?: string | null; followUps?: string[];
    affectedConsumers?: { path: string; usedBy?: string[]; reason: string }[];
  }>(dir, prompt, {
    timeoutMs: 900_000, runId: input.runId, write: true,
    ledger: {
      clientId: input.clientId, userId: input.by.userId, capability: "execution", trigger: input.trigger ?? "button",
      entity: { kind: "task", id: input.taskId }, workitemId: input.workitemId, screen: "task",
      label: `פיתוח משימה #${t.seq}: ${t.intent.slice(0, 60)}`,
      signals: { mechanical: false }, meta: { taskSeq: t.seq, check: false },
    },
  });

  let commit: string | null = null;
  pushLine(input.runId, "מקומיט מקומית (בלי push)…");
  await git(["add", "-A"], dir);
  const stat = await git(["diff", "--cached", "--name-only"], dir);
  const changed = stat.out.split("\n").map((x) => x.trim()).filter(Boolean);
  if (changed.length > 0) {
    const msg = `${wi?.key ?? "REQ"} t${t.seq}: ${t.intent.slice(0, 90)}\n\nDCC task ${t.id}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
    const identity = await resolveCommitIdentity(input.by.userId);
    const c = await git(["-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-m", msg], dir);
    if (c.code === 0) commit = (await git(["rev-parse", "--short", "HEAD"], dir)).out;
    pushLine(input.runId, commit ? `✓ commit ${commit} · ${changed.length} קבצים` : `commit נכשל: ${c.out.slice(0, 200)}`);
    // Code that changed moves the task to in_progress; the checks below decide from there.
    await withTenant(input.clientId, (tx) => tx.update(task).set({ state: "in_progress", updatedAt: new Date() }).where(eq(task.id, input.taskId)));
  } else {
    pushLine(input.runId, "לא השתנו קבצים");
  }

  // 2 — the build; 3 — every other check, only once it builds. No write access in either.
  const checks = await checksOf(input.clientId, t.id);
  const buildChecks = checks.filter((c) => c.checkKind === "build");
  const rest = checks.filter((c) => c.checkKind !== "build");
  const outcomes: CheckOutcome[] = [];
  let skipped: number[] = [];
  if (buildChecks.length) {
    setPhase(input.runId, "build");
    pushLine(input.runId, "שלב 2 מתוך 3 — Build");
    outcomes.push(...(await runChecksStep(input, dir, t, buildChecks, built)).checks);
  }
  if (rest.length) {
    if (outcomes.every((o) => o.passed)) {
      setPhase(input.runId, "test");
      pushLine(input.runId, "שלב 3 מתוך 3 — בדיקות");
      outcomes.push(...(await runChecksStep(input, dir, t, rest, built)).checks);
    } else {
      // Tests of code that does not build say nothing — they wait for the build to pass.
      skipped = rest.map((c) => c.seq);
      await withTenant(input.clientId, (tx) => tx.update(task).set({ checkResult: null, checkCause: null, state: "pending", updatedAt: new Date() }).where(inArray(task.id, rest.map((c) => c.id))));
      pushLine(input.runId, `⚠ ה-Build לא עבר — ${rest.length} הבדיקות האחרות לא רצו`);
    }
  }
  await syncTaskStateAfterCheckChange(input.clientId, input.taskId, { attempted: true });

  const passed = outcomes.filter((o) => o.passed).length;
  const waiting = outcomes.filter((o) => o.likelyCause === "dependency_missing").length;
  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "claude_session", type: "note.added",
    actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "dcc:implement" },
    links: [{ rel: "task", ref: input.taskId }],
    payload: {
      body: `🛠 Claude פיתח משימה #${t.seq}: ${t.intent.slice(0, 70)}\nbranch ${branch}${commit ? ` · commit ${commit}` : " · ללא שינויים"}`
        + `${outcomes.length ? ` · ${passed}/${outcomes.length} בדיקות עברו` : ""}${waiting ? `, ${waiting} מחכות לתלות` : ""}${skipped.length ? `, ${skipped.length} לא רצו — ה-Build לא עבר` : ""}\n\n${res.summary}`,
    },
  });
  await regenerateBrief(input.clientId, input.workitemId);

  return {
    branch, dir, repoName: r.name, summary: res.summary,
    filesChanged: changed.length ? changed : res.filesChanged ?? [],
    commit, testsRun: res.testsRun ?? null, followUps: res.followUps ?? [],
    affectedConsumers: (res.affectedConsumers ?? []).map((c) => ({ path: c.path, usedBy: c.usedBy ?? [], reason: c.reason })),
    ...(outcomes.length ? { checks: outcomes } : {}),
    ...(skipped.length ? { skipped } : {}),
    ...(base ? { base } : {}),
  };
}

/** Adds to the result of a task's latest development run that finished — it was pushed, or the task was closed on it. */
export async function markLatestRun(taskId: string, patch: Pick<ImplementResult, "pushedAt" | "closedAt">): Promise<void> {
  const [r] = await db.select({ id: flowRun.id, result: flowRun.result }).from(flowRun)
    .where(and(eq(flowRun.taskId, taskId), eq(flowRun.kind, "implement"), eq(flowRun.state, "done")))
    .orderBy(desc(flowRun.startedAt)).limit(1);
  if (r) await db.update(flowRun).set({ result: { ...(r.result as Record<string, unknown> | null ?? {}), ...patch } }).where(eq(flowRun.id, r.id));
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
  await git(["fetch", "origin", await defaultBranch(dir)], dir);
  // Back to where the task's own work starts — which is the branch of the
  // task it was built on, when it was built on one, never further.
  const from = await taskBaseSha(dir, branch, t);
  if (from) await git(["reset", "--hard", from], dir);
  await git(["clean", "-fd"], dir);

  // What it was built on is forgotten too: the next run decides again, from
  // what exists by then — this is how a task developed before its dependency
  // comes to build on it once that dependency has been developed.
  await withTenant(input.clientId, (tx) =>
    tx.update(task).set({
      state: t.state === "in_progress" ? "pending" : t.state,
      baseTaskId: null, baseBranch: null, baseSha: null, builtWithout: [],
      updatedAt: new Date(),
    }).where(eq(task.id, input.taskId)),
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
export function httpsRepoUrl(remote: string): string | null {
  const ssh = remote.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = remote.match(/^https?:\/\/([^/]+)\/(.+?)(\.git)?$/);
  if (https) return `https://${https[1]}/${https[2]}`;
  return null;
}

export type PushResult = {
  pushed: boolean; reason?: string; branch?: string; branchUrl?: string; compareUrl?: string;
  /** The branch a pull request for it should target: the default branch, or the branch of the task it is built on. */
  base?: string;
  /** Something the person must know before opening the request — said in words. */
  note?: string;
};

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
  const commits = await taskCommitCount(dir, branch, t);
  if (commits === 0) return { pushed: false, reason: "אין קוד מומש על המשימה הזו — אין מה לדחוף" };

  await git(["checkout", branch], dir);
  const res = await git(["push", "-u", "origin", branch], dir, { timeoutMs: 25_000 });
  if (res.code !== 0) return { pushed: false, reason: `push נכשל: ${res.out.slice(0, 400)}` };

  const remote = (await git(["remote", "get-url", "origin"], dir)).out;
  const def = await defaultBranch(dir);
  // A task built on another task's branch is reviewed against that branch —
  // against the default one its request would carry the other task's work too.
  // Once that work is in the default branch, the default branch is right again.
  let base = def;
  let note: string | undefined;
  if (t.baseTaskId && t.baseBranch && t.baseBranch !== def) {
    await git(["fetch", "origin", def], dir, { timeoutMs: 25_000 });
    const merged = (await git(["merge-base", "--is-ancestor", t.baseBranch, `origin/${def}`], dir)).code === 0;
    const onHost = (await git(["ls-remote", "--exit-code", "--heads", "origin", t.baseBranch], dir, { timeoutMs: 25_000 })).code === 0;
    const [on] = await withTenant(input.clientId, (tx) => tx.select({ seq: task.seq }).from(task).where(eq(task.id, t.baseTaskId!)).limit(1));
    const label = on ? `#${on.seq}` : "המשימה שהיא בנויה עליה";
    if (!merged && onHost) base = t.baseBranch;
    else if (!merged) note = `המשימה בנויה על גבי הענף של ${label}, והענף הזה לא נמצא ב-GitHub. אם ${label} עוד לא נדחפה — דחפו אותה קודם, ואז פתחו את בקשת המיזוג של המשימה הזו מול הענף שלה (${t.baseBranch}); בקשה מול ${def} תכלול גם את העבודה של ${label}. אם ${label} כבר מוזגה — פתחו מול ${def}.`;
  }
  const httpsBase = httpsRepoUrl(remote);
  const branchUrl = httpsBase ? `${httpsBase}/tree/${encodeURIComponent(branch)}` : undefined;
  const compareUrl = httpsBase ? `${httpsBase}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1` : undefined;

  await markLatestRun(input.taskId, { pushedAt: new Date().toISOString() });
  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "git", type: "note.added",
    actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
    links: [{ rel: "task", ref: input.taskId }],
    payload: { body: `⬆ הקוד של משימה #${t.seq} (${t.intent.slice(0, 60)}) נדחף ל-GitHub — branch ${branch}.` },
  });
  await regenerateBrief(input.clientId, input.workitemId);

  return { pushed: true, branch, branchUrl, compareUrl, base, ...(note ? { note } : {}) };
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
      commitCounts.set(t.id, await taskCommitCount(dir, taskBranchName(wi?.key, t), t));
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
  // A task approved without them (created before they existed, or by hand) gets the checks DCC requires now — approved with it.
  await ensureStandardChecks(clientId, taskId, REQUIRED_CHECKS, { by });

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
