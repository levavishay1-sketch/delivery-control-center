#!/usr/bin/env node
// PreToolUse hook on Edit | Write | MultiEdit | NotebookEdit and on Bash | PowerShell — written by DCC onboarding.
//
// Stops a secret before it lands in the repository: it scans the text an
// edit is about to write and, when the command is a `git commit`, the staged
// diff — plus what a `git add` in the same command is about to stage (all
// changes and new files for `-A` / `.`, the named paths otherwise), since that
// has not happened yet when the hook runs — and the working tree for
// `commit -a`. It reports the kind of secret and the line with the value
// masked — never the value itself. Exit 2 + stderr is how a PreToolUse hook
// denies in Claude Code.
//
// With allowTests, files under tests/, __tests__/, spec/, fixtures/,
// testdata/ and *.test.* / *.spec.* are not scanned: fixtures hold fake
// credentials on purpose. Test it without Claude:
//   node secret-scan.mjs < event.json
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Filled by DCC when the hook is written.
const CONFIG = /* @dcc:config */ {};
const ALLOW_TESTS = CONFIG.allowTests === true;

// Group 1 of every pattern is the secret value; the report masks it.
const PATTERNS = [
  { kind: "AWS access key", re: /\b(AKIA[0-9A-Z]{16})\b/g },
  { kind: "private key block", re: /(-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----)/g },
  { kind: "password in a connection string", re: /\b(?:Password|Pwd)\s*=\s*([^;"'\s]{4,})\s*;/gi },
  { kind: "credentials in a database URL", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^:/\s@]+:([^@/\s]+)@/gi },
  { kind: "secret assigned in code", re: /\b(?:[a-z0-9]+_)*(?:password|passwd|secret|api_?key|access_?key|auth_?token|token|client_?secret)\b["']?\s*[:=]\s*["']([^"']{8,})["']/gi },
  { kind: "GitHub token", re: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { kind: "Slack token", re: /\b(xox[baprs]-[A-Za-z0-9-]{10,})/g },
  { kind: "Stripe live key", re: /\b(sk_live_[A-Za-z0-9]{8,})\b/g },
  { kind: "JWT", re: /\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g },
];
const PLACEHOLDER = /changethis|example|placeholder|xxx|dummy|<[^>]*>|\$\{|password123|redacted|fake|sample/i;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|fixtures?|testdata)\/|\.(test|spec)\.[^/]+$/i;

function readEvent() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function mask(line, value) {
  const shown = (value ? line.split(value).join("***") : line).trim();
  return shown.length > 160 ? `${shown.slice(0, 157)}...` : shown;
}

/** The secrets in `text`; `offset` is the line number before its first line. */
function scanText(text, where, offset = 0) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const { kind, re } of PATTERNS) {
      re.lastIndex = 0;
      for (let m = re.exec(line); m; m = re.exec(line)) {
        if (PLACEHOLDER.test(m[0])) continue;
        hits.push({ where, line: offset + i + 1, kind, masked: mask(line, m[1] ?? m[0]) });
        break;
      }
    }
  });
  return hits;
}

/** Added lines of a unified diff, with the file and the line number they land on. */
function scanDiff(diff) {
  let hits = [];
  let file = "";
  let skip = false;
  let lineNo = 0;
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++ ")) {
      file = raw.replace(/^\+\+\+ (b\/)?/, "").trim();
      skip = ALLOW_TESTS && TEST_PATH.test(file);
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) { lineNo = Number(hunk[1]) - 1; continue; }
    if (raw.startsWith("-")) continue;
    lineNo++;
    if (!raw.startsWith("+") || skip) continue;
    hits = hits.concat(scanText(raw.slice(1), file, lineNo - 1));
  }
  return hits;
}

function git(cwd, args) {
  const r = spawnSync("git", ["-c", "core.quotepath=off", ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 && typeof r.stdout === "string" ? r.stdout : "";
}

/** The paths the `git add` commands in `command` will stage: "." for everything (-A, --all, -u, .), else the paths named. */
function addSpecs(command) {
  const specs = new Set();
  for (const segment of command.split(/&&|\|\||[;\n]/)) {
    const m = /\bgit\b(?:\s+-[cC]\s+\S+)*\s+add\b(.*)$/.exec(segment);
    if (!m) continue;
    const args = [...m[1].matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((x) => x[1] ?? x[2] ?? x[3] ?? "");
    if (args.some((a) => ["-A", "--all", "-u", "--update", ".", ":/"].includes(a))) specs.add(".");
    for (const a of args) if (a && !a.startsWith("-")) specs.add(a);
  }
  return specs.has(".") ? ["."] : [...specs];
}

/** A new file's text, when it is text and not huge. */
function readNew(file) {
  try {
    const buf = readFileSync(file);
    return buf.length > 2_000_000 || buf.includes(0) ? "" : buf.toString("utf8");
  } catch {
    return "";
  }
}

const event = readEvent();
const tool = event.tool_name ?? "";
const input = event.tool_input ?? {};
const cwd = event.cwd || process.cwd();
let hits = [];

const shell = /^(Bash|PowerShell)$/.test(tool);
if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
  const raw = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : "";
  const rel = (path.isAbsolute(raw) ? path.relative(cwd, raw) : raw).replace(/\\/g, "/");
  if (ALLOW_TESTS && TEST_PATH.test(rel)) process.exit(0);
  const texts = [];
  if (typeof input.content === "string") texts.push(input.content);
  if (typeof input.new_string === "string") texts.push(input.new_string);
  if (typeof input.new_source === "string") texts.push(input.new_source);
  if (Array.isArray(input.edits)) for (const e of input.edits) if (typeof e?.new_string === "string") texts.push(e.new_string);
  for (const t of texts) hits = hits.concat(scanText(t, rel || "(new text)"));
} else if (shell) {
  const command = typeof input.command === "string" ? input.command : "";
  if (!/\bgit\b[^|&;]*\bcommit\b/.test(command)) process.exit(0);
  const flags = ["--no-color", "--no-ext-diff", "--unified=0"];
  hits = scanDiff(git(cwd, ["diff", "--cached", ...flags]));
  if (/\s(?:--all|-[a-zA-Z]*a[a-zA-Z]*)(?=\s|$)/.test(command)) hits = hits.concat(scanDiff(git(cwd, ["diff", ...flags])));
  // `git add … && git commit`: the add has not run yet, so what it will stage is scanned here — changed tracked files and new ones.
  const specs = addSpecs(command);
  if (specs.length) {
    hits = hits.concat(scanDiff(git(cwd, ["diff", ...flags, "--", ...specs])));
    for (const f of git(cwd, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...specs]).split("\0").filter(Boolean).slice(0, 2000)) {
      if (ALLOW_TESTS && TEST_PATH.test(f)) continue;
      const text = readNew(path.join(cwd, f));
      if (text) hits = hits.concat(scanText(text, f));
    }
  }
} else {
  process.exit(0);
}

if (!hits.length) process.exit(0);
const seen = new Set();
hits = hits.filter((h) => { const k = `${h.where}:${h.line}:${h.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
const what = hits.length === 1 ? "a secret" : `${hits.length} secrets`;
const lines = [`Blocked: ${what} would ${shell ? "go into the commit" : "be written"}. Move it to the environment or a secret store, or use a placeholder, then retry.`];
for (const h of hits.slice(0, 20)) lines.push(`  ${h.where}:${h.line}: ${h.kind} — ${h.masked}`);
if (hits.length > 20) lines.push(`  ... and ${hits.length - 20} more`);
process.stderr.write(`${lines.join("\n")}\n`);
process.exit(2);
