import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";

/**
 * Runs one agent process with its caps (protocol 3.2 and 17.3) and reads its
 * event stream (Claude Code's stream-json shape: one JSON object per line,
 * `assistant` events per turn and a final `result` event).
 *
 * CAPS THE RUNNER ENFORCES ITSELF: wall-clock time and number of turns (it
 * counts `assistant` events and stops the process tree when the cap is
 * passed), and the size of the output.
 * THE BUDGET: Claude Code does not stream cost while it runs, only the total
 * in `result`. Enforcing a budget during the run needs token counts times a
 * price table, which the protocol fixes only at Freeze 2; so here the budget
 * is enforced by the agent's own flag and checked after the run. A run that
 * ends above its budget without being stopped is reported, not reclassified.
 *
 * STATUSES OF THE RUN AND THEIR PROTOCOL READING:
 *   COMPLETED  a result event and exit 0; success is graded elsewhere (10.1).
 *   CAPPED     stopped at a cap: INCOMPLETE (3.2), a failed run in the primary
 *              analysis and missing in the sensitivity analysis.
 *   ABORTED    stopped by the harness or the machine from outside: INVALID
 *              (17.3), re-run with the same seed.
 *   CRASHED    the agent's process ended without a result, not at a cap and
 *              not from outside. The protocol does not define this case
 *              (17.3 lists a crash of the harness or the machine, and a lost
 *              model endpoint before the agent acted); reported as UNDEFINED.
 */

export type Caps = { wallMs: number; maxTurns: number; maxOutputBytes: number; maxCostUsd?: number };
export type RunnerStatus = "COMPLETED" | "CAPPED" | "ABORTED" | "CRASHED";
export type ProtocolStatus = "COMPLETED" | "INCOMPLETE" | "INVALID" | "UNDEFINED";

export const PROTOCOL_STATUS: Record<RunnerStatus, ProtocolStatus> = { COMPLETED: "COMPLETED", CAPPED: "INCOMPLETE", ABORTED: "INVALID", CRASHED: "UNDEFINED" };

export type ProcessResult = {
  status: RunnerStatus;
  protocolStatus: ProtocolStatus;
  reason: string;
  exitCode: number | null;
  turns: number;
  resultEvent: Record<string, unknown> | null;
  costUsd: number | null;
  costAboveCapWithoutStop: boolean;
  durationMs: number;
  events: Record<string, unknown>[];
  unparsedLines: number;
};

function killTree(pid: number): void {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch { /* already gone */ }
}

export function runProcess(o: {
  command: string; args: readonly string[]; cwd: string; env: Record<string, string>; caps: Caps;
  stdoutPath: string; stderrPath: string; signal?: AbortSignal;
}): Promise<ProcessResult> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(o.command, o.args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
    const out = createWriteStream(o.stdoutPath);
    const err = createWriteStream(o.stderrPath);
    const events: Record<string, unknown>[] = [];
    let buffer = "", bytes = 0, turns = 0, unparsed = 0;
    let resultEvent: Record<string, unknown> | null = null;
    let stopped: { status: RunnerStatus; reason: string } | null = null;
    const stop = (status: RunnerStatus, reason: string) => {
      if (stopped) return;
      stopped = { status, reason };
      if (child.pid !== undefined) killTree(child.pid);
    };
    const timer = setTimeout(() => stop("CAPPED", `wall-clock cap ${o.caps.wallMs} ms`), o.caps.wallMs);
    const onAbort = () => stop("ABORTED", "stopped from outside the run");
    o.signal?.addEventListener("abort", onAbort, { once: true });
    if (o.signal?.aborted) onAbort();

    const onLine = (line: string) => {
      if (!line.trim()) return;
      let ev: Record<string, unknown>;
      try { ev = JSON.parse(line) as Record<string, unknown>; } catch { unparsed++; return; }
      events.push(ev);
      if (ev.type === "assistant") {
        turns++;
        if (turns > o.caps.maxTurns) stop("CAPPED", `turn cap ${o.caps.maxTurns}`);
      }
      if (ev.type === "result") resultEvent = ev;
    };
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      out.write(chunk);
      if (bytes > o.caps.maxOutputBytes) { stop("CAPPED", `output cap ${o.caps.maxOutputBytes} bytes`); return; }
      buffer += chunk.toString("utf8");
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) { onLine(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
    });
    child.stderr.on("data", (chunk: Buffer) => err.write(chunk));
    child.on("error", (e) => stop("CRASHED", `could not start: ${e.message}`));
    child.on("close", (code) => {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
      if (buffer) onLine(buffer);
      out.end(); err.end();
      const r = resultEvent as Record<string, unknown> | null;
      const cost = r && typeof r.total_cost_usd === "number" ? r.total_cost_usd : null;
      let final: { status: RunnerStatus; reason: string };
      if (stopped) final = stopped;
      else if (r && code === 0) final = { status: "COMPLETED", reason: "result event and exit 0" };
      else final = { status: "CRASHED", reason: r ? `result event but exit ${code}` : `exit ${code} without a result event` };
      resolve({
        status: final.status, protocolStatus: PROTOCOL_STATUS[final.status], reason: final.reason, exitCode: code,
        turns, resultEvent: r, costUsd: cost,
        costAboveCapWithoutStop: final.status === "COMPLETED" && cost !== null && o.caps.maxCostUsd !== undefined && cost > o.caps.maxCostUsd,
        durationMs: Date.now() - t0, events, unparsedLines: unparsed,
      });
    });
  });
}
