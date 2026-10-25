#!/usr/bin/env node
// PreToolUse hook on Edit | Write | MultiEdit — written by DCC onboarding.
//
// Denies an edit inside a path that must not be edited by hand (generated
// code, signing keys, a vendored tree). A PreToolUse hook denies by exiting
// with code 2; what it writes to stderr is handed back to Claude as the
// reason. Every other outcome exits 0 and the edit goes ahead.
//
// An entry in PATHS is a directory or file path relative to the repository
// root ("src/generated", "Entities/"), the same with "/**", or a file-name
// pattern ("*.snk", "Entities.cs"). Test it without Claude:
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

function matches(rel, entry) {
  const e = fold(clean(entry).replace(/\/\*\*$/, ""));
  if (!e) return false;
  if (/[*?]/.test(e)) return globToRegExp(e).test(e.includes("/") ? rel : path.posix.basename(rel));
  if (rel === e || rel.startsWith(`${e}/`)) return true; // the path itself, or anything under it
  return !e.includes("/") && path.posix.basename(rel) === e; // a bare file name, anywhere
}

const event = readEvent();
if (!/^(Edit|Write|MultiEdit)$/.test(event.tool_name ?? "")) process.exit(0);
const file = event.tool_input?.file_path;
if (typeof file !== "string" || !file) process.exit(0);

const cwd = event.cwd || process.cwd();
const rel = fold(clean(path.isAbsolute(file) ? path.relative(cwd, file) : file));
if (rel === ".." || rel.startsWith("../")) process.exit(0); // outside the repository: not this hook's business

const hit = PATHS.find((p) => matches(rel, p));
if (!hit) process.exit(0);
process.stderr.write(`Blocked: ${rel} is under "${hit}" — ${REASON}.\n`);
process.exit(2);
