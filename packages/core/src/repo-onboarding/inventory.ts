import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Deterministic inventory of what the repository ALREADY carries for AI
 * tools and for humans — the "never assume the repository starts empty"
 * input every later stage reads before proposing anything. No model
 * call; type/name/path only, never a copy of the file.
 *
 * Detected conventions are the documented ones: Claude Code's own
 * (`CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules`, `.claude/skills`,
 * `.claude/agents`, `.claude/settings*.json`, `.mcp.json`), the
 * cross-tool `AGENTS.md`, and the other agents' instruction files Claude
 * Code's `/init` itself knows how to read (`.cursor/rules`, `.cursorrules`,
 * `.github/copilot-instructions.md`, `.github/instructions/*`, `.windsurf`,
 * `.clinerules`, `.kiro/steering`).
 */

export type InventoryItem = {
  /** claude_md | nested_claude_md | rule | skill | agent | settings | hook | mcp | agents_md | other_agent_rules | readme | contributing | security | docs_dir | adr | pr_template | codeowners | ci */
  type: string;
  path: string;
  /** Human-facing name (skill/agent frontmatter name, file name otherwise). */
  name: string;
  description?: string | null;
  lines?: number;
  /** Rule/skill `paths:` globs, when declared. */
  paths?: string[];
  /** Which tool family owns the convention. */
  tool: "claude_code" | "cross_tool" | "other_agent" | "human";
};

export type AiInventory = {
  items: InventoryItem[];
  /** Quick facts the classification and plan prompts key off. */
  summary: {
    hasClaudeMd: boolean; claudeMdLines: number; hasAgentsMd: boolean; hasClaudeDir: boolean;
    rules: number; skills: number; agents: number; hooks: number; mcpServers: number;
    otherAgentRules: number; readme: boolean; docsDirs: number; adrs: number; contributing: boolean; security: boolean; prTemplate: boolean; ci: number;
  };
};

