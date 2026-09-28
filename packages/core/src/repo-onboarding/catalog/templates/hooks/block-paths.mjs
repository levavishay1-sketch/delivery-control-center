#!/usr/bin/env node
// PreToolUse hook on Edit | Write | MultiEdit | NotebookEdit and on Bash | PowerShell — written by DCC onboarding.
//
// Denies a change inside a path that must not be edited by hand (generated
// code, signing keys, a vendored tree): an edit through Claude's file tools,
// and a shell command that writes there — a `>` / `>>` redirect,
// Set-Content / Add-Content / Out-File / New-Item, tee, touch, `sed -i`, or
// the destination of cp / mv / copy / move / Copy-Item / Move-Item. A
// PreToolUse hook denies by exiting with code 2; what it writes to stderr is
// handed back to Claude as the reason. Every other outcome exits 0 and the
// change goes ahead.
//
// Paths are relative to the project root: $CLAUDE_PROJECT_DIR when Claude
// Code sets it, else the event's cwd. An entry in PATHS is a directory or file
// path relative to that root ("src/generated", "Entities/"), the same with
// "/**", or a file-name pattern ("*.snk", "Entities.cs"). Test it without
// Claude:
//   node block-paths.mjs < event.json     (event = the JSON Claude Code sends)
import { readFileSync } from "node:fs";
import path from "node:path";

// Filled by DCC when the hook is written; edit here to change the list.
const CONFIG = /* @dcc:config */ {};
const PATHS = Array.isArray(CONFIG.paths) ? CONFIG.paths.map(String) : [];
const REASON = typeof CONFIG.reason === "string" && CONFIG.reason ? CONFIG.reason : "this path must not be edited by hand";
const fold = process.platform === "win32" ? (s) => s.toLowerCase() : (s) => s;

function readEvent() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

/** Forward slashes, no "./" prefix, no trailing slash. */
const clean = (p) => String(p).replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");

/** "*.snk" → /^[^/]*\.snk$/ — "**" crosses directories, "*" and "?" do not. */
function globToRegExp(glob) {
  let src = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { src += ".*"; i++; } else src += "[^/]*";
    } else if (c === "?") src += "[^/]";
    else src += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${src}$`);
}

/** `rel` is already folded; the entry is folded here. */
function matches(rel, entry) {
  const e = fold(clean(entry).replace(/\/\*\*$/, ""));
  if (!e) return false;
  if (/[*?]/.test(e)) return globToRegExp(e).test(e.includes("/") ? rel : path.posix.basename(rel));
  if (rel === e || rel.startsWith(`${e}/`)) return true; // the path itself, or anything under it
  return !e.includes("/") && path.posix.basename(rel) === e; // a bare file name, anywhere
}

const PATH_FLAGS = ["-path", "-literalpath", "-filepath"];
const DEST_FLAGS = ["-destination", "-t", "--target-directory"];

/** The files a shell command writes to, as far as its text says. */
function writeTargets(command) {
  const out = [];
  for (const m of command.matchAll(/(?<![<>&\d=-])\d?>>?\s*("[^"]+"|'[^']+'|[^\s;&|<>]+)/g)) {
    const t = m[1].replace(/^["']|["']$/g, "");
    if (!/^(&\d?|\/dev\/null|\$null|nul)$/i.test(t)) out.push(t);
  }
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const [head, ...args] = [...segment.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
    if (!head) continue;
    const cmd = head.toLowerCase();
    const flag = (names) => { const i = args.findIndex((a) => names.includes(a.toLowerCase())); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
    const plain = args.filter((a, i) => !a.startsWith("-") && !(i > 0 && [...PATH_FLAGS, ...DEST_FLAGS, "-value"].includes(args[i - 1].toLowerCase())));
    if (["set-content", "add-content", "out-file", "new-item", "sc", "ac", "ni", "tee-object"].includes(cmd)) {
      const t = flag(PATH_FLAGS) ?? plain[0];
      if (t) out.push(t);
    } else if (cmd === "tee" || cmd === "touch") out.push(...plain);
    else if (["cp", "copy", "copy-item", "cpi", "mv", "move", "move-item", "mi", "install"].includes(cmd)) {
      const t = flag(DEST_FLAGS) ?? (plain.length >= 2 ? plain[plain.length - 1] : null);
      if (t) out.push(t);
    } else if (cmd === "sed" && args.some((a) => /^-i/.test(a)) && plain.length) out.push(plain[plain.length - 1]);
  }
  return out;
}

const event = readEvent();
const tool = event.tool_name ?? "";
const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
const cwd = event.cwd || root;

let targets = [];
if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
  const file = event.tool_input?.file_path ?? event.tool_input?.notebook_path;
  if (typeof file === "string" && file) targets = [file];
} else if (/^(Bash|PowerShell)$/.test(tool)) {
  const command = event.tool_input?.command;
  if (typeof command === "string" && command) targets = writeTargets(command);
}

for (const target of targets) {
  const rel = clean(path.relative(root, path.resolve(cwd, target)));
  if (!rel || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) continue; // outside the repository: not this hook's business
  const hit = PATHS.find((p) => matches(fold(rel), p));
  if (!hit) continue;
  process.stderr.write(`Blocked: ${rel} is under "${hit}" — ${REASON}.\n`);
  process.exit(2);
}
process.exit(0);
