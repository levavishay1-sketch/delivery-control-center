import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, rmSync } from "node:fs";

/**
 * Runs one agent process with its caps (protocol 3.2 and 17.3) and reads its
 * event stream (Claude Code's stream-json shape: one JSON object per line,
 * `assistant` events per turn and a final `result` event).
 *
 * STOPPING THE TREE. On Windows the agent runs inside a Job Object through
 * job-run.exe (runner/job-run.cs). Terminating that helper closes the job and
 * the kernel kills every process in it, descendants included, at once; when
 * the agent exits by itself, the helper exits and whatever it left running
 * is killed the same way. Without the helper (or on POSIX) the fallback is
 * `taskkill /T` or a process-group kill, which needs the root process alive
 * to find its descendants and is slower.
 *
 * THE CAPS ARE DETECTED, THEN ENFORCED: the runner sees a cap crossed only
 * when it reads the event (turns), the byte count (output) or the timer
 * (wall clock), and then stops the tree. Whatever the process wrote before it
 * died is still read and counted. So a cap is not a hard limit; the overshoot
 * is measured and reported (`overshoot`).
 * THE BUDGET: Claude Code does not stream cost while it runs, only the total
 * in `result`; enforcing it during the run needs a price table, which the
 * protocol fixes only at Freeze 2. It is checked after the run.
 *
 * STATUSES AND THEIR PROTOCOL READING (frozen terms only):
 *   ended      exit with a result event: no status applies (protocolStatus null)
 *   CAPPED     stopped at a cap: INCOMPLETE (3.2)
 *   ABORTED    stopped from outside: INVALID (17.3)
 *   CRASHED    ended without a result, not at a cap, not from outside: the
 *              protocol does not define this case, so the status is UNKNOWN
 */

export type Caps = { wallMs: number; maxTurns: number; maxOutputBytes: number; maxCostUsd?: number };
export type RunnerStatus = "ENDED" | "CAPPED" | "ABORTED" | "CRASHED";
export type ProtocolStatus = "INCOMPLETE" | "INVALID" | "UNKNOWN" | null;

export const PROTOCOL_STATUS: Record<RunnerStatus, ProtocolStatus> = { ENDED: null, CAPPED: "INCOMPLETE", ABORTED: "INVALID", CRASHED: "UNKNOWN" };

export type Overshoot = {
  /** Which cap stopped the run, if any. */
  cap: "turns" | "wall" | "output" | null;
  /** Milliseconds from the moment the runner decided to stop the tree until the process's pipes closed. */
  stopToCloseMs: number | null;
  /** Wall-clock cap: milliseconds past the deadline when the process closed. */
  pastDeadlineMs: number | null;
  /** Turn cap: assistant events read after the one that crossed the cap. */
  turnsAfterCap: number | null;
  /** Output cap: bytes read after the chunk that crossed the cap. */
  bytesAfterCap: number | null;
};

export type ProcessResult = {
  status: RunnerStatus;
  protocolStatus: ProtocolStatus;
  reason: string;
  exitCode: number | null;
  turns: number;
  outputBytes: number;
  resultEvent: Record<string, unknown> | null;
  costUsd: number | null;
  costAboveCapWithoutStop: boolean;
  durationMs: number;
  treeKill: "job-object" | "taskkill" | "process-group";
  /** Job Object only: processes still alive in the job when the agent exited (then killed by the job). */
  lingeringAtExit: number | null;
  overshoot: Overshoot;
  events: Record<string, unknown>[];
  unparsedLines: number;
};

