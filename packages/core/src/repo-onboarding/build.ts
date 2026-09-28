import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderTemplate, type RepoFacts, type Rendered } from "./catalog/index.ts";
import { FAMILY_HE, KIND_HE, buildOrder } from "./components.ts";
import { validateComponent } from "./verify.ts";
import type { Component, ComponentValidation, DiscoveredProcess, RepoProfile } from "./types.ts";

/**
 * The build: approved cards become files in the isolated copy, by family in
 * dependency order — safety (deny lists, .gitignore, .gitattributes, the
 * secret hook), verification (scripts, the gate), knowledge (AGENTS.md and
 * the thin CLAUDE.md, per-path rules, docs), connections (MCP, plugins,
 * LSP), skills, agents, enforcement hooks — then each component is
 * validated its own way. Files nobody owns alone (settings.json, .mcp.json,
 * AGENTS.md, .gitignore) are merged, never overwritten. The text a model
 * must write comes through `author`, injected, so the build itself is pure
 * on the file system and can run with a stand-in.
 */

export type Author = (input: { component: Component; format: string; process?: DiscoveredProcess | null; evidence?: string }) => Promise<string>;

/** The text this build appended to a file that already existed — what its validation reads, not the whole file. */
type Appended = Map<string, string>;

export type BuildInput = {
  dir: string;
  repoName: string;
  profile: RepoProfile;
  cards: readonly Component[];
  processes: readonly DiscoveredProcess[];
  author: Author;
  log: (line: string) => void;
};

export type BuildOutcome = { key: string; status: Component["status"]; files: string[]; validation: ComponentValidation | null; notes: string[] };

/* ── merging the shared files ─────────────────────────────────────── */

type Settings = { permissions?: { deny?: string[]; allow?: string[] }; hooks?: Record<string, { matcher?: string; hooks: unknown[] }[]>; enabledPlugins?: Record<string, boolean>; extraKnownMarketplaces?: Record<string, unknown>; [k: string]: unknown };

function readJson<T>(file: string, fallback: T): T {
  try { return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback; } catch { return fallback; }
}

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
        if (!same) { list.push(e); continue; }
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
export function appendLines(dir: string, rel: string, lines: readonly string[], header: string, appended?: Appended): string {
  const file = path.join(dir, rel);
  const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
  const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
  const add = lines.filter((l) => l.trim() && !have.has(l.trim()));
  if (add.length) {
    const body = `${cur.length && !cur.endsWith("\n") ? "\n" : ""}${cur.includes(header) ? "" : `\n${header}\n`}${add.join("\n")}\n`;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, cur + body, "utf8");
    if (appended && cur.length) appended.set(rel, (appended.get(rel) ?? "") + body);
  }
  return rel;
}

function writeFile(dir: string, rel: string, content: string, mode?: number): string {
  const file = path.join(dir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, { encoding: "utf8", mode });
  return rel;
}

/* ── the facts the templates need ─────────────────────────────────── */

