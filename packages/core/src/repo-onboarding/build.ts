import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderTemplate, type RepoFacts, type Rendered } from "./catalog/index.ts";
import { FAMILY_HE, KIND_HE, buildOrder, deliverable } from "./components.ts";
import { checkClaims, mcpPlaceholder, runHookCheck, statusAfter, toolsOf, validateComponent, validateScript, withRouting } from "./verify.ts";
import type { Component, ComponentValidation, DiscoveredProcess, RepoProfile } from "./types.ts";

/**
 * The build: approved cards become files in the isolated copy, by family in
 * dependency order — safety (deny lists, .gitignore, .gitattributes, the
 * secret hook), verification (scripts, the gate), knowledge (AGENTS.md and
 * the thin CLAUDE.md, per-path rules, docs), connections (MCP, plugins,
 * LSP), skills, agents, enforcement hooks — then each component is
 * validated its own way. A file a model wrote that fails its check is written
 * once more with what the check said; only then it fails.
 *
 * Files nobody owns alone (settings.json, .mcp.json, AGENTS.md, CLAUDE.md,
 * .gitignore, .gitattributes, package.json) are composed at the end, from
 * their state before the build and the parts of the cards that passed — a
 * failed card's deny rule, hook route, gate line or MCP entry is not in
 * them. A failed card's own files are taken out of the copy. Every card ends
 * verified, configured (a connection whose configuration is written and
 * parsed), failed, deferred or reported — never "installed, not checked".
 *
 * The text a model must write comes through `author`, injected, so the build
 * itself is pure on the file system and can run with a stand-in.
 */

export type Author = (input: {
  component: Component;
  format: string;
  process?: DiscoveredProcess | null;
  evidence?: string;
  /** Set on the one second attempt: the file written before failed its check — what the check said, and what to change. */
  fix?: string;
}) => Promise<string>;

export type BuildInput = {
  dir: string;
  repoName: string;
  profile: RepoProfile;
  cards: readonly Component[];
  processes: readonly DiscoveredProcess[];
  author: Author;
  log: (line: string) => void;
};

export type BuildOutcome = {
  key: string;
  status: Component["status"];
  /** The files it has in the copy now — its own and the shared ones its part is in. Empty for a failed card. */
  files: string[];
  validation: ComponentValidation | null;
  notes: string[];
  /** A model-written file failed its first check and was written once more: that first check. */
  retry: ComponentValidation | null;
  /** Its own files taken out of the copy because it failed (deleted, or put back as they were before the build). */
  removed: string[];
};

/** Every card's outcome, in build order, and every file taken out of the copy because its card failed. */
export type BuildRun = BuildOutcome[] & { removedFiles: string[] };

/** The files several cards write into; composed at the end from the cards that passed. */
export const SHARED_FILES: readonly string[] = [".claude/settings.json", ".mcp.json", "AGENTS.md", "CLAUDE.md", ".gitignore", ".gitattributes", "package.json"];

/* ── merging the shared files ─────────────────────────────────────── */

type Settings = { permissions?: { deny?: string[]; allow?: string[] }; hooks?: Record<string, { matcher?: string; hooks: unknown[] }[]>; enabledPlugins?: Record<string, boolean>; extraKnownMarketplaces?: Record<string, unknown>; [k: string]: unknown };

function readJson<T>(file: string, fallback: T): T {
  try { return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback; } catch { return fallback; }
}

const readOrNull = (dir: string, rel: string): string | null => { const f = path.join(dir, rel); return existsSync(f) ? readFileSync(f, "utf8") : null; };

export function mergeSettings(dir: string, fragment: NonNullable<Rendered["settings"]> | { enabledPlugins?: Record<string, boolean>; extraKnownMarketplaces?: Record<string, unknown> }): string {
  const file = path.join(dir, ".claude", "settings.json");
  mkdirSync(path.dirname(file), { recursive: true });
  const cur = readJson<Settings>(file, {});
  const f = fragment as Settings;
  if (f.permissions?.deny?.length) cur.permissions = { ...(cur.permissions ?? {}), deny: [...new Set([...(cur.permissions?.deny ?? []), ...f.permissions.deny])] };
  if (f.permissions?.allow?.length) cur.permissions = { ...(cur.permissions ?? {}), allow: [...new Set([...(cur.permissions?.allow ?? []), ...f.permissions.allow])] };
  if (f.hooks) {
    cur.hooks = cur.hooks ?? {};
    for (const [event, entries] of Object.entries(f.hooks)) {
      const list = (cur.hooks[event] ??= []);
      for (const e of entries as { matcher?: string; hooks: unknown[] }[]) {
        const same = list.find((x) => (x.matcher ?? "") === (e.matcher ?? ""));
        if (!same) { list.push(structuredClone(e)); continue; }
        for (const h of e.hooks) if (!same.hooks.some((x) => JSON.stringify(x) === JSON.stringify(h))) same.hooks.push(h);
      }
    }
  }
  if (f.enabledPlugins) cur.enabledPlugins = { ...(cur.enabledPlugins ?? {}), ...f.enabledPlugins };
  if (f.extraKnownMarketplaces) cur.extraKnownMarketplaces = { ...(cur.extraKnownMarketplaces ?? {}), ...f.extraKnownMarketplaces };
  writeFileSync(file, JSON.stringify(cur, null, 2) + "\n", "utf8");
  return ".claude/settings.json";
}

export function mergeMcp(dir: string, fragment: Record<string, unknown>): string {
  const file = path.join(dir, ".mcp.json");
  const cur = readJson<{ mcpServers?: Record<string, unknown> }>(file, {});
  const add = (fragment as { mcpServers?: Record<string, unknown> }).mcpServers ?? {};
  cur.mcpServers = { ...(cur.mcpServers ?? {}), ...add };
  writeFileSync(file, JSON.stringify(cur, null, 2) + "\n", "utf8");
  return ".mcp.json";
}