export function runProcess(o: {
  command: string; args: readonly string[]; cwd: string; env: Record<string, string>; caps: Caps;
  stdoutPath: string; stderrPath: string; signal?: AbortSignal;
  /** job-run.exe on Windows; without it the runner falls back to taskkill. */
  jobHelper?: string | null;
  statusPath?: string;
}): Promise<ProcessResult> {
  const t0 = Date.now();
  const deadline = t0 + o.caps.wallMs;
  const useJob = process.platform === "win32" && !!o.jobHelper && !!o.statusPath;
  const treeKill: ProcessResult["treeKill"] = useJob ? "job-object" : process.platform === "win32" ? "taskkill" : "process-group";
  if (useJob) rmSync(o.statusPath!, { force: true });
  const [cmd, args] = useJob ? [o.jobHelper!, [o.statusPath!, o.command, ...o.args]] : [o.command, [...o.args]];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
    const out = createWriteStream(o.stdoutPath);
    const err = createWriteStream(o.stderrPath);
    const events: Record<string, unknown>[] = [];
    let buffer = "", bytes = 0, turns = 0, unparsed = 0;
    let resultEvent: Record<string, unknown> | null = null;
    let stopped: { status: RunnerStatus; reason: string; cap: Overshoot["cap"]; at: number; turns: number; bytes: number } | null = null;
    const killTree = () => {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        if (treeKill === "job-object") child.kill(); // TerminateProcess on the helper: the job closes and the kernel kills the tree
        else if (treeKill === "taskkill") execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
        else process.kill(-pid, "SIGKILL");
      } catch { /* already gone */ }
    };
    const stop = (status: RunnerStatus, reason: string, cap: Overshoot["cap"] = null) => {
      if (stopped) return;
      stopped = { status, reason, cap, at: Date.now(), turns, bytes };
      killTree();
    };
    const timer = setTimeout(() => stop("CAPPED", `wall-clock cap ${o.caps.wallMs} ms`, "wall"), o.caps.wallMs);
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
        if (turns > o.caps.maxTurns) stop("CAPPED", `turn cap ${o.caps.maxTurns}`, "turns");
      }
      if (ev.type === "result") resultEvent = ev;
    };
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      out.write(chunk);
      if (bytes > o.caps.maxOutputBytes) stop("CAPPED", `output cap ${o.caps.maxOutputBytes} bytes`, "output");
      if (stopped?.cap === "output") return; // past the output cap the rest is counted, not parsed
      buffer += chunk.toString("utf8");
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) { onLine(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
    });
    child.stderr.on("data", (chunk: Buffer) => err.write(chunk));
    child.on("error", (e) => stop("CRASHED", `could not start: ${e.message}`));
    child.on("close", (code) => {
      const closedAt = Date.now();
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
      if (buffer && stopped?.cap !== "output") onLine(buffer);
      out.end(); err.end();
      let lingering: number | null = null;
      if (useJob && existsSync(o.statusPath!)) {
        try { lingering = (JSON.parse(readFileSync(o.statusPath!, "utf8")) as { activeAtExit: number }).activeAtExit; } catch { lingering = null; }
      }
      const r = resultEvent as Record<string, unknown> | null;
      const cost = r && typeof r.total_cost_usd === "number" ? r.total_cost_usd : null;
      const s = stopped as { status: RunnerStatus; reason: string; cap: Overshoot["cap"]; at: number; turns: number; bytes: number } | null;
      let final: { status: RunnerStatus; reason: string };
      if (s) final = s;
      else if (r && code === 0) final = { status: "ENDED", reason: "result event and exit 0" };
      else final = { status: "CRASHED", reason: r ? `result event but exit ${code}` : `exit ${code} without a result event` };
      resolve({
        status: final.status, protocolStatus: PROTOCOL_STATUS[final.status], reason: final.reason, exitCode: code,
        turns, outputBytes: bytes, resultEvent: r, costUsd: cost,
        costAboveCapWithoutStop: final.status === "ENDED" && cost !== null && o.caps.maxCostUsd !== undefined && cost > o.caps.maxCostUsd,
        durationMs: closedAt - t0, treeKill, lingeringAtExit: lingering,
        overshoot: {
          cap: s?.cap ?? null,
          stopToCloseMs: s ? closedAt - s.at : null,
          pastDeadlineMs: s?.cap === "wall" ? closedAt - deadline : null,
          turnsAfterCap: s?.cap === "turns" ? turns - s.turns : null,
          bytesAfterCap: s?.cap === "output" ? bytes - s.bytes : null,
        },
        events, unparsedLines: unparsed,
      });
    });
  });
}