function parseFrontmatter(text: string): { name?: string; description?: string; paths?: string[] } {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: { name?: string; description?: string; paths?: string[] } = {};
  const lines = m[1]!.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i]!.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const val = kv[2]!.trim();
    if (key === "name") out.name = val.replace(/^["']|["']$/g, "");
    else if (key === "description") out.description = val.replace(/^["']|["']$/g, "");
    else if (key === "paths") {
      const inline = val.match(/^\[(.*)\]$/);
      if (inline) out.paths = inline[1]!.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      else if (val) out.paths = val.split(/\s+/).map((s) => s.replace(/^["']|["']$/g, "")).filter(Boolean);
      else {
        out.paths = [];
        for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]!); j++) out.paths.push(lines[j]!.replace(/^\s*-\s+/, "").trim().replace(/^["']|["']$/g, ""));
      }
    }
  }
  return out;
}

const countLines = (p: string) => { try { return readFileSync(p, "utf8").split("\n").length; } catch { return 0; } };
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };
const listDirs = (p: string) => (isDir(p) ? readdirSync(p).filter((n) => isDir(path.join(p, n))) : []);
const listFiles = (p: string, ext?: string) => (isDir(p) ? readdirSync(p).filter((n) => isFile(path.join(p, n)) && (!ext || n.endsWith(ext))) : []);
const rel = (root: string, full: string) => path.relative(root, full).split(path.sep).join("/");

function walkMd(root: string, dir: string, out: string[], depth = 0) {
  if (depth > 4 || !isDir(dir)) return;
  for (const n of readdirSync(dir)) {
    const full = path.join(dir, n);
    if (isDir(full)) walkMd(root, full, out, depth + 1);
    else if (n.endsWith(".md")) out.push(rel(root, full));
  }
}

export function scanAiInventory(root: string): AiInventory {
  const items: InventoryItem[] = [];
  const add = (it: InventoryItem) => items.push(it);

  // Claude Code — project instructions (either documented location).
  for (const p of ["CLAUDE.md", ".claude/CLAUDE.md"]) {
    if (isFile(path.join(root, p))) add({ type: "claude_md", path: p, name: p, lines: countLines(path.join(root, p)), tool: "claude_code" });
  }
  if (isFile(path.join(root, "CLAUDE.local.md"))) add({ type: "claude_md", path: "CLAUDE.local.md", name: "CLAUDE.local.md (personal, gitignored)", lines: countLines(path.join(root, "CLAUDE.local.md")), tool: "claude_code" });
  // Nested CLAUDE.md files (loaded on demand when Claude reads that directory).
  const nested: string[] = [];
  const walkNested = (dir: string, depth: number) => {
    if (depth > 4 || !isDir(dir)) return;
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n === ".git" || n === "bin" || n === "obj" || n === "dist") continue;
      const full = path.join(dir, n);
      if (isDir(full)) { if (depth > 0 && isFile(path.join(full, "CLAUDE.md"))) nested.push(rel(root, path.join(full, "CLAUDE.md"))); walkNested(full, depth + 1); }
    }
  };
  walkNested(root, 0);
  for (const p of nested) add({ type: "nested_claude_md", path: p, name: p, lines: countLines(path.join(root, p)), tool: "claude_code" });

  // .claude/rules/**/*.md
  const rulesDir = path.join(root, ".claude", "rules");
  const ruleFiles: string[] = [];
  walkMd(root, rulesDir, ruleFiles);
  for (const p of ruleFiles) {
    const fm = parseFrontmatter(readFileSync(path.join(root, p), "utf8"));
    add({ type: "rule", path: p, name: path.basename(p, ".md"), paths: fm.paths, lines: countLines(path.join(root, p)), tool: "claude_code" });
  }
  // Skills — .claude/skills/<name>/SKILL.md and the legacy skills/ + .claude/commands/ layouts.
  for (const base of [".claude/skills", "skills"]) {
    for (const name of listDirs(path.join(root, base))) {
      const skillFile = path.join(root, base, name, "SKILL.md");
      if (!isFile(skillFile)) continue;
      const fm = parseFrontmatter(readFileSync(skillFile, "utf8"));
      add({ type: "skill", path: `${base}/${name}/SKILL.md`, name: fm.name ?? name, description: fm.description ?? null, paths: fm.paths, lines: countLines(skillFile), tool: "claude_code" });
    }
  }
  for (const f of listFiles(path.join(root, ".claude", "commands"), ".md")) {
    add({ type: "skill", path: `.claude/commands/${f}`, name: `/${f.replace(/\.md$/, "")} (legacy command)`, lines: countLines(path.join(root, ".claude", "commands", f)), tool: "claude_code" });
  }
  for (const f of listFiles(path.join(root, ".claude", "agents"), ".md")) {
    const fm = parseFrontmatter(readFileSync(path.join(root, ".claude", "agents", f), "utf8"));
    add({ type: "agent", path: `.claude/agents/${f}`, name: fm.name ?? f.replace(/\.md$/, ""), description: fm.description ?? null, tool: "claude_code" });
  }
  for (const settingsFile of ["settings.json", "settings.local.json"]) {
    const p = path.join(root, ".claude", settingsFile);
    if (!isFile(p)) continue;
    let cfg: { hooks?: Record<string, unknown>; permissions?: { allow?: string[]; deny?: string[] }; mcpServers?: Record<string, unknown> } | null = null;
    try { cfg = JSON.parse(readFileSync(p, "utf8")); } catch { cfg = null; }
    add({ type: "settings", path: `.claude/${settingsFile}`, name: settingsFile, description: cfg ? `deny: ${cfg.permissions?.deny?.length ?? 0} · allow: ${cfg.permissions?.allow?.length ?? 0} · hook events: ${Object.keys(cfg.hooks ?? {}).length}` : "(לא ניתן לפענח JSON)", tool: "claude_code" });
    for (const ev of Object.keys(cfg?.hooks ?? {})) add({ type: "hook", path: `.claude/${settingsFile}#hooks.${ev}`, name: ev, tool: "claude_code" });
    for (const s of Object.keys(cfg?.mcpServers ?? {})) add({ type: "mcp", path: `.claude/${settingsFile}#mcpServers.${s}`, name: s, tool: "claude_code" });
  }
  if (isFile(path.join(root, ".mcp.json"))) {
    let cfg: { mcpServers?: Record<string, unknown> } | null = null;
    try { cfg = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8")); } catch { cfg = null; }
    for (const s of Object.keys(cfg?.mcpServers ?? {})) add({ type: "mcp", path: `.mcp.json#mcpServers.${s}`, name: s, tool: "claude_code" });
    if (!cfg || Object.keys(cfg.mcpServers ?? {}).length === 0) add({ type: "mcp", path: ".mcp.json", name: ".mcp.json", tool: "claude_code" });
  }

  // Cross-tool and other-agent instruction files.
  if (isFile(path.join(root, "AGENTS.md"))) add({ type: "agents_md", path: "AGENTS.md", name: "AGENTS.md", lines: countLines(path.join(root, "AGENTS.md")), tool: "cross_tool" });
  const otherRules: { p: string; label: string }[] = [
    { p: ".cursorrules", label: "Cursor (legacy)" }, { p: ".github/copilot-instructions.md", label: "GitHub Copilot" },
    { p: ".windsurfrules", label: "Windsurf (legacy)" }, { p: ".clinerules", label: "Cline" }, { p: "GEMINI.md", label: "Gemini CLI" },
  ];
  for (const { p, label } of otherRules) if (isFile(path.join(root, p))) add({ type: "other_agent_rules", path: p, name: label, lines: countLines(path.join(root, p)), tool: "other_agent" });
  const otherDirs: { d: string; label: string }[] = [
    { d: ".cursor/rules", label: "Cursor rules" }, { d: ".github/instructions", label: "Copilot instructions" }, { d: ".windsurf/rules", label: "Windsurf rules" },
    { d: ".kiro/steering", label: "Kiro steering" }, { d: ".devin/rules", label: "Devin rules" },
  ];
  for (const { d, label } of otherDirs) {
    const files: string[] = [];
    walkMd(root, path.join(root, d), files);
    for (const n of listFiles(path.join(root, d))) if (n.endsWith(".mdc")) files.push(`${d}/${n}`);
    for (const p of files) add({ type: "other_agent_rules", path: p, name: `${label}: ${path.basename(p)}`, lines: countLines(path.join(root, p)), tool: "other_agent" });
  }

  // Human documentation that discovery must read before writing anything new.
  for (const n of readdirSync(root)) {
    if (/^readme(\.|$)/i.test(n) && isFile(path.join(root, n))) add({ type: "readme", path: n, name: n, lines: countLines(path.join(root, n)), tool: "human" });
    if (/^contributing(\.|$)/i.test(n) && isFile(path.join(root, n))) add({ type: "contributing", path: n, name: n, lines: countLines(path.join(root, n)), tool: "human" });
    if (/^security\.md$/i.test(n) && isFile(path.join(root, n))) add({ type: "security", path: n, name: n, lines: countLines(path.join(root, n)), tool: "human" });
    if (/^(docs?|documentation|wiki)$/i.test(n) && isDir(path.join(root, n))) {
      const md: string[] = [];
      walkMd(root, path.join(root, n), md);
      add({ type: "docs_dir", path: `${n}/`, name: `${n}/ (${md.length} markdown files)`, tool: "human" });
      for (const p of md) if (/(^|\/)(adr|adrs|decisions)\//i.test(p)) add({ type: "adr", path: p, name: path.basename(p), tool: "human" });
    }
  }
  for (const d of ["adr", "adrs", "decisions", "doc/adr", "docs/adr", "docs/decisions"]) {
    if (isDir(path.join(root, d))) for (const f of listFiles(path.join(root, d), ".md")) if (!items.some((i) => i.path === `${d}/${f}`)) add({ type: "adr", path: `${d}/${f}`, name: f, tool: "human" });
  }
  for (const p of [".github/PULL_REQUEST_TEMPLATE.md", ".github/pull_request_template.md", "PULL_REQUEST_TEMPLATE.md", "docs/PULL_REQUEST_TEMPLATE.md", ".azuredevops/pull_request_template.md"]) {
    if (isFile(path.join(root, p))) add({ type: "pr_template", path: p, name: "PR template", tool: "human" });
  }
  for (const p of ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"]) if (isFile(path.join(root, p))) add({ type: "codeowners", path: p, name: "CODEOWNERS", tool: "human" });
  for (const p of ["azure-pipelines.yml", ".gitlab-ci.yml", "Jenkinsfile", ".circleci/config.yml"]) if (isFile(path.join(root, p))) add({ type: "ci", path: p, name: p, tool: "human" });
  const wf = path.join(root, ".github", "workflows");
  for (const f of listFiles(wf)) if (/\.ya?ml$/i.test(f)) add({ type: "ci", path: `.github/workflows/${f}`, name: f, tool: "human" });

  const count = (t: string) => items.filter((i) => i.type === t).length;
  const claudeMd = items.find((i) => i.type === "claude_md" && i.path !== "CLAUDE.local.md");
  return {
    items,
    summary: {
      hasClaudeMd: !!claudeMd, claudeMdLines: claudeMd?.lines ?? 0, hasAgentsMd: count("agents_md") > 0, hasClaudeDir: isDir(path.join(root, ".claude")),
      rules: count("rule"), skills: count("skill"), agents: count("agent"), hooks: count("hook"), mcpServers: count("mcp"),
      otherAgentRules: count("other_agent_rules"), readme: count("readme") > 0, docsDirs: count("docs_dir"), adrs: count("adr"),
      contributing: count("contributing") > 0, security: count("security") > 0, prTemplate: count("pr_template") > 0, ci: count("ci"),
    },
  };
}

/** A compact, prompt-ready rendering of the inventory (paths + names only). */
export function renderInventoryForPrompt(inv: AiInventory): string {
  if (inv.items.length === 0) return "(nothing found — no README, no AI configuration, no docs directory)";
  const byType = new Map<string, InventoryItem[]>();
  for (const it of inv.items) byType.set(it.type, [...(byType.get(it.type) ?? []), it]);
  return Array.from(byType.entries())
    .map(([t, list]) => `${t}:\n${list.slice(0, 40).map((i) => `  - ${i.path}${i.lines ? ` (${i.lines} lines)` : ""}${i.description ? ` — ${i.description.slice(0, 120)}` : ""}${i.paths?.length ? ` [paths: ${i.paths.join(", ")}]` : ""}`).join("\n")}${list.length > 40 ? `\n  … +${list.length - 40}` : ""}`)
    .join("\n");
}