/** Lines appended once, under a header, to a file that may already exist. */
export function appendLines(dir: string, rel: string, lines: readonly string[], header: string): string {
  const file = path.join(dir, rel);
  const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
  const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
  const add = lines.filter((l) => l.trim() && !have.has(l.trim()));
  if (add.length) {
    const body = `${cur.length && !cur.endsWith("\n") ? "\n" : ""}${cur.includes(header) ? "" : `\n${header}\n`}${add.join("\n")}\n`;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, cur + body, "utf8");
  }
  return rel;
}

/** A block appended as it is — blank lines and repeated lines (a code fence) kept, unlike `appendLines`. Once: the same block already in the file is not added again; a block under a heading the file already has is added (its text is new). */
export function appendBlock(dir: string, rel: string, block: string, marker: string): string {
  const file = path.join(dir, rel);
  const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (cur.replace(/\r\n/g, "\n").includes(block.trim())) return rel;
  const body = `${cur.length && !cur.endsWith("\n") ? "\n" : ""}${cur.length ? "\n" : ""}${marker}\n${block.trim()}\n`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, cur + body, "utf8");
  return rel;
}

const INIT_MARKER = "<!-- DCC onboarding: taken from the /init draft, approved on its card -->";

function writeFile(dir: string, rel: string, content: string, mode?: number): string {
  const file = path.join(dir, rel);
  const inside = path.relative(path.resolve(dir), path.resolve(file));
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw new Error(`נתיב מחוץ לעותק: ${rel}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, { encoding: "utf8", mode });
  return rel;
}

/** A file's folders, up to the copy's root, removed while they are empty — a failed skill leaves no empty `.claude/skills/<name>/`. */
function pruneEmpty(dir: string, rel: string) {
  const root = path.resolve(dir);
  let cur = path.dirname(path.resolve(dir, rel));
  while (cur.startsWith(root) && cur !== root) {
    try { if (readdirSync(cur).length) return; rmdirSync(cur); } catch { return; }
    cur = path.dirname(cur);
  }
}

/** A file put back as it was before the build: its old text, or gone when it did not exist. */
function restore(dir: string, rel: string, before: string | null) {
  if (before === null) { rmSync(path.join(dir, rel), { force: true }); pruneEmpty(dir, rel); } else writeFileSync(path.join(dir, rel), before, "utf8");
}

/* ── the facts the templates need ─────────────────────────────────── */

/** The solution a build command names (`msbuild Altshuler.sln /t:Build`) — what the Windows build section and the gate build. */
function solutionOf(profile: RepoProfile): string | null {
  for (const c of [...profile.build.commands, ...profile.ci.commands]) {
    const m = c.match(/(?:^|[\s"'])([^\s"']+\.slnx?)(?=$|[\s"'])/i);
    if (m) return m[1]!.replace(/\\/g, "/").replace(/^\.\//, "");
  }
  return null;
}

export function repoFacts(profile: RepoProfile, repoName: string, defaultBranch: string | null): RepoFacts {
  const cmd = (c: string | undefined) => c?.replace(/\s+#.*$/, "").trim() || null;
  const test = profile.ci.commands.find((c) => /\b(test|vitest|jest|pytest|phpunit)\b/.test(c)) ?? (profile.tests.frameworks.find((f) => f.startsWith("package.json:"))?.replace(/^package\.json:(\S+).*$/, "npm run $1") ?? (profile.tests.frameworks.includes("go test") ? "go test ./..." : profile.tests.frameworks.includes("cargo test") ? "cargo test" : profile.tests.frameworks.includes("pytest") ? "pytest" : null));
  const lint = profile.lint_format.includes("eslint") ? "npx eslint ." : profile.lint_format.includes("ruff") ? "ruff check ." : profile.lint_format.includes("golangci-lint") ? "golangci-lint run" : null;
  return {
    name: repoName, buildCommand: cmd(profile.build.commands[0]), testCommand: test, lintCommand: lint,
    languages: profile.languages.slice(0, 4).map((l) => l.language), packageManager: profile.package_managers[0] ?? null, defaultBranch, windowsOnly: profile.windows_build.windows_only_build,
    // What this machine has and what git tracks — the build and test sections say what runs here from these, never from a guess.
    tools: toolsOf(profile) ?? null, testProjects: profile.tests.projects ?? null, testCommands: profile.tests.commands ?? null,
    solution: solutionOf(profile), webAppProjects: profile.windows_build.web_app_projects ?? null,
  };
}

/** Where things are, as the catalog draws it: the top folders and the folders holding many projects side by side — never a list of every package. */
const layoutOf = (p: RepoProfile) => ({ top: p.size.top_level_dirs, groups: p.layout?.unit_groups ?? [] });
/** The AGENTS.md template with the layout map from the diagnosis, unless the card brings its own. */
const agentsMdTemplate = (params: Record<string, unknown>, profile: RepoProfile, facts: RepoFacts) =>
  renderTemplate("agents-md", { layout: layoutOf(profile), ...params }, facts).files.find((f) => f.path === "AGENTS.md")?.content ?? "# {{PURPOSE}}\n\n{{RULES}}\n";

/* ── names: from stable keys, never from a title ──────────────────── */

const cutName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "");

/** A file or folder name: ASCII, cut to 40 characters and trimmed after the cut; from the key when the source has no letters to keep. */
export function nameFrom(source: string, key: string): string {
  return cutName(source) || cutName(key) || `c-${createHash("sha1").update(key).digest("hex").slice(0, 8)}`;
}

/** A process step's skill or agent is named `<process>-<step>`; any other card by its key. */
export const componentName = (c: Pick<Component, "key" | "params">): string =>
  nameFrom(typeof c.params.process === "string" && typeof c.params.step === "string" && c.params.process && c.params.step ? `${c.params.process}-${c.params.step}` : c.key, c.key);

/** The frontmatter's `name:` set to the file's own name — what Claude Code calls it and what the folder says must agree. */
export function setFrontmatterName(text: string, name: string): string {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return text;
  const fm = /^name:.*$/m.test(m[1]!) ? m[1]!.replace(/^name:.*$/m, () => `name: ${name}`) : `name: ${name}\n${m[1]!}`;
  return `---\n${fm}\n---${text.slice(m[0].length)}`;
}

/**
 * A skill or an agent Claude Code will load needs a frontmatter; when the author
 * wrote the body without one (it happened after a retry in the first research
 * round), the frontmatter is made from the card — the name, the card's own
 * "when to use me" sentence, the tools the kind allows — and the body is kept.
 * The validation then judges the body's claims, not the model's formatting.
 */
export function ensureFrontmatter(text: string, c: Pick<Component, "kind" | "title_he" | "why_he" | "what_he">, name: string): string {
  if (/^---\r?\n[\s\S]*?\r?\n---/.test(text)) return setFrontmatterName(text, name);
  const oneLine = (s: string) => s.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  const description = oneLine(`${c.title_he}. ${c.what_he}`).slice(0, 400);
  const fm = c.kind === "agent"
    ? [`name: ${name}`, `description: "${description}"`, "tools: Glob, Grep, Read, Bash", "model: sonnet"]
    : [`name: ${name}`, `description: "${description}"`, "allowed-tools: Read, Grep, Glob, Bash"];
  return `---\n${fm.join("\n")}\n---\n\n${text.replace(/^\s+/, "")}`;
}

/* ── AGENTS.md: the one file every tool reads, and the thin CLAUDE.md ── */

const AGENTS_HEADER = "## Rules for this repository (from DCC's diagnosis)";

const externalText = (p: RepoProfile) => Object.entries(p.external_systems).slice(0, 8).map(([k, v]) => `- ${k} (referenced in ${v.sample_files.slice(0, 2).map((f) => `\`${f}\``).join(", ")})`).join("\n") || "- none detected";
/** How a change is checked here — only that: the build and the tests have their own section, from the tools this machine has. The gate line is there only when the gate passed. */
const verificationText = (gate: boolean) => gate
  ? "- Before saying a change is done: `node scripts/dcc-verify.mjs` — its last line is the verdict."
  : "- Before saying a change is done, run the build and the tests above — or say plainly which of them cannot run here.";

function readmePurpose(dir: string): string | null {
  for (const n of ["README.md", "readme.md", "README"]) {
    const f = path.join(dir, n);
    if (!existsSync(f)) continue;
    const text = readFileSync(f, "utf8").replace(/^#.*$/gm, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
    const para = text.split(/\n\s*\n/).map((s) => s.replace(/\s+/g, " ").trim()).find((s) => s.length > 60 && !s.startsWith("[") && !s.startsWith("<"));
    if (para) return para.slice(0, 500);
  }
  return null;
}

/** The builder's slots of an AGENTS.md skeleton, filled from the diagnosis. */
function fillAgentsText(skeleton: string, f: { purpose: string | null; profile: RepoProfile; ruleLines: readonly string[]; hasGate: boolean }): string {
  return skeleton
    .replace("{{PURPOSE}}", f.purpose || "(not described in the repository)")
    .replace("{{LAYOUT}}", "(flat)") // the template draws the layout map; its slot is left only when there is nothing to map
    .replace("{{EXTERNAL}}", externalText(f.profile))
    .replace("{{RULES}}", f.ruleLines.length ? f.ruleLines.map((r) => `- ${r}`).join("\n") : "- (no rules beyond the facts above)")
    .replace("{{VERIFICATION}}", verificationText(f.hasGate))
    .replace(/\{\{[A-Z_]+\}\}/g, "");
}

/** What the build would write into AGENTS.md now, from the cards not declined and not taken from the `/init` draft — "ours" in the scan of the draft. No model: without a README paragraph, the purpose says the build writes it. */
export function previewAgentsMd(dir: string, profile: RepoProfile, repoName: string, cards: readonly Component[]): string {
  const facts = repoFacts(profile, repoName, null);
  const live = cards.filter((c) => c.source !== "init" && c.status !== "declined" && c.status !== "removed");
  const ruleLines = live.filter((c) => c.kind === "rule").map((c) => String(c.params.text ?? "").trim()).filter(Boolean);
  const hasGate = live.some((c) => c.kind === "script");
  const scaffold = live.find((c) => c.kind === "scaffold" && c.params.template === "agents-md");
  const delta = live.find((c) => c.kind === "doc" && c.params.template === "agents-md-delta");
  const purpose = readmePurpose(dir) ?? "(one paragraph the build writes from the code: what this repository is for)";
  const fill = (skeleton: string) => fillAgentsText(skeleton, { purpose, profile, ruleLines, hasGate });
  if (scaffold) return fill(agentsMdTemplate(scaffold.params, profile, facts));
  if (delta) return `(appended to the repository's existing instructions file)\n${fill(renderTemplate("agents-md-delta", delta.params, facts).files[0]?.content ?? `${AGENTS_HEADER}\n{{RULES}}\n`)}`;
  return ruleLines.length ? `${AGENTS_HEADER}\n${ruleLines.map((r) => `- ${r}`).join("\n")}\n` : "(no card of ours writes AGENTS.md)";
}

/** CLAUDE.md points at AGENTS.md when this build created AGENTS.md: a new one-line file, or the line added to the repository's own. */
function pointClaudeMd(dir: string, hadAgents: boolean): string[] {
  if (hadAgents) return [];
  const claude = readOrNull(dir, "CLAUDE.md");
  if (claude === null) return [writeFile(dir, "CLAUDE.md", "@AGENTS.md\n")];
  return claude.includes("@AGENTS.md") ? [] : [appendLines(dir, "CLAUDE.md", ["@AGENTS.md"], "<!-- the shared instructions -->")];
}

/* ── a model's answer, as a file ──────────────────────────────────── */

/** A model asked for "only the file" sometimes wraps it in a code fence anyway. */
export function stripFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[a-z]*\r?\n([\s\S]*?)\r?\n```$/);
  return (m ? m[1]! : t) + "\n";
}

/**
 * A model asked for a file that opens with frontmatter sometimes talks first ("Here is the file content:"): everything
 * before the first line that is exactly `---` is cut. When that talk opened a code fence around the file, the fence's
 * close (the last fence line) and what follows it go too.
 */
export function stripPreamble(text: string, needsFrontmatter: boolean): string {
  const t = text.replace(/^﻿/, "");
  if (!needsFrontmatter || /^---\r?\n/.test(t)) return t;
  const lines = t.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trimEnd() === "---");
  if (at < 0) return t;
  let rest = lines.slice(at);
  if (lines.slice(0, at).some((l) => /^\s*```/.test(l))) {
    const close = rest.map((l) => l.trim()).lastIndexOf("```");
    if (close > 0) rest = rest.slice(0, close);
  }
  return rest.join("\n");
}

