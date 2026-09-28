import { execFileSync } from "node:child_process";
import { closeSync, createWriteStream, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync, type WriteStream } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IPty } from "@lydell/node-pty";
import { runtimeDir } from "./workspace.ts";
import type { SessionState } from "./types.ts";

/**
 * One terminal per onboarding run: the real, interactive Claude Code in a
 * pseudo-terminal, plus the lines DCC itself prints (its git steps), in one
 * stream the screen shows exactly as a terminal would. The person's
 * keystrokes go straight to Claude — slash commands, answers, Esc — so the
 * session behaves the same as it does in a terminal, because it is one.
 *
 * The stream is kept in memory (last 2 MB) and mirrored to
 * `<runtime>/terminal.log`, so a reconnect — or an API restart — replays
 * what was on screen. The PTY itself does not survive a restart; the same
 * conversation is reopened with `--resume <session-id>`.
 */

const require = createRequire(import.meta.url);
const pty = require("@lydell/node-pty") as typeof import("@lydell/node-pty");

const MAX_BUFFER = 2_000_000;
const REPLAY_FROM_LOG = 1_500_000;

export type TerminalMessage = { type: "output"; data: string } | { type: "state"; state: SessionState };
type Listener = (m: TerminalMessage) => void;

type Channel = {
  runId: string;
  buf: string;
  log: WriteStream;
  listeners: Set<Listener>;
  pty: IPty | null;
  state: SessionState;
  cols: number;
  rows: number;
  /** Who last typed into the session — the actor for what the transcript shows next. */
  lastInputUserId: string | null;
};

const channels = new Map<string, Channel>();

function readTail(file: string, bytes: number): string {
  if (!existsSync(file)) return "";
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const out = Buffer.alloc(len);
    readSync(fd, out, 0, len, size - len);
    return out.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function channel(runId: string): Channel {
  let c = channels.get(runId);
  if (c) return c;
  const dir = runtimeDir(runId);
  mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, "terminal.log");
  c = {
    runId,
    buf: readTail(logPath, REPLAY_FROM_LOG),
    log: createWriteStream(logPath, { flags: "a" }),
    listeners: new Set(),
    pty: null,
    state: "none",
    cols: 110,
    rows: 32,
    lastInputUserId: null,
  };
  channels.set(runId, c);
  return c;
}

function emit(c: Channel, data: string) {
  c.buf += data;
  if (c.buf.length > MAX_BUFFER) c.buf = c.buf.slice(c.buf.length - MAX_BUFFER);
  c.log.write(data);
  for (const l of c.listeners) l({ type: "output", data });
}

function setState(c: Channel, state: SessionState) {
  c.state = state;
  for (const l of c.listeners) l({ type: "state", state });
}

/** A line DCC itself prints into the run's terminal — dimmed, so it reads
 *  as "the system did this", not as Claude's output. */
export function terminalLine(runId: string, text: string) {
  emit(channel(runId), `\x1b[2m${text.replace(/\r?\n/g, "\r\n")}\x1b[0m\r\n`);
}

export function subscribeTerminal(runId: string, listener: Listener): { replay: string; state: SessionState; unsubscribe: () => void } {
  const c = channel(runId);
  c.listeners.add(listener);
  return { replay: c.buf, state: c.state, unsubscribe: () => c.listeners.delete(listener) };
}

export function writeTerminalInput(runId: string, data: string, userId: string | null) {
  const c = channels.get(runId);
  if (!c?.pty) return false;
  c.lastInputUserId = userId;
  c.pty.write(data);
  return true;
}

export function resizeTerminal(runId: string, cols: number, rows: number) {
  const c = channel(runId);
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || rows < 5 || cols > 400 || rows > 200) return;
  c.cols = cols;
  c.rows = rows;
  try { c.pty?.resize(cols, rows); } catch { /* the process may be exiting */ }
}

export const terminalState = (runId: string): SessionState => channels.get(runId)?.state ?? "none";
export const lastInputUser = (runId: string): string | null => channels.get(runId)?.lastInputUserId ?? null;

/* ── the Claude Code process ──────────────────────────────────────── */

/** The executable to put in the PTY. On Windows a global npm install exposes
 *  only a `claude.cmd` shim; a PTY needs a real executable, so the native
 *  binary the shim points at is used, falling back to `cmd.exe /c claude`. */