export function repoFacts(profile: RepoProfile, repoName: string, defaultBranch: string | null): RepoFacts {
  const cmd = (c: string | undefined) => c?.replace(/\s+#.*$/, "").trim() || null;
  const test = profile.ci.commands.find((c) => /\b(test|vitest|jest|pytest|phpunit)\b/.test(c)) ?? (profile.tests.frameworks.find((f) => f.startsWith("package.json:"))?.replace(/^package\.json:(\S+).*$/, "npm run $1") ?? (profile.tests.frameworks.includes("go test") ? "go test ./..." : profile.tests.frameworks.includes("cargo test") ? "cargo test" : profile.tests.frameworks.includes("pytest") ? "pytest" : null));
  const lint = profile.lint_format.includes("eslint") ? "npx eslint ." : profile.lint_format.includes("ruff") ? "ruff check ." : profile.lint_format.includes("golangci-lint") ? "golangci-lint run" : null;
  return {
    name: repoName, buildCommand: cmd(profile.build.commands[0]), testCommand: test, lintCommand: lint,
    languages: profile.languages.slice(0, 4).map((l) => l.language), packageManager: profile.package_managers[0] ?? null, defaultBranch, windowsOnly: profile.windows_build.windows_only_build,
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";

/* ── AGENTS.md: the one file every tool reads, and the thin CLAUDE.md ── */

const AGENTS_HEADER = "## Rules for this repository (from DCC's diagnosis)";

function layoutText(p: RepoProfile): string {
  const dirs = p.size.top_level_dirs.slice(0, 14).map((d) => `- \`${d}/\``);
  const pk = p.monorepo.is_monorepo ? [`Packages (${p.monorepo.package_count ?? p.monorepo.packages.length}): ${p.monorepo.packages.slice(0, 12).map((x) => `\`${x}\``).join(", ")}`] : [];
  return [...pk, ...dirs].join("\n") || "(flat)";
}
const externalText = (p: RepoProfile) => Object.entries(p.external_systems).slice(0, 8).map(([k, v]) => `- ${k} (referenced in ${v.sample_files.slice(0, 2).map((f) => `\`${f}\``).join(", ")})`).join("\n") || "- none detected";
const verificationText = (facts: RepoFacts, gate: boolean) => [
  facts.windowsOnly ? "- The build runs only on a Windows runner; without one, do not claim a build or a test run." : facts.buildCommand ? `- Build: \`${facts.buildCommand}\`` : "- No build command was detected.",
  facts.testCommand ? `- Tests: \`${facts.testCommand}\`` : "- No test framework was detected.",
  facts.lintCommand ? `- Lint: \`${facts.lintCommand}\`` : null,
  gate ? "- Before saying a change is done: `node scripts/dcc-verify.mjs`" : null,
].filter(Boolean).join("\n");

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
function fillAgentsText(skeleton: string, f: { purpose: string | null; profile: RepoProfile; facts: RepoFacts; ruleLines: readonly string[]; hasGate: boolean }): string {
  return skeleton
    .replace("{{PURPOSE}}", f.purpose || "(not described in the repository)")
    .replace("{{LAYOUT}}", layoutText(f.profile))
    .replace("{{EXTERNAL}}", externalText(f.profile))
    .replace("{{RULES}}", f.ruleLines.length ? f.ruleLines.map((r) => `- ${r}`).join("\n") : "- (no rules beyond the facts above)")
    .replace("{{VERIFICATION}}", verificationText(f.facts, f.hasGate))
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
  const fill = (skeleton: string) => fillAgentsText(skeleton, { purpose, profile, facts, ruleLines, hasGate });
  if (scaffold) return fill(renderTemplate("agents-md", scaffold.params, facts).files.find((f) => f.path === "AGENTS.md")?.content ?? "# {{PURPOSE}}\n\n{{RULES}}\n");
  if (delta) return `(appended to the repository's existing instructions file)\n${fill(renderTemplate("agents-md-delta", delta.params, facts).files[0]?.content ?? `${AGENTS_HEADER}\n{{RULES}}\n`)}`;
  return ruleLines.length ? `${AGENTS_HEADER}\n${ruleLines.map((r) => `- ${r}`).join("\n")}\n` : "(no card of ours writes AGENTS.md)";
}

/* ── the build ────────────────────────────────────────────────────── */

export async function buildComponents(input: BuildInput): Promise<BuildOutcome[]> {
  const { dir, profile, log } = input;
  const facts = repoFacts(profile, input.repoName, null);
  const out: BuildOutcome[] = [];
  const appended: Appended = new Map();
  const cards = buildOrder(input.cards.filter((c) => c.status === "approved"));
  const knownCommands = [...profile.build.commands, ...profile.ci.commands, facts.testCommand ?? "", facts.lintCommand ?? ""].filter(Boolean);
  const ruleLines = cards.filter((c) => c.kind === "rule").map((c) => String(c.params.text ?? "").trim()).filter(Boolean);
  const hasGate = cards.some((c) => c.kind === "script");
  let agentsWritten = false;
  const agentsPath = path.join(dir, "AGENTS.md");
  const claudePath = path.join(dir, "CLAUDE.md");

  const fillAgents = async (c: Component, skeleton: string, forDelta: boolean): Promise<string> => {
    let purpose = readmePurpose(dir);
    if (!purpose && !forDelta) {
      purpose = (await input.author({ component: c, format: "One paragraph of at most 60 words, plain text, no heading: what this repository is and what it is for, from the code itself. Nothing else." })).trim().split(/\n\s*\n/)[0] ?? "";
    }
    return fillAgentsText(skeleton, { purpose, profile, facts, ruleLines, hasGate });
  };

  for (const c of cards) {
    const notes: string[] = [];
    const files: string[] = [];
    let status: Component["status"] = "installed";
    try {
      log(`▸ ${FAMILY_HE[c.family]} · ${KIND_HE[c.kind]} · ${c.title_he}`);
      const template = String(c.params.template ?? "");
      switch (c.kind) {
        case "permission": {
          const r = renderTemplate("deny", { deny: c.params.deny }, facts);
          if (r.settings) files.push(mergeSettings(dir, r.settings));
          notes.push(...r.notes);
          break;
        }
        case "hook": {
          const r = renderTemplate(template, c.params, facts);
          for (const f of r.files) files.push(writeFile(dir, f.path, f.content, f.mode));
          if (r.settings) files.push(mergeSettings(dir, r.settings));
          notes.push(...r.notes);
          break;
        }
        case "gitignore": {
          const r = renderTemplate("gitignore", c.params, facts);
          const lines = r.files[0]?.content.split("\n").filter((l) => l && !l.startsWith("#")) ?? (c.params.entries as string[]);
          files.push(appendLines(dir, ".gitignore", lines, "# added by DCC onboarding"));
          break;
        }
        case "gitattributes": {
          const r = renderTemplate("gitattributes", c.params, facts);
          const lines = r.files[0]?.content.split("\n").filter((l) => l && !l.startsWith("#")) ?? [];
          files.push(appendLines(dir, ".gitattributes", lines, "# generated code, marked by DCC onboarding"));
          break;
        }
        case "script": {
          const r = renderTemplate(template || "local-gate", c.params, facts);
          for (const f of r.files) files.push(writeFile(dir, f.path, f.content, f.mode));
          const pkg = path.join(dir, "package.json");
          if (existsSync(pkg)) {
            try {
              const j = JSON.parse(readFileSync(pkg, "utf8")) as { scripts?: Record<string, string> };
              if (!j.scripts?.verify) { j.scripts = { ...(j.scripts ?? {}), verify: "node scripts/dcc-verify.mjs" }; writeFileSync(pkg, JSON.stringify(j, null, 2) + "\n"); files.push("package.json"); }
            } catch { notes.push("package.json could not be read; the verify script was not registered in it"); }
          }
          notes.push(...r.notes);
          break;
        }
        case "scaffold": {
          if (template === "agents-md") {
            const r = renderTemplate("agents-md", c.params, facts);
            const skeleton = r.files.find((f) => f.path === "AGENTS.md")?.content ?? "# {{PURPOSE}}\n\n{{RULES}}\n";
            const text = await fillAgents(c, skeleton, false);
            if (existsSync(agentsPath)) {
              files.push(appendLines(dir, "AGENTS.md", text.split("\n").filter((l) => !l.startsWith("# ")), `\n<!-- DCC onboarding: merged from the diagnosis -->`, appended));
              notes.push("AGENTS.md existed: the new sections were appended, nothing was overwritten");
            } else files.push(writeFile(dir, "AGENTS.md", text));
            if (!existsSync(claudePath)) files.push(writeFile(dir, "CLAUDE.md", "@AGENTS.md\n"));
            else if (!readFileSync(claudePath, "utf8").includes("@AGENTS.md")) files.push(appendLines(dir, "CLAUDE.md", ["@AGENTS.md"], "<!-- the shared instructions -->", appended));
            agentsWritten = true;
          } else if (template === "per-package" || template === "per-area") {
            const r = renderTemplate(template, c.params, facts);
            for (const f of r.files) {
              let content = f.content;
              if (content.includes("{{PACKAGE_COMMANDS}}")) {
                const pkg = path.join(dir, path.dirname(f.path), "package.json");
                let cmds = "(see the root)";
                if (existsSync(pkg)) {
                  try { const s = (JSON.parse(readFileSync(pkg, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {}; cmds = Object.entries(s).filter(([k]) => /^(build|test|lint|dev|start|check|typecheck)$/.test(k)).map(([k, v]) => `- \`npm run ${k}\` → \`${v.slice(0, 80)}\``).join("\n") || cmds; } catch { /* keep the fallback */ }
                }
                content = content.replace("{{PACKAGE_COMMANDS}}", cmds);
              }
              if (!existsSync(path.join(dir, path.dirname(f.path)))) { notes.push(`${path.dirname(f.path)} does not exist — skipped`); continue; }
              files.push(writeFile(dir, f.path, content.replace(/\{\{[A-Z_]+\}\}/g, "")));
            }
            notes.push(...r.notes);
          } else if (template === "first-test") {
            const r = renderTemplate("first-test", c.params, facts);
            for (const f of r.files) files.push(writeFile(dir, f.path, f.content));
            notes.push(...r.notes);
            if (!r.files.length) status = "deferred";
          } else {
            const r = renderTemplate(template, c.params, facts);
            for (const f of r.files) files.push(writeFile(dir, f.path, f.content, f.mode));
            notes.push(...r.notes);
          }
          break;
        }
        case "rule": {
          // Rule lines live in AGENTS.md; the scaffold writes them all at once, and without a scaffold they go into a section of their own.
          if (!agentsWritten && !cards.some((x) => x.kind === "scaffold" && x.params.template === "agents-md" && x.status === "approved")) {
            if (!existsSync(agentsPath)) {
              const r = renderTemplate("agents-md", {}, facts);
              const skeleton = r.files.find((f) => f.path === "AGENTS.md")?.content ?? "# {{PURPOSE}}\n\n{{RULES}}\n";
              files.push(writeFile(dir, "AGENTS.md", await fillAgents(c, skeleton, true)));
              if (!existsSync(claudePath)) files.push(writeFile(dir, "CLAUDE.md", "@AGENTS.md\n"));
            } else {
              files.push(appendLines(dir, "AGENTS.md", ruleLines.map((l) => `- ${l}`), AGENTS_HEADER, appended));
            }
            agentsWritten = true;
          } else files.push("AGENTS.md");
          break;
        }
        case "doc": {
          if (template === "agents-md-delta") {
            const r = renderTemplate("agents-md-delta", c.params, facts);
            const section = await fillAgents(c, r.files[0]?.content ?? `${AGENTS_HEADER}\n{{RULES}}\n`, true);
            const target = existsSync(agentsPath) ? "AGENTS.md" : existsSync(claudePath) ? "CLAUDE.md" : "AGENTS.md";
            files.push(appendLines(dir, target, section.split("\n"), "<!-- DCC onboarding: facts from the diagnosis -->", appended));
            notes.push(...r.notes);
          } else {
            const r = renderTemplate(template || "docs-set", c.params, facts);
            for (const f of r.files) {
              const body = await input.author({ component: c, format: `The body of the Markdown document "${f.path}" (no title line — it is already there): specific to this repository, every path and command checkable, at most 120 lines. Sections with ## headings.` });
              files.push(writeFile(dir, f.path, f.content.replace("{{BODY}}", body.trim()).replace(/\{\{[A-Z_]+\}\}/g, "")));
            }
            notes.push(...r.notes);
          }
          break;
        }
        case "skill": {
          const name = slug(template === "process-skill" ? `${c.params.processTitle ?? c.params.process}-${c.params.stepTitle ?? c.params.step}` : template || c.key);
          if (template === "process-skill" || !template) {
            const proc = input.processes.find((p) => p.key === c.params.process) ?? null;
            const text = await input.author({
              component: c, process: proc,
              format: `A Claude Code skill file (SKILL.md) with YAML frontmatter between --- lines: name: ${name}; description: one paragraph saying what the skill does and WHEN to use it (Claude Code triggers on this sentence); allowed-tools: Read, Grep, Glob, Bash. Then a Markdown body: the steps of the procedure in order, each naming the exact files and commands as they are in this repository, what to check before saying it is done, and what NOT to do. At most 90 lines.`,
            });
            files.push(writeFile(dir, `.claude/skills/${name}/SKILL.md`, stripFence(text)));
          } else {
            const r = renderTemplate(template, c.params, facts);
            for (const f of r.files) files.push(writeFile(dir, f.path, f.content.replace(/\{\{[A-Z_]+\}\}/g, ""), f.mode));
            notes.push(...r.notes);
          }
          break;
        }
        case "agent": {
          if (template === "process-agent" || !template) {
            const proc = input.processes.find((p) => p.key === c.params.process) ?? null;
            const name = slug(`${c.params.stepTitle ?? c.params.step ?? c.key}`);
            const text = await input.author({
              component: c, process: proc, evidence: Array.isArray(c.params.evidence) ? (c.params.evidence as string[]).join("\n") : undefined,
              format: `A Claude Code subagent definition (Markdown) with YAML frontmatter between --- lines: name: ${name}; description: one paragraph that says what this agent checks or does and WHEN the main agent should call it — this sentence is the "when to call me" test; tools: Glob, Grep, Read, Bash (read-only — never Edit or Write); model: sonnet. Body: the role in two sentences; the scope (the folders and files, from the process); a checklist of 5 to 10 concrete checks, each with the evidence that justifies it (a review comment, a bug, a convention seen in the code) — no generic advice; and the output format: a JSON array of findings {file, line, severity: block|warn|info, note}. At most 90 lines.`,
            });
            files.push(writeFile(dir, `.claude/agents/${name}.md`, stripFence(text)));
          } else {
            const r = renderTemplate(template, { ...c.params, withReviewMd: true }, facts);
            const checklist = await input.author({ component: c, format: "A Markdown checklist of 6 to 10 concrete review checks for this scope, one per line starting with '- [ ]', each naming the file or pattern it applies to and the evidence for it (history, conventions seen in the code). No generic advice. Nothing else." });
            for (const f of r.files) files.push(writeFile(dir, f.path, f.content.replace("{{CHECKLIST}}", checklist.trim()).replace(/\{\{[A-Z_]+\}\}/g, ""), f.mode));
            notes.push(...r.notes);
          }
          break;
        }
        case "mcp": {
          const name = String(c.params.server ?? c.params.name ?? slug(c.title_he.split(" (")[0] ?? c.key));
          c.params.server = name;
          const url = typeof c.params.url === "string" ? c.params.url : undefined;
          const command = typeof c.params.command === "string" ? c.params.command : undefined;
          // A source page (a repository, a docs page) is not an endpoint: the connection needs the client's details from its README.
          if (!command && (!url || /github\.com|learn\.microsoft\.com|docs\.|\/blob\/|\/tree\//i.test(url))) {
            status = "deferred";
            notes.push(`not connected: ${url ?? "no address"} is the server's page, not an endpoint — configure it from its README with the client's details, keeping only the tools the card names`);
            break;
          }
          const spec = { server: name, url, command, args: Array.isArray(c.params.args) ? c.params.args : undefined, tools: Array.isArray(c.params.tools) ? c.params.tools : undefined, readOnly: c.params.readOnly === true, env: c.params.env };
          const r = renderTemplate("mcp", spec, facts);
          if (r.mcp) files.push(mergeMcp(dir, r.mcp));
          const toolsLine = r.notes.find((n) => /use only/i.test(n)) ?? (spec.tools ? `MCP server \`${name}\`: use only these tools: ${spec.tools.join(", ")}; the rest are not loaded.` : null);
          if (toolsLine && existsSync(agentsPath)) files.push(appendLines(dir, "AGENTS.md", [`- ${toolsLine}`], "## MCP", appended));
          notes.push(...r.notes.filter((n) => n !== toolsLine));
          if (spec.url && /\{[a-z]+\}/.test(spec.url)) notes.push(`the address has a placeholder (${spec.url}) — fill in the client's environment before the first session`);
          break;
        }
        case "plugin": case "lsp": {
          const url = String(c.params.url ?? "");
          const gh = url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
          const marketplace = gh ? `${gh[1]}/${gh[2]!.replace(/\.git$/, "")}` : url;
          const pluginName = String(c.params.pluginName ?? c.params.name ?? slug(c.title_he.split(" ")[0] ?? c.key));
          const key = OFFICIAL.test(url) ? `${pluginName}@claude-plugins-official` : `${pluginName}@${slug(marketplace)}`;
          const fragment = OFFICIAL.test(url)
            ? { enabledPlugins: { [key]: true } }
            : { enabledPlugins: { [key]: true }, extraKnownMarketplaces: { [slug(marketplace)]: { source: { source: "github", repo: marketplace } } } };
          files.push(mergeSettings(dir, fragment));
          notes.push(`registered as ${key}; Claude Code installs it at the first session`);
          break;
        }
        case "review": case "pr_template": {
          const r = renderTemplate(c.kind === "review" ? "reviewer" : "pr-template", c.params, facts);
          for (const f of r.files) files.push(writeFile(dir, f.path, f.content.replace(/\{\{[A-Z_]+\}\}/g, ""), f.mode));
          break;
        }
        case "runner": status = "deferred"; notes.push("a requirement from the client, not a file"); break;
        case "report": status = "reported"; break;
        case "settings": case "devcontainer": {
          const r = renderTemplate(template, c.params, facts);
          for (const f of r.files) files.push(writeFile(dir, f.path, f.content, f.mode));
          if (r.settings) files.push(mergeSettings(dir, r.settings));
          break;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  ✗ ${msg}`);
      out.push({ key: c.key, status: "failed", files, validation: { how: "בנייה", passed: false, detail: msg.slice(0, 300), at: new Date().toISOString() }, notes });
      continue;
    }
    const uniq = [...new Set(files)];
    const withFiles: Component = { ...c, files: uniq, status };
    const validation = status === "installed" ? validateComponent(withFiles, dir, knownCommands, appended) : null;
    const finalStatus: Component["status"] = status !== "installed" ? status : validation?.passed === false ? "failed" : validation?.passed === true ? "verified" : "installed";
    log(`  ${finalStatus === "verified" ? "✓" : finalStatus === "failed" ? "✗" : "·"} ${uniq.join(", ") || "—"}${validation ? ` — ${validation.how}: ${validation.detail}` : ""}`);
    out.push({ key: c.key, status: finalStatus, files: uniq, validation, notes });
  }
  return out;
}

const OFFICIAL = /github\.com\/anthropics\/claude-plugins-official/i;

/** The repository's own copy of its dossier — the fixed `.dcc/` folder every onboarded repository carries: the profile
 *  the run diagnosed, every card with its decision and validation, the trial outcomes. The next run and any other tool
 *  can read them; nothing in them is a secret value (the profile records locations only). */
export function writeDossier(dir: string, input: { profile: RepoProfile; corrections: unknown[]; cards: readonly Component[]; trials: unknown[]; processes: readonly DiscoveredProcess[]; runId: string; baselineSha: string | null }): string[] {
  const at = new Date().toISOString();
  const files: [string, unknown][] = [
    [".dcc/profile.json", { writtenAt: at, runId: input.runId, baselineSha: input.baselineSha, corrections: input.corrections, profile: input.profile }],
    [".dcc/components.json", { writtenAt: at, runId: input.runId, components: input.cards.map((c) => ({ key: c.key, kind: c.kind, family: c.family, title: c.title_he, why: c.why_he, what: c.what_he, source: c.source, sourceRef: c.sourceRef, group: c.group, risk: c.risk, status: c.status, files: c.files, validation: c.validation, declineReason: c.declineReason })) }],
    [".dcc/processes.json", { writtenAt: at, runId: input.runId, processes: input.processes }],
    [".dcc/trials.json", { writtenAt: at, runId: input.runId, trials: input.trials }],
  ];
  return files.map(([rel, body]) => writeFile(dir, rel, JSON.stringify(body, null, 2) + "\n"));
}

/** A model asked for "only the file" sometimes wraps it in a code fence anyway. */
export function stripFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[a-z]*\r?\n([\s\S]*?)\r?\n```$/);
  return (m ? m[1]! : t) + "\n";
}