/** The fence and the preamble off, one trailing newline. */
const asFile = (text: string, needsFrontmatter: boolean) => `${stripPreamble(stripFence(text).trimEnd(), needsFrontmatter).trimEnd()}\n`;

/* ── the build ────────────────────────────────────────────────────── */

/** What a card puts into the shared files, applied again at every composition; returns the files it touched. */
type Part = (x: Composition) => string[];
type Composition = { ruleLines: string[]; hasGate: boolean; scaffold: boolean; delta: boolean; rulesWritten: boolean };

type CardState = {
  card: Component;
  /** alive = built and still in the running; configured = an MCP that waits for the client's environment, not written. */
  state: "alive" | "failed" | "deferred" | "reported" | "configured";
  own: string[];
  parts: Part[];
  /** The shared files its parts touched in the last composition. */
  shared: string[];
  /** The shared files its parts went into while it was written — what a failed card is left out of. */
  drafted: string[];
  /** Params the build decided (the MCP server's name, the plugin's key) — what its check needs. */
  extra: Record<string, unknown>;
  /** A check that runs something (the gate, the hook) runs once; the composition cannot change its result. */
  ran: ComponentValidation | null;
  /** The text only this card added (a section from the /init draft) — what its check reads. */
  ownText: Map<string, string> | null;
  validation: ComponentValidation | null;
  retry: ComponentValidation | null;
  notes: string[];
  removed: string[];
};