function claudeCommand(): { file: string; prefix: string[] } {
  const override = process.env.DCC_CLAUDE_BIN;
  if (override && !/\.cmd$/i.test(override)) return { file: override, prefix: [] };
  if (process.platform !== "win32") return { file: override ?? "claude", prefix: [] };
  try {
    const shim = override ?? execFileSync("where", ["claude.cmd"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/)[0]!.trim();
    const m = readFileSync(shim, "utf8").match(/"%dp0%\\([^"]+?\.exe)"/i);
    const exe = m ? path.join(path.dirname(shim), m[1]!) : null;
    if (exe && existsSync(exe)) return { file: exe, prefix: [] };
  } catch { /* fall through */ }
  return { file: process.env.ComSpec ?? "cmd.exe", prefix: ["/c", "claude"] };
}

const STATUSLINE_SCRIPT = fileURLToPath(new URL("./statusline.mjs", import.meta.url)).replace(/\\/g, "/");
export const statusFile = (runId: string) => path.join(runtimeDir(runId), "status.json");

/** `--settings` for the session: a status line that hands DCC the session's
 *  cost, model, effort and transcript path (Claude Code passes them to a
 *  status-line command) and shows a one-line summary in the terminal. */
function writeSessionSettings(runId: string): string {
  const file = path.join(runtimeDir(runId), "settings.json");
  const out = statusFile(runId).replace(/\\/g, "/");
  writeFileSync(file, JSON.stringify({ statusLine: { type: "command", command: `node "${STATUSLINE_SCRIPT}" "${out}"`, refreshInterval: 5 } }, null, 2), "utf8");
  return file;
}

export type StartSessionOptions = {
  runId: string;
  cwd: string;
  sessionId: string;
  /** Reopen the existing conversation instead of starting `/init`. */
  resume: boolean;
  model?: string;
  effort?: string;
  onExit: (exitCode: number | null) => void;
};

export function startClaudeSession(o: StartSessionOptions) {
  const c = channel(o.runId);
  if (c.pty) throw new Error("סשן Claude כבר פעיל בהרצה הזו");
  const settings = writeSessionSettings(o.runId);
  const args = [
    ...(o.resume ? ["--resume", o.sessionId] : ["--session-id", o.sessionId]),
    "--settings", settings,
    ...(o.model ? ["--model", o.model] : []),
    ...(o.effort ? ["--effort", o.effort] : []),
    ...(o.resume ? [] : ["/init"]),
  ];
  const cmd = claudeCommand();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  // A session launched from inside another Claude Code session must not
  // think it is nested.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  env.CLAUDE_CODE_NEW_INIT = "1";

  // A resumed process repaints the conversation itself; drawn on top of the
  // previous process's screen, its cursor moves land in the old output.
  // Start it on a clean screen (the full history stays in terminal.log).
  if (o.resume) emit(c, "\x1b[2J\x1b[3J\x1b[H");
  terminalLine(o.runId, `dcc$ claude ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
  const p = pty.spawn(cmd.file, [...cmd.prefix, ...args], { name: "xterm-256color", cols: c.cols, rows: c.rows, cwd: o.cwd, env });
  c.pty = p;
  setState(c, "live");
  p.onData((d) => emit(c, d));
  p.onExit(({ exitCode }) => {
    c.pty = null;
    terminalLine(o.runId, `\r\n[סשן Claude הסתיים${exitCode ? ` (קוד ${exitCode})` : ""}]`);
    setState(c, "ended");
    o.onExit(exitCode ?? null);
  });
}

/** `/exit` first, so Claude Code closes the conversation cleanly; the
 *  process is killed if it is still there after a few seconds. */
export async function stopClaudeSession(runId: string, graceful = true): Promise<void> {
  const c = channels.get(runId);
  const p = c?.pty;
  if (!c || !p) return;
  if (graceful) {
    // Esc closes an open menu first; the pause keeps the terminal from
    // reading Esc + "/" as one Alt-key sequence.
    try { p.write("\x1b"); } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 250));
    try { p.write("/exit\r"); } catch { /* already gone */ }
    for (let i = 0; i < 30 && c.pty; i++) await new Promise((r) => setTimeout(r, 200));
  }
  if (c.pty) try { c.pty.kill(); } catch { /* already gone */ }
}

/** A session DCC knows about but whose process is gone (API restart). */
export function markDisconnected(runId: string) {
  const c = channel(runId);
  if (!c.pty) setState(c, "disconnected");
}

export function killAllSessions() {
  for (const c of channels.values()) {
    if (c.pty) try { c.pty.kill(); } catch { /* already gone */ }
    c.log.end();
  }
}