const isGatherer = (c: Component) => (c.kind === "scaffold" && c.params.template === "agents-md") || (c.kind === "doc" && c.params.template === "agents-md-delta");
/** What the cards in the running decide for the shared files: the rule lines, the gate line, which card carries the rules. */
const compositionOf = (cards: readonly Component[]): Composition => ({
  ruleLines: cards.filter((c) => c.kind === "rule").map((c) => String(c.params.text ?? "").trim()).filter(Boolean),
  hasGate: cards.some((c) => c.kind === "script"),
  scaffold: cards.some((c) => c.kind === "scaffold" && c.params.template === "agents-md"),
  delta: cards.some((c) => c.kind === "doc" && c.params.template === "agents-md-delta"),
  rulesWritten: false,
});
const MODEL_WRITTEN_FIX = (v: ComponentValidation, files: readonly string[]) =>
  `The file you wrote (${files.join(", ")}) failed DCC's check "${v.how}": ${v.detail}. Write it again so that every path and command it names exists in this repository and runs on this machine — or say plainly that a step cannot be run here, without naming a tool that is not installed. Keep the same format and change nothing else.`;

export async function buildComponents(input: BuildInput): Promise<BuildRun> {
  const { dir, profile, log } = input;
  const facts = repoFacts(profile, input.repoName, null);
  const tools = toolsOf(profile);
  const cards = buildOrder(input.cards.filter((c) => c.status === "approved"));
  const baseline = new Map(SHARED_FILES.map((f) => [f, readOrNull(dir, f)] as const));
  const ownBefore = new Map<string, string | null>();
  const owner = new Map<string, string>();
  const states: CardState[] = [];
  const agentsPath = path.join(dir, "AGENTS.md");

  // While the cards are written, each one's parts go straight into the shared files, with every approved rule line and the gate — a working draft for the checks that decide on a second attempt. The final files are composed after.
  const draft = compositionOf(cards);
  const part = (s: CardState, p: Part) => { s.parts.push(p); const files = p(draft); s.shared.push(...files); s.drafted.push(...files); };

  const writeOwn = (s: CardState, rel: string, content: string, mode?: number): string => {
    const norm = rel.replace(/\\/g, "/").replace(/^\.\//, "");
    if (SHARED_FILES.includes(norm)) { part(s, () => [writeFile(dir, norm, content, mode)]); return norm; }
    const by = owner.get(norm);
    if (by && by !== s.card.key) throw new Error(`התנגשות שם עם ${by}: ${norm} כבר נכתב בשבילו — הרכיב הזה לא נכתב`);
    if (!ownBefore.has(norm)) ownBefore.set(norm, readOrNull(dir, norm));
    owner.set(norm, s.card.key);
    writeFile(dir, norm, content, mode);
    if (!s.own.includes(norm)) s.own.push(norm);
    return norm;
  };
  const claim = (s: CardState, rel: string) => { const by = owner.get(rel); if (by && by !== s.card.key) throw new Error(`התנגשות שם עם ${by}: ${rel} כבר נכתב בשבילו — הרכיב הזה לא נכתב`); };
  const cardNow = (s: CardState): Component => ({ ...s.card, status: "installed", files: [...new Set([...s.own, ...s.shared])], params: { ...s.card.params, ...s.extra } });
  /** What this build added to a shared file that existed before it — what a text's check reads, not the repository's own text. */
  const addedToShared = (): Map<string, string> => {
    const out = new Map<string, string>();
    for (const [f, before] of baseline) {
      if (before === null) continue;
      const now = readOrNull(dir, f);
      if (now !== null) out.set(f, now.startsWith(before) ? now.slice(before.length) : now);
    }
    return out;
  };
  const check = (s: CardState): ComponentValidation => {
    const c = cardNow(s);
    if (c.kind === "script") return s.ran ?? validateScript(c, dir);
    if (c.kind === "hook") return withRouting(s.ran ?? runHookCheck(c, dir), c, dir);
    return validateComponent(c, dir, { tools, appended: s.ownText ?? addedToShared() });
  };

  /* 1. every approved card written, and checked once so a model-written file gets its one second attempt */
  for (const c of cards) {
    const s: CardState = { card: c, state: "alive", own: [], parts: [], shared: [], drafted: [], extra: {}, ran: null, ownText: null, validation: null, retry: null, notes: [], removed: [] };
    states.push(s);
    const notes = s.notes;
    /** Writes the model's part of the card; called again, with what the check said, when that check fails. */
    let rewrite: ((fix: string) => Promise<void>) | null = null;
    try {
      log(`▸ ${FAMILY_HE[c.family]} · ${KIND_HE[c.kind]} · ${c.title_he}`);
      const template = String(c.params.template ?? "");
      if (template === "init-file" || template === "init-section") {
        // Taken from the /init draft: the approved text, as it is on the card — a whole new file, or a section added to AGENTS.md after ours.
        const text = String(c.params.text ?? "");
        if (template === "init-file") writeOwn(s, String(c.params.file), text.endsWith("\n") ? text : `${text}\n`);
        else {
          const heading = String(c.params.heading ?? c.title_he).replace(/^#+\s*/, "");
          const block = `## ${heading}\n\n${text}`;
          // What this card alone adds is what its check reads; AGENTS.md is delivered through other cards too.
          s.ownText = new Map([["AGENTS.md", block], ["CLAUDE.md", ""]]);
          part(s, () => { const had = existsSync(agentsPath); return [appendBlock(dir, "AGENTS.md", block, INIT_MARKER), ...pointClaudeMd(dir, had)]; });
        }
      } else switch (c.kind) {
        case "permission": {
          const r = renderTemplate("deny", { deny: c.params.deny }, facts);
          if (r.settings) { const settings = r.settings; part(s, () => [mergeSettings(dir, settings)]); }
          notes.push(...r.notes);
          break;
        }
        case "hook": {
          const r = renderTemplate(template, c.params, facts);
          for (const f of r.files) writeOwn(s, f.path, f.content, f.mode);
          if (r.settings) { const settings = r.settings; part(s, () => [mergeSettings(dir, settings)]); }
          notes.push(...r.notes);
          break;
        }
        case "gitignore": {
          const r = renderTemplate("gitignore", c.params, facts);
          const lines = r.files[0]?.content.split("\n").filter((l) => l && !l.startsWith("#")) ?? (c.params.entries as string[]);
          part(s, () => [appendLines(dir, ".gitignore", lines, "# added by DCC onboarding")]);
          break;
        }
        case "gitattributes": {
          const r = renderTemplate("gitattributes", c.params, facts);
          const lines = r.files[0]?.content.split("\n").filter((l) => l && !l.startsWith("#")) ?? [];
          part(s, () => [appendLines(dir, ".gitattributes", lines, "# generated code, marked by DCC onboarding")]);
          break;
        }
        case "script": {
          const r = renderTemplate(template || "local-gate", c.params, facts);
          for (const f of r.files) writeOwn(s, f.path, f.content, f.mode);
          const entry = r.files[0]?.path ?? "scripts/dcc-verify.mjs";
          // The repository's package.json learns `npm run verify` only if the gate passes — it is composed with the other shared files.
          part(s, () => {
            const pkg = path.join(dir, "package.json");
            if (!existsSync(pkg)) return [];
            try {
              const j = JSON.parse(readFileSync(pkg, "utf8")) as { scripts?: Record<string, string> };
              if (j.scripts?.verify) return [];
              j.scripts = { ...(j.scripts ?? {}), verify: `node ${entry}` };
              writeFileSync(pkg, JSON.stringify(j, null, 2) + "\n");
              return ["package.json"];
            } catch { return []; }
          });
          notes.push(...r.notes);
          break;
        }
        case "scaffold": {
          if (template === "agents-md") {
            const skeleton = agentsMdTemplate(c.params, profile, facts);
            const purpose = readmePurpose(dir) ?? ((await input.author({ component: c, format: "One paragraph of at most 60 words, plain text, no heading: what this repository is and what it is for, from the code itself. Nothing else." })).trim().split(/\n\s*\n/)[0] ?? "");
            part(s, (x) => {
              const text = fillAgentsText(skeleton, { purpose, profile, ruleLines: x.ruleLines, hasGate: x.hasGate });
              const had = existsSync(agentsPath);
              const files = had ? [appendLines(dir, "AGENTS.md", text.split("\n").filter((l) => !l.startsWith("# ")), "\n<!-- DCC onboarding: merged from the diagnosis -->")] : [writeFile(dir, "AGENTS.md", text)];
              return [...files, ...pointClaudeMd(dir, had)];
            });
            if (baseline.get("AGENTS.md") !== null) notes.push("AGENTS.md existed: the new sections were appended, nothing was overwritten");
          } else if (template === "per-package" || template === "per-area") {
            const r = renderTemplate(template, c.params, facts);
            for (const f of r.files) {
              let content = f.content;
              if (content.includes("{{PACKAGE_COMMANDS}}")) {
                const pkg = path.join(dir, path.dirname(f.path), "package.json");
                let cmds = "(see the root)";
                if (existsSync(pkg)) {
                  try { const sc = (JSON.parse(readFileSync(pkg, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {}; cmds = Object.entries(sc).filter(([k]) => /^(build|test|lint|dev|start|check|typecheck)$/.test(k)).map(([k, v]) => `- \`npm run ${k}\` → \`${v.slice(0, 80)}\``).join("\n") || cmds; } catch { /* keep the fallback */ }
                }
                content = content.replace("{{PACKAGE_COMMANDS}}", cmds);
              }
              if (!existsSync(path.join(dir, path.dirname(f.path)))) { notes.push(`${path.dirname(f.path)} does not exist — skipped`); continue; }
              writeOwn(s, f.path, content.replace(/\{\{[A-Z_]+\}\}/g, ""));
            }
            notes.push(...r.notes);
          } else if (template === "first-test") {
            const r = renderTemplate("first-test", c.params, facts);
            for (const f of r.files) writeOwn(s, f.path, f.content);
            notes.push(...r.notes);
            if (!r.files.length) s.state = "deferred";
          } else {
            const r = renderTemplate(template, c.params, facts);
            for (const f of r.files) writeOwn(s, f.path, f.content, f.mode);
            notes.push(...r.notes);
          }
          break;
        }
        case "rule": {
          // Rule lines live in AGENTS.md: AGENTS.md from the diagnosis carries them all, or the section added to the repository's own
          // instructions file does; without either, they go into a section of their own.
          part(s, (x) => {
            if (x.delta) return [existsSync(agentsPath) ? "AGENTS.md" : existsSync(path.join(dir, "CLAUDE.md")) ? "CLAUDE.md" : "AGENTS.md"];
            if (x.scaffold || x.rulesWritten) return ["AGENTS.md"];
            x.rulesWritten = true;
            const had = existsSync(agentsPath);
            return [appendLines(dir, "AGENTS.md", x.ruleLines.map((l) => `- ${l}`), AGENTS_HEADER), ...pointClaudeMd(dir, had)];
          });
          break;
        }
        case "doc": {
          if (template === "agents-md-delta") {
            const r = renderTemplate("agents-md-delta", c.params, facts);
            const skeleton = r.files[0]?.content ?? `${AGENTS_HEADER}\n{{RULES}}\n`;
            const purpose = readmePurpose(dir);
            part(s, (x) => {
              const section = fillAgentsText(skeleton, { purpose, profile, ruleLines: x.ruleLines, hasGate: x.hasGate });
              const target = existsSync(agentsPath) ? "AGENTS.md" : existsSync(path.join(dir, "CLAUDE.md")) ? "CLAUDE.md" : "AGENTS.md";
              return [appendLines(dir, target, section.split("\n"), "<!-- DCC onboarding: facts from the diagnosis -->")];
            });
            notes.push(...r.notes);
          } else {
            const rendered = renderTemplate(template || "docs-set", c.params, facts);
            // A document the reviewer (or a person) asked for names no catalog doc: it gets its own file under docs/, titled by the card — never "nothing written".
            const r = rendered.files.length ? rendered : { files: [{ path: `docs/${componentName(c)}.md`, content: `# ${c.title_he}\n\n{{BODY}}\n` }], notes: [...rendered.notes.filter((n) => !/nothing written/.test(n)), `written as docs/${componentName(c)}.md — the card named no catalog document`] };
            const writeDoc = async (f: { path: string; content: string }, fix?: string) => {
              const body = await input.author({ component: c, fix, format: `The body of the Markdown document "${f.path}" (no title line — it is already there): specific to this repository, every path and command checkable, at most 120 lines. Sections with ## headings.` });
              writeOwn(s, f.path, f.content.replace("{{BODY}}", body.trim()).replace(/\{\{[A-Z_]+\}\}/g, ""));
            };
            for (const f of r.files) { claim(s, f.path); await writeDoc(f); }
            // A second attempt rewrites the documents the check found fault in — all of them when none names anything checkable.
            rewrite = async (fix) => {
              const faulty = r.files.filter((f) => existsSync(path.join(dir, f.path)) && checkClaims(readFileSync(path.join(dir, f.path), "utf8"), dir, { tools, file: f.path }).missing.length);
              for (const f of faulty.length ? faulty : r.files) await writeDoc(f, fix);
            };
            notes.push(...r.notes);
          }
          break;
        }
        case "skill": {
          if (template === "process-skill" || !template) {
            const name = componentName(c);
            const file = `.claude/skills/${name}/SKILL.md`;
            claim(s, file);
            const proc = input.processes.find((p) => p.key === c.params.process) ?? null;
            const write = async (fix?: string) => {
              const text = await input.author({
                component: c, process: proc, fix,
                format: `A Claude Code skill file (SKILL.md) with YAML frontmatter between --- lines, the first line of the file being ---: name: ${name}; description: one paragraph saying what the skill does and WHEN to use it (Claude Code triggers on this sentence); allowed-tools: Read, Grep, Glob, Bash. Then a Markdown body: the steps of the procedure in order, each naming the exact files and commands as they are in this repository, what to check before saying it is done, and what NOT to do. At most 90 lines.`,
              });
              writeOwn(s, file, ensureFrontmatter(asFile(text, true), c, name));
            };
            await write();
            rewrite = write;
          } else {
            const r = renderTemplate(template, c.params, facts);
            for (const f of r.files) writeOwn(s, f.path, f.content.replace(/\{\{[A-Z_]+\}\}/g, ""), f.mode);
            notes.push(...r.notes);
          }
          break;
        }
        case "agent": {
          if (template === "process-agent" || !template) {
            const name = componentName(c);
            const file = `.claude/agents/${name}.md`;
            claim(s, file);
            const proc = input.processes.find((p) => p.key === c.params.process) ?? null;
            const write = async (fix?: string) => {
              const text = await input.author({
                component: c, process: proc, fix, evidence: Array.isArray(c.params.evidence) ? (c.params.evidence as string[]).join("\n") : undefined,
                format: `A Claude Code subagent definition (Markdown) with YAML frontmatter between --- lines, the first line of the file being ---: name: ${name}; description: one paragraph that says what this agent checks or does and WHEN the main agent should call it — this sentence is the "when to call me" test; tools: Glob, Grep, Read, Bash (read-only — never Edit or Write); model: sonnet. Body: the role in two sentences; the scope (the folders and files, from the process); a checklist of 5 to 10 concrete checks, each with the evidence that justifies it (a review comment, a bug, a convention seen in the code) — no generic advice; and the output format: a JSON array of findings {file, line, severity: block|warn|info, note}. At most 90 lines.`,
              });
              writeOwn(s, file, ensureFrontmatter(asFile(text, true), c, name));
            };
            await write();
            rewrite = write;
          } else {
            const r = renderTemplate(template, { ...c.params, withReviewMd: true }, facts);
            const write = async (fix?: string) => {
              const checklist = await input.author({ component: c, fix, format: "A Markdown checklist of 6 to 10 concrete review checks for this scope, one per line starting with '- [ ]', each naming the file or pattern it applies to and the evidence for it (history, conventions seen in the code). No generic advice. Nothing else." });
              for (const f of r.files) {
                // REVIEW.md is one per repository: the first reviewer writes it, a second one keeps its own agent file only.
                const by = owner.get(f.path);
                if (f.path === "REVIEW.md" && by && by !== c.key) { notes.push(`REVIEW.md already written by ${by} — kept`); continue; }
                writeOwn(s, f.path, f.content.replace("{{CHECKLIST}}", checklist.trim()).replace(/\{\{[A-Z_]+\}\}/g, ""), f.mode);
              }
            };
            for (const f of r.files) if (f.path !== "REVIEW.md") claim(s, f.path);
            await write();
            rewrite = write;
            notes.push(...r.notes);
          }
          break;
        }
        case "mcp": {
          const name = String(c.params.server ?? c.params.name ?? nameFrom(c.key, c.key));
          s.extra.server = name;
          const url = typeof c.params.url === "string" ? c.params.url : undefined;
          const command = typeof c.params.command === "string" ? c.params.command : undefined;
          // A source page (a repository, a docs page) is not an endpoint: the connection needs the client's details from its README.
          if (!command && (!url || /github\.com|learn\.microsoft\.com|docs\.|\/blob\/|\/tree\//i.test(url))) {
            s.state = "deferred";
            notes.push(`not connected: ${url ?? "no address"} is the server's page, not an endpoint — configure it from its README with the client's details, keeping only the tools the card names`);
            break;
          }
          // An address with a slot to fill (`{org}`) is not written: a session would fail on it. Its instruction goes into the pull request's report.
          const slot = mcpPlaceholder(c);
          if (slot !== null) {
            s.state = "configured";
            s.validation = { how: "הגדרת שרת ה-MCP", passed: true, detail: `דורש את הסביבה של הלקוח: ${slot} — לא נכתב ל-.mcp.json; ההוראה בדוח ה-PR`, at: new Date().toISOString() };
            notes.push(`not written: the address needs the client's environment (${slot}) — the instruction is in the pull request's report`);
            break;
          }
          const spec = { server: name, url, command, args: Array.isArray(c.params.args) ? c.params.args : undefined, tools: Array.isArray(c.params.tools) ? c.params.tools : undefined, readOnly: c.params.readOnly === true, env: c.params.env };
          const r = renderTemplate("mcp", spec, facts);
          const toolsLine = r.notes.find((n) => /use only/i.test(n)) ?? (spec.tools ? `MCP server \`${name}\`: use only these tools: ${spec.tools.join(", ")}; the rest are not loaded.` : null);
          const mcp = r.mcp;
          part(s, () => {
            const files = mcp ? [mergeMcp(dir, mcp)] : [];
            if (toolsLine && existsSync(agentsPath)) files.push(appendLines(dir, "AGENTS.md", [`- ${toolsLine}`], "## MCP"));
            return files;
          });
          notes.push(...r.notes.filter((n) => n !== toolsLine));
          break;
        }
        case "plugin": case "lsp": {
          const url = String(c.params.url ?? "");
          const gh = url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
          const marketplace = gh ? `${gh[1]}/${gh[2]!.replace(/\.git$/, "")}` : url;
          const pluginName = String(c.params.pluginName ?? c.params.name ?? nameFrom(c.key, c.key));
          const market = nameFrom(marketplace, c.key);
          const key = OFFICIAL.test(url) ? `${pluginName}@claude-plugins-official` : `${pluginName}@${market}`;
          s.extra.pluginKey = key;
          const fragment = OFFICIAL.test(url)
            ? { enabledPlugins: { [key]: true } }
            : { enabledPlugins: { [key]: true }, extraKnownMarketplaces: { [market]: { source: { source: "github", repo: marketplace } } } };
          part(s, () => [mergeSettings(dir, fragment)]);
          notes.push(`registered as ${key}; Claude Code installs it at the client's first session`);
          break;
        }
        case "review": case "pr_template": {
          const r = renderTemplate(c.kind === "review" ? "reviewer" : "pr-template", c.params, facts);
          for (const f of r.files) writeOwn(s, f.path, f.content.replace(/\{\{[A-Z_]+\}\}/g, ""), f.mode);
          break;
        }
        case "runner": s.state = "deferred"; notes.push("a requirement from the client, not a file"); break;
        case "report": s.state = "reported"; break;
        case "settings": case "devcontainer": {
          const r = renderTemplate(template, c.params, facts);
          for (const f of r.files) writeOwn(s, f.path, f.content, f.mode);
          if (r.settings) { const settings = r.settings; part(s, () => [mergeSettings(dir, settings)]); }
          break;
        }
      }
      if (s.state !== "alive") continue;
      // What runs something runs once, here; the rest is checked again on the final files.
      if (c.kind === "script") { s.ran = validateScript(cardNow(s), dir); if (s.ran.passed !== true) { s.state = "failed"; s.validation = s.ran; } }
      if (c.kind === "hook") { s.ran = runHookCheck(cardNow(s), dir); if (s.ran.passed !== true) { s.state = "failed"; s.validation = s.ran; } }
      if (rewrite) {
        const first = check(s);
        if (first.passed !== true) {
          s.retry = first;
          log(`  ↻ ${first.how}: ${first.detail} — writing it once more with what the check said`);
          await rewrite(MODEL_WRITTEN_FIX(first, s.own));
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  ✗ ${msg}`);
      s.state = "failed";
      s.validation = { how: "בנייה", passed: false, detail: msg.slice(0, 300), at: new Date().toISOString() };
    }
  }

  /* 2. the shared files composed from the cards still standing; a failed card's own files out; every card checked on the result — until nothing more fails */
  const compose = () => {
    for (const [f, before] of baseline) restore(dir, f, before);
    const alive = states.filter((s) => s.state === "alive");
    const x = compositionOf(alive.map((s) => s.card));
    for (const s of alive) s.shared = s.parts.flatMap((p) => p(x));
  };
  const takeOut = () => {
    for (const s of states) {
      if (s.state !== "failed") continue;
      for (const f of s.own) {
        if (owner.get(f) !== s.card.key) continue;
        restore(dir, f, ownBefore.get(f) ?? null);
        owner.delete(f);
        s.removed.push(f);
      }
      s.own = [];
      s.shared = [];
    }
  };
  for (let round = 0; round <= cards.length; round++) {
    compose();
    takeOut();
    let failed = 0;
    // A card whose text stands alone is judged first; AGENTS.md from the diagnosis gathers the rule lines and the gate, so it is judged once they are settled.
    for (const gatherers of [false, true]) {
      for (const s of states) {
        if (s.state !== "alive" || isGatherer(s.card) !== gatherers) continue;
        s.validation = check(s);
        if (s.validation.passed !== true) { s.state = "failed"; failed++; }
      }
      if (failed) break;
    }
    if (!failed) break;
  }
  compose();
  takeOut();

  /* 3. the outcome of every card */
  const out: BuildRun = Object.assign([] as BuildOutcome[], { removedFiles: [] as string[] });
  const removedFiles: string[] = [];
  for (const s of states) {
    const c = s.card;
    const status: Component["status"] = s.state === "alive" ? statusAfter(c, s.validation!) : s.state;
    const files = s.state === "alive" ? [...new Set([...s.own, ...s.shared])] : [];
    if (s.state === "failed") {
      if (s.removed.length) s.notes.push(`taken out of the copy: ${s.removed.join(", ")}`);
      if (s.drafted.length) s.notes.push(`left out of ${[...new Set(s.drafted)].join(", ")}`);
    }
    removedFiles.push(...s.removed);
    log(`  ${status === "verified" ? "✓" : status === "configured" ? "◆" : status === "failed" ? "✗" : "·"} ${c.title_he} · ${files.join(", ") || "—"}${s.validation ? ` — ${s.validation.how}: ${s.validation.detail}` : ""}`);
    out.push({ key: c.key, status, files, validation: s.validation, notes: s.notes, retry: s.retry, removed: s.removed });
  }
  out.removedFiles = [...new Set(removedFiles)];
  return out;
}

const OFFICIAL = /github\.com\/anthropics\/claude-plugins-official/i;

/* ── the repository's own record of the onboarding ────────────────── */

export const DOSSIER_FILE = ".dcc/onboarding.json";

/**
 * The one file the onboarding leaves in the repository: what was delivered, how each piece was verified, and the
 * measurement with and without it. No profile, no interview answers, no costs, no call ids, no local paths, no
 * secret locations — nothing a teammate reading the repository should not see. Any other file DCC once wrote into
 * `.dcc/` is removed from the copy.
 */
export function writeDossier(dir: string, input: {
  cards: readonly Component[];
  runId: string;
  baselineSha: string | null;
  /** The measurement with and without the set, as the run summarises it; null when it did not run. */
  eval?: unknown;
  /** Accepted from earlier callers and never written: the profile, the corrections, the trials and the processes stay in DCC. */
  profile?: unknown; corrections?: unknown; trials?: unknown; processes?: unknown;
}): string[] {
  const folder = path.join(dir, ".dcc");
  if (existsSync(folder)) for (const f of readdirSync(folder)) if (f.endsWith(".json") && `.dcc/${f}` !== DOSSIER_FILE) rmSync(path.join(folder, f), { force: true });
  const body = {
    writtenAt: new Date().toISOString(),
    runId: input.runId,
    baselineSha: input.baselineSha,
    delivered: input.cards.filter(deliverable).map((c) => ({ key: c.key, kind: c.kind, title_he: c.title_he, files: c.files, verified: { how: c.validation?.how ?? null, at: c.validation?.at ?? null } })),
    eval: input.eval ?? null,
  };
  return [writeFile(dir, DOSSIER_FILE, JSON.stringify(body, null, 2) + "\n")];
}
